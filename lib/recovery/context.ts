import { EMPTY_INTAKE } from "@/lib/intake"
import { LIMITS } from "@/lib/schemas"
import { daysBetween } from "@/lib/workspace/dates"
import type {
  Intake,
  RejectedPlan,
  Strategy,
  TaskBreakdownRequest,
  TaskContext,
  TaskRecoveryRequest,
  WritingAction,
  WritingAssistRequest,
} from "@/lib/schemas"
import { STATUS_LABEL, PRIORITY_LABEL } from "@/lib/workspace/schemas"
import type { Task, Workspace } from "@/lib/workspace/schemas"
import { currentSubtask } from "@/lib/workspace/selectors"

const clip = (text: string) => text.slice(0, 400)

/** Turns saved editor HTML into plain text, keeping paragraphs apart. */
export function htmlToText(html: string) {
  return html
    .replace(/<\/(p|h[1-6]|li|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

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
        event.kind === "completed" && event.text.startsWith("Completed")
    ),
    attempts: texts(
      (event) =>
        event.type === "recovery" ||
        event.type === "stuck" ||
        (event.type === "focus" && event.text.startsWith("Stopped"))
    ),
    obstacles: texts((event) => event.type === "obstacle").slice(-10),
    openSteps: task.subtasks
      .filter((sub) => !sub.done)
      .map((sub) => clip(sub.title))
      .slice(0, 15),
    instructions: (task.instructions?.text ?? "").slice(
      0,
      LIMITS.contextInstructions
    ),
    document: htmlToText(task.workDoc?.content ?? "").slice(
      0,
      LIMITS.contextDocument
    ),
    currentStep: clip(currentSubtask(task)?.title ?? ""),
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

export function buildBreakdownRequest(
  task: Task,
  state: Workspace,
  today: string,
  rejected: string[][] = []
): TaskBreakdownRequest {
  return {
    stage: "task-breakdown",
    task: buildTaskContext(task, state),
    today,
    rejected: rejected.slice(-3).map((steps) => steps.slice(0, 10).map(clip)),
  }
}

export function buildWritingRequest(
  task: Task,
  state: Workspace,
  today: string,
  action: WritingAction,
  options: { selection?: string; source?: string } = {}
): WritingAssistRequest {
  return {
    stage: "writing-assist",
    action,
    task: buildTaskContext(task, state),
    today,
    selection: (options.selection ?? "").slice(0, LIMITS.contextDocument),
    source: (options.source ?? "").slice(0, LIMITS.contextInstructions),
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
    const days = daysBetween(today, task.deadline)
    known.push(
      days < 0
        ? `The deadline on record was ${task.deadline}, which has passed.`
        : `The deadline on record is ${task.deadline}, ${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} away`}.`
    )
  } else {
    unknown.push("Whether this has a real deadline. None is recorded.")
  }
  if (task.currentStep) known.push(`The current step is “${task.currentStep}”.`)
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
