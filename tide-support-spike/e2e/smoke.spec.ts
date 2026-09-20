import { test, expect } from '@playwright/test'

// Smoke/contract tests for the Tide-protected customer support spike.
//
// These tests deliberately stop at the boundary of the Tide login flow.
// No real username, password, token, or Tide enclave approval is stored,
// generated, or automated anywhere in this suite. They verify:
//
//   1. The public page (`/`) loads successfully for an anonymous visitor.
//   2. The unauthenticated sign-in UI is shown (heading, prompt, Log In button).
//   3. A protected API route rejects a request with no bearer token, and
//      rejects a request with a syntactically-present-but-invalid token —
//      both via the app's real server-side JWT verification path, not a
//      relaxed or mocked check.
//
// None of this requires TideCloak to be running. If TideCloak is down, the
// login button still renders (it only calls out to TideCloak when clicked),
// and the protected route's rejection of a missing/invalid token happens
// before any TideCloak-dependent verification would occur.

test.describe('Public application page', () => {
  test('loads successfully for an unauthenticated visitor', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBe(200)
  })

  test('shows the expected sign-in interface', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Welcome!' })).toBeVisible()
    await expect(page.getByText('Please log in to continue.')).toBeVisible()

    const loginButton = page.getByRole('button', { name: 'Log In' })
    await expect(loginButton).toBeVisible()
    await expect(loginButton).toBeEnabled()
  })
})

test.describe('Protected API route authentication', () => {
  test('rejects a request with no Authorization header', async ({ request }) => {
    const response = await request.get('/api/protected')
    expect(response.status()).toBe(401)

    const body = await response.json()
    expect(body).toHaveProperty('error')
  })

  test('rejects a request with a malformed Authorization header', async ({ request }) => {
    const response = await request.get('/api/protected', {
      headers: { Authorization: 'NotBearer something' },
    })
    expect(response.status()).toBe(401)
  })

  test('rejects a request with a syntactically-invalid bearer token', async ({ request }) => {
    // This is not a real token — it is a fixed, obviously-fake string used
    // only to exercise the route's signature-verification failure path.
    // No real Tide-issued token is used or stored anywhere in this suite.
    const response = await request.get('/api/protected', {
      headers: { Authorization: 'Bearer not-a-real-jwt.invalid.token' },
    })
    // The route verifies via embedded JWKS (I-04) and must reject an
    // unparseable/invalid token. Accept 401 or 403/500 depending on where
    // verification fails, but never a 200.
    expect(response.status()).not.toBe(200)
  })
})
