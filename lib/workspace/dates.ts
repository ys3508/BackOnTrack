/** Dates are plain YYYY-MM-DD strings, so they never shift between time zones. */

export function localToday(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

function toUtc(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return Date.UTC(year, month - 1, day)
}

export function addDays(date: string, days: number) {
  return new Date(toUtc(date) + days * 86_400_000).toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string) {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000)
}

export function shortDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(toUtc(date)))
}

/** A calm description of a deadline, without alarm words. */
export function deadlineText(deadline: string, today: string) {
  const days = daysBetween(today, deadline)
  if (days === 0) return "Due today"
  if (days === 1) return "Due tomorrow"
  if (days < 0) return `Deadline was ${shortDate(deadline)}`
  return `Due ${shortDate(deadline)}`
}

export function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso))
}
