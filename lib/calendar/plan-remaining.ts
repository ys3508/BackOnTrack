import { addDays } from "@/lib/workspace/dates"
import type { PlannedSession } from "@/lib/workspace/schemas"

export type ProposedSession = { date: string; minutes: number; label: string }

export type RemainingPlan = {
  sessions: ProposedSession[]
  /** Steps that don't fit in the days available. */
  unscheduled: string[]
  deadlinePassed: boolean
}

export const MINUTES_PER_STEP = 25
const DAYS_WITHOUT_DEADLINE = 14
const DAYS_AFTER_PASSED_DEADLINE = 7
const MIN_SLOT = 5

function isWeekend(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return weekday === 0 || weekday === 6
}

/**
 * Spreads open steps over the days left, using only the time the user says they
 * have, and counting work already planned. It's plain arithmetic, not AI. It only
 * proposes sessions, and it has no way to change a deadline.
 */
export function planRemaining({
  steps,
  today,
  deadline,
  minutesPerDay,
  skipWeekends,
  existing,
}: {
  steps: string[]
  today: string
  deadline: string | null
  minutesPerDay: number
  skipWeekends: boolean
  existing: PlannedSession[]
}): RemainingPlan {
  const deadlinePassed = Boolean(deadline && deadline < today)
  const lastDay =
    deadline && !deadlinePassed
      ? deadline
      : addDays(
          today,
          (deadlinePassed
            ? DAYS_AFTER_PASSED_DEADLINE
            : DAYS_WITHOUT_DEADLINE) - 1
        )

  const days: { date: string; free: number }[] = []
  for (let date = today; date <= lastDay; date = addDays(date, 1)) {
    if (skipWeekends && isWeekend(date)) continue
    const planned = existing
      .filter((item) => item.date === date && !item.done)
      .reduce((sum, item) => sum + item.minutes, 0)
    days.push({ date, free: Math.max(0, minutesPerDay - planned) })
  }

  // A step already planned doesn't need planning again.
  const alreadyPlanned = new Set(
    existing.filter((item) => !item.done).map((item) => item.label)
  )
  const sessions: ProposedSession[] = []
  const unscheduled: string[] = []

  for (const step of steps) {
    if (alreadyPlanned.has(step)) continue
    // A step stays in one sitting whenever a day has room for it.
    const whole = days.find((day) => day.free >= MINUTES_PER_STEP)
    if (whole) {
      sessions.push({
        date: whole.date,
        minutes: MINUTES_PER_STEP,
        label: step,
      })
      whole.free -= MINUTES_PER_STEP
      continue
    }
    // Five-minute scraps of a step aren't a plan, so it's reported as not fitting.
    if (minutesPerDay >= MINUTES_PER_STEP) {
      unscheduled.push(step)
      continue
    }
    let needed = MINUTES_PER_STEP
    const placed: ProposedSession[] = []
    for (const day of days) {
      if (!needed) break
      if (day.free < MIN_SLOT) continue
      const minutes = Math.min(needed, day.free)
      placed.push({ date: day.date, minutes, label: step })
      day.free -= minutes
      needed -= minutes
    }
    if (needed > 0) {
      // Doesn't fit, so its partial time is handed back for the next step.
      for (const item of placed) {
        const day = days.find((entry) => entry.date === item.date)
        if (day) day.free += item.minutes
      }
      unscheduled.push(step)
    } else {
      sessions.push(...placed)
    }
  }

  return { sessions, unscheduled, deadlinePassed }
}
