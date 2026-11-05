"use client"

import { useMemo, useState } from "react"
import { CalendarPlus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { fieldClass } from "@/components/workspace/parts"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { MINUTES_PER_STEP, planRemaining } from "@/lib/calendar/plan-remaining"
import { shortDate } from "@/lib/workspace/dates"
import { isActive } from "@/lib/workspace/schemas"
import { cn } from "@/lib/utils"

const DAILY_OPTIONS = [15, 30, 60, 90]

/** Suggests sessions for the steps left. Nothing is planned until confirmed. */
export function PlanRemaining({ taskId }: { taskId?: string }) {
  const { state, today, dispatch } = useStore()
  const candidates = state.tasks.filter(
    (task) => isActive(task) && task.subtasks.some((sub) => !sub.done)
  )
  const [chosen, setChosen] = useState(candidates[0]?.id ?? "")
  const task = state.tasks.find((item) => item.id === (taskId ?? chosen))
  const [open, setOpen] = useState(false)
  const [minutesPerDay, setMinutesPerDay] = useState(30)
  const [skipWeekends, setSkipWeekends] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])
  const [added, setAdded] = useState(0)

  const openSteps = useMemo(
    () =>
      task?.subtasks.filter((sub) => !sub.done).map((sub) => sub.title) ?? [],
    [task]
  )
  const plan = useMemo(
    () =>
      planRemaining({
        steps: openSteps,
        today,
        deadline: task?.deadline ?? null,
        minutesPerDay,
        skipWeekends,
        existing: state.planned.filter((item) => item.taskId === task?.id),
      }),
    [openSteps, today, task, minutesPerDay, skipWeekends, state.planned]
  )

  if (!task || !openSteps.length) {
    return taskId ? null : (
      <p className="text-sm text-muted-foreground">
        Tasks with open steps can be planned here.
      </p>
    )
  }

  const keyOf = (index: number) =>
    `${plan.sessions[index].date}-${plan.sessions[index].label}`
  const kept = plan.sessions.filter(
    (_, index) => !skipped.includes(keyOf(index))
  )

  if (!open) {
    return (
      <div className="space-y-2">
        {added > 0 && (
          <p role="status" className="text-sm text-sage">
            Added {added} work {added === 1 ? "session" : "sessions"} to your
            calendar.
          </p>
        )}
        {!taskId && <TaskSelect value={chosen} onChange={setChosen} />}
        <Button
          type="button"
          size="xl"
          variant="outline"
          onClick={() => {
            setOpen(true)
            setAdded(0)
            setSkipped([])
          }}
        >
          <CalendarPlus aria-hidden />
          Plan remaining work
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {!taskId && <TaskSelect value={chosen} onChange={setChosen} />}

      <div role="group" aria-label="Time you have most days">
        <p className="mb-1.5 text-sm font-medium">Time you have most days</p>
        <div className="flex flex-wrap gap-1.5">
          {DAILY_OPTIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              aria-pressed={minutesPerDay === minutes}
              onClick={() => setMinutesPerDay(minutes)}
              className={cn(
                "min-h-11 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                minutesPerDay === minutes
                  ? "border-primary bg-sage-soft"
                  : "border-border bg-card"
              )}
            >
              {minutes} min
            </button>
          ))}
        </div>
      </div>

      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
        <input
          type="checkbox"
          checked={skipWeekends}
          onChange={(event) => setSkipWeekends(event.target.checked)}
          className="size-5 accent-[var(--primary)]"
        />
        Leave weekends free
      </label>

      <p className="text-xs text-muted-foreground">
        Calculated from your open steps, at about {MINUTES_PER_STEP} minutes
        each, and not by AI. Uncheck anything you don’t want.
      </p>

      {plan.sessions.length > 0 ? (
        <ul aria-label="Suggested work sessions" className="space-y-1">
          {plan.sessions.map((session, index) => (
            <li key={keyOf(index)}>
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={!skipped.includes(keyOf(index))}
                  onChange={(event) =>
                    setSkipped(
                      event.target.checked
                        ? skipped.filter((key) => key !== keyOf(index))
                        : [...skipped, keyOf(index)]
                    )
                  }
                  className="size-5 shrink-0 accent-[var(--primary)]"
                />
                <span className="min-w-0 break-words">
                  {shortDate(session.date)}, {session.minutes} min:{" "}
                  {session.label}
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nothing new to plan with this much time.
        </p>
      )}

      {plan.unscheduled.length > 0 && (
        <p className="rounded-lg bg-sand-soft p-3 text-sm text-sand">
          {plan.unscheduled.length}{" "}
          {plan.unscheduled.length === 1 ? "step doesn’t" : "steps don’t"} fit
          {task.deadline && !plan.deadlinePassed
            ? " before the deadline"
            : " in the next few days"}{" "}
          with this much time: {plan.unscheduled.join(", ")}. You could allow
          more time, or make something smaller.
        </p>
      )}

      {task.deadline && (
        <p className="text-sm text-muted-foreground">
          {plan.deadlinePassed ? "The deadline was" : "The deadline stays"}{" "}
          {shortDate(task.deadline)}, and this won’t change it.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="xl"
          disabled={!kept.length}
          onClick={() => {
            const at = nowIso()
            for (const session of kept) {
              dispatch({
                type: "add-planned",
                at,
                session: {
                  id: newId(),
                  taskId: task.id,
                  date: session.date,
                  time: null,
                  minutes: session.minutes,
                  label: session.label,
                  done: false,
                },
              })
            }
            setAdded(kept.length)
            setOpen(false)
          }}
        >
          Add {kept.length} to my calendar
        </Button>
        <Button
          type="button"
          size="xl"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Not now
        </Button>
      </div>
    </div>
  )
}

function TaskSelect({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const { state } = useStore()
  const candidates = state.tasks.filter(
    (task) => isActive(task) && task.subtasks.some((sub) => !sub.done)
  )
  return (
    <div>
      <label
        htmlFor="plan-remaining-task"
        className="mb-1 block text-sm font-medium"
      >
        Task
      </label>
      <select
        id="plan-remaining-task"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={fieldClass}
      >
        {candidates.map((task) => (
          <option key={task.id} value={task.id}>
            {task.title}
          </option>
        ))}
      </select>
    </div>
  )
}
