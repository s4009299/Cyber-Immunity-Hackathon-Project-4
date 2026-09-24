import { NextRequest, NextResponse } from 'next/server'
import { requireTideRealmAdmin } from '../../../../lib/requireAdmin'
import { logSafeError } from '../../../../lib/safeLog'

// Server-side proxy that fetches customer1's vuid dynamically at request
// time. Used only when constructing the Forseti policy for case-001 — the
// vuid is never hardcoded anywhere in source, and this route mints its own
// admin token server-side (KC_BOOTSTRAP_ADMIN_PASSWORD, never exposed to the
// browser). The response contains only the vuid string, never a token, a
// password, or the customer's tideUserKey.

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
      `${TIDECLOAK_URL}/admin/realms/${REALM}/users?username=customer1&exact=true&briefRepresentation=false`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!res.ok) {
      return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 502 })
    }
    const users: Array<{ attributes?: { vuid?: string[] } }> = await res.json()
    const vuid = users[0]?.attributes?.vuid?.[0]
    if (!vuid) {
      return NextResponse.json({ error: 'customer1 has no vuid attribute' }, { status: 500 })
    }
    return NextResponse.json({ vuid }, { status: 200 })
  } catch (err) {
    logSafeError('admin.owner-vuid.GET', err)
    return NextResponse.json({ error: 'Internal error fetching owner vuid' }, { status: 500 })
  }
}
