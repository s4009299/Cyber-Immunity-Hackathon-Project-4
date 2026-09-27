'use client'

import { useTideCloak } from '@tidecloak/nextjs'
import type { TidecloakConfig } from '@tidecloak/nextjs/server'
import { useState, useCallback, useEffect } from 'react'
import rawConfig from "../../tidecloak.json"
import AppNav from '../components/AppNav'
import Link from 'next/link'

// tidecloak.json is a placeholder ({}) until `npm run init` provisions the realm
// and writes the real adapter config. Type it via the SDK's own config shape so
// fields like `realm` type-check regardless of the placeholder's contents.
const tcConfig = rawConfig as TidecloakConfig

// Same sanitisation used on the case-001 page: strips anything URL-shaped
// (ORK endpoints are URLs) or long-hex-shaped (vuids/similar identifiers)
// from any error surfaced to the UI, defensively, even though today's
// self-encrypt/self-decrypt error paths are not known to include them.
function sanitizeError(err: any): string {
  let message = (err && (err.message || String(err))) || 'Failed'
  message = message.replace(/https?:\/\/\S+/gi, '[url removed]')
  message = message.replace(/\b[0-9a-fA-F]{16,}\b/g, '[id removed]')
  return message
}


export default function HomePage() {
  const { logout, getValueFromIdToken, hasRealmRole, token, doEncrypt, doDecrypt } = useTideCloak()

  const [username, setUsername] = useState("")
  const [hasDefaultRole, setHasDefaultRole] = useState(false)
  const [isSupportAgent, setIsSupportAgent] = useState(false)
  const [isCustomer, setIsCustomer] = useState(false)
  const [verifyResult, setVerifyResult] = useState<string | null>(null)
  const [verifyOk, setVerifyOk] = useState<boolean | null>(null)
  const [verifying, setVerifying] = useState(false)

  // Self encrypt/decrypt: data is bound to THIS user's identity — only they can
  // decrypt it. The "message" tag matches the _tide_message.selfencrypt/.selfdecrypt
  // roles granted to every user in init/realm.json.
  const TAG = "message"
  const [text, setText] = useState("")        // always the decrypted value, editable
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [cryptoErr, setCryptoErr] = useState("")

  // localStorage key for the saved note, namespaced per user (vuid).
  const storageKey = () => `tide-note:${getValueFromIdToken("vuid")}`

  useEffect(() => {
    if (token) {
      const name = getValueFromIdToken("preferred_username")
      const defaultRole = hasRealmRole(`default-roles-${tcConfig["realm"]}`)
      setUsername(name);
      setHasDefaultRole(defaultRole)
      setIsSupportAgent(hasRealmRole("support-agent"))
      setIsCustomer(hasRealmRole("customer"))

      // Restore the saved note. Only the CIPHERTEXT is persisted; we decrypt it
      // client-side here so the field shows plaintext when you log back in.
      const stored = typeof window !== "undefined" ? localStorage.getItem(storageKey()) : null
      if (stored) {
        doDecrypt([{ encrypted: stored, tags: [TAG] }])
          .then((res) => setText(String(res[0])))
          .catch(() => {})
      }
    }

  }, [token])

  const onLogout = useCallback(() => {
    logout()
  }, [logout])

  const onVerify = useCallback(async () => {
    setVerifying(true)
    setVerifyResult(null)
    setVerifyOk(null)
    try {
      const res = await fetch('/api/protected', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
      const data = await res.json()
      if (res.ok) {
        setVerifyOk(true)
        setVerifyResult(`Session verified server-side. Role checks and signature verification passed.`)
      } else {
        setVerifyOk(false)
        setVerifyResult(`${res.status} — ${data.error || res.statusText}`)
      }
    } catch (err: any) {
      setVerifyOk(false)
      setVerifyResult(`Network error: ${sanitizeError(err)}`)
    } finally {
      setVerifying(false)
    }
  }, [token])

  // Submit = encrypt the current value, persist the ciphertext, then decrypt it
  // straight back so the field keeps showing plaintext. We store only the
  // ciphertext (here in localStorage; in a real app, on your server) — it's
  // decrypted again when you log back in.
  const onSubmit = useCallback(async () => {
    setBusy(true); setCryptoErr(""); setStatus("")
    try {
      const [ct] = await doEncrypt([{ data: text, tags: [TAG] }])
      if (typeof window !== "undefined") localStorage.setItem(storageKey(), ct)
      const [pt] = await doDecrypt([{ encrypted: ct, tags: [TAG] }])
      setText(String(pt))
      setStatus("Message successfully stored")
    } catch (err: any) {
      setCryptoErr(sanitizeError(err))
    } finally {
      setBusy(false)
    }
  }, [text, doEncrypt, doDecrypt])

  const roleLabel = isSupportAgent ? 'Support Agent' : isCustomer ? 'Customer' : 'User'

  return (
    <div className="page-shell">
      <AppNav />
      <main id="main-content" className="page-main">
        <div className="stack" style={{ gap: '1.5rem' }}>
          {/* ── Welcome header with role + session indicators ── */}
          <section className="card">
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: '1rem',
              }}
            >
              <div>
                <span className="eyebrow">Dashboard</span>
                <h1 style={{ margin: '0.25rem 0 0', fontSize: '1.5rem', color: 'var(--navy-900)' }}>
                  Hello, {username || 'there'}
                </h1>
                <p className="muted" style={{ margin: '0.35rem 0 0' }}>
                  Signed in to the Secure IT Support Portal
                </p>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                <span className="badge badge-info">
                  <span className="badge-dot" aria-hidden="true" />
                  Role: {roleLabel}
                </span>
                <span className={`badge ${hasDefaultRole ? 'badge-success' : 'badge-neutral'}`}>
                  <span className="badge-dot" aria-hidden="true" />
                  {hasDefaultRole ? 'Default roles active' : 'Default roles missing'}
                </span>
              </div>
            </div>
          </section>

          {/* ── Quick access to the secure case workflow ── */}
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Secure case access</h2>
                <p className="card-subtitle">
                  Policy-governed encryption and decryption for support cases you own or have been
                  granted access to.
                </p>
              </div>
              <span className="badge badge-teal">
                <span className="badge-dot" aria-hidden="true" />
                Forseti-protected
              </span>
            </div>
            <Link href="/case-001" className="btn btn-teal">
              Open Case-001 →
            </Link>
          </section>

          {/* ── Session verification ── */}
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Session security check</h2>
                <p className="card-subtitle">
                  Confirms your access token is verified server-side against TideCloak, including
                  its signature and required role.
                </p>
              </div>
            </div>

            <button
              onClick={onVerify}
              className="btn btn-primary"
              disabled={verifying}
              aria-busy={verifying}
            >
              {verifying ? 'Verifying…' : 'Verify Token'}
            </button>

            {verifyResult && (
              <p
                role="status"
                className={`alert ${verifyOk ? 'alert-success' : 'alert-danger'}`}
                style={{ marginTop: '1rem' }}
              >
                {verifyResult}
              </p>
            )}
          </section>

          {/* ── Encrypted personal note ── */}
          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Your encrypted note</h2>
                <p className="card-subtitle">
                  Protected under your own identity — only you can decrypt this note.
                </p>
              </div>
              <span className="badge badge-success">
                <span className="badge-dot" aria-hidden="true" />
                Self-encrypted
              </span>
            </div>

            <div className="form-field">
              <label htmlFor="note-text" className="visually-hidden">
                Encrypted note content
              </label>
              <textarea
                id="note-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type your note…"
                className="textarea-input"
              />
              <button onClick={onSubmit} className="btn btn-primary" disabled={busy} aria-busy={busy} style={{ alignSelf: 'flex-start' }}>
                {busy ? 'Submitting…' : 'Submit'}
              </button>

              {status && (
                <p role="status" className="alert alert-success">
                  {status}
                </p>
              )}
              {cryptoErr && (
                <p role="alert" className="alert alert-danger">
                  {cryptoErr}
                </p>
              )}
            </div>
          </section>

          <button onClick={onLogout} className="btn btn-secondary" style={{ alignSelf: 'flex-start' }}>
            Log out
          </button>
        </div>
      </main>
    </div>
  )
}
