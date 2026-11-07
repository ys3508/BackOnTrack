import { taskColor } from "@/lib/calendar/task-colors"
import { addDays, daysBetween } from "@/lib/workspace/dates"
import type {
  CalendarEvent,
  EventOutcome,
  EventOverride,
  EventRepeat,
  PlannedSession,
  Task,
  Workspace,
} from "@/lib/workspace/schemas"

/* ---------- Clock ---------- */

const pad = (value: number) => String(value).padStart(2, "0")

const clockMinutes = (clock: string) => {
  const [hours, minutes] = clock.split(":").map(Number)
  return hours * 60 + minutes
}

/** How long, in minutes. An end at or before the start runs past midnight. */
export function minutesBetween(start: string, end: string) {
  const length = clockMinutes(end) - clockMinutes(start)
  return length > 0 ? length : length + 1440
}

export function addClock(clock: string, minutes: number) {
  const total = (((clockMinutes(clock) + Math.round(minutes)) % 1440) + 1440) % 1440
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`
}

export const weekdayOf = (date: string) => {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(year, month - 1, day).getDay()
}

/* ---------- Occurrences ---------- */

/** One appearance of an event on a real day. */
export type Occurrence = {
  event: CalendarEvent
  /** The date its override and outcome are stored under. */
  key: string
  date: string
  start: string
  end: string
  minutes: number
  title: string
  color: string | null
  /** This one differs from the rest of its series. */
  adjusted: boolean
  outcome: EventOutcome | null
}

/** The last day a count-limited series reaches, or its until, or never. */
function lastKey(event: CalendarEvent) {
  const repeat = event.repeat
  if (!repeat?.count) return repeat?.until ?? null
  let date = event.date
  let left = repeat.count
  // Bounded so a damaged rule can't hang the page.
  for (let step = 0; step < 366 * 20; step += 1) {
    if (repeat.days.includes(weekdayOf(date))) {
      left -= 1
      if (left === 0) break
    }
    date = addDays(date, 1)
  }
  return repeat.until && repeat.until < date ? repeat.until : date
}

function isKey(event: CalendarEvent, date: string, last: string | null) {
  if (!event.repeat) return date === event.date
  return (
    date >= event.date &&
    (!last || date <= last) &&
    event.repeat.days.includes(weekdayOf(date))
  )
}

function occurrence(event: CalendarEvent, key: string): Occurrence | null {
  const change = event.overrides[key]
  if (change?.cancelled) return null
  const start = change?.start ?? event.start
  const end = change?.end ?? event.end
  return {
    event,
    key,
    date: change?.date ?? key,
    start,
    end,
    minutes: minutesBetween(start, end),
    title: change?.title ?? event.title,
    color: change?.color ?? event.color,
    adjusted: Boolean(change),
    outcome: event.outcomes[key] ?? null,
  }
}

/** This event's appearances on the dates from `from` up to, not including, `until`. */
export function occurrencesBetween(
  event: CalendarEvent,
  from: string,
  until: string
): Occurrence[] {
  const last = lastKey(event)
  const keys = new Set<string>()
  if (event.repeat) {
    for (let date = from; date < until; date = addDays(date, 1)) {
      if (isKey(event, date, last)) keys.add(date)
    }
  } else {
    keys.add(event.date)
  }
  // One moved in from a date outside the range still shows up where it landed.
  for (const [key, change] of Object.entries(event.overrides)) {
    if (change.date && isKey(event, key, last)) keys.add(key)
  }
  return [...keys]
    .sort()
    .flatMap((key) => occurrence(event, key) ?? [])
    .filter((item) => item.date >= from && item.date < until)
}

export function allOccurrences(
  state: Pick<Workspace, "events">,
  from: string,
  until: string
) {
  return state.events.flatMap((event) => occurrencesBetween(event, from, until))
}

export function occursOn(event: CalendarEvent, date: string) {
  return occurrencesBetween(event, date, addDays(date, 1)).length > 0
}

/** Where a date's occurrence really sits, even if it was moved there from elsewhere. */
export function occurrenceAt(event: CalendarEvent, key: string) {
  return occurrence(event, key)
}

/* ---------- What each event is ---------- */

/** Work set aside for a task, with its "Did it?" and the rest of that flow. */
export const isPlannedEvent = (event: CalendarEvent) =>
  event.kind === "event" && Boolean(event.taskId) && !event.repeat

/** What the Routines page lists: repeating events, one row per series. */
export function routinesOf(state: Pick<Workspace, "events">) {
  const groups = new Map<string, CalendarEvent[]>()
  for (const event of state.events) {
    if (event.kind !== "event" || !event.repeat) continue
    const id = seriesKey(event)
    groups.set(id, [...(groups.get(id) ?? []), event])
  }
  return [...groups.values()].map((parts) => {
    const sorted = [...parts].sort((a, b) => a.date.localeCompare(b.date))
    return { current: sorted[sorted.length - 1], parts: sorted }
  })
}

export const seriesKey = (event: CalendarEvent) => event.seriesId ?? event.id

export function seriesParts(
  state: Pick<Workspace, "events">,
  event: CalendarEvent
) {
  const id = seriesKey(event)
  return state.events.filter((item) => seriesKey(item) === id)
}

/** The colour the user picked, or their task's, everywhere it's drawn. */
export function colorOf(
  item: { color: string | null; taskId?: string | null },
  tasks: Pick<Task, "id" | "focusTheme">[]
) {
  if (item.color) return item.color
  if (!item.taskId) return DEFAULT_EVENT_COLOR
  const task = tasks.find((entry) => entry.id === item.taskId)
  return taskColor(item.taskId, task?.focusTheme).strong
}

export const EVENT_SWATCHES = [
  { name: "Blue", value: "#0b4fb3" },
  { name: "Green", value: "#4a7d1e" },
  { name: "Coral", value: "#d9501f" },
  { name: "Periwinkle", value: "#5e65dc" },
  { name: "Sky", value: "#2f7fb8" },
  { name: "Rose", value: "#c23a86" },
] as const

export const DEFAULT_EVENT_COLOR = EVENT_SWATCHES[0].value

export function eventTitle(
  item: Pick<Occurrence, "title"> & { event: CalendarEvent },
  tasks: Pick<Task, "id" | "title">[]
) {
  const { event } = item
  const task = tasks.find((entry) => entry.id === event.taskId)
  // A title changed for just this occurrence wins over everything else.
  const base =
    item.title !== event.title ? item.title : (task?.title ?? item.title)
  const named = event.label ? `${base}: ${event.label}` : base
  return `${event.emoji} ${named}`.trim()
}

/** How a block looks. Colour says which thing it is, and this says how it went. */
export type BlockStatus =
  | "planned"
  | "missed"
  | "done"
  | "minimum"
  | "skipped"
  | "buffer"

export function statusOf(item: Occurrence, now: number): BlockStatus {
  if (item.event.kind === "buffer") return "buffer"
  if (item.outcome === "full" || item.outcome === "did") return "done"
  if (item.outcome === "minimum") return "minimum"
  if (item.outcome === "skipped" || item.outcome === "didnt") return "skipped"
  if (item.event.flexible) return "planned"
  const ends =
    new Date(`${item.date}T${item.start}:00`).getTime() +
    item.minutes * 60_000
  return ends < now ? "missed" : "planned"
}

/* ---------- Planned blocks ---------- */

const plannedViews = new WeakMap<CalendarEvent[], PlannedSession[]>()

function plannedView(event: CalendarEvent): PlannedSession {
  const outcome = event.outcomes[event.date]
  return {
    id: event.id,
    taskId: event.taskId!,
    date: event.date,
    time: event.flexible ? null : event.start,
    minutes: minutesBetween(event.start, event.end),
    label: event.label,
    done: outcome === "full" || outcome === "did",
    outcome: outcome === "did" || outcome === "didnt" ? outcome : null,
    window: event.window,
  }
}

/** Work set aside for tasks, in the shape the rest of the app reasons about. */
export function plannedSessions(state: Pick<Workspace, "events">) {
  const known = plannedViews.get(state.events)
  if (known) return known
  const views = state.events.filter(isPlannedEvent).map(plannedView)
  plannedViews.set(state.events, views)
  return views
}

export function plannedSession(
  state: Pick<Workspace, "events">,
  id: string | null | undefined
) {
  return plannedSessions(state).find((item) => item.id === id)
}

function outcomeFrom(session: PlannedSession): EventOutcome | null {
  if (session.outcome) return session.outcome
  return session.done ? "full" : null
}

/** A block as an event. Used by anything that sets aside time for a task. */
export function eventFromPlanned(
  session: Omit<PlannedSession, "outcome" | "window"> &
    Partial<Pick<PlannedSession, "outcome" | "window">>,
  title: string,
  createdAt = ""
): CalendarEvent {
  const start = session.time ?? "00:00"
  const outcome = outcomeFrom({ outcome: null, window: null, ...session })
  return {
    id: session.id,
    title,
    taskId: session.taskId,
    kind: "event",
    date: session.date,
    start,
    end: addClock(start, Math.min(session.minutes, 1439)),
    flexible: !session.time,
    color: null,
    repeat: null,
    overrides: {},
    outcomes: outcome ? { [session.date]: outcome } : {},
    minimum: "",
    link: "",
    notes: "",
    emoji: "",
    label: session.label,
    window: session.window ?? null,
    seriesId: null,
    createdAt,
  }
}

/** Writes a changed view back, leaving everything it doesn't cover alone. */
function withPlannedView(
  event: CalendarEvent,
  session: PlannedSession
): CalendarEvent {
  const start = session.time ?? event.start
  const outcome = outcomeFrom(session)
  return {
    ...event,
    date: session.date,
    start,
    end: addClock(start, Math.min(session.minutes, 1439)),
    flexible: !session.time,
    window: session.window,
    label: session.label,
    outcomes: outcome ? { [session.date]: outcome } : {},
  }
}

/** Changes planned blocks through their view, so outcomes stay with the date. */
export function mapPlanned(
  events: CalendarEvent[],
  update: (session: PlannedSession) => PlannedSession
) {
  return events.map((event) => {
    if (!isPlannedEvent(event)) return event
    const before = plannedView(event)
    const after = update(before)
    return after === before ? event : withPlannedView(event, after)
  })
}

/* ---------- Editing ---------- */

export type EventScope = "one" | "following" | "all"

/** What an edit can change. Times and dates go through here so a scope applies. */
export type EventPatch = Partial<
  Pick<
    CalendarEvent,
    | "title"
    | "taskId"
    | "kind"
    | "date"
    | "start"
    | "end"
    | "flexible"
    | "color"
    | "repeat"
    | "minimum"
    | "link"
    | "notes"
    | "emoji"
  >
>

const pickWhen = (patch: EventPatch) => {
  const { date, start, end, ...rest } = patch
  return { when: { date, start, end }, rest }
}

function shiftDays(days: number[], by: number) {
  return [...new Set(days.map((day) => (((day + by) % 7) + 7) % 7))].sort()
}

/** Moves the dates something is stored under, along with a moved series. */
function shiftKeys<T>(record: Record<string, T>, by: number) {
  if (!by) return record
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [addDays(key, by), value])
  )
}

function shiftOverrides(record: Record<string, EventOverride>, by: number) {
  if (!by) return record
  return shiftKeys(
    Object.fromEntries(
      Object.entries(record).map(([key, change]) => [
        key,
        change.date ? { ...change, date: addDays(change.date, by) } : change,
      ])
    ),
    by
  )
}

/** The same rule, moved by however many days this occurrence was dragged. */
function shiftedRepeat(
  event: CalendarEvent,
  key: string,
  patch: EventPatch
): EventRepeat | null {
  const repeat = patch.repeat === undefined ? event.repeat : patch.repeat
  if (!repeat || patch.repeat !== undefined || !patch.date) return repeat
  const by = daysBetween(key, patch.date)
  return by ? { ...repeat, days: shiftDays(repeat.days, by) } : repeat
}

function pickFrom<T>(record: Record<string, T>, keep: (key: string) => boolean) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => keep(key)))
}

function editOne(
  event: CalendarEvent,
  key: string,
  patch: EventPatch
): CalendarEvent {
  const change: EventOverride = { ...event.overrides[key] }
  if (patch.date && patch.date !== key) change.date = patch.date
  else if (patch.date === key) delete change.date
  if (patch.start) change.start = patch.start
  if (patch.end) change.end = patch.end
  if (patch.title !== undefined && patch.title !== event.title) {
    change.title = patch.title
  }
  if (patch.color && patch.color !== event.color) change.color = patch.color
  return { ...event, overrides: { ...event.overrides, [key]: change } }
}

function editOneOff(event: CalendarEvent, patch: EventPatch): CalendarEvent {
  const date = patch.date ?? event.date
  const by = daysBetween(event.date, date)
  return {
    ...event,
    ...patch,
    date,
    overrides: shiftKeys(event.overrides, by),
    outcomes: shiftKeys(event.outcomes, by),
  }
}

/** Everything from `key` on becomes its own event, and the past stays as it was. */
function editFollowing(
  event: CalendarEvent,
  key: string,
  patch: EventPatch,
  newId: string
): CalendarEvent[] {
  const { when, rest } = pickWhen(patch)
  const repeat = shiftedRepeat(event, key, patch)
  const firstDate = when.date ?? key
  const by = daysBetween(key, firstDate)
  const series = seriesKey(event)
  const before = occurrenceCountBefore(event, key)
  const later: CalendarEvent = {
    ...event,
    ...rest,
    id: newId,
    seriesId: series,
    date: firstDate,
    start: when.start ?? event.start,
    end: when.end ?? event.end,
    repeat:
      repeat && event.repeat?.count && patch.repeat === undefined
        ? { ...repeat, count: Math.max(1, event.repeat.count - before) }
        : repeat,
    overrides: shiftOverrides(
      pickFrom(event.overrides, (date) => date > key),
      by
    ),
    outcomes: shiftKeys(
      pickFrom(event.outcomes, (date) => date >= key),
      by
    ),
  }
  // Nothing came before it, so there's no earlier part to keep.
  if (before === 0) return [{ ...later, id: event.id, seriesId: event.seriesId }]
  const earlier: CalendarEvent = {
    ...event,
    seriesId: series,
    repeat: endedBefore(event.repeat!, key),
    overrides: pickFrom(event.overrides, (date) => date < key),
    outcomes: pickFrom(event.outcomes, (date) => date < key),
  }
  return [earlier, later]
}

/** The same rule, stopping the day before a date, whatever its end was. */
function endedBefore(repeat: EventRepeat, key: string): EventRepeat {
  return { days: repeat.days, until: addDays(key, -1) }
}

function occurrenceCountBefore(event: CalendarEvent, key: string) {
  const last = lastKey(event)
  let count = 0
  for (let date = event.date; date < key; date = addDays(date, 1)) {
    if (isKey(event, date, last)) count += 1
  }
  return count
}

function editAll(
  parts: CalendarEvent[],
  source: CalendarEvent,
  key: string,
  patch: EventPatch
) {
  const { when, rest } = pickWhen(patch)
  const repeat = shiftedRepeat(source, key, patch)
  const by = when.date ? daysBetween(key, when.date) : 0
  return parts.map((part) => ({
    ...part,
    ...rest,
    start: when.start ?? part.start,
    end: when.end ?? part.end,
    date: by ? addDays(part.date, by) : part.date,
    overrides: shiftOverrides(part.overrides, by),
    outcomes: shiftKeys(part.outcomes, by),
    repeat:
      part.repeat &&
      (part === source
        ? repeat
        : by
          ? { ...part.repeat, days: shiftDays(part.repeat.days, by) }
          : patch.repeat
            ? { ...patch.repeat, until: part.repeat.until }
            : part.repeat),
  }))
}

/** A repeating event's edit, reaching as far as the user said it should. */
export function applyEventEdit(
  events: CalendarEvent[],
  id: string,
  key: string,
  scope: EventScope,
  patch: EventPatch,
  newId: string
) {
  const event = events.find((item) => item.id === id)
  if (!event) return events
  if (!event.repeat) {
    return events.map((item) =>
      item === event ? editOneOff(item, patch) : item
    )
  }
  // No longer repeating at all: only the occurrence being edited is left.
  if (patch.repeat === null && scope === "all") {
    const series = seriesKey(event)
    const single = editFollowing(
      { ...event, repeat: { days: event.repeat.days }, date: key },
      key,
      patch,
      event.id
    )
    return [...events.filter((item) => seriesKey(item) !== series), ...single]
  }
  if (scope === "one") {
    return events.map((item) => (item === event ? editOne(item, key, patch) : item))
  }
  if (scope === "following") {
    return events.flatMap((item) =>
      item === event ? editFollowing(item, key, patch, newId) : [item]
    )
  }
  const parts = seriesParts({ events }, event)
  const changed = new Map(
    editAll(parts, event, key, patch).map((item) => [item.id, item])
  )
  return events.map((item) => changed.get(item.id) ?? item)
}

/** Removes one occurrence, this one onward, or the whole series. */
export function applyEventDelete(
  events: CalendarEvent[],
  id: string,
  key: string,
  scope: EventScope
) {
  const event = events.find((item) => item.id === id)
  if (!event) return events
  if (!event.repeat) return events.filter((item) => item !== event)
  if (scope === "all") {
    const series = seriesKey(event)
    return events.filter((item) => seriesKey(item) !== series)
  }
  if (scope === "one") {
    return events.map((item) =>
      item === event
        ? {
            ...item,
            overrides: {
              ...item.overrides,
              [key]: { ...item.overrides[key], cancelled: true },
            },
          }
        : item
    )
  }
  if (occurrenceCountBefore(event, key) === 0) {
    return events.filter((item) => item !== event)
  }
  const ended = endedBefore(event.repeat, key)
  return events.map((item) =>
    item === event
      ? {
          ...item,
          repeat: ended,
          overrides: pickFrom(item.overrides, (date) => date < key),
          outcomes: pickFrom(item.outcomes, (date) => date < key),
        }
      : item
  )
}

/* ---------- Finding time ---------- */

/** What's holding time on a date, in minutes from midnight. */
function busyMinutes(state: Pick<Workspace, "events">, date: string) {
  return allOccurrences(state, date, addDays(date, 1))
    .filter((item) => !item.event.flexible && item.event.kind === "event")
    .map((item) => {
      const from = clockMinutes(item.start)
      return [from, from + item.minutes] as const
    })
}

/** The first quarter hour from `after` with room for this length. */
export function nextFreeQuarter(
  state: Pick<Workspace, "events">,
  date: string,
  after: string,
  minutes: number
) {
  const busy = busyMinutes(state, date)
  let start = Math.ceil(clockMinutes(after) / 15) * 15
  // Past the end of the day there's no room left, so it stays where it started.
  while (start + minutes <= 1440) {
    const blocking = busy.find(
      ([from, to]) => start < to && start + minutes > from
    )
    if (!blocking) return `${pad(Math.floor(start / 60))}:${pad(start % 60)}`
    start = Math.ceil(blocking[1] / 15) * 15
  }
  const fallback = Math.min(Math.ceil(clockMinutes(after) / 15) * 15, 1425)
  return `${pad(Math.floor(fallback / 60))}:${pad(fallback % 60)}`
}
