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

## Open questions carried into Stage 2B

- Whether the Forseti policy-signing ceremony (a separate mechanism from IGA change requests —
  browser popup via `requestTideOperatorApproval`, not an Admin Console approval) behaves
  consistently with what is documented, given that one governance assumption has already been
  found to diverge from documentation on this build.
- Whether the isolated Forseti expiry experiment (signed `ExpiresAtEpoch` parameter, trusted-time
  primitive) passes on this build. Not yet attempted.
