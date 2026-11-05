import type { TimerState } from "@/lib/workspace/schemas"

/**
 * All timing comes from wall-clock timestamps. Nothing counts interval ticks, so
 * the time stays right when a browser throttles a background tab, the computer
 * sleeps, or the page reloads.
 */
export function elapsedMs(timer: TimerState, now: number) {
  const running = timer.runningSince === null ? 0 : now - timer.runningSince
  return timer.accumulatedMs + Math.max(0, running)
}

export function remainingSeconds(timer: TimerState, now: number) {
  const left = timer.plannedSeconds * 1000 - elapsedMs(timer, now)
  return Math.max(0, Math.ceil(left / 1000))
}

export function isTimerFinished(timer: TimerState, now: number) {
  return remainingSeconds(timer, now) === 0
}

/** The moment the timer reached zero, even if that was while the page was closed. */
export function finishTime(timer: TimerState, now: number) {
  if (timer.runningSince === null) return now
  const left = timer.plannedSeconds * 1000 - timer.accumulatedMs
  return Math.min(now, timer.runningSince + left)
}

export function formatClock(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
}

export function formatMinutes(seconds: number) {
  if (seconds < 60) return `${seconds} sec`
  return `${Math.round(seconds / 60)} min`
}
