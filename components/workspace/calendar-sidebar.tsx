"use client"

import { useEffect, useRef, useState } from "react"
import { Draggable } from "@fullcalendar/interaction"
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/workspace/parts"
import { useStore } from "@/components/workspace/store"
import {
  PALETTE,
  WEEKDAYS,
  buildRoutineRule,
  parseRoutineRule,
  routineTime,
  timesThisWeek,
} from "@/lib/calendar/derived"
import type { Routine } from "@/lib/workspace/schemas"
import { shortDate } from "@/lib/workspace/dates"
import { trayItems } from "@/lib/calendar/derived"
import { cn } from "@/lib/utils"

/** Lets anything marked with data-cal-drag be dropped on the calendar. */
function useCalendarDraggable() {
  const ref = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const draggable = new Draggable(ref.current, {
      itemSelector: "[data-cal-drag]",
      eventData: (element) => ({
        title: element.getAttribute("data-title") ?? "",
        duration: { minutes: Number(element.getAttribute("data-minutes")) },
        // The drop adds the real record, so nothing temporary is left behind.
        create: false,
      }),
    })
    return () => draggable.destroy()
  }, [])
  return ref
}

/** Past days' unfinished tasks. Calm by design: grey, with no red and no count. */
export function NotStartedTray({
  onSchedule,
}: {
  onSchedule: (taskId: string) => void
}) {
  const { state, today } = useStore()
  const items = trayItems(state, today)
  const ref = useCalendarDraggable()
  return (
    <section aria-labelledby="tray-heading">
      <h2
        id="tray-heading"
        className="mb-2 font-sans text-[15px] font-semibold tracking-normal"
      >
        Not started yet
      </h2>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing waiting here.</p>
      )}
      <ul ref={ref} className="space-y-1.5">
        {items.map(({ task, putOffDays }) => (
          <li
            key={task.id}
            data-cal-drag
            data-kind="task"
            data-id={task.id}
            data-title={task.title}
            data-minutes={25}
            className="flex cursor-grab items-start gap-1 rounded-xl border border-border bg-card p-2"
          >
            <GripVertical
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium break-words">
                {task.title}
              </span>
              <span className="block text-xs text-muted-foreground">
                put off {putOffDays} {putOffDays === 1 ? "day" : "days"}
              </span>
              <button
                type="button"
                aria-label={`Schedule ${task.title}`}
                onClick={() => onSchedule(task.id)}
                className="min-h-8 rounded-md text-xs font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                Schedule
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RoutineForm({
  routine,
  onDone,
}: {
  routine?: Routine
  onDone: () => void
}) {
  const { dispatch, today } = useStore()
  const parsed = routine ? parseRoutineRule(routine.rrule) : null
  const [name, setName] = useState(routine?.name ?? "")
  const [emoji, setEmoji] = useState(routine?.emoji ?? "")
  const [color, setColor] = useState(routine?.color ?? PALETTE[0])
  const [days, setDays] = useState<string[]>(parsed?.days ?? [])
  const [time, setTime] = useState(parsed?.time ?? "07:00")
  const [duration, setDuration] = useState(routine?.duration ?? 60)
  const ready = name.trim() && days.length && time && duration > 0

  return (
    <form
      className="space-y-2 rounded-xl border border-border bg-card p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        const rrule = buildRoutineRule(days, time, parsed?.startDate || today)
        if (routine) {
          dispatch({
            type: "update-routine",
            id: routine.id,
            patch: { name: name.trim(), emoji, color, duration, rrule },
          })
        } else {
          dispatch({
            type: "add-routine",
            routine: {
              id: crypto.randomUUID(),
              name: name.trim(),
              emoji,
              color,
              duration,
              rrule,
              exdates: [],
              doneDates: [],
              createdAt: new Date().toISOString(),
            },
          })
        }
        onDone()
      }}
    >
      <div className="flex gap-2">
        <label className="w-14">
          <span className="mb-0.5 block text-xs font-medium">Emoji</span>
          <Input
            value={emoji}
            maxLength={4}
            onChange={(event) => setEmoji(event.target.value)}
            className="h-10 text-center"
          />
        </label>
        <label className="min-w-0 flex-1">
          <span className="mb-0.5 block text-xs font-medium">Name</span>
          <Input
            value={name}
            autoFocus
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            className="h-10"
          />
        </label>
      </div>
      <fieldset>
        <legend className="mb-0.5 text-xs font-medium">Days</legend>
        <div className="flex flex-wrap gap-1">
          {WEEKDAYS.map((day) => (
            <button
              key={day.code}
              type="button"
              aria-pressed={days.includes(day.code)}
              onClick={() =>
                setDays(
                  days.includes(day.code)
                    ? days.filter((code) => code !== day.code)
                    : [...days, day.code]
                )
              }
              className={cn(
                "min-h-9 rounded-full border px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                days.includes(day.code)
                  ? "border-primary bg-sage-soft"
                  : "border-border bg-card"
              )}
            >
              {day.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="mb-0.5 block text-xs font-medium">Time</span>
          <Input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="h-10"
          />
        </label>
        <label>
          <span className="mb-0.5 block text-xs font-medium">Minutes</span>
          <Input
            type="number"
            min={5}
            step={5}
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
            className="h-10"
          />
        </label>
      </div>
      <fieldset>
        <legend className="mb-0.5 text-xs font-medium">Color</legend>
        <div className="flex flex-wrap gap-1.5">
          {PALETTE.map((option, index) => (
            <button
              key={option}
              type="button"
              aria-label={`Color ${index + 1}`}
              aria-pressed={color === option}
              onClick={() => setColor(option)}
              style={{ backgroundColor: option }}
              className={cn(
                "size-8 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                color === option &&
                  "ring-2 ring-foreground ring-offset-2 ring-offset-card"
              )}
            />
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" size="lg" className="min-h-10" disabled={!ready}>
          {routine ? "Save routine" : "Add routine"}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="ghost"
          className="min-h-10"
          onClick={onDone}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

export function MyRoutines({
  editingId,
  setEditingId,
  selected,
}: {
  editingId: string | null
  setEditingId: (id: string | null) => void
  selected: string
}) {
  const { state, dispatch, today } = useStore()
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<Routine | null>(null)
  const ref = useCalendarDraggable()
  return (
    <section aria-labelledby="routines-heading">
      <h2
        id="routines-heading"
        className="mb-2 font-sans text-[15px] font-semibold tracking-normal"
      >
        My routines
      </h2>
      <ul ref={ref} className="space-y-1.5">
        {state.routines.map((routine) => {
          const times = timesThisWeek(state, routine, today)
          if (editingId === routine.id) {
            return (
              <li key={routine.id}>
                <RoutineForm
                  routine={routine}
                  onDone={() => setEditingId(null)}
                />
              </li>
            )
          }
          return (
            <li
              key={routine.id}
              data-cal-drag
              data-kind="routine"
              data-id={routine.id}
              data-title={`${routine.emoji} ${routine.name}`.trim()}
              data-minutes={routine.duration}
              style={{ borderLeftColor: routine.color }}
              className="cursor-grab rounded-xl border border-l-4 border-border bg-card p-2"
            >
              <div className="flex items-start gap-1">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium break-words">
                    {routine.emoji} {routine.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {parseRoutineRule(routine.rrule)
                      .days.map(
                        (code) =>
                          WEEKDAYS.find((day) => day.code === code)?.label
                      )
                      .join(", ")}{" "}
                    · {routineTime(routine)} · {routine.duration} min
                  </span>
                  {times > 0 && (
                    <span className="block text-xs text-muted-foreground">
                      this week: {times} {times === 1 ? "time" : "times"}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={`Edit ${routine.name}`}
                  onClick={() => setEditingId(routine.id)}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  <Pencil className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${routine.name}`}
                  onClick={() => setDeleting(routine)}
                  className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
              <button
                type="button"
                aria-label={`Add ${routine.name} to ${shortDate(selected)}`}
                onClick={() =>
                  dispatch({
                    type: "place-routine",
                    placement: {
                      id: crypto.randomUUID(),
                      routineId: routine.id,
                      date: selected,
                      time: routineTime(routine),
                      done: false,
                    },
                  })
                }
                className="min-h-8 rounded-md text-xs font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                Add to {shortDate(selected)}
              </button>
            </li>
          )
        })}
      </ul>
      {adding ? (
        <div className="mt-2">
          <RoutineForm onDone={() => setAdding(false)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <Plus className="size-4" aria-hidden />
          New routine
        </button>
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this routine?"
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) dispatch({ type: "delete-routine", id: deleting.id })
          setDeleting(null)
        }}
      >
        “{deleting?.name}” will leave your calendar, including days you marked
        done. Focus sessions aren’t affected.
      </ConfirmDialog>
    </section>
  )
}
