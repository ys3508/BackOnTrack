import { EMPTY_INTAKE } from "@/lib/intake"
import type {
  Intake,
  RejectedPlan,
  Strategy,
  TaskContext,
  TaskRecoveryRequest,
} from "@/lib/schemas"
import { STATUS_LABEL, PRIORITY_LABEL } from "@/lib/workspace/schemas"
import type { Task, Workspace } from "@/lib/workspace/schemas"

const clip = (text: string) => text.slice(0, 400)

/** Collects what the recovery engine may use: the task's own recorded data. */
export function buildTaskContext(task: Task, state: Workspace): TaskContext {
  const texts = (keep: (event: Task["history"][number]) => boolean) =>
    task.history
      .filter(keep)
      .map((event) => clip(event.text))
      .slice(-15)

  return {
    title: task.title.slice(0, 200),
    description: task.description.slice(0, 2000),
    deadline: task.deadline,
    originalDeadline: task.originalDeadline,
    status: STATUS_LABEL[task.status],
    priority: PRIORITY_LABEL[task.priority],
    progress: task.progress,
    completedActions: texts(
      (event) =>
        (event.type === "action" || event.type === "subtask") &&
        event.text.startsWith("Completed")
    ),
    attempts: texts(
      (event) =>
        event.type === "recovery" ||
        (event.type === "focus" && event.text.startsWith("Stopped"))
    ),
    obstacles: texts((event) => event.type === "obstacle").slice(-10),
    openSteps: task.subtasks
      .filter((sub) => !sub.done)
      .map((sub) => clip(sub.title))
      .slice(0, 15),
    focusSessions: state.focusSessions
      .filter((session) => session.taskId === task.id)
      .slice(-10)
      .map((session) => ({
        date: session.startedAt.slice(0, 10),
        plannedMinutes: session.plannedMinutes,
        actualMinutes: Math.round(session.actualSeconds / 60),
        outcome: session.outcome,
        note: clip(session.note),
      })),
  }
}

export function buildRecoveryRequest(
  task: Task,
  state: Workspace,
  today: string,
  options: {
    strategy?: Strategy | null
    obstacle?: string
    rejected?: RejectedPlan[]
  } = {}
): TaskRecoveryRequest {
  return {
    stage: "task-recovery",
    task: buildTaskContext(task, state),
    today,
    strategy: options.strategy ?? null,
    obstacle: options.obstacle?.trim().slice(0, 500) ?? "",
    rejected: (options.rejected ?? task.rejectedPlans).slice(-10),
  }
}

/** Lets the existing safety checks read a task's own words. */
export function contextIntake(request: TaskRecoveryRequest): Intake {
  const { task, obstacle } = request
  return {
    ...EMPTY_INTAKE,
    responsibility: `${task.title} ${task.description}`.slice(0, 2000),
    obstacleOther: [obstacle, ...task.obstacles].join(" ").slice(0, 300),
  }
}

/** Facts the app can state for certain, because they're in the user's own data. */
export function taskFacts({ task }: TaskRecoveryRequest, today: string) {
  const known = [`The task is “${task.title}”.`]
  const unknown: string[] = []
  if (task.deadline) {
    known.push(
      task.deadline < today
        ? `The deadline on record was ${task.deadline}, which has passed.`
        : `The deadline on record is ${task.deadline}.`
    )
  } else {
    unknown.push("Whether this has a real deadline. None is recorded.")
  }
  known.push(`It is recorded as ${task.progress}% done.`)
  if (task.focusSessions.length) {
    const minutes = task.focusSessions.reduce(
      (total, session) => total + session.actualMinutes,
      0
    )
    known.push(
      `You've spent about ${minutes} minutes in ${task.focusSessions.length} focus session${task.focusSessions.length === 1 ? "" : "s"} on it.`
    )
  }
  if (task.completedActions.length) {
    known.push(
      `You've finished ${task.completedActions.length} action${task.completedActions.length === 1 ? "" : "s"} on it.`
    )
  }
  return { known, unknown }
}
