'use client'

import { useTideCloak } from '@tidecloak/nextjs'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'

// Shared top navigation for every authenticated page (dashboard, secure
// case page, admin ceremony). Renders nothing on the public login page —
// each page decides whether to include it, so unauthenticated visitors on
// "/" never see nav links to pages they can't use yet.
//
// Mobile-friendly: below 720px the link list collapses behind a hamburger
// toggle button (aria-expanded / aria-controls wired for screen readers).
// No token, vuid, or role name beyond "preferred_username" is ever
// rendered here.

const NAV_LINKS = [
  { href: '/home', label: 'Dashboard' },
  { href: '/case-001', label: 'Secure Case 001' },
]

export default function AppNav() {
  const { authenticated, logout, getValueFromIdToken } = useTideCloak()
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)

  const onLogout = useCallback(() => {
    logout()
  }, [logout])

  if (!authenticated) return null

  const username = getValueFromIdToken('preferred_username')

  return (
    <header className="app-nav">
      <div className="app-nav-inner">
        <Link href="/home" className="app-nav-brand">
          <span className="app-nav-mark" aria-hidden="true">
            TC
          </span>
          Secure IT Support Portal
        </Link>

        <nav className="app-nav-links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="app-nav-link"
              aria-current={pathname === link.href ? 'page' : undefined}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="app-nav-user">
          {username && <span className="app-nav-username">{username}</span>}
          <button type="button" className="btn btn-secondary" onClick={onLogout}>
            Log out
          </button>
        </div>

        <button
          type="button"
          className="app-nav-toggle"
          aria-expanded={menuOpen}
          aria-controls="app-nav-mobile-menu"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? '✕' : '☰'}
        </button>
      </div>

      <nav
        id="app-nav-mobile-menu"
        className={`app-nav-mobile${menuOpen ? ' is-open' : ''}`}
        aria-label="Primary, mobile"
      >
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="app-nav-link"
            aria-current={pathname === link.href ? 'page' : undefined}
            onClick={() => setMenuOpen(false)}
          >
            {link.label}
          </Link>
        ))}
        {username && <span className="app-nav-username">Signed in as {username}</span>}
        <button type="button" className="btn btn-secondary" onClick={onLogout}>
          Log out
        </button>
      </nav>
    </header>
  )
}
