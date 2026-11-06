import { htmlToText } from "@/lib/recovery/context"
import { concreteStep } from "@/lib/recovery/concrete"
import { daysBetween } from "@/lib/workspace/dates"
import type { Task, Workspace } from "@/lib/workspace/schemas"
import { isActive } from "@/lib/workspace/schemas"
import {
  currentSubtask,
  deadlinePassed,
  resumeTask,
  stepCounts,
} from "@/lib/workspace/selectors"

export const RETURN_AFTER_DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000

/** Based on when the app was last opened, so first use never counts as a return. */
export function isAway(lastOpenedAt: string | null, now: number) {
  if (!lastOpenedAt) return false
  const opened = Date.parse(lastOpenedAt)
  return !Number.isNaN(opened) && now - opened >= RETURN_AFTER_DAYS * DAY_MS
}

function lastFinishedStep(task: Task) {
  return task.subtasks
    .filter((sub) => sub.done)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0]
}

function pickTask(state: Workspace) {
  const started = resumeTask(state)
  if (started) return started
  return (
    state.tasks
      .filter((task) => isActive(task) && task.status !== "paused")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  )
}

export type ReturnSummary = {
  task: Task
  done: number
  total: number
  lastFinished: string | null
  documentWords: number
  documentEndsWith: string | null
  nextStep: string | null
  firstAction: string | null
  deadlineWasMissed: boolean
  /** A real date with real consequences, so it's stated once, without alarm. */
  alsoDue: { title: string; deadline: string } | null
  neverStarted: boolean
  resumeNote: string
}

/**
 * What a returning person needs, and nothing else. There are deliberately no
 * counts of overdue tasks, no time-away figure, and no list to work through.
 */
export function returnSummary(
  state: Workspace,
  today: string
): ReturnSummary | null {
  if (state.timer) return null
  const task = pickTask(state)
  if (!task) return null
  const { done, total } = stepCounts(task)
  const text = task.workDoc ? htmlToText(task.workDoc.content).trim() : ""
  const lastLine = text.split("\n").filter(Boolean).at(-1) ?? null
  const step = currentSubtask(task)?.title ?? null
  const firstAction = step ? concreteStep(step).firstAction : null
  const alsoDue =
    state.tasks
      .filter(
        (other) =>
          other.id !== task.id &&
          isActive(other) &&
          other.deadline !== null &&
          daysBetween(today, other.deadline) >= 0 &&
          daysBetween(today, other.deadline) <= 1
      )
      .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? ""))[0] ??
    null
  return {
    task,
    done,
    total,
    lastFinished: lastFinishedStep(task)?.title ?? null,
    documentWords: text ? text.split(/\s+/).length : 0,
    documentEndsWith:
      lastLine && lastLine.length > 90
        ? `${lastLine.slice(0, 87)}...`
        : lastLine,
    nextStep: step,
    firstAction: firstAction === step ? null : firstAction,
    deadlineWasMissed: deadlinePassed(task, today),
    alsoDue: alsoDue?.deadline
      ? { title: alsoDue.title, deadline: alsoDue.deadline }
      : null,
    neverStarted: !done && !total && !text && !task.resumeNote,
    resumeNote: task.resumeNote,
  }
}
