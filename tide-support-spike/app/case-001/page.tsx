'use client'

import { useTideCloak } from '@tidecloak/nextjs'
import { useCallback, useState } from 'react'
import AppNav from '../components/AppNav'
import { categorizeForClient } from '../../lib/safeLog'

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

// Sends only a fixed, pre-computed category — never the raw error — to be
// logged server-side. The complete error text (which for Forseti/ORK
// failures can include gas values, ORK URLs, or other internal detail)
// never leaves the browser. Best-effort: a failure to log must never block
// or alter the UI outcome the user already sees.
function reportSafely(operation: string, category: ReturnType<typeof categorizeForClient>, bearer: () => Promise<string>): void {
  bearer()
    .then((token) =>
      fetch('/api/log/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ operation, category }),
      })
    )
    .catch(() => {})
}

// The single user-friendly message shown for any access-denial caused by a
// missing role — never the verbose Forseti message (which names the
// specific role, and in other failure modes could include ORK/gas/URL
// detail). Every other decrypt failure still goes through sanitizeError,
// which strips URLs and long hex identifiers, but is not replaced outright
// since those cases are not simple permission denials.
const ACCESS_DENIED_MESSAGE = 'Access denied. You do not have permission to decrypt this case.'

export default function CaseOnePage() {
  const { authenticated, isInitializing, login, getToken } = useTideCloak()

  const [verifyStatus, setVerifyStatus] = useState('')
  const [verifyOk, setVerifyOk] = useState<boolean | null>(null)
  const [verifyBusy, setVerifyBusy] = useState(false)

  const [noteText, setNoteText] = useState('')
  const [encryptStatus, setEncryptStatus] = useState('')
  const [encryptOk, setEncryptOk] = useState<boolean | null>(null)
  const [encryptBusy, setEncryptBusy] = useState(false)

  const [decryptResult, setDecryptResult] = useState('')
  const [decryptOk, setDecryptOk] = useState<boolean | null>(null)
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
    setVerifyOk(null)
    try {
      const bytes = await fetchPolicyBytes()
      const { Models } = await import('@tideorg/js')
      const { Policy } = Models as any
      const policy = Policy.from(bytes)
      const hasSignature = !!policy.signature && policy.signature.length > 0
      setVerifyOk(true)
      setVerifyStatus(
        `Policy decoded. version=${policy.version}, ` +
          `modelIds=[${policy.modelIds.join(', ')}], ` +
          `approvalType=${policy.approvalType}, executionType=${policy.executionType}, ` +
          `signaturePresent=${hasSignature}. ` +
          `(contractId, params, and signature bytes are intentionally not displayed.)`
      )
    } catch (err: any) {
      setVerifyOk(false)
      setVerifyStatus(sanitizeError(err))
    } finally {
      setVerifyBusy(false)
    }
  }, [fetchPolicyBytes])

  // ── 2. Customer encrypts case-001 content under the signed policy ──
  const onEncrypt = useCallback(async () => {
    setEncryptBusy(true)
    setEncryptStatus('')
    setEncryptOk(null)
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
      setEncryptOk(true)
      setEncryptStatus('case-001 content encrypted and stored.')
    } catch (err: any) {
      setEncryptOk(false)
      setEncryptStatus(sanitizeError(err))
    } finally {
      setEncryptBusy(false)
    }
  }, [noteText, fetchPolicyBytes, bearer])

  // ── 3. Attempt to decrypt case-001 content — same action for owner or agent ──
  const onDecrypt = useCallback(async () => {
    setDecryptBusy(true)
    setDecryptResult('')
    setDecryptOk(null)
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
      setDecryptOk(true)
      setDecryptResult(`Decrypted: ${String(plaintext)}`)
    } catch (err: any) {
      setDecryptOk(false)
      const category = categorizeForClient(err)
      // The complete error (which may include Forseti/ORK internal detail
      // such as gas values, ORK URLs, or stack information) is never shown
      // to the user and never sent anywhere in full — only this pre-computed
      // category is reported for server-side logging, below.
      setDecryptResult(
        category === 'forseti-denied-missing-role' ? ACCESS_DENIED_MESSAGE : `Denied or failed: ${sanitizeError(err)}`
      )
      reportSafely('case-001.decrypt', category, bearer)
    } finally {
      setDecryptBusy(false)
    }
  }, [fetchPolicyBytes, bearer])

  if (isInitializing) {
    return (
      <div className="centered-shell">
        <p style={{ color: 'var(--white)' }}>Initializing…</p>
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="centered-shell">
        <main id="main-content" className="card card--elevated" style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
          <span className="eyebrow">Secure Case 001</span>
          <h1 style={{ margin: '0.5rem 0', fontSize: '1.3rem' }}>Sign in required</h1>
          <p className="muted">You must log in to use the case-001 workflow.</p>
          <button onClick={login} className="btn btn-primary btn-block" style={{ marginTop: '1rem' }}>
            Log In
          </button>
        </main>
      </div>
    )
  }

  return (
    <div className="page-shell">
      <AppNav />
      <main id="main-content" className="page-main">
        <div className="stack" style={{ gap: '1.5rem' }}>
          <section className="card">
            <div className="card-header">
              <div>
                <span className="eyebrow">Support case</span>
                <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.4rem', color: 'var(--navy-900)' }}>
                  Case-001 — Policy-governed access
                </h1>
                <p className="card-subtitle" style={{ marginTop: '0.35rem' }}>
                  Access to this case's content is enforced by a signed Forseti policy inside the
                  Tide enclave, not by this application.
                </p>
              </div>
              <span className="badge badge-teal">
                <span className="badge-dot" aria-hidden="true" />
                Forseti contract
              </span>
            </div>
          </section>

          {/* ── 1. Verify stored policy ── */}
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">1. Verify stored policy</h2>
                <p className="card-subtitle">
                  Decodes the signed policy's shape only. The contractId, signed parameters
                  (including the owner VUID), and signature bytes are never displayed.
                </p>
              </div>
              <span className="badge badge-info">
                <span className="badge-dot" aria-hidden="true" />
                Read-only
              </span>
            </div>
            <button onClick={onVerifyPolicy} className="btn btn-primary" disabled={verifyBusy} aria-busy={verifyBusy}>
              {verifyBusy ? 'Verifying...' : 'Verify Policy'}
            </button>
            {verifyStatus && (
              <p
                role="status"
                className={`alert ${verifyOk ? 'alert-success' : 'alert-danger'}`}
                style={{ marginTop: '1rem' }}
              >
                {verifyStatus}
              </p>
            )}
          </section>

          {/* ── 2. Encrypt ── */}
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">2. Encrypt case-001 content</h2>
                <p className="card-subtitle">Case owner only — enforced by the Forseti contract.</p>
              </div>
              <span className="badge badge-warning">
                <span className="badge-dot" aria-hidden="true" />
                Owner action
              </span>
            </div>
            <div className="form-field">
              <label htmlFor="case-content" className="form-label">
                Case content
              </label>
              <textarea
                id="case-content"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Case content to encrypt..."
                className="textarea-input"
              />
              <button
                onClick={onEncrypt}
                className="btn btn-primary"
                disabled={encryptBusy || !noteText}
                aria-busy={encryptBusy}
                style={{ alignSelf: 'flex-start' }}
              >
                {encryptBusy ? 'Encrypting...' : 'Encrypt & Store'}
              </button>
              {encryptStatus && (
                <p role="status" className={`alert ${encryptOk ? 'alert-success' : 'alert-danger'}`}>
                  {encryptStatus}
                </p>
              )}
            </div>
          </section>

          {/* ── 3. Decrypt ── */}
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">3. Attempt to decrypt case-001 content</h2>
                <p className="card-subtitle">
                  Allowed if you are the case owner, or if you hold the
                  case-agent-access-case-001 role. Decided entirely by the Forseti contract.
                </p>
              </div>
              <span className="badge badge-neutral">
                <span className="badge-dot" aria-hidden="true" />
                Access-controlled
              </span>
            </div>
            <button onClick={onDecrypt} className="btn btn-teal" disabled={decryptBusy} aria-busy={decryptBusy}>
              {decryptBusy ? 'Attempting...' : 'Attempt Decrypt'}
            </button>
            {decryptResult && (
              <p
                role="status"
                className={`alert ${decryptOk ? 'alert-success' : 'alert-danger'}`}
                style={{ marginTop: '1rem' }}
              >
                {decryptResult}
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
