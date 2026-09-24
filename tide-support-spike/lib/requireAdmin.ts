import { NextRequest, NextResponse } from 'next/server'
import { verifyTideCloakToken } from '@tidecloak/nextjs/server'
import tcConfig from '../tidecloak.json'

// Shared fail-closed authorization guard for /api/admin/* routes.
//
// This app path is NOT itself a security boundary — "starts with /api/admin"
// is a naming convention, not an access control. Every route under it must
// independently verify:
//   1. A valid Authorization: Bearer <token> is present -> else 401.
//   2. The token verifies against the embedded JWKS (real Tide signature
//      verification, not a decode-only check) -> else 401.
//   3. The verified token's resource_access["realm-management"].roles
//      contains "tide-realm-admin" -> else 403.
//
// tide-realm-admin is a CLIENT role on the realm-management client, not a
// realm role (AP-29). Checking realm_access.roles here would always be
// false and silently lock out every real admin while looking correct.
//
// Possession of the server-side KC_BOOTSTRAP_ADMIN_PASSWORD, or the fact
// that a request originated from localhost, is NEVER treated as
// authorization by this guard. Those only ever gate the app's own
// server-to-TideCloak calls, never the browser-to-app call.
//
// Nothing here logs the token, the verified payload, or any claim value.

const REALM_MANAGEMENT_CLIENT = 'realm-management'
const ADMIN_ROLE = 'tide-realm-admin'

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; response: NextResponse }

/**
 * Verifies the request carries a valid Tide access token and returns its
 * decoded payload. Shared by requireTideRealmAdmin and
 * requireAuthenticatedUser — this is the ONLY place token verification is
 * implemented; every route-level guard composes on top of this.
 *
 * Never logs the token or payload. Never echoes the underlying verification
 * error back to the caller (it may contain token fragments) — callers
 * receive a generic 401 on any failure.
 */
export async function verifyBearerToken(
  request: NextRequest
): Promise<{ ok: true; payload: Record<string, any> } | { ok: false; response: NextResponse }> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized: missing or malformed Authorization header' },
        { status: 401 }
      ),
    }
  }

  const token = authHeader.slice('Bearer '.length)

  let payload: Record<string, any>
  try {
    payload = (await verifyTideCloakToken(tcConfig, token, [])) as Record<string, any>
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized: invalid token' }, { status: 401 }),
    }
  }

  if (!payload) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized: invalid token' }, { status: 401 }),
    }
  }

  return { ok: true, payload }
}

export async function requireTideRealmAdmin(request: NextRequest): Promise<AdminAuthResult> {
  const verified = await verifyBearerToken(request)
  if (!verified.ok) return verified

  const clientRoles: string[] =
    verified.payload?.resource_access?.[REALM_MANAGEMENT_CLIENT]?.roles ?? []

  if (!clientRoles.includes(ADMIN_ROLE)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden: tide-realm-admin role required' },
        { status: 403 }
      ),
    }
  }

  return { ok: true }
}

export type AuthenticatedUserResult =
  | { ok: true; vuid: string; realmRoles: string[] }
  | { ok: false; response: NextResponse }

/**
 * Fail-closed guard for /api/case/* routes: requires only a validly
 * verified Tide access token (any authenticated user — customer or agent),
 * no specific role. Case-specific authorization (who can encrypt/decrypt
 * case-001, who owns it) is enforced by the Forseti contract inside the
 * Tide enclave at encrypt/decrypt time, and — for the data-store route —
 * by the ownership/role check the caller performs using the returned vuid
 * and realmRoles.
 *
 * Returns the doken's vuid (payload.vuid — never the OIDC "sub", which
 * a Tide doken does not carry) and realm roles for the caller to make its
 * own authorization decision. Never logs the token, vuid, or roles.
 */
export async function requireAuthenticatedUser(
  request: NextRequest
): Promise<AuthenticatedUserResult> {
  const verified = await verifyBearerToken(request)
  if (!verified.ok) return verified

  const vuid = verified.payload?.vuid
  if (!vuid || typeof vuid !== 'string') {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized: token has no vuid claim' }, { status: 401 }),
    }
  }

  const realmRoles: string[] = verified.payload?.realm_access?.roles ?? []

  return { ok: true, vuid, realmRoles }
}
