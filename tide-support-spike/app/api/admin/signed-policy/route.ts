import { NextRequest, NextResponse } from 'next/server'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { requireTideRealmAdmin } from '../../../../lib/requireAdmin'
import { logSafeError } from '../../../../lib/safeLog'

// Server-side storage for signed Forseti policy bytes, keyed by policyKey
// (here always "case-001"). Signed policy bytes are needed by every user who
// encrypts/decrypts case-001 content, so they are stored server-side (a
// gitignored data file), never in localStorage or in-memory only, per Tide
// canon's storage guidance for shared policies.
//
// This route does not perform any Tide-privileged action itself — it is
// pure storage, written to and read from by other routes.

const DATA_DIR = join(process.cwd(), 'data', 'signed-policies')

function pathFor(policyKey: string): string {
  // policyKey is restricted to a safe charset before being used in a path.
  if (!/^[a-zA-Z0-9-]+$/.test(policyKey)) {
    throw new Error('Invalid policyKey')
  }
  return join(DATA_DIR, `${policyKey}.json`)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTideRealmAdmin(request)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const { policyKey, policyBytesBase64 } = await request.json()
    if (!policyKey || !policyBytesBase64) {
      return NextResponse.json({ error: 'policyKey and policyBytesBase64 are required' }, { status: 400 })
    }
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(pathFor(policyKey), JSON.stringify({ policyBytesBase64 }), 'utf-8')
    return NextResponse.json({ stored: true }, { status: 200 })
  } catch (err) {
    logSafeError('admin.signed-policy.POST', err)
    return NextResponse.json({ error: 'Failed to store signed policy' }, { status: 500 })
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireTideRealmAdmin(request)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const policyKey = request.nextUrl.searchParams.get('policyKey')
    if (!policyKey) {
      return NextResponse.json({ error: 'policyKey query param is required' }, { status: 400 })
    }
    const path = pathFor(policyKey)
    if (!existsSync(path)) {
      return NextResponse.json({ error: 'No signed policy stored for this key' }, { status: 404 })
    }
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    return NextResponse.json(data, { status: 200 })
  } catch (err) {
    logSafeError('admin.signed-policy.GET', err)
    return NextResponse.json({ error: 'Failed to read signed policy' }, { status: 500 })
  }
}
