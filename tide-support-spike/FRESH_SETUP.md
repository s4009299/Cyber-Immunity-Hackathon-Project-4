# Fresh-Machine Setup — Secure IT Support Portal (TideCloak)

Reproducible setup for a tester starting from a clean Windows laptop: no existing Docker
container, no `data/` directory, no realm, no `.env`. Every step below assumes none of that
exists yet.

No credentials or secret values appear anywhere in this document. Everywhere a password is
needed, choose your own value and keep it out of version control.

---

## 1. Prerequisites

- Docker Desktop installed and running (`docker ps` should return a header row with no error)
- Git
- Node.js matching this project's toolchain (Next.js 16.x → Node 20+)
- Bash. On Windows, WSL (Windows Subsystem for Linux) is required — `init/tcinit.sh` is bash-only
  and does not run under plain PowerShell or `cmd.exe`.

## 2. Clone the repository

```powershell
git clone <repo-url>
cd Cyber-Immunity-Hackathon-Project-4
git checkout spike/tide-case-access-grant
```

## 3. Create the `data/` directory

Does not exist on a fresh machine — create it before starting the container:

```powershell
New-Item -ItemType Directory -Path "tide-support-spike\data" -Force
```

## 4. Create the TideCloak container (first time only)

Run from anywhere — `docker run` needs an **absolute** path for the volume mount. Replace
`<ABSOLUTE_PATH_TO_REPO>`. At the prompt, choose a brand-new local password and use the same
value when editing `.env` in step 5:

```powershell
$securePassword = Read-Host "Choose a local TideCloak bootstrap password" -AsSecureString
$bootstrapPassword = [System.Net.NetworkCredential]::new("", $securePassword).Password
docker run -d `
  --name tidecloak `
  -p 8080:8080 `
  -v "<ABSOLUTE_PATH_TO_REPO>\tide-support-spike\data:/opt/keycloak/data/h2" `
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin `
  -e "KC_BOOTSTRAP_ADMIN_PASSWORD=$bootstrapPassword" `
  -e USER_HOME_ORK=https://ork1.tideprotocol.com `
  -e SYSTEM_HOME_ORK=https://ork1.tideprotocol.com `
  -e THRESHOLD_T=14 `
  -e THRESHOLD_N=20 `
  tideorg/tidecloak-dev:latest
```

Wait for it to come up before continuing:

```powershell
Invoke-WebRequest http://localhost:8080/realms/master -SkipHttpErrorCheck
```
Poll until this returns HTTP 200 — first boot can take 30–90 seconds.

**✅ Verified this session**, in a fully isolated test (different container name
`tidecloak-validate`, host port **8081** instead of 8080, a scratch data directory outside the
repo under `%TEMP%`, a throwaway password) — the existing working `tidecloak` container on port
8080 was never stopped, restarted, or otherwise touched:
- `docker run` with exactly this image, port mapping, bind-mount target path, and these non-secret
  env vars starts successfully from a genuinely empty data directory.
- `GET /realms/master` returned HTTP 200 after the container came up.

`PAYER_PUBLIC` was present on the original working container's environment but was **not**
included in the validation run above, and provisioning still succeeded through every scripted
step (realm creation, VRK keygen, IGA enable, user creation, enrollment-link minting). It appears
unnecessary for first-time setup; omitted here on that basis.

## 5. Set up the application's environment file

```powershell
cd tide-support-spike
Copy-Item .env.example .env
```

This is the **app-root** file at `tide-support-spike/.env`, not `init/.env.example`.
Set `KC_BOOTSTRAP_ADMIN_USERNAME` and `KC_BOOTSTRAP_ADMIN_PASSWORD` to **exactly** what you used
in the `docker run` command in step 4. Leave `NEW_REALM_NAME=support-spike` for this test plan.
The script now reads this file directly. Do not commit `.env` or send it with test results.

## 6. Install dependencies

```powershell
npm install
```

## 7. Provision the realm, client, and admin identity

```powershell
npm run init
```

This runs `init/tcinit.sh` (reads `init/realm.json`, talks to the running container). The script
reads `tide-support-spike/.env` itself, including when Bash is launched from PowerShell/WSL.
The precedence is: variables explicitly available to Bash, then app-root `.env`, then the
scaffold defaults in `init/.env.example`. Next.js does not load `.env` for arbitrary Bash scripts.
The app-root file is therefore required for this guide's `support-spike` realm and bootstrap
password. The script stops **before making a TideCloak change** if that password is missing or
still a placeholder. Check that its output says `Creating realm 'support-spike'...`; if it says
`nextjs-test`, stop and check the branch and the location/content of the app-root `.env`.

**Do not rerun the script blindly after a partial failure.** Check whether `support-spike` was
already created and record the first failed step. Provisioning a half-finished realm may require
manual recovery; ask the project owner before deleting or recreating any realm or data.

**Confirmed working this session, step by step, against a fresh isolated realm**
(`validate-test`, on the throwaway `tidecloak-validate` container — not the realm used by the
working app):
1. Realm creation — `201 Created`
2. `setUpTideRealm` (VRK keygen on the live Tide Cybersecurity Fabric — requires internet access
   to reach the ORK network) — `200 OK`
3. Stamping `iga.attestor=tide` — `204`
4. Enabling IGA governance — `200 OK`
5. Draining the resulting change-requests — inbox empty, no manual action needed at this stage
6. Creating the realm's `admin` user — `202 Accepted`
7. Resolving the new user's ID — succeeded
8. Minting a one-time Tide enrollment link — succeeded

**🛑 Requires live browser enrollment — stopped here, not completed in validation.** The script
prints a URL and pauses, polling automatically until enrollment is detected. Opening that URL and
completing Tide's enclave-based account-linking ceremony is a hard, non-automatable requirement —
Tide's threshold authentication has no headless or CLI path. This step was deliberately **not**
completed during this validation run (it would have created a real linked Tide identity for a
throwaway realm with no purpose) — you must complete it yourself when running this for real.

After enrollment, the script continues automatically: it drains the resulting change-requests,
signs the Tide IdP settings for the realm, grants `tide-realm-admin` to the enrolled admin (an
irreversible flip from FirstAdmin to MultiAdmin governance — by design, not a mistake to undo),
and writes the client adapter config to `tidecloak.json`. None of this remaining portion was
re-verified in this session beyond what was already recorded in `learning.md` from the original
provisioning of the real `support-spike` realm.

## 8. Create `customer1` and `agent1`

`tcinit.sh` only provisions the realm and its one admin account — `customer1` and `agent1` are
**not** created by any script in this repo today. Create them following the same pattern recorded
in `learning.md`'s Stage 2A section, using a master-realm admin token against the running
container:

1. **Create the realm roles** `customer` and `support-agent` (and, for the case-001 workflow,
   `case-agent-access-case-001`):
   ```
   POST /admin/realms/<realm>/roles
   Body: {"name": "customer"}
   ```
   repeated for each role name. On an IGA-governed (Tide-mode) realm this returns `202` with a
   `Location` header pointing at a pending change request — the role does **not** exist yet.
   **🛑 Requires manual approval** in the TideCloak Admin Console (or via
   `POST /admin/realms/<realm>/iga/change-requests/<id>/approve` by an already-enrolled admin) before
   a read-back of `GET /admin/realms/<realm>/roles/<name>` will succeed. Not re-verified this
   session (requires an enrolled admin, which the validation run deliberately stopped short of).

2. **Create the two realm users**:
   ```
   POST /admin/realms/<realm>/users
   Body: {"username": "customer1", "enabled": true, "attributes": {"tideInvitable": ["true"]}}
   ```
   and the same for `agent1`. Also governed — expect `202`/pending-change-request behaviour, same
   as role creation.

3. **Each new user requires its own Tide enrollment**, exactly like the admin in step 7: mint a
   `link-tide-account-action` link via
   `POST /admin/realms/<realm>/tideAdminResources/get-required-action-link?userId=<id>&lifespan=3600`,
   open it in a browser, complete enrollment. **🛑 Requires live browser enrollment** — two more
   times (once per user), same non-automatable constraint as the admin.

4. **Assign the realm roles**: `customer` → `customer1`, `support-agent` → `agent1`, via
   `POST /admin/realms/<realm>/users/<userId>/role-mappings/realm` with the role representation in
   the body. This also returns a non-final response (`204`, no `Location` header, but a change
   request is still created) and **requires the same Admin Console approval** before the mapping
   is actually in effect — confirmed in `learning.md` to be a real governance step, not inferable
   from the response code alone. Deliberately leave `case-agent-access-case-001` unassigned at
   this point — it is granted later, per-case, as the subject of testing.

**None of step 8 was re-run in this validation session.** It is documented here directly from
`learning.md`'s record of what was actually done against the real `support-spike` realm, because
reproducing it again would have required completing two more live browser enrollments against a
throwaway realm for no lasting purpose. Treat it as accurate-but-not-re-verified.

## 9. Build and start the application

```powershell
npm run build
npm run start -- -p 3000
```

## 10. Upload and sign the case-001 Forseti policy

**Contract upload — ✅ verified this session**, against the isolated `validate-test` realm:
```
POST /admin/realms/<realm>/iga/forseti-contracts
Body: {"contractCode": "<contract source>", "name": "<contract name>"}
```
returned `200 OK` immediately, with no governance pause and no enrollment dependency — this step
is unauthenticated-admin-only (just needs a master-realm bootstrap token) and fully scriptable.
The real case-001 contract source lives in `lib/forsetiContract.ts`
(`CASE_001_CONTRACT_SOURCE`) — upload that exact string, not the placeholder used in this
session's connectivity check.

**🛑 Signing requires one live enclave approval — not re-run this session.** With the app running
and logged in as the Tide-linked realm admin:
1. Navigate to `http://localhost:3000/admin/sign-policy`.
2. Click "Sign Policy." This fetches `customer1`'s vuid dynamically (never hardcoded), constructs
   the policy, and walks through TideCloak's signing flow, including **one browser popup requiring
   enclave approval**. Approve it.
3. On success: "Policy signed and stored successfully for case-001." The signed policy bytes are
   written to `tide-support-spike/data/signed-policies/case-001.json` (gitignored).

This step was not re-validated in isolation this session, since it depends on a fully enrolled
admin and an enrolled `customer1` (steps 7–8), neither of which were completed against the
throwaway realm.

## 11. Create case-001 test data

With the app running, log in as `customer1`, go to `http://localhost:3000/case-001`, and use
"Encrypt & Store" under "Check case security" to create the content `agent1`'s access will be
tested against. Writes to `tide-support-spike/data/case-content/case-001.json` (gitignored).

## 12. Grant / revoke `case-agent-access-case-001` for testing

Same governed pattern as step 8.4: submit the grant via the realm role-mappings endpoint, verify
via read-back that it's still pending, approve in the Admin Console, verify it committed. Same
process in reverse for revocation. **After every grant or revoke, the affected test user
(`agent1`) must log out and log back in** before the change is reflected in their session — their
existing doken is a point-in-time snapshot taken at login and does not update itself. This was
directly confirmed (not just assumed) during this project's Week 6 testing, recorded in
`learning.md`.

## Fresh-machine handoff note

This guide's original isolated validation stopped at the admin enrollment link. A tester must
still create and enroll `customer1` and `agent1`, approve governed role changes, sign the policy,
and create test case data in **their own** realm. Passwords for accounts on another developer's
local container do not create those accounts here. Record the first setup error and its step;
do not mark TC07–TC11 runnable until an enrolled Tide-linked realm admin is available locally.

---

## Summary: what this session actually verified vs. what remains manual

| Step | Status this session |
|---|---|
| Docker container creation (fresh image, port, mount, env) | ✅ Verified in isolation (port 8081, scratch data dir, throwaway password) |
| Container reachable at `/realms/master` | ✅ Verified |
| Realm creation | ✅ Verified (`validate-test` realm, `201`) |
| `setUpTideRealm` (VRK keygen) | ✅ Verified (`200`) |
| IGA attestor stamp + enable | ✅ Verified (`204`, `200`) |
| Admin user creation | ✅ Verified (`202`) |
| Enrollment link minting | ✅ Verified (link generated successfully) |
| **Admin Tide enrollment (browser)** | 🛑 Not run — requires a human, by design |
| IdP signing, `tide-realm-admin` grant, adapter export | Not re-run (depends on enrollment above) |
| `customer1`/`agent1` creation, roles, enrollment | Not re-run this session; documented from `learning.md`'s record of the original setup |
| Forseti contract upload | ✅ Verified in isolation (`200`, no governance pause) |
| **Forseti policy signing (browser enclave approval)** | 🛑 Not run — requires a human, by design |
| case-001 test data creation | Not re-run; documented from prior sessions' confirmed behaviour |
| Grant/revoke + required re-login | Not re-run; previously directly confirmed, recorded in `learning.md` |

**Later independent testing found a setup failure:** the script originally loaded only
`init/.env.example`, while step 5 configured the app-root `.env`. This selected `nextjs-test`
and a placeholder admin password, leading to an HTTP 401. The script and step 7 have been
updated to read the app-root `.env` and fail early for a missing or placeholder password. The
configuration fix has been checked locally without a live TideCloak run; the complete fresh
setup still needs independent verification by the tester.

The working `tidecloak` container (port 8080) and its `data/` directory were not stopped,
restarted, or modified at any point during this validation — confirmed by direct inspection before
and after.
