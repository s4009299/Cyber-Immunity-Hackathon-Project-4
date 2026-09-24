import { NextRequest, NextResponse } from 'next/server'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { requireAuthenticatedUser } from '../../../../../lib/requireAdmin'
import { logSafeError } from '../../../../../lib/safeLog'

// Server-side storage for case-001's encrypted content (ciphertext only —
// this route never sees plaintext; encryption happens client-side via
// IAMService.doEncrypt before the ciphertext reaches here).
//
// POST (store the ciphertext): restricted to the case owner. Ownership is
// checked by comparing the caller's verified vuid (from their access token)
// against case-001's owner vuid, fetched fresh from TideCloak at request
// time via the same admin-token pattern used elsewhere — never hardcoded,
// never trusted from the client. This is deliberately NOT delegated to the
// customer realm role alone: holding "customer" only proves you are *a*
// customer, not that you own *this* case.
//
// GET (read the ciphertext): available to any authenticated user. Handing
// back ciphertext to a caller who cannot decrypt it (e.g. agent1 before the
// access-grant role is assigned) is not a disclosure — decryption is
// enforced by the Forseti contract inside the Tide enclave, not by this
// route. This mirrors real deployments where ciphertext blobs are commonly
// fetchable while only the decryption step is access-controlled.

const DATA_DIR = join(process.cwd(), 'data', 'case-content')
const CASE_KEY = 'case-001'
const TIDECLOAK_URL = 'http://localhost:8080'
const REALM = 'support-spike'
const OWNER_USERNAME = 'customer1'

function pathFor(): string {
  return join(DATA_DIR, `${CASE_KEY}.json`)
}

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

async function getCaseOwnerVuid(): Promise<string> {
  const token = await getAdminToken()
  const res = await fetch(
    `${TIDECLOAK_URL}/admin/realms/${REALM}/users?username=${OWNER_USERNAME}&exact=true&briefRepresentation=false`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) {
    throw new Error(`Failed to look up case owner: HTTP ${res.status}`)
  }
  const users: Array<{ attributes?: { vuid?: string[] } }> = await res.json()
  const vuid = users[0]?.attributes?.vuid?.[0]
  if (!vuid) {
    throw new Error('Case owner has no vuid attribute')
  }
  return vuid
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser(request)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const ownerVuid = await getCaseOwnerVuid()
    if (auth.vuid !== ownerVuid) {
      return NextResponse.json(
        { error: 'Forbidden: only the case owner may store case-001 content' },
        { status: 403 }
      )
    }

    const { encryptedBase64, tags } = await request.json()
    if (!encryptedBase64 || !Array.isArray(tags) || tags.length === 0) {
      return NextResponse.json({ error: 'encryptedBase64 and a non-empty tags array are required' }, { status: 400 })
    }

    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(pathFor(), JSON.stringify({ encryptedBase64, tags }), 'utf-8')
    return NextResponse.json({ stored: true }, { status: 200 })
  } catch (err) {
    logSafeError('case.case-001.data.POST', err)
    return NextResponse.json({ error: 'Failed to store case-001 content' }, { status: 500 })
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser(request)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const path = pathFor()
    if (!existsSync(path)) {
      return NextResponse.json({ error: 'No content stored for case-001' }, { status: 404 })
    }
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    return NextResponse.json(data, { status: 200 })
  } catch (err) {
    logSafeError('case.case-001.data.GET', err)
    return NextResponse.json({ error: 'Failed to read case-001 content' }, { status: 500 })
  }
}
