import { plannedSessions } from "@/lib/calendar/model"
import { isQuick, rankTasks, type RankedTask } from "@/lib/planning/priority"
import { concreteStep } from "@/lib/recovery/concrete"
import { daysBetween, shortDate } from "@/lib/workspace/dates"
import type { DailyPlanItem, Energy, Workspace } from "@/lib/workspace/schemas"
import { currentSubtask } from "@/lib/workspace/selectors"

const MIN_SLOT = 5
/** After a plan didn't happen, the next attempt starts small. */
const CARRIED_MINUTES = 10
const MAX_QUICK = 2

const SHAPE: Record<
  Energy | "unknown",
  { share: number; session: number; items: number }
> = {
  low: { share: 0.6, session: 15, items: 2 },
  okay: { share: 0.8, session: 25, items: 4 },
  good: { share: 0.9, session: 45, items: 4 },
  unknown: { share: 0.8, session: 25, items: 4 },
}

export type NotToday = { taskId: string; title: string; reason: string }

export type ProposedPlan = {
  items: DailyPlanItem[]
  notToday: NotToday[]
  /** Deadlines that may not be met. Stated, and never changed. */
  risks: string[]
  usableMinutes: number
  unfinished: number
}

/** Tasks whose planned time passed without the work getting done. */
export function unfinishedFromEarlier(state: Workspace, today: string) {
  const ids = new Set<string>()
  const plan = state.dailyPlan
  if (plan && plan.date < today) {
    plan.items.filter((item) => !item.done).forEach((i) => ids.add(i.taskId))
  }
  plannedSessions(state)
    .filter((item) => item.date < today && !item.done)
    .forEach((item) => ids.add(item.taskId))
  return ids
}

/**
 * Proposes what today can realistically hold. It's arithmetic on the user's own
 * tasks, not AI. It marks nothing overdue, and moves no deadlines or sessions.
 */
export function buildDailyPlan({
  state,
  today,
  minutes,
  energy,
}: {
  state: Workspace
  today: string
  minutes: number
  energy: Energy | null
}): ProposedPlan {
  const shape = SHAPE[energy ?? "unknown"]
  const usable = Math.max(MIN_SLOT, Math.round((minutes * shape.share) / 5) * 5)
  const carried = unfinishedFromEarlier(state, today)
  const ranked = rankTasks(state, today)

  const daysLeft = ({ task }: RankedTask) =>
    task.deadline ? daysBetween(today, task.deadline) : null
  const isUrgent = (entry: RankedTask) => {
    const days = daysLeft(entry)
    return days !== null && days >= 0 && days <= 1
  }
  // What's due now can use all the time there is. Everything else gets one sitting.
  const need = (entry: RankedTask) =>
    isUrgent(entry)
      ? entry.remaining.minutes
      : Math.min(
          entry.remaining.minutes,
          carried.has(entry.task.id) ? CARRIED_MINUTES : shape.session
        )

  // Something quick goes first, unless it would squeeze out what's due now.
  const urgentNeed = ranked
    .filter(isUrgent)
    .reduce((sum, entry) => sum + need(entry), 0)
  const quickFirst: RankedTask[] = []
  let spare = usable - urgentNeed
  for (const entry of ranked.filter(isQuick)) {
    if (isUrgent(entry)) continue
    if (quickFirst.length < MAX_QUICK && entry.remaining.minutes <= spare) {
      quickFirst.push(entry)
      spare -= entry.remaining.minutes
    }
  }
  const order = [
    ...quickFirst,
    ...ranked.filter((entry) => !quickFirst.includes(entry)),
  ]

  const items: DailyPlanItem[] = []
  const notToday: NotToday[] = []
  const risks: string[] = []
  let left = usable

  for (const entry of order) {
    const { task, remaining } = entry
    const wasCarried = carried.has(task.id)
    const planned = Math.min(need(entry), left)
    if (items.length >= shape.items || planned < MIN_SLOT) {
      notToday.push({
        taskId: task.id,
        title: task.title,
        reason:
          items.length >= shape.items
            ? "Keeping today’s list short"
            : "Not enough time left today",
      })
    } else {
      const step = currentSubtask(task)?.title
      const smaller = (wasCarried || energy === "low") && step
      const why = [
        wasCarried && isUrgent(entry)
          ? "It was planned earlier and didn’t happen, and it’s due soon, so it gets most of today, beginning with something small"
          : wasCarried
            ? "It was planned earlier and didn’t happen, so this starts small instead of just moving it"
            : "",
        quickFirst.includes(entry)
          ? `About ${remaining.minutes} minutes, so it’s quick to clear`
          : "",
        ...entry.reasons,
      ].filter(Boolean)
      items.push({
        taskId: task.id,
        subtaskId: currentSubtask(task)?.id ?? null,
        title: task.title,
        action: smaller
          ? concreteStep(step).firstAction
          : task.nextAction || step || task.title,
        minutes: planned,
        reason: why.slice(0, 2).join(". "),
        done: false,
      })
      left -= planned
    }

    const days = daysLeft(entry)
    const scheduled =
      items.find((item) => item.taskId === task.id)?.minutes ?? 0
    if (
      days !== null &&
      days >= 0 &&
      days <= 1 &&
      remaining.minutes > scheduled
    ) {
      risks.push(
        `“${task.title}” is due ${days === 0 ? "today" : "tomorrow"} (${shortDate(task.deadline!)}) and may need about ${remaining.minutes} minutes${remaining.known ? "" : ", which is a rough guess"}. Today’s plan gives it ${scheduled}.`
      )
    }
  }

  return {
    items,
    notToday,
    risks,
    usableMinutes: usable,
    unfinished: [...carried].filter((id) =>
      ranked.some((entry) => entry.task.id === id)
    ).length,
  }
}
