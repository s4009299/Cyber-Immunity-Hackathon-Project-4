'use client'

import { useTideCloak } from '@tidecloak/nextjs'
import { useCallback, useState } from 'react'

// case-001 workflow page.
//
// Three independent actions, each usable by whichever authenticated user is
// currently logged in:
//   1. Verify the stored policy (decode-only: shape/contractId/model IDs,
//      never the signature bytes or any param value).
//   2. Encrypt content as the case owner (customer1) via
//      IAMService.doEncrypt(data, policyBytes) — policy-governed encryption,
//      not self-encryption.
//   3. Attempt to decrypt the stored ciphertext via
//      IAMService.doDecrypt(data, policyBytes) — this is the same action
//      customer1 and agent1 both perform; whether it succeeds is decided by
//      the Forseti contract inside the Tide enclave, not by this page.
//
// All errors shown to the user are sanitised: raw ORK URLs, VUIDs, and
// policy bytes are stripped before display. Nothing here is ever logged to
// the console with those values either.

const TAG = 'case-001'

function sanitizeError(err: any): string {
  let message = (err && (err.message || String(err))) || 'Unknown error'
  // Strip anything that looks like a URL (ORK endpoints are URLs) and any
  // long hex string (vuids and similar identifiers are long hex strings).
  message = message.replace(/https?:\/\/\S+/gi, '[url removed]')
  message = message.replace(/\b[0-9a-fA-F]{16,}\b/g, '[id removed]')
  return message
}

export default function CaseOnePage() {
  const { authenticated, isInitializing, login, getToken } = useTideCloak()

  const [verifyStatus, setVerifyStatus] = useState('')
  const [verifyBusy, setVerifyBusy] = useState(false)

  const [noteText, setNoteText] = useState('')
  const [encryptStatus, setEncryptStatus] = useState('')
  const [encryptBusy, setEncryptBusy] = useState(false)

  const [decryptResult, setDecryptResult] = useState('')
  const [decryptBusy, setDecryptBusy] = useState(false)

  const bearer = useCallback(async (): Promise<string> => {
    const t = await getToken()
    if (!t) throw new Error('Not authenticated')
    return t
  }, [getToken])

  const fetchPolicyBytes = useCallback(async (): Promise<Uint8Array> => {
    const res = await fetch('/api/case/case-001/policy', {
      headers: { Authorization: `Bearer ${await bearer()}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error || `Failed to fetch case-001 policy: HTTP ${res.status}`)
    }
    const { policyBytesBase64 } = await res.json()
    return Uint8Array.from(atob(policyBytesBase64), (c) => c.charCodeAt(0))
  }, [bearer])

  // ── 1. Verify stored policy (decode-only, no sensitive values shown) ──
  const onVerifyPolicy = useCallback(async () => {
    setVerifyBusy(true)
    setVerifyStatus('')
    try {
      const bytes = await fetchPolicyBytes()
      const { Models } = await import('@tideorg/js')
      const { Policy } = Models as any
      const policy = Policy.from(bytes)
      const hasSignature = !!policy.signature && policy.signature.length > 0
      setVerifyStatus(
        `✅ Policy decoded. version=${policy.version}, ` +
          `modelIds=[${policy.modelIds.join(', ')}], ` +
          `approvalType=${policy.approvalType}, executionType=${policy.executionType}, ` +
          `signaturePresent=${hasSignature}. ` +
          `(contractId, params, and signature bytes are intentionally not displayed.)`
      )
    } catch (err: any) {
      setVerifyStatus(`❌ ${sanitizeError(err)}`)
    } finally {
      setVerifyBusy(false)
    }
  }, [fetchPolicyBytes])

  // ── 2. Customer encrypts case-001 content under the signed policy ──
  const onEncrypt = useCallback(async () => {
    setEncryptBusy(true)
    setEncryptStatus('')
    try {
      const policyBytes = await fetchPolicyBytes()
      const { IAMService } = await import('@tidecloak/js')
      const [ciphertext] = await IAMService.doEncrypt(
        [{ data: noteText, tags: [TAG] }],
        policyBytes
      )
      const encryptedBase64 = typeof ciphertext === 'string' ? ciphertext : btoa(String.fromCharCode(...ciphertext))

      const storeRes = await fetch('/api/case/case-001/data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await bearer()}`,
        },
        body: JSON.stringify({ encryptedBase64, tags: [TAG] }),
      })
      if (!storeRes.ok) {
        const body = await storeRes.json().catch(() => ({}))
        throw new Error(body.error || `Failed to store encrypted content: HTTP ${storeRes.status}`)
      }
      setEncryptStatus('✅ case-001 content encrypted and stored.')
    } catch (err: any) {
      setEncryptStatus(`❌ ${sanitizeError(err)}`)
    } finally {
      setEncryptBusy(false)
    }
  }, [noteText, fetchPolicyBytes, bearer])

  // ── 3. Attempt to decrypt case-001 content — same action for owner or agent ──
  const onDecrypt = useCallback(async () => {
    setDecryptBusy(true)
    setDecryptResult('')
    try {
      const policyBytes = await fetchPolicyBytes()

      const dataRes = await fetch('/api/case/case-001/data', {
        headers: { Authorization: `Bearer ${await bearer()}` },
      })
      if (!dataRes.ok) {
        const body = await dataRes.json().catch(() => ({}))
        throw new Error(body.error || `Failed to fetch case-001 content: HTTP ${dataRes.status}`)
      }
      const { encryptedBase64, tags } = await dataRes.json()

      const { IAMService } = await import('@tidecloak/js')
      const [plaintext] = await IAMService.doDecrypt(
        [{ encrypted: encryptedBase64, tags }],
        policyBytes
      )
      setDecryptResult(`✅ Decrypted: ${String(plaintext)}`)
    } catch (err: any) {
      setDecryptResult(`❌ Denied or failed: ${sanitizeError(err)}`)
    } finally {
      setDecryptBusy(false)
    }
  }, [fetchPolicyBytes, bearer])

  if (isInitializing) return <p>Initializing...</p>

  if (!authenticated) {
    return (
      <div style={{ padding: '2rem' }}>
        <p>You must log in to use the case-001 workflow.</p>
        <button onClick={login}>Log In</button>
      </div>
    )
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 640 }}>
      <h1>case-001 policy-governed access</h1>

      <section style={{ marginTop: '1.5rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>1. Verify stored policy</h2>
        <p style={{ color: '#666', fontSize: '0.85rem' }}>
          Decodes the signed policy's shape only. The contractId, signed parameters (including the
          owner vuid), and signature bytes are never displayed.
        </p>
        <button onClick={onVerifyPolicy} disabled={verifyBusy}>
          {verifyBusy ? 'Verifying...' : 'Verify Policy'}
        </button>
        {verifyStatus && <p style={{ marginTop: '0.5rem' }}>{verifyStatus}</p>}
      </section>

      <section style={{ marginTop: '1.5rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>2. Encrypt case-001 content (case owner only)</h2>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder="Case content to encrypt..."
          style={{ width: '100%', minHeight: 64 }}
        />
        <button onClick={onEncrypt} disabled={encryptBusy || !noteText}>
          {encryptBusy ? 'Encrypting...' : 'Encrypt & Store'}
        </button>
        {encryptStatus && <p style={{ marginTop: '0.5rem' }}>{encryptStatus}</p>}
      </section>

      <section style={{ marginTop: '1.5rem', borderTop: '1px solid #eee', paddingTop: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>3. Attempt to decrypt case-001 content</h2>
        <p style={{ color: '#666', fontSize: '0.85rem' }}>
          Whether this succeeds depends on the Forseti contract: allowed if you are the case owner,
          or if you hold the case-agent-access-case-001 role.
        </p>
        <button onClick={onDecrypt} disabled={decryptBusy}>
          {decryptBusy ? 'Attempting...' : 'Attempt Decrypt'}
        </button>
        {decryptResult && <p style={{ marginTop: '0.5rem' }}>{decryptResult}</p>}
      </section>
    </div>
  )
}
