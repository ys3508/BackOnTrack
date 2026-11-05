import { lastProgressAt } from "@/lib/workspace/friction"
import {
  HELP_LABEL,
  type FrictionEvent,
  type HelpKind,
  type Task,
  type Workspace,
} from "@/lib/workspace/schemas"

/** Fewer similar moments than this could easily be chance, so nothing is claimed. */
export const MIN_EVIDENCE = 3
const WINDOW_MS = 60 * 24 * 60 * 60 * 1000
const RECENT_SESSIONS = 5
const PREPARED_KINDS: HelpKind[] = ["prepared", "outline", "draft"]

export type HintAction = "setup" | "help" | "recover" | "editor"

export type Pattern = {
  id: string
  title: string
  evidence: string
  actionLabel: string
  action: HintAction
  /** Only about this task. Otherwise it's across tasks. */
  taskId?: string
  /** Only about tasks of this kind. */
  taskKind?: "writing" | "code"
  helpKind?: HelpKind
  avoid?: boolean
}

const SAME_MOMENT_MS = 60 * 60 * 1000

const occasions = (count: number) =>
  count === 1 ? "one occasion" : `${count} separate occasions`

/**
 * Clicking "I'm stuck" three times in a minute is one bad moment, not a pattern,
 * so events on one task within the hour count once.
 */
function distinctMoments(events: FrictionEvent[]) {
  const kept: FrictionEvent[] = []
  for (const item of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    const repeat = kept.some(
      (other) =>
        other.taskId === item.taskId &&
        Date.parse(item.at) - Date.parse(other.at) < SAME_MOMENT_MS
    )
    if (!repeat) kept.push(item)
  }
  return kept
}

const actionForHelp = (kind: HelpKind): HintAction =>
  PREPARED_KINDS.includes(kind) ? "setup" : "help"

function detectFrom(log: FrictionEvent[], state: Workspace): Pattern[] {
  const patterns: Pattern[] = []

  const blank = distinctMoments(
    log.filter(
      (item) =>
        item.blankDoc &&
        (item.kind === "stuck" || (item.kind === "session" && item.interrupted))
    )
  )
  if (blank.length >= MIN_EVIDENCE) {
    patterns.push({
      id: "blank-start",
      title: "Empty documents seem to be a sticking point",
      evidence: `On ${occasions(blank.length)} recently, you got stuck or stopped early while the document was empty.`,
      actionLabel: "Start from a prepared document",
      action: "setup",
    })
  }

  const sessions = distinctMoments(
    log.filter((item) => item.kind === "session")
  ).slice(-RECENT_SESSIONS)
  const early = sessions.filter((item) => item.interrupted).length
  if (early >= MIN_EVIDENCE) {
    patterns.push({
      id: "focus-early",
      title: "The timer may not be the best way in right now",
      evidence: `${early} of your last ${sessions.length} focus sessions stopped in under a minute.`,
      actionLabel: "Open the document, with no timer",
      action: "editor",
    })
  }

  for (const taskKind of ["writing", "code"] as const) {
    const stuck = distinctMoments(
      log.filter((item) => item.kind === "stuck" && item.taskKind === taskKind)
    )
    const tasks = new Set(stuck.map((item) => item.taskId)).size
    if (stuck.length >= MIN_EVIDENCE && tasks >= 2) {
      patterns.push({
        id: `kind-stuck:${taskKind}`,
        title:
          taskKind === "writing"
            ? "Writing tasks seem harder to get going"
            : "Coding tasks seem harder to get going",
        evidence: `You reported being stuck on ${occasions(stuck.length)}, across ${tasks} ${taskKind === "writing" ? "writing" : "coding"} tasks.`,
        actionLabel:
          taskKind === "writing"
            ? "Start from a prepared document"
            : "Get a code starting point",
        action: taskKind === "writing" ? "setup" : "help",
        taskKind,
      })
    }
  }

  for (const task of state.tasks) {
    const progressAt = lastProgressAt(task)
    const moved = distinctMoments(
      log.filter(
        (item) =>
          item.kind === "moved" &&
          item.taskId === task.id &&
          item.at > progressAt
      )
    ).length
    if (moved >= MIN_EVIDENCE) {
      patterns.push({
        id: `moved:${task.id}`,
        title: "This task keeps moving",
        evidence: `Its work session moved on ${occasions(moved)}, with no step finished in between.`,
        actionLabel: "Make it smaller",
        action: "recover",
        taskId: task.id,
      })
    }
  }

  const kinds = new Set(
    log.flatMap((item) => (item.helpKind ? [item.helpKind] : []))
  )
  for (const helpKind of kinds) {
    const resolved = log.filter(
      (item) => item.helpKind === helpKind && item.outcome
    )
    const worked = resolved.filter((item) => item.outcome === "progress").length
    if (resolved.length < MIN_EVIDENCE) continue
    const label = HELP_LABEL[helpKind]
    if (worked / resolved.length >= 0.6) {
      patterns.push({
        id: `help-works:${helpKind}`,
        title: `${label} seems to help you get moving`,
        evidence: `You made progress after it ${worked} of ${resolved.length} times. That doesn’t prove it was the reason.`,
        actionLabel: `Start with this: ${label.toLowerCase()}`,
        action: actionForHelp(helpKind),
        helpKind,
      })
    } else if (worked === 0) {
      patterns.push({
        id: `help-stalled:${helpKind}`,
        title: `${label} hasn’t seemed to help so far`,
        evidence: `You were stuck again after it on ${occasions(resolved.length)}, so other approaches will come first.`,
        actionLabel: "",
        action: "help",
        helpKind,
        avoid: true,
      })
    }
  }

  return patterns
}

function recent(state: Workspace, now: number) {
  return state.frictionLog.filter(
    (item) => now - Date.parse(item.at) <= WINDOW_MS
  )
}

/** Everything noticed, whether or not the user has dismissed it. */
export function detectPatterns(state: Workspace, now: number) {
  if (!state.learning.enabled) return []
  return detectFrom(recent(state, now), state)
}

export function activePatterns(state: Workspace, now: number) {
  return detectPatterns(state, now).filter(
    (item) => !state.learning.dismissed.includes(item.id)
  )
}

function applies(pattern: Pattern, task: Task, kind: string) {
  if (pattern.taskId && pattern.taskId !== task.id) return false
  if (pattern.taskKind && pattern.taskKind !== kind) return false
  // A prepared document goes into an empty one, so it needs one to be empty.
  if (
    pattern.action === "setup" &&
    task.workDoc?.content.replace(/<[^>]+>/g, "").trim()
  ) {
    return false
  }
  return true
}

/** The one thing worth saying about this task, if there's anything. */
export function hintFor(
  state: Workspace,
  task: Task,
  kind: string,
  now: number
): Pattern | null {
  const useful = activePatterns(state, now).filter(
    (item) => !item.avoid && applies(item, task, kind)
  )
  const rank = (item: Pattern) =>
    item.taskId ? 0 : item.helpKind ? 1 : item.action === "setup" ? 2 : 3
  return [...useful].sort((a, b) => rank(a) - rank(b))[0] ?? null
}

export type Guidance = {
  preferred: HelpKind | null
  avoid: HelpKind[]
  notes: string[]
}

/** What plans and prompts should take into account. A stated preference wins. */
export function guidanceFor(
  state: Workspace,
  task: Task,
  kind: string,
  now: number
): Guidance {
  const patterns = activePatterns(state, now).filter(
    (item) => !item.taskId || item.taskId === task.id
  )
  const stated = state.learning.preferred
  const relevant = patterns.filter((item) => applies(item, task, kind))
  const blankHelp = relevant.find((item) => item.action === "setup")
  const works = relevant.find((item) => item.helpKind && !item.avoid)
  const preferred = stated ?? works?.helpKind ?? (blankHelp ? "prepared" : null)
  return {
    preferred,
    avoid: patterns.flatMap((item) =>
      item.avoid && item.helpKind && item.helpKind !== stated
        ? [item.helpKind]
        : []
    ),
    notes: [
      ...(stated
        ? [`They said they prefer to start with: ${HELP_LABEL[stated]}.`]
        : []),
      ...patterns.map((item) => `${item.title}. ${item.evidence}`),
    ].slice(0, 6),
  }
}

export const startsPrepared = (kind: string) =>
  PREPARED_KINDS.includes(kind as HelpKind)
