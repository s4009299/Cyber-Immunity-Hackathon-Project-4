import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { requireAuthenticatedUser } from '../../../../../lib/requireAdmin'
import { logSafeError } from '../../../../../lib/safeLog'

// Serves the already-signed case-001 Forseti policy bytes to any
// authenticated Tide user (customer1 or agent1). This is intentionally NOT
// the admin proxy (/api/admin/signed-policy) — that route is gated on
// tide-realm-admin and is used only during the one-time signing ceremony.
// Ordinary users need read access to the same bytes to attempt
// encrypt/decrypt: the policy is public in the sense that it is signed and
// self-verifying, and the real access decision is made by the Forseti
// contract inside the Tide enclave (via ValidateExecutor), not by this
// route. This route's job is only "are you a valid, authenticated Tide
// user" — never "are you allowed to access case-001" (that would duplicate,
// and could drift from, the contract's own logic).
//
// GET-only: nobody writes the policy through this route. Only the admin
// signing ceremony (POST /api/admin/signed-policy) may write it.

const DATA_DIR = join(process.cwd(), 'data', 'signed-policies')
const POLICY_KEY = 'case-001'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser(request)
  if (!auth.ok) {
    return auth.response
  }

  try {
    const path = join(DATA_DIR, `${POLICY_KEY}.json`)
    if (!existsSync(path)) {
      return NextResponse.json({ error: 'No signed policy stored for case-001' }, { status: 404 })
    }
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    return NextResponse.json(data, { status: 200 })
  } catch (err) {
    logSafeError('case.case-001.policy.GET', err)
    return NextResponse.json({ error: 'Failed to read case-001 policy' }, { status: 500 })
  }
}
