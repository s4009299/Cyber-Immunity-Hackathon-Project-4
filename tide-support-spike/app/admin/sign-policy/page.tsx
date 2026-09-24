'use client'

import { useTideCloak } from '@tidecloak/nextjs'
import { useState, useCallback } from 'react'
import { CASE_001_CONTRACT_SOURCE } from '../../../lib/forsetiContract'

// One-time admin ceremony: sign the case-001 Forseti policy.
//
// This page must be visited by a user authenticated as the Tide admin
// (holding tide-realm-admin). It performs the 5-step signing flow exactly as
// documented in Tide's setup-forseti-e2ee playbook:
//   1. Build the policy + request, initialize via createTideRequest
//   2. Operator approval popup (the one enclave step a human must complete)
//   3. Attach the admin policy to the APPROVED request
//   4. executeSignRequest with waitForAll = true
//   5. Attach the resulting VVK signature to the policy object
//
// The owner vuid is fetched from the server at signing time (never
// hardcoded). The resulting signed policy bytes are stored server-side via
// POST /api/admin/signed-policy, keyed "case-001".

const POLICY_KEY = 'case-001'
const AGENT_ROLE = 'case-agent-access-case-001'

export default function SignPolicyPage() {
  const { authenticated, hasClientRole, isInitializing, login, getToken } = useTideCloak()
  const [status, setStatus] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>('')

  const onSign = useCallback(async () => {
    setBusy(true)
    setError('')
    setStatus('Fetching owner vuid...')
    try {
      // Always pull a fresh token immediately before use rather than relying
      // on a stale value captured at render time — this ceremony can take a
      // while (it waits on an enclave popup + ORK round trip), and the
      // access token can expire mid-flow. getToken() returns the current
      // token, refreshing it first if the underlying client considers it
      // stale. Never read a token from localStorage/sessionStorage directly.
      const bearer = async (): Promise<string> => {
        const t = await getToken()
        if (!t) throw new Error('Not authenticated — please log in first')
        return t
      }

      // Fetch tidecloak.json for vendorId — imported at module scope would
      // work too, but this keeps the page self-contained and explicit.
      const tcConfigRes = await fetch('/tidecloak.json').catch(() => null)
      let vendorId: string
      if (tcConfigRes && tcConfigRes.ok) {
        vendorId = (await tcConfigRes.json()).vendorId
      } else {
        // tidecloak.json is not served from public/ in this app (it lives at
        // the project root per the Next.js scaffold); fall back to a small
        // dedicated route if needed. For this spike we import it directly.
        const mod = await import('../../../tidecloak.json')
        vendorId = (mod as any).default.vendorId ?? (mod as any).vendorId
      }

      const vuidRes = await fetch('/api/admin/owner-vuid', {
        headers: { Authorization: `Bearer ${await bearer()}` },
      })
      if (!vuidRes.ok) throw new Error(`Failed to fetch owner vuid: HTTP ${vuidRes.status}`)
      const { vuid: ownerVuid } = await vuidRes.json()

      setStatus('Constructing policy...')
      const { Models } = await import('@tideorg/js')
      const { Policy, ApprovalType, ExecutionType, BaseTideRequest } = Models as any
      const { PolicySignRequest } = await import('heimdall-tide')

      const encoder = new TextEncoder()
      const contractHashBuf = await crypto.subtle.digest(
        'SHA-512',
        encoder.encode(CASE_001_CONTRACT_SOURCE)
      )
      const contractId = Array.from(new Uint8Array(contractHashBuf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()

      const policy = new Policy({
        version: '3',
        contractId,
        modelId: ['PolicyEnabledEncryption:1', 'PolicyEnabledDecryption:1'],
        keyId: vendorId,
        approvalType: ApprovalType.IMPLICIT,
        executionType: ExecutionType.PRIVATE,
        params: [
          ['OwnerVuid', ownerVuid],
          ['AgentRole', AGENT_ROLE],
        ],
      })

      setStatus('Fetching admin policy...')
      const adminPolicyRes = await fetch('/api/admin/admin-policy', {
        headers: { Authorization: `Bearer ${await bearer()}` },
      })
      if (!adminPolicyRes.ok) throw new Error(`Failed to fetch admin policy: HTTP ${adminPolicyRes.status}`)
      const { policyBase64 } = await adminPolicyRes.json()
      const adminPolicyBytes = Uint8Array.from(atob(policyBase64), (c) => c.charCodeAt(0))

      // The underlying TideCloak instance for the ORK signing calls.
      const { IAMService } = await import('@tidecloak/js')
      const tc = (IAMService as any)._tc
      if (!tc) throw new Error('TideCloak not initialized — please log in first')

      setStatus('Step 1: initializing request...')
      const policyRequest = PolicySignRequest.New(policy).addForsetiContractToUpload(
        CASE_001_CONTRACT_SOURCE
      )
      const initializedBytes = await tc.createTideRequest(policyRequest.encode())

      setStatus('Step 2: waiting for enclave approval popup...')
      const approvalResults = await tc.requestTideOperatorApproval([
        { id: 'case-001-policy-sign', request: initializedBytes },
      ])
      if (approvalResults[0].status !== 'approved') {
        throw new Error('Signing was denied in the enclave')
      }

      setStatus('Step 3: attaching admin policy to approved request...')
      const approvedRequest = BaseTideRequest.decode(approvalResults[0].request)
      approvedRequest.addPolicy(adminPolicyBytes)

      setStatus('Step 4: executing sign request (this reaches the ORK network)...')
      const signatures = await tc.executeSignRequest(approvedRequest.encode(), true)

      setStatus('Step 5: attaching signature and storing...')
      policy.signature = signatures[0]
      const signedBytes: Uint8Array = policy.toBytes()
      const signedBytesBase64 = btoa(String.fromCharCode(...signedBytes))

      const storeRes = await fetch('/api/admin/signed-policy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await bearer()}`,
        },
        body: JSON.stringify({ policyKey: POLICY_KEY, policyBytesBase64: signedBytesBase64 }),
      })
      if (!storeRes.ok) throw new Error(`Failed to store signed policy: HTTP ${storeRes.status}`)

      setStatus('✅ Policy signed and stored successfully for case-001.')
    } catch (err: any) {
      setError(err.message || String(err))
      setStatus('')
    } finally {
      setBusy(false)
    }
  }, [])

  if (isInitializing) return <p>Initializing...</p>

  if (!authenticated) {
    return (
      <div style={{ padding: '2rem' }}>
        <p>You must log in as the Tide admin to sign the case-001 policy.</p>
        <button onClick={login}>Log In</button>
      </div>
    )
  }

  // tide-realm-admin is a CLIENT role on the realm-management client, not a
  // realm role (AP-29) — hasClientRole(role, resource) is the correct check.
  // This is UI convenience only, not the security boundary: the actual
  // /api/admin/* routes independently re-verify this server-side via
  // requireTideRealmAdmin() regardless of what this page renders (I-08).
  // A non-admin who is merely authenticated (e.g. agent1) is stopped here
  // for a good UX, but would also get a 403 from the API routes if they
  // somehow triggered the requests.
  const isAdmin = hasClientRole('tide-realm-admin', 'realm-management')

  if (!isAdmin) {
    return (
      <div style={{ padding: '2rem' }}>
        <p>
          You are logged in, but this account does not hold the <code>tide-realm-admin</code>{' '}
          role. Only the enrolled Tide realm administrator can sign the case-001 policy.
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 640 }}>
      <h1>Sign case-001 Forseti Policy</h1>
      <p>
        This is a one-time admin ceremony. It fetches customer1's vuid dynamically, constructs
        the case-001 policy, and signs it via the Tide enclave (one browser approval popup).
      </p>
      <button onClick={onSign} disabled={busy}>
        {busy ? 'Signing...' : 'Sign Policy'}
      </button>
      {status && <p style={{ marginTop: '1rem' }}>{status}</p>}
      {error && <p style={{ marginTop: '1rem', color: 'red' }}>Error: {error}</p>}
    </div>
  )
}
