"use client"

import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ConfirmDialog, fieldClass } from "@/components/workspace/parts"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { addDays, shortDate } from "@/lib/workspace/dates"
import { isActive } from "@/lib/workspace/schemas"
import type { PlannedSession, Task } from "@/lib/workspace/schemas"

const LENGTHS = [5, 10, 25, 50]

/** Plans optional work. It never changes a task's deadline. */
export function PlanSessionForm({
  taskId,
  date,
  idPrefix,
}: {
  taskId?: string
  date?: string
  idPrefix: string
}) {
  const { state, dispatch, today } = useStore()
  const tasks = state.tasks.filter(isActive)
  const [selectedTask, setSelectedTask] = useState(tasks[0]?.id ?? "")
  const [day, setDay] = useState(date ?? today)
  const [time, setTime] = useState("")
  const [minutes, setMinutes] = useState(25)
  const resolvedDay = date ?? day
  const resolvedTask = taskId ?? selectedTask

  if (!taskId && !tasks.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Add a task first, then you can plan time for it.
      </p>
    )
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!resolvedTask || !resolvedDay) return
        dispatch({
          type: "add-planned",
          at: nowIso(),
          session: {
            id: newId(),
            taskId: resolvedTask,
            date: resolvedDay,
            time: time || null,
            minutes,
            label: "",
            done: false,
          },
        })
        setTime("")
      }}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {!taskId && (
          <div className="sm:col-span-2">
            <label
              htmlFor={`${idPrefix}-task`}
              className="mb-1 block text-sm font-medium"
            >
              Task
            </label>
            <select
              id={`${idPrefix}-task`}
              value={selectedTask}
              onChange={(event) => setSelectedTask(event.target.value)}
              className={fieldClass}
            >
              {tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
          </div>
        )}
        {!date && (
          <div>
            <label
              htmlFor={`${idPrefix}-date`}
              className="mb-1 block text-sm font-medium"
            >
              Day
            </label>
            <input
              id={`${idPrefix}-date`}
              type="date"
              max="9999-12-31"
              value={day}
              onChange={(event) => setDay(event.target.value)}
              className={fieldClass}
            />
          </div>
        )}
        <div>
          <label
            htmlFor={`${idPrefix}-time`}
            className="mb-1 block text-sm font-medium"
          >
            Time (optional)
          </label>
          <input
            id={`${idPrefix}-time`}
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label
            htmlFor={`${idPrefix}-minutes`}
            className="mb-1 block text-sm font-medium"
          >
            Length
          </label>
          <select
            id={`${idPrefix}-minutes`}
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
            className={fieldClass}
          >
            {LENGTHS.map((length) => (
              <option key={length} value={length}>
                {length} minutes
              </option>
            ))}
          </select>
        </div>
      </div>
      <Button type="submit" size="xl" variant="outline">
        <Plus aria-hidden />
        Plan a work session
      </Button>
    </form>
  )
}

export function PlannedSessionRow({
  session,
  showTask,
}: {
  session: PlannedSession
  showTask?: boolean
}) {
  const { state, dispatch } = useStore()
  const title = state.tasks.find((task) => task.id === session.taskId)?.title
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-sage/60 bg-sage-soft/40 px-3 py-2 text-sm">
      <label className="flex min-h-9 flex-1 cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          checked={session.done}
          onChange={() => dispatch({ type: "toggle-planned", id: session.id })}
          className="size-5 shrink-0 accent-[var(--primary)]"
        />
        <span
          className={
            session.done
              ? "min-w-0 break-words text-muted-foreground line-through"
              : "min-w-0 break-words"
          }
        >
          {showTask ? `${title}: ` : ""}
          {session.minutes} min{session.time ? ` at ${session.time}` : ""}
          {session.label ? `: ${session.label}` : ""}
        </span>
      </label>
      <label>
        <span className="sr-only">Move this work session to another day</span>
        <input
          type="date"
          max="9999-12-31"
          value={session.date}
          onChange={(event) => {
            if (event.target.value) {
              dispatch({
                type: "move-planned",
                at: nowIso(),
                id: session.id,
                date: event.target.value,
                time: session.time,
              })
            }
          }}
          className="h-10 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        />
      </label>
      <button
        type="button"
        aria-label={`Remove work session on ${shortDate(session.date)}`}
        onClick={() =>
          dispatch({ type: "remove-planned", at: nowIso(), id: session.id })
        }
        className="grid size-10 place-items-center rounded-md text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </li>
  )
}

/**
 * Picks a new day to work on a task. The original deadline stays the same unless
 * the user explicitly opts to change it, because a real deadline may be fixed.
 */
export function ReplanDialog({
  task,
  onClose,
}: {
  task: Task | null
  onClose: () => void
}) {
  const { dispatch, today } = useStore()
  const [day, setDay] = useState(today)
  const [changeDeadline, setChangeDeadline] = useState(false)

  const choices = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "In 3 days", date: addDays(today, 3) },
    { label: "Next week", date: addDays(today, 7) },
  ]

  return (
    <ConfirmDialog
      open={Boolean(task)}
      title="Replan this task"
      confirmLabel="Plan it"
      confirmDisabled={!day}
      onCancel={onClose}
      onConfirm={() => {
        if (!task) return
        const at = nowIso()
        dispatch({
          type: "add-planned",
          at,
          session: {
            id: newId(),
            taskId: task.id,
            date: day,
            time: null,
            minutes: 25,
            label: "",
            done: false,
          },
        })
        if (changeDeadline) {
          dispatch({ type: "set-deadline", id: task.id, at, deadline: day })
        }
        setChangeDeadline(false)
        onClose()
      }}
    >
      <p>When could you work on “{task?.title}”?</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {choices.map((choice) => (
          <button
            key={choice.label}
            type="button"
            aria-pressed={day === choice.date}
            onClick={() => setDay(choice.date)}
            className={
              "min-h-11 rounded-full border px-3.5 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30 " +
              (day === choice.date
                ? "border-primary bg-sage-soft"
                : "border-border bg-card")
            }
          >
            {choice.label}
          </button>
        ))}
      </div>
      <label
        htmlFor="replan-date"
        className="mt-3 mb-1 block text-sm font-medium text-foreground"
      >
        Or choose a day
      </label>
      <input
        id="replan-date"
        type="date"
        max="9999-12-31"
        value={day}
        onChange={(event) => setDay(event.target.value)}
        className={fieldClass}
      />
      {task?.deadline && (
        <>
          <p className="mt-3 text-sm">
            The deadline stays {shortDate(task.deadline)}. A plan only changes
            when you work, and someone else may control the deadline itself.
          </p>
          <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={changeDeadline}
              onChange={(event) => setChangeDeadline(event.target.checked)}
              className="size-5 accent-[var(--primary)]"
            />
            The deadline itself has changed too
          </label>
        </>
      )}
    </ConfirmDialog>
  )
}
