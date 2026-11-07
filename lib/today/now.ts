import { rankTasks } from "@/lib/planning/priority"
import { addDays, daysBetween, localToday } from "@/lib/workspace/dates"
import { isActive } from "@/lib/workspace/schemas"
import type {
  FocusSession,
  PlannedSession,
  Recovery,
  Settings,
  Task,
  TimerState,
  Workspace,
} from "@/lib/workspace/schemas"
import { startCue } from "@/lib/workspace/selectors"

/**
 * The one thing the Now card is about. Calculated from recorded facts, so it's
 * the same after a reload, and nothing here is decided by AI.
 */
export type NowState =
  | { kind: "active"; timer: TimerState; task: Task | null }
  | { kind: "paused"; timer: TimerState; task: Task | null }
  | { kind: "finished"; session: FocusSession }
  | { kind: "recovering"; recovery: Recovery; task: Task | null }
  | { kind: "missed"; session: PlannedSession; task: Task }
  | { kind: "upcoming"; session: PlannedSession; task: Task }
  | { kind: "suggested"; task: Task; reason: string }
  | { kind: "empty" }

const startOf = (session: PlannedSession) =>
  new Date(`${session.date}T${session.time}:00`).getTime()

/** Planned for today, with a time, and not yet answered in any way. */
function openBlocksToday(state: Workspace, today: string, now: number) {
  return state.planned.flatMap((session) => {
    if (session.date !== today || !session.time) return []
    if (session.done || session.outcome) return []
    // An attempt means it was started, so it's never called missed. A block
    // still ahead stays on the card, with wherever they said to pick up.
    if (
      startOf(session) <= now &&
      state.focusSessions.some((item) => item.plannedId === session.id)
    ) {
      return []
    }
    const task = state.tasks.find((item) => item.id === session.taskId)
    return task && isActive(task) && task.status !== "paused"
      ? [{ session, task }]
      : []
  })
}

export function nowState(
  state: Workspace,
  today: string,
  now: number,
  /** A task the user moved past with "Pick one for me". */
  pickedId: string | null = null
): NowState {
  const { timer } = state
  if (timer) {
    const task = state.tasks.find((item) => item.id === timer.taskId) ?? null
    return {
      kind: timer.runningSince === null ? "paused" : "active",
      timer,
      task,
    }
  }
  const finished = state.focusSessions.find(
    (item) => item.id === state.finishedSessionId
  )
  if (finished) return { kind: "finished", session: finished }

  const { recovery } = state
  if (recovery) {
    const task = state.tasks.find((item) => item.id === recovery.taskId) ?? null
    // If the task was finished or removed elsewhere, there's nothing to recover.
    if (!recovery.taskId || (task && isActive(task))) {
      return { kind: "recovering", recovery, task }
    }
  }

  const blocks = openBlocksToday(state, today, now)
  const passed = blocks
    .filter(({ session }) => startOf(session) <= now)
    .sort((a, b) => startOf(b.session) - startOf(a.session))[0]
  if (passed) return { kind: "missed", ...passed }

  const next = blocks.sort((a, b) => startOf(a.session) - startOf(b.session))[0]
  if (next) return { kind: "upcoming", ...next }

  const ranked = rankTasks(state, today)
  if (!ranked.length) return { kind: "empty" }
  const chosen = ranked.find((entry) => entry.task.id === pickedId) ?? ranked[0]
  return {
    kind: "suggested",
    task: chosen.task,
    // "Nothing is set" isn't a reason worth showing.
    reason:
      chosen.task.deadline ||
      chosen.task.priority !== "none" ||
      chosen.task.status !== "not-started"
        ? chosen.reasons[0]
        : "",
  }
}

/** Due today or tomorrow, as far as the user has told us. */
export function isUrgent(task: Task, today: string) {
  return Boolean(task.deadline && task.deadline <= addDays(today, 1))
}

/**
 * Another task, for when the suggestion doesn't feel possible. Something with a
 * near deadline is never swapped for something that could wait.
 */
export function pickAnother(
  state: Workspace,
  today: string,
  currentId: string
): { id: string; keptBecause: string | null } {
  const ranked = rankTasks(state, today)
  const index = ranked.findIndex((entry) => entry.task.id === currentId)
  const current = ranked[index]?.task
  const urgent = ranked.filter((entry) => isUrgent(entry.task, today))
  if (current && isUrgent(current, today)) {
    const others = urgent.filter((entry) => entry.task.id !== currentId)
    if (others.length) {
      const at = urgent.findIndex((entry) => entry.task.id === currentId)
      return {
        id: urgent[(at + 1) % urgent.length].task.id,
        keptBecause: null,
      }
    }
    const days = daysBetween(today, current.deadline!)
    return {
      id: currentId,
      keptBecause:
        days < 0
          ? "This one’s date has already gone by, so it stays first for now."
          : days === 0
            ? "This one is due today, so it stays first."
            : "This one is due tomorrow, so it stays first.",
    }
  }
  if (urgent.length) return { id: urgent[0].task.id, keptBecause: null }
  if (ranked.length < 2) {
    return { id: currentId, keptBecause: "This is the only open task." }
  }
  return {
    id: ranked[(index + 1) % ranked.length].task.id,
    keptBecause: null,
  }
}

/** The first thing to do, if there's one written down. */
export function firstStepOf(task: Task) {
  return startCue(task)?.text ?? null
}

/** "Restarted" counts sessions that really began, never cards that were seen. */
export function restartsOn(state: Workspace, date: string) {
  return state.progressEvents.filter(
    (item) =>
      item.type === "restarted" && localToday(new Date(item.at)) === date
  ).length
}

/** The block's end has passed with nothing recorded, so it's worth asking. */
export function blockHasEnded(session: PlannedSession, now: number) {
  return startOf(session) + session.minutes * 60_000 <= now
}

/** True once the smaller version was met. The task itself stays open. */
export function minimumMet(state: Workspace, taskId: string) {
  return state.progressEvents.some(
    (item) => item.taskId === taskId && item.type === "minimum_met"
  )
}

/** How long the moment of finishing something stays on the page. */
export const WIN_SHOWN_MS = 30_000

/** Something just finished, in whole or in its smaller version. */
export function latestWin(state: Workspace, now: number) {
  for (let at = state.progressEvents.length - 1; at >= 0; at -= 1) {
    const item = state.progressEvents[at]
    if (item.type !== "minimum_met" && item.type !== "completed") continue
    // `now` can lag behind by up to a tick, so a brand new win looks "future".
    return now - new Date(item.at).getTime() < WIN_SHOWN_MS ? item : null
  }
  return null
}

/** A sitting, not the whole task: long estimates still start with something short. */
export function sessionMinutes(task: Task, settings: Settings) {
  return task.estimateMinutes
    ? Math.min(task.estimateMinutes, 25)
    : settings.defaultFocusMinutes
}

export type TodayOccurrence = {
  id: string
  title: string
  time: string
  done: boolean
  routineId: string
  placementId: string | null
}

/** Planned time that may be more than a day can hold. Only ever a suggestion. */
export const HEAVY_DAY_MINUTES = 8 * 60

export function plannedMinutesOn(state: Workspace, date: string) {
  return state.planned
    .filter((item) => item.date === date && !item.done)
    .reduce((sum, item) => sum + item.minutes, 0)
}

/** Tasks relevant today come first. The rest stay available, just folded away. */
export function splitTasks(state: Workspace, today: string) {
  const open = rankTasks(state, today).map((entry) => entry.task)
  const paused = state.tasks.filter((task) => task.status === "paused")
  const relevant = (task: Task) =>
    task.deadline === today ||
    task.status === "in-progress" ||
    task.quick ||
    localToday(new Date(task.createdAt)) === today ||
    state.planned.some(
      (item) => item.taskId === task.id && item.date === today && !item.done
    )
  return {
    today: open.filter(relevant),
    later: [...open.filter((task) => !relevant(task)), ...paused],
  }
}
