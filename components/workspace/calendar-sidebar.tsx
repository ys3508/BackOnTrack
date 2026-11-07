"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Draggable } from "@fullcalendar/interaction"
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react"

import { EventEditor } from "@/components/workspace/event-editor"
import { ConfirmDialog } from "@/components/workspace/parts"
import { useStore } from "@/components/workspace/store"
import {
  formatClockTime,
  occurrenceOutcome,
  repeatLabel,
  routineWeek,
  trayItems,
} from "@/lib/calendar/derived"
import {
  colorOf,
  minutesBetween,
  occursOn,
  routinesOf,
} from "@/lib/calendar/model"
import type { CalendarEvent } from "@/lib/workspace/schemas"
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
  hideHeading,
}: {
  onSchedule: (taskId: string) => void
  /** For when something around it already names it. */
  hideHeading?: boolean
}) {
  const { state, today } = useStore()
  const items = trayItems(state, today)
  const ref = useCalendarDraggable()
  if (!items.length) return null
  return (
    <section
      aria-labelledby={hideHeading ? undefined : "tray-heading"}
      aria-label={hideHeading ? "Not started yet" : undefined}
    >
      {!hideHeading && (
        <h2
          id="tray-heading"
          className="mb-2 font-heading text-lg"
        >
          Not started yet ({items.length})
        </h2>
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
            className="bot-press flex cursor-grab items-start gap-1 rounded-2xl bg-card p-2.5"
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
                {putOffDays === 0
                  ? "put off today"
                  : `put off ${putOffDays} ${putOffDays === 1 ? "day" : "days"}`}
              </span>
              <button
                type="button"
                aria-label={`Schedule ${task.title}`}
                onClick={() => onSchedule(task.id)}
                className="min-h-8 rounded-md text-xs font-medium text-link outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
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

/** Drag it onto the calendar to keep some time free, wherever it's useful. */
export function BufferChip() {
  const { state } = useStore()
  const ref = useCalendarDraggable()
  const minutes = state.settings.bufferMinutes
  return (
    <section aria-label="Add a buffer">
      <ul ref={ref}>
        <li
          data-cal-drag
          data-kind="buffer"
          data-id="buffer"
          data-title="Buffer"
          data-minutes={minutes}
          className="bot-press bot-buffer-chip flex cursor-grab items-center gap-1 rounded-2xl p-2.5 text-sm font-medium"
        >
          <GripVertical
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
          Buffer
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {minutes} min
          </span>
        </li>
      </ul>
      <p className="mt-1 text-xs text-muted-foreground">
        Drag it to any time you’d like to keep free.
      </p>
    </section>
  )
}

export function MyRoutines({
  editingId,
  setEditingId,
  page = false,
}: {
  editingId: string | null
  setEditingId: (id: string | null) => void
  /** On the Routines screen, with room for today's answer on each card. */
  page?: boolean
}) {
  const { state, dispatch, today } = useStore()
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null)
  const ref = useCalendarDraggable()
  const addRef = useRef<HTMLButtonElement>(null)
  const routines = routinesOf(state)
  const editing = state.events.find((item) => item.id === editingId)
  const addAnchor = useCallback(() => addRef.current, [])
  const editAnchor = useCallback(
    () => document.querySelector(`[data-routine-card="${editingId}"]`),
    [editingId]
  )
  const closeAdding = useCallback(() => setAdding(false), [])
  const closeEditing = useCallback(() => setEditingId(null), [setEditingId])
  return (
    <section aria-labelledby="routines-heading">
      <h2
        id="routines-heading"
        className="mb-2 font-heading text-lg"
      >
        My routines
      </h2>
      {!routines.length && (
        <p className={cn(page ? "bot-card mb-3 p-5 font-medium" : "mb-2 text-xs text-muted-foreground")}>
          {page
            ? "Nothing here yet. Add something small you’d like to come back to, like a walk or a tidy desk. It can have a smaller version for hard days."
            : "Anything that repeats shows up here."}
        </p>
      )}
      <ul
        ref={ref}
        className={page ? "grid gap-4 sm:grid-cols-2" : "space-y-1.5"}
      >
        {routines.map(({ current, parts }) => {
          const color = colorOf(current, state.tasks)
          // Today's part of the series, which may not be the newest one.
          const part = parts.find((item) => occursOn(item, today))
          const outcome = part ? occurrenceOutcome(part, today) : null
          const setOutcome = (next: "full" | "minimum" | "skipped") =>
            part &&
            dispatch({
              type: "occurrence-outcome",
              id: part.id,
              key: today,
              outcome: outcome === next ? null : next,
            })
          const week = routineWeek(state, current, today)
          const emoji = current.emoji
          return (
            <li
              key={current.id}
              data-cal-drag
              data-routine-card={current.id}
              data-kind="routine"
              data-id={current.id}
              data-title={`${emoji} ${current.title}`.trim()}
              data-minutes={minutesBetween(current.start, current.end)}
              style={
                {
                  "--event-color": color,
                  background: `radial-gradient(120% 140% at 8% 0%, color-mix(in srgb, ${color} 30%, white), color-mix(in srgb, ${color} 6%, white))`,
                } as React.CSSProperties
              }
              className={cn(
                "bot-press cursor-grab rounded-2xl",
                page ? "cursor-default p-4" : "p-3"
              )}
            >
              <div className="flex items-start gap-1">
                {page && (
                  <span
                    aria-hidden
                    className="mr-2 grid size-12 shrink-0 place-items-center rounded-full bg-white/80 text-2xl"
                  >
                    {emoji || "✦"}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block font-medium break-words",
                      page ? "font-heading text-[1.75rem] leading-none font-normal" : "text-sm"
                    )}
                  >
                    {!page && emoji && `${emoji} `}
                    {current.title}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {repeatLabel(current.repeat!.days)} ·{" "}
                    {current.flexible
                      ? "Any time"
                      : formatClockTime(
                          new Date(`2000-01-15T${current.start}:00`)
                        )}{" "}
                    · {minutesBetween(current.start, current.end)} min
                  </span>
                  {(week.full > 0 || week.minimum > 0) && (
                    <span className="block text-xs text-muted-foreground">
                      this week:{" "}
                      {[
                        week.full > 0 &&
                          `● ${week.full} ${week.full === 1 ? "time" : "times"}`,
                        week.minimum > 0 && `◐ ${week.minimum} minimum`,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={`Edit ${current.title}`}
                  onClick={() => setEditingId(current.id)}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-ink outline-none hover:bg-white focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  <Pencil className="size-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${current.title}`}
                  onClick={() => setDeleting(current)}
                  className="grid size-8 shrink-0 place-items-center rounded-full text-ink outline-none hover:bg-white focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              </div>
              {page && current.minimum && (
                <p className="mt-2 text-xs font-medium">
                  ◐ Minimum: {current.minimum}
                </p>
              )}
              {page && part && (
                <div
                  role="group"
                  aria-label={`Today: ${current.title}`}
                  className="mt-3 flex flex-wrap gap-1.5"
                >
                  <button
                    type="button"
                    aria-pressed={outcome === "full"}
                    data-outcome="full"
                    className="bot-outcome"
                    onClick={() => setOutcome("full")}
                  >
                    ● Full
                  </button>
                  <button
                    type="button"
                    aria-pressed={outcome === "minimum"}
                    data-outcome="minimum"
                    className="bot-outcome"
                    onClick={() => setOutcome("minimum")}
                  >
                    ◐ Minimum
                  </button>
                  <button
                    type="button"
                    aria-pressed={outcome === "skipped"}
                    data-outcome="skipped"
                    className="bot-outcome"
                    onClick={() => setOutcome("skipped")}
                  >
                    Skip
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      <button
        ref={addRef}
        type="button"
        onClick={() => setAdding(true)}
        className="bot-press mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/80 px-5 text-sm font-medium outline-none"
      >
        <Plus className="size-4" aria-hidden />
        New routine
      </button>
      {adding && (
        <EventEditor
          draft={{
            date: today,
            start: "07:00",
            minutes: 30,
            repeating: true,
          }}
          anchor={addAnchor}
          onClose={closeAdding}
        />
      )}
      {editing && (
        <EventEditor
          key={editing.id}
          event={editing}
          occurrence={editing.date}
          scope="all"
          anchor={editAnchor}
          onClose={closeEditing}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this routine?"
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) {
            dispatch({
              type: "delete-event",
              id: deleting.id,
              key: deleting.date,
              scope: "all",
            })
          }
          setDeleting(null)
        }}
      >
        “{deleting?.title}” will leave your calendar, including days you marked
        done. Focus sessions aren’t affected.
      </ConfirmDialog>
    </section>
  )
}
