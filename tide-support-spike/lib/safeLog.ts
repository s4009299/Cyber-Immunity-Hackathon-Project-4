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

// Fixed, closed set of safe log categories. Only ever one of these strings
// is written to the server log for an error — never the error's own
// message text, which for Forseti/ORK failures can contain gas values,
// ORK URLs, request IDs, or other internal detail.
export type SafeErrorCategory =
  | 'forseti-denied-missing-role'
  | 'forseti-denied-other'
  | 'upstream-5xx'
  | 'upstream-404'
  | 'upstream-4xx'
  | `error:${string}`
  | 'error'
  | 'unknown'

function categorize(err: unknown): SafeErrorCategory {
  if (err instanceof Error) {
    // Forseti access-denial messages take the shape:
    //   "Forseti policy denied (Data, Executor): Missing role '<role>'."
    // Bucket the specific "missing role" case separately from other denials
    // (expired doken, contract-level rejection, etc.) so an operator can see
    // *that* a denial happened and *why in broad terms*, without any role
    // name, doken detail, or ORK/gas information ever being logged.
    if (/Forseti policy denied/i.test(err.message)) {
      return /missing role/i.test(err.message) ? 'forseti-denied-missing-role' : 'forseti-denied-other'
    }

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

/**
 * For client-side failures that must be logged server-side without ever
 * transmitting the raw error: the browser categorises the error using the
 * same rules as categorize() above, then this function logs ONLY that
 * pre-computed category string against the given operation name. Never
 * accepts or logs free-text — callers cannot pass an arbitrary message
 * through this path.
 */
export function logSafeCategory(operation: string, category: SafeErrorCategory): void {
  console.error(`[${operation}] failed`, { category })
}

/**
 * Client-side counterpart to categorize(): browsers cannot import
 * lib/safeLog's categorize() directly into a "use client" component and
 * then log server-side, so this mirrors the same closed category set for
 * use in the browser before the category (never the raw error) is sent to
 * /api/log/client-error.
 */
export function categorizeForClient(err: unknown): SafeErrorCategory {
  return categorize(err)
}
