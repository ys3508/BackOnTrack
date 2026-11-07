import { plannedSessions } from "@/lib/calendar/model"
import { formatClockTime } from "@/lib/calendar/derived"
import { isActive } from "@/lib/workspace/schemas"
import type { PlannedSession, Workspace } from "@/lib/workspace/schemas"

export const REMIND_BEFORE_MS = 5 * 60_000

/** Moving a block re-arms its reminder, since this includes the time. */
export const reminderKey = (session: PlannedSession) =>
  `${session.id}:${session.date}T${session.time}`

export type Reminder = {
  key: string
  taskId: string
  title: string
  body: string
}

/**
 * Blocks starting in about five minutes that haven't reminded yet. It's worked
 * out from the clock, so it only runs while the app is open in a tab.
 */
export function dueReminders(state: Workspace, now: number): Reminder[] {
  if (!state.settings.remindersEnabled) return []
  return plannedSessions(state).flatMap((session): Reminder[] => {
    if (!session.time || session.done || session.outcome) return []
    if (state.remindedBlocks.includes(reminderKey(session))) return []
    const start = new Date(`${session.date}T${session.time}:00`)
    const until = start.getTime() - now
    if (until <= 0 || until > REMIND_BEFORE_MS) return []
    const task = state.tasks.find((item) => item.id === session.taskId)
    // Nothing to nudge about if it's already underway or set aside.
    if (!task || !isActive(task) || task.status === "paused") return []
    if (state.timer?.taskId === task.id) return []
    return [
      {
        key: reminderKey(session),
        taskId: task.id,
        title: task.title,
        body: `Planned for ${formatClockTime(start)}`,
      },
    ]
  })
}
