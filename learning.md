# Kiro Learning Log — Tide-Protected Customer Support Platform

Running record of governance behavior, approvals, problems, and resolutions observed while
building this project. No credentials, tokens, VUID values, Tide user keys, or other secrets are
recorded here.

---

## Stage 2A — Base role creation and assignment

### Role-creation governance: resolved by direct observation, not assumed

Tide's vendor documentation states that realm-role **creation** is an "ACTIVE" action — auto-approved,
no change request, no quorum needed (only role *assignment* to a user is documented as governed).
A separate, version-matched runtime finding recorded elsewhere in the Tide knowledge base
contradicted this for the same TideCloak build we are running (Keycloak 26.7.0).

**We tested it empirically rather than trusting either source.** Creating the realm role `customer`
returned:

```
HTTP 202
Location: /admin/realms/support-spike/iga/change-requests/<id>
```

An immediate read-back of `GET /admin/realms/support-spike/roles/customer` returned `404` — the role
did not exist despite the `202`. The pending change request showed `status: PENDING,
readyToCommit: false`. This confirms role **creation** is governed on this build, contradicting the
vendor documentation and matching the version-matched runtime evidence.

**Resolution/practice adopted for the rest of the project**: treat every `2xx` from a governed admin
endpoint as *accepted*, never as *applied*. Always immediately GET the entity back before assuming
it exists, and check `GET .../iga/change-requests?status=PENDING` for a matching change request. This
same pattern repeated identically for all three roles created in Stage 2A (`customer`,
`support-agent`, `case-agent-access-case-001`) — each returned `202` + a change-request `Location`,
each required a manual enclave approval in the TideCloak Admin Console before the role actually
existed.

### Role-assignment governance: same rule, different response shape

Assigning an existing role to a user (`POST .../users/{id}/role-mappings/realm`) returned `204` with
no `Location` header — a different response shape than role *creation* (`202` + `Location`). This
initially looked like an immediate, unconditional success. It was not: a pending `GRANT_ROLES`
change request was created in both cases we tested (`customer` → `customer1`, `support-agent` →
`agent1`), and a direct read of the user's role mappings confirmed the role was **not** present
until the change request was approved via the Admin Console.

**Lesson**: do not assume "204 means no governance" just because the response contains no
`Location` header pointing at a change request. The change request still exists — it must be
discovered via the pending-changes list, not inferred from the mutation response alone.

### Approvals completed in Stage 2A

Five manual enclave approvals were required and completed via the TideCloak Admin Console, one at
a time, each verified via direct API read-back before the next was requested:

1. `CREATE_ROLE` — realm role `customer`
2. `CREATE_ROLE` — realm role `support-agent`
3. `CREATE_ROLE` — realm role `case-agent-access-case-001`
4. `GRANT_ROLES` — `customer` → `customer1`
5. `GRANT_ROLES` — `support-agent` → `agent1`

No approval was granted or requested for assigning `case-agent-access-case-001` to any user. That
role remains deliberately unassigned, confirmed via `GET .../roles/case-agent-access-case-001/users`
returning zero users.

### Container restart: confirmed non-destructive

Restarting the existing `tidecloak` Docker container (`docker start`, not `docker run`) against the
existing `./data` volume correctly preserved all Stage 1 state: the realm, both enrolled Tide
identities, the client configuration, and IGA/MultiAdmin mode. No data loss, no reinitialization.
Docker Desktop itself was not running at the start of this session and had to be started manually
before the container could be reached — this is an environment-level step, not a project issue.

### Problems encountered and resolutions

- **Docker Desktop was not running** at session start. Resolved by starting it directly and polling
  until the engine responded, before attempting any container operation.
- **No other technical problems** were encountered in Stage 2A. Every governed action behaved
  consistently with the "202/204 = accepted, not applied" rule once that rule was adopted, and no
  read-back check failed to explain an observed state.

---

## Stage 2B — Forseti policy signing ceremony

### First signing attempt failed: ORK threshold failure, request expired

The first attempt to run the case-001 policy-signing ceremony (`/admin/sign-policy`, the
`createTideRequest` → operator approval popup → `executeSignRequest` flow) failed with:

```
TIDE-TIDEJS-NET-THRESHOLD_FAILURE: 0 of 20 ORKs responded successfully
```

Every individual PreSign request behind that aggregate failure reported "This Tide Request has
Expired." No `ExpiresAtEpoch` policy parameter was involved in this contract at all — the
expiry was on the Tide *request* envelope itself (the operator-approval-to-ORK-execution window),
not anything we set. This looks like normal delay between generating the request and it reaching
the ORK network exceeding the request's own built-in validity window, not a bug in our code or
policy.

**Resolution**: retried the ceremony from a fresh page load (new `createTideRequest` call, new
approval popup, executed promptly). The second attempt succeeded immediately and the page
confirmed "Policy signed and stored successfully for case-001."

**Practice adopted**: treat ORK threshold/expiry failures as possibly transient and time-sensitive
— don't leave a signing request sitting approved-but-unexecuted for long. If a signing attempt
fails with `THRESHOLD_FAILURE` and "Request has Expired," the correct response is a clean retry
from the start of the ceremony, not troubleshooting the policy or contract definition.

### Security fix: /api/admin/* routes had zero authentication (caught in review, not self-discovered)

Before the signing ceremony, all three admin proxy routes
(`/api/admin/admin-policy`, `/api/admin/owner-vuid`, `/api/admin/signed-policy`) had no
authentication or authorization checks — they were reachable by anyone who could reach
`localhost:3000`, returning real TideCloak admin data with an HTTP 200. This was not caught during
initial build/smoke verification; it was flagged in review before the signing ceremony was
allowed to proceed.

**Fix**: added `lib/requireAdmin.ts` (`requireTideRealmAdmin`), a shared fail-closed guard applied
to every handler in all three routes: 401 if no/invalid bearer token (real signature verification
via `verifyTideCloakToken`, not a decode-only check), 403 if the verified token's
`resource_access["realm-management"].roles` does not include `tide-realm-admin` (a **client**
role, not a realm role — checking `realm_access.roles` here would always be false).

**Verified directly** (not just "build passed"):
- All three routes tested with no `Authorization` header → all returned `401` with a generic
  error, no data leaked.
- One route tested with a syntactically-invalid bearer token → `401`, confirming real signature
  verification runs (not just header-presence).
- The one-time signing ceremony page (`/admin/sign-policy`) was updated to attach a fresh
  `Authorization: Bearer <token>` (via the TideCloak provider's `getToken()`, never read from
  localStorage/sessionStorage) to every one of its three admin-route calls, and to gate its own UI
  on `hasClientRole('tide-realm-admin', 'realm-management')` — though the real boundary remains the
  server-side guard, not this page-level check.

### Case-specific routes kept separate from the admin proxy

Per explicit instruction, the routes customer1/agent1 use to fetch the case-001 policy and
store/read case-001 ciphertext (`/api/case/case-001/policy`, `/api/case/case-001/data`) are
separate from `/api/admin/*` and use a different, less privileged guard
(`requireAuthenticatedUser` in `lib/requireAdmin.ts`): any validly authenticated Tide user, no
specific role required. Case-level authorization for *decryption* is enforced by the Forseti
contract inside the Tide enclave, not by these routes. The one exception is *storing* case-001
content, which is restricted to the case owner by comparing the caller's verified vuid against a
freshly-fetched owner vuid (never hardcoded, never trusted from the request body).

All three case/admin routes were confirmed to return `401` when called with no `Authorization`
header before any case-001 workflow testing began.

### First Forseti policy signing attempt failed: ORK threshold failure, request expired

The first attempt to run the case-001 policy-signing ceremony (`/admin/sign-policy`, the
`createTideRequest` → operator approval popup → `executeSignRequest` flow) failed with:

```
TIDE-TIDEJS-NET-THRESHOLD_FAILURE: 0 of 20 ORKs responded successfully
```

Every individual PreSign request behind that aggregate failure reported "This Tide Request has
Expired." No `ExpiresAtEpoch` policy parameter was involved in this contract at all — the
expiry was on the Tide *request* envelope itself (the operator-approval-to-ORK-execution window),
not anything we set. This looks like normal delay between generating the request and it reaching
the ORK network exceeding the request's own built-in validity window, not a bug in our code or
policy.

**Resolution**: retried the ceremony from a fresh page load (new `createTideRequest` call, new
approval popup, executed promptly). The second attempt succeeded immediately and the page
confirmed "Policy signed and stored successfully for case-001."

**Practice adopted**: treat ORK threshold/expiry failures as possibly transient and time-sensitive
— don't leave a signing request sitting approved-but-unexecuted for long. If a signing attempt
fails with `THRESHOLD_FAILURE` and "Request has Expired," the correct response is a clean retry
from the start of the ceremony, not troubleshooting the policy or contract definition.

### Policy verification, customer encryption, and pre-grant agent denial — all confirmed live

With the case-001 policy signed and stored, three end-to-end browser checks were run against the
live TideCloak instance (not simulated):

1. **Policy verification** (`/case-001`, "Verify Policy"): the stored policy decoded successfully —
   version `3`, model IDs `PolicyEnabledEncryption:1` and `PolicyEnabledDecryption:1`, approval
   type `1` (IMPLICIT), execution type `0` (PRIVATE), signature present. The contractId, signed
   parameters (including the owner vuid), and raw signature bytes were deliberately not displayed
   by the verification UI and were not observed anywhere else either.
2. **Customer encryption**: logged in as `customer1`, encrypted case-001 test content via
   `IAMService.doEncrypt(data, policyBytes)`, and stored the resulting ciphertext through
   `POST /api/case/case-001/data`. Succeeded, as expected — customer1 is the case owner.
3. **Agent pre-grant denial**: logged in as `agent1` (before any role grant),
   attempted `IAMService.doDecrypt(data, policyBytes)` against the stored ciphertext. **Denied**,
   with the Forseti contract's own message surfaced end-to-end through the app:

   ```
   Forseti policy denied (Data, Executor): Missing role 'case-agent-access-case-001'.
   ```

   This confirms the contract's `ValidateExecutor` role-fallback branch is being reached and
   correctly rejecting a non-owner, non-role-holding caller — not a network error, not an auth
   error, and not a generic failure masquerading as a denial. The message names the exact missing
   role, which matches `AgentRole` as signed into the policy.

This is the required "confirm agent1 denied before role grant" checkpoint. The role
`case-agent-access-case-001` has deliberately not been assigned to `agent1` yet.

### Server-side log sanitisation: raw caught errors were never safe to log verbatim

Review caught that every `catch (err) { console.error('...', err) }` call across the admin and
case-specific API routes, plus both error paths in `middleware.ts` (`onFailure` logging its full
`ctx` object — which carries the raw token string — and `onError` logging the raw caught error),
passed an upstream error object straight to the server log. Errors surfaced from TideCloak/the Tide
enclave/the ORK network can legitimately embed ORK URLs, request identifiers, or other operational
detail in their message text, and nothing enforces that they never will in the future.

**Fix**: added `lib/safeLog.ts` (`logSafeError(operation, err)`), used at all 7 route call sites
and both middleware error paths. It logs only a fixed operation name plus a coarse category derived
from the error (`upstream-4xx` / `upstream-5xx` / `upstream-404` / `error:<ErrorName>` / `error` /
`unknown`) — never the error's message text, never `ctx`, never the raw object.

**Verified directly**: constructed a synthetic error whose message contained both a fake ORK URL
(`https://ork7.tide.org:9091/PreSign`) and a fake vuid-shaped hex string, ran it through the actual
categorisation logic, and confirmed the resulting log line
(`[test.operation] failed { category: 'upstream-5xx' }`) contained neither value. Production build
rebuilt clean afterward (13 routes, no TypeScript errors).

### Role grant to agent1: IGA-governed, one CR, verified by direct read-back at every step

Followed the same "202/204 = accepted, not applied" discipline established in Stage 2A for this
grant:

1. Verified the pending change-request queue was empty and that agent1 held only `support-agent`
   and `default-roles-support-spike` (no `case-agent-access-case-001`) before submitting anything.
2. Submitted exactly one `POST /users/{agent1Id}/role-mappings/realm` call. Response: `204`, no
   `Location` header — the same response shape observed for grants in Stage 2A. A direct read-back
   confirmed the role had **not** taken effect yet (0 holders, agent1's role list unchanged), and
   exactly one new `GRANT_ROLES` change request existed: `status: PENDING`, `readyToCommit: false`,
   `authorizationCount: 0`. CR ID `d4421a3d-7ced-4ee0-9c58-00bfc0969fff`.
3. Reported the CR ID and stopped for manual approval, as required.
4. **First read-back after the reported approval showed no change** — the CR was still
   `status: PENDING`, `authorizationCount: 0`, and the role still had 0 holders. Rather than
   assume the approval had silently applied or wait it out, this was flagged directly as a
   discrepancy between what was reported and what the API showed, and confirmation of the exact
   action taken was requested before proceeding.
5. After confirmation that the CR had specifically been authorised **and committed** (not just
   authorised — TideCloak's governed-role-grant flow apparently requires both steps, matching the
   two-phase pattern implied by the `readyToCommit` field), a second read-back showed the change
   fully applied: CR `status: APPROVED`, `resolvedAt` set, `authorizationCount: 1`, authorised by
   `admin`; `case-agent-access-case-001` now has exactly one holder, `agent1`; agent1's realm role
   mappings are `support-agent`, `case-agent-access-case-001`, `default-roles-support-spike`; the
   pending queue is empty (count 0).

**Lesson reinforced**: "approved" and "committed" are not necessarily interchangeable action
verbs for this governance mechanism on this build, and a `PENDING`-with-`authorizationCount:0`
read-back after a reported approval is a real signal worth surfacing immediately, not something to
retry past silently.

### Post-grant decrypt test: agent1 now authorized, confirmed live

With the role grant verified in place, `agent1` logged out and back in (picking up a fresh doken
carrying the newly-granted role) and re-ran the same "Attempt Decrypt" action against case-001's
stored ciphertext used for the pre-grant denial test. Result:

```
Decrypted: Test encrypted support case for case-001.
```

This is a genuine decrypt success, not a cached or simulated result — it is the same ciphertext
that was previously denied to `agent1` before the grant, decrypted via the same
`IAMService.doDecrypt(data, policyBytes)` call, now succeeding because the Forseti contract's
`ValidateExecutor` role-fallback branch (`RequireRole(executor, AgentRole)`) now finds the role on
agent1's doken. Together with the pre-grant denial recorded above, this demonstrates the full
grant-enables-access half of the required access-control round trip. The revoke-and-reverify half
has deliberately not been attempted yet.

### Role revocation: IGA-governed, one CR, "authorised" and "committed" both required again

Followed the identical discipline used for the grant, in reverse:

1. Verified preconditions before submitting anything: pending queue empty, agent1 confirmed as the
   sole holder of `case-agent-access-case-001`.
2. Submitted exactly one `DELETE /users/{agent1Id}/role-mappings/realm` call. Response: `204`, no
   `Location` header — the same shape observed for the grant. Read-back confirmed the role had
   **not** been removed yet (agent1 still held it, still the sole holder), and exactly one new
   `REVOKE_ROLES` change request existed: `status: PENDING`, `authorizationCount: 0`,
   `readyToCommit: false`. CR ID `71388c79-1c5c-45b7-9b91-9fa75c4a94d6`.
3. Reported the CR ID and stopped for manual approval.
4. A later check (after a Docker Desktop / TideCloak container restart mid-session — the container
   had exited and was restarted non-destructively via `docker start tidecloak` against the existing
   volume, then confirmed responsive before querying) showed the CR still `PENDING`,
   `authorizationCount: 0` — not yet acted on.
5. After confirmation that the CR had been **authorised and committed** (both steps, matching the
   grant's pattern), a fresh read-back showed: CR `status: APPROVED`, `resolvedAt` set,
   `authorizationCount: 1`, authorised by `admin`; `case-agent-access-case-001` back to 0 holders;
   agent1's realm role mappings back to `support-agent`, `default-roles-support-spike` only;
   pending queue empty.

### Post-revocation re-denial: confirmed live, completing the full access-control round trip

With the role fully revoked and confirmed removed via the API, `agent1` logged out and back in
(picking up a fresh doken without the revoked role) and re-ran the same "Attempt Decrypt" action
against case-001's stored ciphertext. Result:

```
Forseti policy denied (Data, Executor): Missing role 'case-agent-access-case-001'.
```

This is the identical denial message observed in the pre-grant test, now reproduced after a full
grant-then-revoke cycle — confirming the Forseti contract's `ValidateExecutor` re-evaluates the
role on every decrypt attempt from the doken presented at call time, rather than caching an earlier
authorization decision. Together with the pre-grant denial and the post-grant success recorded
above, this completes the required three-state access-control round trip for case-001:
**denied → granted-and-allowed → revoked-and-denied-again**, each state confirmed independently via
both a direct TideCloak API read-back (role/CR state) and a live browser decrypt attempt (Forseti's
actual runtime decision), never asserted from one without the other.

## Open questions carried into Stage 2B

- Whether the Forseti policy-signing ceremony (a separate mechanism from IGA change requests —
  browser popup via `requestTideOperatorApproval`, not an Admin Console approval) behaves
  consistently with what is documented, given that one governance assumption has already been
  found to diverge from documentation on this build.
- Whether the isolated Forseti expiry experiment (signed `ExpiresAtEpoch` parameter, trusted-time
  primitive) passes on this build. Not yet attempted.

---

## Playwright end-to-end smoke tests

Added `@playwright/test` and a minimal smoke/contract suite (`tide-support-spike/e2e/smoke.spec.ts`)
covering the three required behaviours: the public page loading, the unauthenticated sign-in UI
being present, and the protected API route rejecting requests without a valid bearer token.

### What was implemented

- `playwright.config.ts` at the app root, using Playwright's `webServer` option to run
  `npm run start` (the production server, not the dev server) on a dedicated port (3100, to avoid
  colliding with a developer's own `npm run dev` on 3000) before tests execute.
- `e2e/smoke.spec.ts`: five tests —
  - public `/` returns `200`
  - `/` renders the "Welcome!" heading, the "Please log in to continue." prompt, and an enabled
    "Log In" button
  - `GET /api/protected` with no `Authorization` header returns `401` with a JSON error body
  - `GET /api/protected` with a non-`Bearer` `Authorization` header returns `401`
  - `GET /api/protected` with a syntactically-invalid bearer token (a fixed, obviously-fake string,
    not a real or captured Tide token) returns a non-`200` status, exercising the route's real
    signature-verification failure path (`verifyTideCloakToken` against the embedded JWKS)
- `npm run test:e2e` (builds the app, then runs the Playwright suite) and
  `npm run test:e2e:report` (opens the last HTML report) added to `package.json`.
- `.gitignore` updated to exclude Playwright's `test-results/`, `playwright-report/`,
  `blob-report/`, and cache directory.

### What was deliberately NOT implemented

- No real Tide user login, no captured or synthetic Tide-issued JWT, no automation of the Tide
  enclave/browser approval flow. The suite tests the boundary right up to where a real login would
  begin (the Log In button being present and clickable) and the server-side rejection behaviour of
  the protected route — it does not cross into an authenticated session anywhere.
- No username, password, or token value of any kind is stored in the test files, the Playwright
  config, or `.env`. The one token-shaped string used in a test (`not-a-real-jwt.invalid.token`) is
  a fixed placeholder chosen specifically to be unparseable as a JWT — it is not a weakened or
  bypassed check; the route's real verification code path throws on it exactly as it would on any
  other invalid input.
- The TideCloak Docker container is not started, stopped, or depended upon by `playwright.config.ts`
  or the test suite. The tests are self-contained and pass with TideCloak down, because the
  behaviours under test (public page rendering, login-button presence, and missing/invalid-token
  rejection) do not require a live TideCloak connection.

### Problem encountered: Playwright's own browser download timed out

`npx playwright install chromium` failed twice with a connection timeout while downloading the
Chromium binary (`cdn.playwright.dev`), despite basic TCP connectivity to that host succeeding —
this looked like a bandwidth/throughput constraint on the download itself, not a blocked or
unreachable endpoint. Increasing `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT` did not resolve it either.

**Resolution**: configured Playwright to use the system-installed Microsoft Edge browser via the
`channel: 'msedge'` project option, instead of Playwright's own downloaded Chromium binary. This is
a standard, supported Playwright configuration (not a workaround that weakens test coverage) — Edge
is Chromium-based and exercises the same rendering and JavaScript engine Playwright's own bundled
Chromium would. Anyone running this suite on a machine without Edge installed, or without the
network constraint we hit, can remove the `channel` line to use Playwright's normal bundled
browser instead.

### Verification performed

- `npm run build` — production build, run standalone: succeeded, all 6 routes compiled, TypeScript
  check clean.
- `npx playwright test` (against the already-built app) — 5/5 passed.
- `npm run test:e2e` (full build-then-test pipeline, matching what CI or a fresh clone would run) —
  5/5 passed, ~10s runtime.
