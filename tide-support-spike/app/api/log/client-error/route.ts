import { NextRequest, NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '../../../../lib/requireAdmin'
import { logSafeCategory, type SafeErrorCategory } from '../../../../lib/safeLog'

// Accepts a pre-categorised client-side failure and logs it server-side.
//
// This route NEVER accepts or logs free-text. The request body may contain
// only an `operation` string (a fixed label the client already knows, e.g.
// "case-001.decrypt") and a `category` value that must be a member of the
// closed SafeErrorCategory set. Any other shape, or a category outside the
// allowed set, is rejected with 400 before anything is logged — a
// compromised or modified client cannot use this endpoint to smuggle a raw
// error message, an ORK URL, a role name, or any other detail into the
// server log.
//
// Requires authentication (any valid Tide user) so this can't be used as an
// open, unauthenticated log-injection or log-flooding endpoint, matching the
// same guard used by the other /api/case/* routes.

const ALLOWED_CATEGORIES = new Set<string>([
  'forseti-denied-missing-role',
  'forseti-denied-other',
  'upstream-5xx',
  'upstream-404',
  'upstream-4xx',
  'error',
  'unknown',
])

function isAllowedCategory(value: unknown): value is SafeErrorCategory {
  if (typeof value !== 'string') return false
  if (ALLOWED_CATEGORIES.has(value)) return true
  // error:<ErrorName> — ErrorName restricted to a short identifier-shaped
  // string so this can't become a free-text channel either.
  return /^error:[A-Za-z][A-Za-z0-9]{0,39}$/.test(value)
}

const ALLOWED_OPERATIONS = new Set<string>(['case-001.decrypt', 'case-001.encrypt', 'case-001.verify-policy'])

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireAuthenticatedUser(request)
  if (!auth.ok) {
    return auth.response
  }

  const body = await request.json().catch(() => null)
  const operation = body?.operation
  const category = body?.category

  if (typeof operation !== 'string' || !ALLOWED_OPERATIONS.has(operation)) {
    return NextResponse.json({ error: 'Invalid operation' }, { status: 400 })
  }
  if (!isAllowedCategory(category)) {
    return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
  }

  logSafeCategory(`client:${operation}`, category)
  return NextResponse.json({ logged: true }, { status: 200 })
}
