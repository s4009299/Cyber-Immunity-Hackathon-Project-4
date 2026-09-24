// Shared sanitised server-side error logging.
//
// Upstream errors from TideCloak / the Tide enclave / ORK network can
// legitimately contain ORK URLs, ports, request IDs, or other operational
// detail in their message text. None of that is ever safe to pass to
// console.error verbatim, and none of it is ever a vuid, token, or policy
// byte either (those never appear in JS Error objects thrown by this code —
// see the throw sites in each route) but we do not rely on that distinction
// holding forever. Every server-side catch block in this app logs only:
//   - a fixed operation name supplied by the caller, and
//   - a coarse, safe category derived from the error (never the raw message).
//
// This intentionally loses debugging detail. That is the correct trade-off
// for a security-sensitive app: an operator investigating an incident reads
// the operation name and category from the log, then reproduces the failure
// under controlled conditions if more detail is needed, rather than the logs
// themselves becoming a place sensitive values could leak to.

function categorize(err: unknown): string {
  if (err instanceof Error) {
    // HTTP-status-shaped messages ("... HTTP 404", "... HTTP 500") are safe
    // to bucket by status class without echoing the rest of the message.
    const statusMatch = err.message.match(/HTTP (\d{3})/)
    if (statusMatch) {
      const status = Number(statusMatch[1])
      if (status >= 500) return 'upstream-5xx'
      if (status === 404) return 'upstream-404'
      if (status >= 400) return 'upstream-4xx'
    }
    if (err.name && err.name !== 'Error') return `error:${err.name}`
    return 'error'
  }
  return 'unknown'
}

export function logSafeError(operation: string, err: unknown): void {
  console.error(`[${operation}] failed`, { category: categorize(err) })
}
