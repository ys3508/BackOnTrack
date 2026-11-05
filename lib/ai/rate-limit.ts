const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_CLIENT = 40
const MAX_GLOBAL_PER_DAY = 500
const DAY_MS = 24 * 60 * 60 * 1000

const clients = new Map<string, { count: number; resetAt: number }>()
let global = { count: 0, resetAt: 0 }

/**
 * Simple in-memory usage control for a demo deployment. Counters are kept per
 * server instance and reset on restart, so this limits accidental overuse but
 * is not a strict quota. Set a spend limit with the AI provider as well.
 */
export function checkRateLimit(clientId: string, now = Date.now()) {
  if (now >= global.resetAt) global = { count: 0, resetAt: now + DAY_MS }
  if (global.count >= MAX_GLOBAL_PER_DAY) return false

  if (clients.size > 5000) {
    for (const [id, entry] of clients) {
      if (now >= entry.resetAt) clients.delete(id)
    }
  }

  const entry = clients.get(clientId)
  if (!entry || now >= entry.resetAt) {
    clients.set(clientId, { count: 1, resetAt: now + WINDOW_MS })
  } else {
    if (entry.count >= MAX_PER_CLIENT) return false
    entry.count++
  }
  global.count++
  return true
}

export function resetRateLimitForTests() {
  clients.clear()
  global = { count: 0, resetAt: 0 }
}
