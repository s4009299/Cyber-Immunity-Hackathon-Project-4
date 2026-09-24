import { NextRequest, NextResponse } from 'next/server'
import { requireTideRealmAdmin } from '../../../../lib/requireAdmin'
import { logSafeError } from '../../../../lib/safeLog'

// Server-side proxy for fetching the realm's signed tide-realm-admin policy.
// This is required because:
//   1. The endpoint requires an admin bearer token, which must never reach
//      the browser (AP-41).
//   2. TideCloak and the app are on different origins, so a direct browser
//      fetch would be blocked/opaque anyway.
//
// This route mints its own short-lived admin token server-side (from
// KC_BOOTSTRAP_ADMIN_PASSWORD in .env, never exposed to the client) and
// returns only the decoded policy bytes to the caller.
//
// Per Tide canon: the realm admin policy is named exactly "tide-realm-admin".
// Do not fall back to policies[0] if the name lookup misses — fail loudly.

const TIDECLOAK_URL = 'http://localhost:8080'
const REALM = 'support-spike'

async function getAdminToken(): Promise<string> {
  const password = process.env.KC_BOOTSTRAP_ADMIN_PASSWORD
  if (!password) {
    throw new Error('KC_BOOTSTRAP_ADMIN_PASSWORD is not set in the server environment')
  }
  const body = new URLSearchParams({
    username: 'admin',
    password,
    grant_type: 'password',
    client_id: 'admin-cli',
  })
  const res = await fetch(`${TIDECLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    throw new Error(`Failed to mint admin token: HTTP ${res.status}`)
  }
  const json = await res.json()
  return json.access_token as string
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTideRealmAdmin(request)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const token = await getAdminToken()
    const res = await fetch(
      `${TIDECLOAK_URL}/admin/realms/${REALM}/iga/role-policies`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch role policies: HTTP ${res.status}` },
        { status: 502 }
      )
    }
    const policies: Array<{ name: string; policy: string }> = await res.json()

    const matches = policies.filter((p) => p.name === 'tide-realm-admin')
    if (matches.length !== 1) {
      return NextResponse.json(
        { error: `Expected exactly one tide-realm-admin policy, found ${matches.length}` },
        { status: 500 }
      )
    }

    // Return the base64 text as-is; the browser decodes it (never decode and
    // re-encode server-side, per Tide canon).
    return NextResponse.json({ policyBase64: matches[0].policy }, { status: 200 })
  } catch (err) {
    logSafeError('admin.admin-policy.GET', err)
    return NextResponse.json({ error: 'Internal error fetching admin policy' }, { status: 500 })
  }
}
