# Secure IT Support Portal — Docker Deployment

Containerised production build of the TideCloak-protected support portal, running on
`http://localhost:3000`, connected to your existing, already-provisioned local TideCloak
container. This guide covers the Docker path only — for a from-scratch, no-Docker setup see
`FRESH_SETUP.md`.

**This is not a from-scratch provisioning guide.** It assumes TideCloak, the `support-spike`
realm, the three enrolled identities, the signed case-001 policy, and the case-001 test data
already exist (as set up in earlier project stages). Nothing here re-provisions, re-enrolls, or
resets any of that.

## Prerequisites

- Docker Desktop (with Docker Compose v2, `docker compose`)
- Your existing TideCloak container, already running, created against a bind-mounted
  `tide-support-spike/data` directory (do not delete or recreate it). It does not need to be
  named `tidecloak-fix` — see "One-time network setup" below if yours is named differently.
- `tide-support-spike/.env` — real values for `KC_BOOTSTRAP_ADMIN_USERNAME` /
  `KC_BOOTSTRAP_ADMIN_PASSWORD` (not committed to git)
- `tide-support-spike/tidecloak.json` — the adapter config already exported for the
  `support-spike` realm (not committed to git; see below for why it's required)

## Why `tidecloak.json` must exist locally before building

Several files (`app/layout.tsx`, `middleware.ts`, API routes, the admin signing page)
statically import `tidecloak.json`. Next.js compiles that import directly into the JS bundle
at **build time** — it is not read from disk at runtime. The Dockerfile's build stage fails
fast with a clear error if the file is missing. This is not a secret in the same sense as a
password (it's the realm's already-signed public adapter config: embedded JWKS public key,
vendor ID, signed origin material), but it is realm-specific and stays gitignored — it must be
present on your machine, not in version control.

## One-time network setup

TideCloak reaches the browser and this app's server differently, and this matters for Docker:

- **Browser → TideCloak**: the browser runs on your host machine, where your TideCloak
  container already publishes port 8080. No change needed — `tidecloak.json`'s
  `auth-server-url` stays `http://localhost:8080`.
- **App server → TideCloak**: a few of this app's own API routes (owner-vuid lookup,
  admin-policy fetch, case-001 ownership check) call the TideCloak admin API server-side. Inside
  the app's container, `localhost:8080` means *that container*, not TideCloak — confirmed
  directly: `wget http://localhost:8080` from inside the app container returns "connection
  refused," while `wget http://<tidecloak-container-name>:8080` succeeds. These routes use
  `TIDECLOAK_INTERNAL_URL`, which `docker-compose.yml` builds from `TIDECLOAK_CONTAINER_NAME`
  instead of a hardcoded `localhost` address, for this reason.

**If your TideCloak container is named something other than `tidecloak-fix`**, add this line to
`tide-support-spike/.env`:
```
TIDECLOAK_CONTAINER_NAME=your-actual-container-name
```
If omitted, it defaults to `tidecloak-fix`. Find your container's name with `docker ps`.

For the container-network address to resolve, your TideCloak container must share a Docker
network with this app. Run this once (safe to re-run; it does not restart or reconfigure your
TideCloak container — it only attaches a second network interface alongside its existing one):

```powershell
docker network create tide-portal-net
docker start <your-tidecloak-container-name>          # if not already running
docker network connect tide-portal-net <your-tidecloak-container-name>
```

Your TideCloak container keeps its original network and host port mapping unchanged.

## Build and start

```powershell
cd tide-support-spike
docker compose build
docker compose up -d
```

- App: `http://localhost:3000`
- TideCloak: `http://localhost:8080` (unchanged, already running)

## Stopping

```powershell
docker compose down
```

This stops and removes only the `secure-support-portal` app container and image-level
resources. It does **not** touch your TideCloak container, its network, or
`tide-support-spike/data/`.

## What's mounted vs. baked in

| Item | Where it lives | Baked into image? |
|---|---|---|
| `tidecloak.json` | compiled into the JS bundle at build time | Yes — required, see above |
| `.env` (`KC_BOOTSTRAP_ADMIN_*`, `TIDECLOAK_CONTAINER_NAME`) | injected via `env_file` in `docker-compose.yml` | **No** |
| `data/case-content/` | bind-mounted (`./data/case-content:/app/data/case-content`) | **No** |
| `data/signed-policies/` | bind-mounted (`./data/signed-policies:/app/data/signed-policies`) | **No** |

**The app container only sees these two subdirectories — nothing else under `data/`.**
TideCloak's own H2 database files (`data/keycloakdb*`) and the local `data/_backups/` directory
live alongside them on the host but are deliberately **not** mounted into the app container:
this app has no use for them, and narrowing the mount this way means it cannot read or write
them even by accident. (An earlier version of `docker-compose.yml` mounted the whole `data/`
directory; this has been narrowed and re-verified — see "Verified this session" below.)

`.dockerignore` excludes `.env`, `data/`, and the Forseti scratch files
(`owner-vuid.txt`/`contractId.txt`) from the build context entirely — they never reach the
image, mirroring what `.gitignore` already excludes from version control.

## Verified this session

**Automated / direct checks:**
- `docker compose build` / `docker compose up -d` — succeeded, Next.js reported ready.
- **Browser-side**: `GET http://localhost:8080/realms/support-spike` from the host → `200`.
  `GET http://localhost:3000` from the host → `200`.
- **Server-side**: from inside the app container, `http://<tidecloak-container-name>:8080/realms/support-spike`
  succeeded; `http://localhost:8080` failed with connection refused — confirming the two
  connectivity paths are genuinely different and the `TIDECLOAK_INTERNAL_URL` fix is necessary
  and working.
- **Mount narrowing re-verified after the change**: `docker exec secure-support-portal ls /app/data`
  now lists only `case-content/` and `signed-policies/` — `keycloakdb*` and `_backups/` are not
  present inside the app container at all.
- `GET /api/case/case-001/policy` and `GET /api/case/case-001/data` without an Authorization
  header both returned `401` — the auth guard is intact inside the container.
- Your TideCloak container's realm (`support-spike`) and all three identities (`admin`,
  `customer1`, `agent1`) confirmed present via the admin API before and after this setup, and
  again after narrowing the mounts.

**Manual browser checks (performed by the user, not automated):**
- Signed in as `customer1` through the containerised app.
- Loaded the signed case-001 policy successfully.
- Encrypted, stored, and decrypted the content **"Docker deployment test"** successfully —
  this exercises the `TIDECLOAK_INTERNAL_URL`-dependent ownership-check route end-to-end with a
  real authenticated session, not just a network-reachability check.
- Signed in as `agent1` and confirmed decryption was **denied** (agent1 does not hold
  `case-agent-access-case-001`).
- Restored the original `case-001.json` test data afterward and confirmed its SHA-256 hash
  matches the pre-test backup.

## Known limitations / not yet verified

- **Grant/revoke of `case-agent-access-case-001` has not yet been retested through the Docker
  deployment.** The full grant → agent1-succeeds → revoke → agent1-denied-again round trip was
  previously verified against the non-Docker (`npm run start`) deployment (see `learning.md`,
  Week 6). Only the pre-grant denial and the owner's encrypt/decrypt were re-verified against
  the containerised app this session. **Manual check still needed**: grant the role via the
  normal IGA change-request flow, confirm `agent1` can decrypt through the Docker-hosted app,
  then revoke it and confirm `agent1` is denied again after logging out and back in.
- `tidecloak.json`'s signed origins (`client-origin-auth-http://localhost:8080`,
  `client-origin-auth-http://localhost:3000`) are tied to exactly those host/port combinations.
  Deploying this container to a different host or port would require re-signing the IdP
  settings against the new origin — out of scope here, consistent with this project's existing
  "customer-only authorisation" and signed-origin constraints documented in
  `docs/STAGE_1_SUMMARY.md`.
- The production image uses `node:20-alpine`. If `sharp` (an image-processing dependency) ever
  causes a native-binding mismatch on Alpine's musl libc, switch the base image to
  `node:20-bookworm-slim` in `Dockerfile` as a straightforward fallback.
- `docker-compose.yml` intentionally does not define a TideCloak service. If your TideCloak
  container is ever removed or recreated, the one-time network-connect step above must be
  repeated.

## Exact tester startup steps

1. Confirm your TideCloak container is running: `docker ps` — note its exact name.
2. If that name isn't `tidecloak-fix`, add `TIDECLOAK_CONTAINER_NAME=<that name>` to
   `tide-support-spike/.env`.
3. One-time network setup (safe to re-run):
   ```powershell
   docker network create tide-portal-net
   docker network connect tide-portal-net <your-tidecloak-container-name>
   ```
4. Build and start the app:
   ```powershell
   cd tide-support-spike
   docker compose build
   docker compose up -d
   ```
5. Open `http://localhost:3000`, log in, and confirm the dashboard and Secure Case 001 page
   behave as expected.
6. When done: `docker compose down` (stops only the app; your TideCloak container and its data
   are untouched).
