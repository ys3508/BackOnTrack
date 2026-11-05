import { addDays, daysBetween } from "@/lib/workspace/dates"
import { isActive } from "@/lib/workspace/schemas"
import type { Task, TaskEvent, Workspace } from "@/lib/workspace/schemas"

/** A task whose deadline has passed. Interface text stays calm about this. */
export function deadlinePassed(task: Task, today: string) {
  return Boolean(isActive(task) && task.deadline && task.deadline < today)
}

/** The single next action for a task. */
export function nextActionFor(task: Task) {
  if (task.nextAction) return task.nextAction
  const open = task.subtasks.find((sub) => !sub.done)
  if (open) return open.title
  if (task.status === "needs-recovery") {
    return `Get a recovery plan for “${task.title}”`
  }
  return `Spend 5 minutes on “${task.title}”`
}

function score(task: Task, state: Workspace, today: string) {
  let value = 0
  if (task.priority === "high") value += 20
  if (task.priority === "medium") value += 10
  if (task.status === "in-progress") value += 12
  if (task.status === "needs-recovery") value += 15
  if (task.deadline) {
    const days = daysBetween(today, task.deadline)
    if (days < 0) value += 25
    else if (days <= 2) value += 30
    else if (days <= 7) value += 15
  }
  const plannedToday = state.planned.some(
    (item) => item.taskId === task.id && item.date === today && !item.done
  )
  if (plannedToday) value += 40
  return value
}

/** Picks one task to suggest. Paused tasks wait until the user resumes them. */
export function recommendTask(state: Workspace, today: string): Task | null {
  const skipped =
    state.skipped.date === today ? new Set(state.skipped.taskIds) : new Set()
  const candidates = state.tasks.filter(
    (task) =>
      isActive(task) && task.status !== "paused" && !skipped.has(task.id)
  )
  if (!candidates.length) return null
  return [...candidates].sort(
    (a, b) =>
      score(b, state, today) - score(a, state, today) ||
      a.createdAt.localeCompare(b.createdAt)
  )[0]
}

export function tasksNeedingAttention(
  state: Workspace,
  today: string,
  exclude?: string
) {
  return state.tasks
    .filter(
      (task) =>
        task.id !== exclude &&
        (task.status === "needs-recovery" || deadlinePassed(task, today))
    )
    .sort(
      (a, b) =>
        Number(b.status === "needs-recovery") -
          Number(a.status === "needs-recovery") ||
        (a.deadline ?? "9").localeCompare(b.deadline ?? "9")
    )
}

export function upcomingDeadlines(state: Workspace, today: string, days = 14) {
  const until = addDays(today, days)
  return state.tasks
    .filter(
      (task): task is Task & { deadline: string } =>
        isActive(task) &&
        Boolean(task.deadline) &&
        task.deadline! >= today &&
        task.deadline! <= until
    )
    .sort((a, b) => a.deadline.localeCompare(b.deadline))
}

const COMPLETED_PREFIXES = ["Completed", "Status changed to Completed"]

export function recentActions(state: Workspace, limit = 5) {
  const items: { task: Task; event: TaskEvent }[] = []
  for (const task of state.tasks) {
    for (const event of task.history) {
      const finished =
        (event.type === "focus" && event.text.startsWith("Focus session")) ||
        COMPLETED_PREFIXES.some((prefix) => event.text.startsWith(prefix))
      if (finished) items.push({ task, event })
    }
  }
  return items
    .sort((a, b) => b.event.at.localeCompare(a.event.at))
    .slice(0, limit)
}
