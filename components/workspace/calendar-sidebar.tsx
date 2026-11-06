"use client"

import { useEffect, useRef, useState } from "react"
import { Draggable } from "@fullcalendar/interaction"
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DurationChips,
  ROUTINE_MINUTES,
} from "@/components/workspace/calendar-overlays"
import { ConfirmDialog } from "@/components/workspace/parts"
import { useStore } from "@/components/workspace/store"
import {
  EMOJI_CHOICES,
  PALETTE,
  WEEKDAYS,
  buildRoutineRule,
  formatClockTime,
  parseRoutineRule,
  routineTime,
  routineWeek,
  suggestEmoji,
} from "@/lib/calendar/derived"
import type { Routine } from "@/lib/workspace/schemas"
import { shortDate } from "@/lib/workspace/dates"
import { trayItems } from "@/lib/calendar/derived"
import { cn } from "@/lib/utils"

function weekdayCode(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return WEEKDAYS[new Date(year, month - 1, day).getDay()].code as string
}

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
  return (
    <section
      aria-labelledby={hideHeading ? undefined : "tray-heading"}
      aria-label={hideHeading ? "Not started yet" : undefined}
    >
      {!hideHeading && (
        <h2
          id="tray-heading"
          className="mb-2 font-sans text-[15px] font-semibold tracking-normal"
        >
          Not started yet
        </h2>
      )}
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
                {putOffDays === 0
                  ? "put off today"
                  : `put off ${putOffDays} ${putOffDays === 1 ? "day" : "days"}`}
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

const DAY_PRESETS = [
  { label: "Every day", days: WEEKDAYS.map((day) => day.code as string) },
  { label: "Weekdays", days: ["MO", "TU", "WE", "TH", "FR"] },
  { label: "Weekends", days: ["SA", "SU"] },
]

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
  // A guess until they choose one themselves.
  const [picked, setPicked] = useState(routine?.emoji ?? "")
  const [pickerOpen, setPickerOpen] = useState(false)
  const emoji = picked || suggestEmoji(name)
  const [color, setColor] = useState(routine?.color ?? PALETTE[0])
  const [days, setDays] = useState<string[]>(
    parsed?.days ?? [weekdayCode(today)]
  )
  const [kind, setKind] = useState(routine?.kind ?? "fixed")
  const [time, setTime] = useState(parsed?.time ?? "07:00")
  const [duration, setDuration] = useState(routine?.duration ?? 30)
  const [minimum, setMinimum] = useState(routine?.minimumVersion ?? "")

  const missing = [
    !name.trim() && "a name",
    !days.length && "at least one day",
    kind === "fixed" && !time && "a time",
  ].filter(Boolean)
  const ready = !missing.length && duration > 0
  const chip = (active: boolean) =>
    cn(
      "min-h-9 rounded-full border px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
      active ? "border-primary bg-sage-soft" : "border-border bg-card"
    )

  return (
    <form
      className="space-y-2 rounded-xl border border-border bg-card p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault()
        if (!ready) return
        const clock = kind === "flexible" ? "00:00" : time
        const rrule = buildRoutineRule(days, clock, today)
        if (routine) {
          dispatch({
            type: "update-routine",
            id: routine.id,
            patch: {
              name: name.trim(),
              emoji,
              color,
              kind,
              minimumVersion: minimum.trim(),
            },
          })
          // A new schedule starts today, so earlier weeks stay as they were.
          const sameDays =
            [...(parsed?.days ?? [])].sort().join() === [...days].sort().join()
          if (
            !sameDays ||
            parsed?.time !== clock ||
            routine.duration !== duration
          ) {
            dispatch({
              type: "update-routine-future",
              id: routine.id,
              fromDate: today,
              rrule,
              duration,
            })
          }
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
              kind,
              minimumVersion: minimum.trim(),
              exdates: [],
              doneDates: [],
              createdAt: new Date().toISOString(),
            },
          })
        }
        onDone()
      }}
    >
      <div className="flex items-end gap-2">
        <div>
          <span className="mb-0.5 block text-xs font-medium" id="emoji-label">
            Emoji
          </span>
          <button
            type="button"
            aria-labelledby="emoji-label"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen(!pickerOpen)}
            className="grid h-10 w-12 place-items-center rounded-lg border border-input bg-card text-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            {emoji || "＋"}
          </button>
        </div>
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
      {pickerOpen && (
        <div
          role="group"
          aria-label="Choose an emoji"
          className="flex flex-wrap gap-1"
        >
          {EMOJI_CHOICES.map((choice) => (
            <button
              key={choice}
              type="button"
              aria-label={`Use ${choice}`}
              aria-pressed={emoji === choice}
              onClick={() => {
                setPicked(choice)
                setPickerOpen(false)
              }}
              className={cn(
                "grid size-9 place-items-center rounded-lg text-lg outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30",
                emoji === choice && "bg-sage-soft"
              )}
            >
              {choice}
            </button>
          ))}
        </div>
      )}
      <fieldset>
        <legend className="mb-0.5 text-xs font-medium">Days</legend>
        <div className="mb-1 flex flex-wrap gap-1">
          {DAY_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              aria-pressed={
                [...days].sort().join() === [...preset.days].sort().join()
              }
              onClick={() => setDays(preset.days)}
              className={chip(
                [...days].sort().join() === [...preset.days].sort().join()
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>
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
              className={chip(days.includes(day.code))}
            >
              {day.label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-0.5 text-xs font-medium">When</legend>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            aria-pressed={kind === "fixed"}
            onClick={() => setKind("fixed")}
            className={chip(kind === "fixed")}
          >
            At a set time
          </button>
          <button
            type="button"
            aria-pressed={kind === "flexible"}
            onClick={() => setKind("flexible")}
            className={chip(kind === "flexible")}
          >
            Any time that day
          </button>
        </div>
        {kind === "fixed" && (
          <label className="mt-1 block">
            <span className="mb-0.5 block text-xs font-medium">Time</span>
            <Input
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="h-10"
            />
          </label>
        )}
      </fieldset>
      <DurationChips
        value={duration}
        onChange={setDuration}
        options={ROUTINE_MINUTES}
      />
      <label className="block">
        <span className="mb-0.5 block text-xs font-medium">
          Minimum version (optional)
        </span>
        <Input
          value={minimum}
          maxLength={120}
          placeholder="Move for 5 minutes"
          onChange={(event) => setMinimum(event.target.value)}
          className="h-10"
        />
      </label>
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
      {!ready && missing.length > 0 && (
        <p id="routine-missing" className="text-xs text-muted-foreground">
          To add this, it needs {missing.join(" and ")}.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          size="lg"
          className="min-h-10"
          disabled={!ready}
          aria-describedby={!ready ? "routine-missing" : undefined}
        >
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
          const week = routineWeek(state, routine, today)
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
                    ·{" "}
                    {routine.kind === "flexible"
                      ? "Any time"
                      : formatClockTime(
                          new Date(`2000-01-15T${routineTime(routine)}:00`)
                        )}{" "}
                    · {routine.duration} min
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
                      time:
                        routine.kind === "flexible" ? "" : routineTime(routine),
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
