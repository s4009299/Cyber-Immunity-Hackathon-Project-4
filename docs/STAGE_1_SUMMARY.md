# Stage 1 Summary — Tide-Protected Customer Support Platform Spike

**Branch:** `spike/tide-case-access-grant`
**Status:** Complete. No encryption or access-granting logic implemented yet (Stage 2+).

## Goal of Stage 1

Establish a working local TideCloak environment, a scaffolded Next.js application wired to it,
and three distinct Tide-linked identities (Administrator, Customer, Support Agent), with both
the Customer and Support Agent able to authenticate through the running application. This stage
deliberately excludes encryption, case-access granting, and revocation — those are Stage 2+.

## Environment Provisioned

- **TideCloak**: local Docker container (`tideorg/tidecloak-dev:latest`), port 8080.
- **Realm**: `support-spike`, created from the official scaffold's realm template.
  - Licensed via `setUpTideRealm`.
  - IGA (Identity Governance & Administration) enabled in **Tide mode** (cryptographic
    attestation, not the software-only "Tideless" mode).
  - **Realm governance mode: MultiAdmin** (see "Governance Mode" section below — this was a
    deviation from the original Stage 1 plan and has consequences for Stage 2).
- **Client**: `support-app`, public client, redirect URIs and web origins scoped to
  `http://localhost:3000` only.
- **Adapter configuration**: exported and confirmed to contain the required Tide extensions
  (embedded JWKS, vendor ID, home ORK URL). Not included in this document or in version control.
- **Application**: Next.js app generated via the official `npm init @tidecloak/nextjs@latest`
  scaffold. Runs on `http://localhost:3000`.

## Identities Established

Three Tide-linked identities were created, each requiring an interactive, browser-based
enrollment ceremony that cannot be scripted (Tide's threshold authentication model has no
headless or CLI signing path by design):

| Identity | Purpose | Tide-linked |
|---|---|---|
| Administrator | Realm bootstrap and governance | Yes |
| Customer (`customer1`) | Represents the case owner | Yes |
| Support Agent (`agent1`) | Represents the assigned agent | Yes |

At the end of Stage 1, the Customer and Support Agent hold **identical realm roles** — the
realm template's default set only (general app access, base encryption voucher-gate roles).
No case-specific or agent-specific authorization exists yet. This is expected: differentiating
these two identities is the explicit subject of Stage 2.

## Governance Mode: FirstAdmin → MultiAdmin (Deviation From Plan)

The original Stage 1 plan was to keep the realm in **FirstAdmin** mode throughout the spike,
specifically so that a customer's in-app "grant access" action could be executed as a
scripted, server-signed role change with no human admin approval required per action.

During bootstrap, the final administrator setup step (granting the `tide-realm-admin` role to
the administrator account) was executed following the official scaffold's standard sequence.
This grant is a **one-way, irreversible flip**: committing it moves the realm from FirstAdmin
to MultiAdmin governance. This happened without pausing to confirm it against the original
plan, which was an error in execution, not a change of design intent.

**Consequence for Stage 2**: every governed change from this point forward — including the
planned case-access grant and its revocation — requires a two-phase administrator browser
approval (an enclave signature), rather than a fully scripted role change. The originally
planned "customer clicks grant, it just happens" flow is no longer available as designed.

**Decision (post-Stage-1)**: the realm will remain in MultiAdmin mode. Stage 2 will be designed
around a two-step interaction model: the customer's in-app action initiates an access request,
and a governed administrator enclave approval executes it. This is documented as a permanent
architectural characteristic of the spike, not a temporary workaround — see "Customer-Only
Authorisation Limitation" below for what this means for the claim of customer control.

## Customer-Only Authorisation Limitation

This spike does not, and under the current realm configuration cannot, give the customer sole
cryptographic authority to grant or revoke a Support Agent's access to their case.

What the customer's in-app action can do: express clear, auditable intent — "I approve agent X
for case Y" — captured as a real, attributable event in the application.

What it cannot do: cause that grant to take effect without a separate action by a party holding
administrator authority. Tide's governance model requires every role-mapping change on a
MultiAdmin realm to be signed through a human-operated browser enclave. There is no mechanism
by which an ordinary customer identity can sign a role change directly — administrator-level
governance authority is required for every grant and every revocation, with no exception carved
out for changes a customer initiates about their own data.

Practical implication: "customer approval" in this spike is a two-party act — customer intent
plus administrator execution — not a single-party cryptographic action by the customer alone.
Any future claim that "the customer controls agent access" must be qualified accordingly: the
customer controls the *decision*; an administrator-held credential is required to *carry it out*,
for every single grant and every single revoke, with no batching or standing pre-approval
possible under Tide's current MultiAdmin enforcement.

## Automatic-Expiry Limitation

Tide's access tokens (and the internal signed session tokens used for cryptographic operations)
carry a fixed lifetime that is set at issuance and does not shorten in response to a later
administrative action. This has a direct consequence for revocation:

Revoking a Support Agent's case-access role removes that role from future tokens. It does
**not** invalidate a token the agent already holds. If the agent authenticated before the
revocation and their existing token has not yet expired, that token continues to carry the
now-revoked role claim until it naturally expires or the agent's session is refreshed and picks
up the updated (reduced) role set.

Practical implication: there is a real, bounded window — the remaining lifetime of the agent's
current token at the moment of revocation — during which a revoked agent may still be able to
exercise the access that was just removed. This window is not a bug in the spike's design; it
is an inherent property of how Tide issues and validates tokens. Any revocation or expiry test
in Stage 2 must explicitly account for this window rather than assume revocation takes effect
immediately, and any production design built on this spike must treat token lifetime as a hard
upper bound on "time to actually locked out," not the moment of the revocation action itself.

## Verification Performed

- TideCloak container health and API reachability.
- Realm, client, and role provisioning confirmed via the administrative API.
- Adapter configuration confirmed to contain all required Tide extensions.
- Application routes verified to respond correctly, including the silent single-sign-on file
  and the DPoP relay endpoint (with correct security headers).
- All three identities confirmed to hold distinct Tide identity material (i.e., each is a
  genuinely separate cryptographic identity, not an accidental duplicate or session collision).
- Customer and Support Agent both successfully authenticated through the running application
  and reached the authenticated landing page.
- Realm role mappings for Customer and Support Agent queried and confirmed identical (expected
  at this stage — see "Identities Established" above).
- **Verify Token test**: succeeded for both `customer1` and `agent1`. Both displayed
  "Authorized" with distinct `vuid` and identity key values, confirming each holds a genuinely
  separate, independently verifiable Tide identity (not a shared or collided session).
- Production build (`next build`) completed successfully: clean TypeScript check, all routes
  compiled, no errors. One non-blocking deprecation warning (`middleware.ts` naming convention,
  superseded by `proxy.ts` in this Next.js version) — informational only, does not affect
  build or runtime correctness.

## Blockers Encountered and Resolved

1. **Local container runtime was not running** at the start of the session; started manually.
2. **The scaffold's bootstrap script is bash-only** and required a Linux compatibility layer to
   run on this Windows environment. Credential passing into that environment required a specific
   mechanism (`WSLENV`) — an initial attempt using inline shell substitution silently produced an
   empty credential and a failed authentication call.
3. **The bootstrap script's console output could not be reliably captured** once it reached the
   interactive human-enrollment step. Rather than trust an unverifiable background process, the
   remaining automated setup steps (identity-provider signing, administrator role grant, adapter
   export) were re-driven directly and each explicitly verified via the administrative API.
4. **First Customer enrollment attempt failed** with an "account already linked" error. Root
   cause: the enrollment link was opened in a browser session that already held a different
   linked Tide identity, causing a session collision. Resolved by re-issuing the enrollment link
   and completing it in an isolated browser session.
5. **A `.gitignore` gap was found and fixed before any commit occurred.** An early version of the
   ignore rule for the local database files did not match their actual nested location, which
   would have allowed realm secrets and cryptographic key material to be staged for commit. This
   was caught by a dry-run check, not by an actual accidental commit, and corrected immediately.

## Manual Steps Required From the Operator

- Completing three separate browser-based Tide account-linking ceremonies (Administrator,
  Customer, Support Agent). This is a hard constraint of Tide's architecture: authentication and
  identity linking require a live browser-based cryptographic enclave and have no automatable
  equivalent.
- Logging into the running application as both the Customer and the Support Agent to confirm
  the end-to-end authentication flow.

## Explicitly Out of Scope for Stage 1

- Any encryption of case content.
- Any case-specific or agent-specific role or permission.
- The customer-triggered grant/revoke workflow itself.
- Token expiry and revocation-window testing.

These remain the subject of Stage 2, and Stage 2 planning must account for the governance-mode
consequence described above before implementation begins.
