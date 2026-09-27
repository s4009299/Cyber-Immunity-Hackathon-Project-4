'use client'

import { useCallback } from 'react'
import { useTideCloak } from '@tidecloak/nextjs'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function LoginPage() {
  const { login, authenticated } = useTideCloak()
  const router = useRouter()

  const onLogin = useCallback(() => {
    login()
  }, [login])

  useEffect(() => {
    if (authenticated) {
      router.push('/home')
    }
  }, [authenticated])

  return (
    <div className="centered-shell">
      <main id="main-content" className="card card--elevated" style={{ maxWidth: 400, width: '100%' }}>
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center', gap: '0.5rem' }}>
          <span
            aria-hidden="true"
            style={{
              width: '3rem',
              height: '3rem',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, var(--teal-500), var(--blue-500))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--white)',
              fontWeight: 700,
              fontSize: '1.1rem',
            }}
          >
            TC
          </span>

          <span className="eyebrow">Secure IT Support Portal</span>
          <h1 style={{ margin: 0, fontSize: '1.6rem', color: 'var(--navy-900)' }}>Welcome!</h1>
          <p className="muted" style={{ margin: 0 }}>
            Please log in to continue.
          </p>
        </div>

        <button
          onClick={onLogin}
          className="btn btn-primary btn-block"
          style={{ marginTop: '1.5rem', padding: '0.75rem 1.15rem', fontSize: '0.95rem' }}
        >
          Log In
        </button>

        <p className="muted" style={{ marginTop: '1.25rem', textAlign: 'center', fontSize: '0.75rem' }}>
          Protected by TideCloak. Access to cases is verified and authorized on every request.
        </p>
      </main>
    </div>
  )
}
