"use client"

import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  DurationChips,
  Floating,
  TaskCombobox,
} from "@/components/workspace/calendar-overlays"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import {
  EMOJI_CHOICES,
  WEEKDAYS,
  endOf,
  formatClockTime,
  suggestEmoji,
} from "@/lib/calendar/derived"
import {
  EVENT_SWATCHES,
  addClock,
  colorOf,
  occurrenceAt,
  plannedSession,
  weekdayOf,
} from "@/lib/calendar/model"
import type { EventPatch, EventScope } from "@/lib/calendar/model"
import { isActive } from "@/lib/workspace/schemas"
import type {
  CalendarEvent,
  EventRepeat,
  Task,
} from "@/lib/workspace/schemas"
import { cn } from "@/lib/utils"

type RepeatChoice = "none" | "daily" | "weekdays" | "weekends" | "custom"
type EndChoice = "never" | "date" | "count"

const REPEAT_LABEL: Record<RepeatChoice, string> = {
  none: "Does not repeat",
  daily: "Every day",
  weekdays: "Weekdays",
  weekends: "Weekends",
  custom: "Custom days",
}

const PRESET_DAYS: Partial<Record<RepeatChoice, number[]>> = {
  daily: [0, 1, 2, 3, 4, 5, 6],
  weekdays: [1, 2, 3, 4, 5],
  weekends: [0, 6],
}

function choiceOf(repeat: EventRepeat | null | undefined): RepeatChoice {
  if (!repeat) return "none"
  const days = [...repeat.days].sort().join()
  const preset = (Object.keys(PRESET_DAYS) as RepeatChoice[]).find(
    (key) => PRESET_DAYS[key]!.join() === days
  )
  return preset ?? "custom"
}

const sameRepeat = (a: EventRepeat | null, b: EventRepeat | null) =>
  JSON.stringify(
    a && { days: [...a.days].sort(), until: a.until, count: a.count }
  ) ===
  JSON.stringify(
    b && { days: [...b.days].sort(), until: b.until, count: b.count }
  )

/** How far a change to a repeating event should reach. */
export function ScopeChoice({
  question,
  onChoose,
  onCancel,
  allowOne = true,
}: {
  question: string
  onChoose: (scope: EventScope) => void
  onCancel: () => void
  /** A new repeat rule can't apply to a single day. */
  allowOne?: boolean
}) {
  return (
    <div role="group" aria-label={question} className="grid gap-1.5">
      <p className="text-sm font-medium">{question}</p>
      {allowOne && (
        <Button
          type="button"
          size="lg"
          className="min-h-10 justify-start"
          onClick={() => onChoose("one")}
        >
          This one only
        </Button>
      )}
      <Button
        type="button"
        size="lg"
        variant="outline"
        className="min-h-10 justify-start"
        onClick={() => onChoose("following")}
      >
        This and following
      </Button>
      <Button
        type="button"
        size="lg"
        variant="outline"
        className="min-h-10 justify-start"
        onClick={() => onChoose("all")}
      >
        All
      </Button>
      <Button
        type="button"
        size="lg"
        variant="ghost"
        className="min-h-10 justify-start"
        onClick={onCancel}
      >
        Cancel
      </Button>
    </div>
  )
}

/** Where a new event starts out, and how long, from however it was opened. */
export type EventDraft = {
  date: string
  start: string
  minutes: number
  flexible?: boolean
  /** Opened from "New routine", so it starts out repeating. */
  repeating?: boolean
  /** A length chosen on purpose, as by dragging. It's then remembered. */
  chosen?: boolean
}

export type EditorPreview = {
  date: string
  start: string
  minutes: number
  flexible: boolean
}

/**
 * The one way to make or change anything on the calendar. A new title makes a
 * task, unless it repeats, since a routine isn't work to finish.
 */
export function EventEditor({
  draft,
  event,
  occurrence,
  scope: fixedScope,
  anchor,
  onClose,
  onPreview,
}: {
  draft?: EventDraft
  event?: CalendarEvent
  /** The occurrence being edited, by the date it's stored under. */
  occurrence?: string
  /** Set when the choice was already made, as on the Routines page. */
  scope?: EventScope
  anchor: () => Element | null
  onClose: () => void
  onPreview?: (preview: EditorPreview) => void
}) {
  const { state, dispatch } = useStore()
  const key = occurrence ?? event?.date ?? draft?.date ?? ""
  const shown = event ? occurrenceAt(event, key) : null
  const linked = state.tasks.find((task) => task.id === event?.taskId)

  const [title, setTitle] = useState(linked?.title ?? shown?.title ?? "")
  const [picked, setPicked] = useState<Task | null>(linked ?? null)
  const [date, setDate] = useState(shown?.date ?? draft?.date ?? "")
  const [start, setStart] = useState(shown?.start ?? draft?.start ?? "09:00")
  const [minutes, setMinutes] = useState(shown?.minutes ?? draft?.minutes ?? 30)
  const [chosen, setChosen] = useState(Boolean(draft?.chosen))
  const [flexible, setFlexible] = useState(
    event?.flexible ?? draft?.flexible ?? false
  )
  const [color, setColor] = useState<string | null>(
    shown?.color ?? event?.color ?? null
  )
  const [repeatChoice, setRepeatChoice] = useState<RepeatChoice>(
    draft?.repeating ? "daily" : choiceOf(event?.repeat)
  )
  const [customDays, setCustomDays] = useState<number[]>(
    event?.repeat?.days ??
      (draft?.date ? [weekdayOf(draft.date)] : [])
  )
  const [ends, setEnds] = useState<EndChoice>(
    event?.repeat?.until ? "date" : event?.repeat?.count ? "count" : "never"
  )
  const [until, setUntil] = useState(event?.repeat?.until ?? "")
  const [count, setCount] = useState(event?.repeat?.count ?? 10)
  const [minimum, setMinimum] = useState(event?.minimum ?? "")
  const [link, setLink] = useState(event?.link ?? "")
  const [notes, setNotes] = useState(event?.notes ?? "")
  const [emoji, setEmoji] = useState(event?.emoji ?? "")
  const [more, setMore] = useState(Boolean(event?.link || event?.notes))
  const [asking, setAsking] = useState<EventPatch | null>(null)

  const repeating = repeatChoice !== "none"
  const days = PRESET_DAYS[repeatChoice] ?? customDays

  useEffect(() => {
    onPreview?.({ date, start, minutes, flexible })
  }, [onPreview, date, start, minutes, flexible])

  const repeat: EventRepeat | null = repeating
    ? {
        days,
        ...(ends === "date" && until ? { until } : {}),
        ...(ends === "count" ? { count } : {}),
      }
    : null
  const ready =
    Boolean(title.trim() && date) &&
    (flexible || Boolean(start)) &&
    minutes > 0 &&
    (!repeating || days.length > 0)

  /** The task this title means: one picked, or an open one by the same name. */
  function resolveTask() {
    const text = title.trim().toLowerCase()
    if (picked?.title.toLowerCase() === text) return picked
    return (
      state.tasks.find(
        (task) => isActive(task) && task.title.toLowerCase() === text
      ) ?? null
    )
  }

  function linkedTaskId() {
    const task = resolveTask()
    if (task) return task.id
    // A routine isn't something to finish, so it doesn't become a task.
    if (repeating) return null
    const id = newId()
    dispatch({ type: "create-task", id, at: nowIso(), title: title.trim() })
    return id
  }

  function remember() {
    if (chosen) {
      dispatch({ type: "settings", patch: { lastSessionMinutes: minutes } })
    }
  }

  function create() {
    const taskId = linkedTaskId()
    const clock = flexible ? "00:00" : start
    const at = nowIso()
    dispatch({
      type: "add-event",
      event: {
        id: newId(),
        title: title.trim(),
        taskId,
        kind: "event",
        date,
        start: clock,
        end: addClock(clock, minutes),
        flexible,
        // A task's own colour is followed until they pick another.
        color: color ?? (taskId ? null : EVENT_SWATCHES[0].value),
        repeat,
        overrides: {},
        outcomes: {},
        minimum: repeating ? minimum.trim() : "",
        link: link.trim(),
        notes: notes.trim(),
        emoji: repeating ? emoji || suggestEmoji(title) : "",
        label: "",
        window: null,
        seriesId: null,
        createdAt: at,
      },
    })
    remember()
    onClose()
  }

  /** Only what actually changed, so "All" can't flatten what it didn't touch. */
  function changes(target: CalendarEvent): EventPatch {
    const patch: EventPatch = {}
    const before = occurrenceAt(target, key)
    if (!before) return patch
    if (title.trim() !== (linked?.title ?? before.title)) {
      patch.title = title.trim()
    }
    if (date !== before.date) patch.date = date
    if (flexible !== target.flexible) patch.flexible = flexible
    const clock = !flexible ? start : target.flexible ? before.start : "00:00"
    if (clock !== before.start) patch.start = clock
    if (clock !== before.start || minutes !== before.minutes) {
      patch.end = addClock(clock, minutes)
    }
    if (color && color !== before.color) patch.color = color
    if (!sameRepeat(repeat, target.repeat)) patch.repeat = repeat
    if (minimum.trim() !== target.minimum) patch.minimum = minimum.trim()
    if (link.trim() !== target.link) patch.link = link.trim()
    if (notes.trim() !== target.notes) patch.notes = notes.trim()
    if (emoji !== target.emoji) patch.emoji = emoji
    return patch
  }

  function apply(target: CalendarEvent, change: EventPatch, scope: EventScope) {
    const session = plannedSession(state, target.id)
    // Only now, so backing out of the question above leaves no stray task.
    const patch =
      change.title !== undefined && scope !== "one"
        ? { ...change, taskId: linkedTaskId() }
        : change
    let rest = patch
    // A block moves through its own step, so it stays in the task's history.
    if (session && !patch.repeat) {
      const { date: day, start: from, end, flexible: anyTime, ...others } = patch
      const at = nowIso()
      if (day || from || anyTime !== undefined) {
        dispatch({
          type: "move-planned",
          at,
          id: session.id,
          date: day ?? session.date,
          time: flexible ? null : start,
          window: session.window,
        })
      }
      if (end && minutes !== session.minutes) {
        dispatch({ type: "resize-planned", at, id: session.id, minutes })
      }
      rest = others
    }
    if (Object.keys(rest).length) {
      dispatch({
        type: "edit-event",
        id: target.id,
        key,
        scope,
        patch: rest,
        newId: newId(),
      })
    }
    remember()
    onClose()
  }

  function save() {
    if (!ready) return
    if (!event) return create()
    const patch = changes(event)
    if (!Object.keys(patch).length) return onClose()
    if (event.repeat && !fixedScope) return setAsking(patch)
    apply(event, patch, fixedScope ?? "all")
  }

  const effective = colorOf({ color, taskId: resolveTask()?.id }, state.tasks)
  const label = event ? `Edit ${title || "event"}` : "New event"
  const field =
    "h-10 w-full rounded-2xl border border-input bg-card px-2.5 text-sm outline-none focus-visible:border-primary focus-visible:ring-3 focus-visible:ring-primary/30"
  const chip = (active: boolean) =>
    cn(
      "min-h-9 min-w-9 rounded-full border border-line px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
      active
        ? "bg-primary text-primary-foreground"
        : "bg-card hover:bg-brand-soft"
    )

  return (
    <Floating anchor={anchor} label={label} onClose={onClose} wide sheetWhenNarrow>
      {asking && event ? (
        <ScopeChoice
          question={`Change which “${title}”?`}
          allowOne={
            asking.repeat === undefined && asking.flexible === undefined
          }
          onChoose={(scope) => apply(event, asking, scope)}
          onCancel={() => setAsking(null)}
        />
      ) : (
        <form
          className="space-y-2.5"
          noValidate
          onSubmit={(formEvent) => {
            formEvent.preventDefault()
            save()
          }}
        >
          <TaskCombobox
            quiet
            label="Title"
            placeholder="Title, or find a task"
            value={title}
            onChange={setTitle}
            onPick={(task) => {
              setPicked(task)
              if (task?.estimateMinutes && !chosen && !event) {
                setMinutes(task.estimateMinutes)
              }
            }}
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs font-medium">
              Date
              <input
                type="date"
                value={date}
                max="9999-12-31"
                onChange={(change) => setDate(change.target.value)}
                className={cn(field, "mt-0.5")}
              />
            </label>
            {!flexible && (
              <label className="block text-xs font-medium">
                Start
                <input
                  type="time"
                  step={900}
                  value={start}
                  onChange={(change) => setStart(change.target.value)}
                  className={cn(field, "mt-0.5")}
                />
              </label>
            )}
          </div>

          <div>
            <DurationChips
              value={minutes}
              onChange={(next) => {
                setMinutes(next)
                setChosen(true)
              }}
            />
            {!flexible && date && start && (
              <p
                data-testid="event-end"
                className="mt-1 text-xs text-muted-foreground"
              >
                Ends {formatClockTime(endOf(date, start, minutes))}
              </p>
            )}
          </div>

          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={flexible}
              onChange={(change) => setFlexible(change.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            Any time that day
          </label>

          <label className="block text-xs font-medium">
            Repeat
            <select
              value={repeatChoice}
              onChange={(change) =>
                setRepeatChoice(change.target.value as RepeatChoice)
              }
              className={cn(field, "mt-0.5")}
            >
              {(Object.keys(REPEAT_LABEL) as RepeatChoice[]).map((choice) => (
                <option key={choice} value={choice}>
                  {REPEAT_LABEL[choice]}
                </option>
              ))}
            </select>
          </label>

          {repeatChoice === "custom" && (
            <div role="group" aria-label="Days" className="flex flex-wrap gap-1">
              {WEEKDAYS.map((day, index) => (
                <button
                  key={day.code}
                  type="button"
                  aria-pressed={customDays.includes(index)}
                  onClick={() =>
                    setCustomDays(
                      customDays.includes(index)
                        ? customDays.filter((item) => item !== index)
                        : [...customDays, index]
                    )
                  }
                  className={chip(customDays.includes(index))}
                >
                  {day.label}
                </button>
              ))}
            </div>
          )}

          {repeating && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs font-medium">
                  Ends
                  <select
                    value={ends}
                    onChange={(change) =>
                      setEnds(change.target.value as EndChoice)
                    }
                    className={cn(field, "mt-0.5")}
                  >
                    <option value="never">Never</option>
                    <option value="date">On date</option>
                    <option value="count">After N times</option>
                  </select>
                </label>
                {ends === "date" && (
                  <label className="block text-xs font-medium">
                    Last day
                    <input
                      type="date"
                      value={until}
                      min={date}
                      max="9999-12-31"
                      onChange={(change) => setUntil(change.target.value)}
                      className={cn(field, "mt-0.5")}
                    />
                  </label>
                )}
                {ends === "count" && (
                  <label className="block text-xs font-medium">
                    Times
                    <input
                      type="number"
                      min={1}
                      value={count}
                      onChange={(change) =>
                        setCount(Math.max(1, Number(change.target.value) || 1))
                      }
                      className={cn(field, "mt-0.5")}
                    />
                  </label>
                )}
              </div>
              <label className="block text-xs font-medium">
                Minimum version (optional)
                <Input
                  value={minimum}
                  maxLength={120}
                  placeholder="Shoes on"
                  onChange={(change) => setMinimum(change.target.value)}
                  className="mt-0.5 h-10"
                />
              </label>
            </>
          )}

          <fieldset>
            <legend className="mb-1 text-xs font-medium">Colour</legend>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_SWATCHES.map((swatch) => (
                <button
                  key={swatch.value}
                  type="button"
                  aria-label={swatch.name}
                  aria-pressed={effective === swatch.value}
                  onClick={() => setColor(swatch.value)}
                  style={{ backgroundColor: swatch.value }}
                  className={cn(
                    "size-8 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                    effective === swatch.value &&
                      "ring-2 ring-ink ring-offset-2"
                  )}
                />
              ))}
            </div>
          </fieldset>

          <button
            type="button"
            aria-expanded={more}
            onClick={() => setMore(!more)}
            className="min-h-9 rounded-md text-xs font-medium text-link outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            More
          </button>
          {more && (
            <div className="space-y-2">
              <label className="block text-xs font-medium">
                Link
                <Input
                  value={link}
                  placeholder="https://"
                  onChange={(change) => setLink(change.target.value)}
                  className="mt-0.5 h-10"
                />
              </label>
              <label className="block text-xs font-medium">
                Notes
                <Textarea
                  value={notes}
                  rows={2}
                  onChange={(change) => setNotes(change.target.value)}
                  className="mt-0.5"
                />
              </label>
              {repeating && (
                <div
                  role="group"
                  aria-label="Emoji"
                  className="flex flex-wrap gap-1"
                >
                  {EMOJI_CHOICES.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      aria-label={`Use ${choice}`}
                      aria-pressed={
                        (emoji || suggestEmoji(title)) === choice
                      }
                      onClick={() => setEmoji(choice)}
                      className={cn(
                        "grid size-8 place-items-center rounded-lg text-base outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30",
                        (emoji || suggestEmoji(title)) === choice &&
                          "bg-brand-soft"
                      )}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Enter to save, Esc to cancel.
            </p>
            <Button
              type="submit"
              size="lg"
              className="min-h-10"
              disabled={!ready}
            >
              Save
            </Button>
          </div>
        </form>
      )}
    </Floating>
  )
}
