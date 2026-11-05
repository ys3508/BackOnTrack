import { daysBetween, shortDate } from "@/lib/workspace/dates"
import type { Task, Workspace } from "@/lib/workspace/schemas"
import { isActive } from "@/lib/workspace/schemas"
import { priorityScore } from "@/lib/workspace/selectors"

export const MINUTES_PER_OPEN_STEP = 25
export const QUICK_MINUTES = 10

export type Remaining = {
  minutes: number
  /** False when it's a guess, because the user gave no estimate. */
  known: boolean
}

/** What's left to do, using the user's estimate if they gave one. */
export function remainingMinutes(task: Task): Remaining {
  if (task.estimateMinutes) {
    const left = (task.estimateMinutes * (100 - task.progress)) / 100
    return { minutes: Math.max(5, Math.round(left / 5) * 5), known: true }
  }
  const open = task.subtasks.filter((sub) => !sub.done).length
  return { minutes: Math.max(1, open) * MINUTES_PER_OPEN_STEP, known: false }
}

/** The facts behind a task's place in the order, in plain words. */
export function reasonsFor(task: Task, state: Workspace, today: string) {
  const reasons: string[] = []
  if (
    state.planned.some(
      (item) => item.taskId === task.id && item.date === today && !item.done
    )
  ) {
    reasons.push("You planned work on it today")
  }
  if (task.deadline) {
    const days = daysBetween(today, task.deadline)
    if (days < 0) {
      reasons.push(
        `Its deadline was ${shortDate(task.deadline)}, so it’s worth checking what’s still possible`
      )
    } else if (days === 0) reasons.push("Due today")
    else if (days === 1) reasons.push("Due tomorrow")
    else if (days <= 7) reasons.push(`Due in ${days} days`)
  }
  if (task.priority === "high") reasons.push("You marked it high priority")
  if (task.priority === "medium") reasons.push("You marked it medium priority")
  if (task.status === "needs-recovery") {
    reasons.push("It’s waiting for a new approach")
  }
  if (task.status === "in-progress") reasons.push("You’ve already started it")
  return reasons.length
    ? reasons
    : ["No deadline or priority yet, so it comes after the others"]
}

export type RankedTask = {
  task: Task
  score: number
  reasons: string[]
  remaining: Remaining
}

/** Every open task in suggested order. Calculated, so it can always explain itself. */
export function rankTasks(state: Workspace, today: string): RankedTask[] {
  return state.tasks
    .filter((task) => isActive(task) && task.status !== "paused")
    .map((task) => ({
      task,
      score: priorityScore(task, state, today),
      reasons: reasonsFor(task, state, today),
      remaining: remainingMinutes(task),
    }))
    .sort(
      (a, b) =>
        b.score - a.score || a.task.createdAt.localeCompare(b.task.createdAt)
    )
}

export function isQuick({ remaining }: RankedTask) {
  return remaining.known && remaining.minutes <= QUICK_MINUTES
}
