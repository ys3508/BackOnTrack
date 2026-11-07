import {
  addClock,
  eventFromPlanned,
  minutesBetween,
} from "@/lib/calendar/model"
import {
  CalendarEventSchema,
  PlannedSessionSchema,
  RoutinePlacementSchema,
  RoutineSchema,
} from "@/lib/workspace/schemas"
import type {
  CalendarEvent,
  EventOutcome,
  EventOverride,
  Routine,
  RoutinePlacement,
  Task,
  UnmigratedRecord,
} from "@/lib/workspace/schemas"

const WEEKDAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]

type Rule = {
  days: number[]
  start: string
  firstDate: string
  until: string | undefined
  duration: number
}

/** Reads the iCal rule saved with an old routine. Null if it makes no sense. */
function readRule(rrule: string, duration: number): Rule | null {
  const start = rrule.match(/DTSTART:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/)
  const days = (rrule.match(/BYDAY=([A-Z,]+)/)?.[1].split(",") ?? [])
    .map((code) => WEEKDAY_CODES.indexOf(code))
    .filter((day) => day >= 0)
  if (!start || !days.length) return null
  const until = rrule.match(/UNTIL=(\d{4})(\d{2})(\d{2})/)
  return {
    days,
    start: `${start[4]}:${start[5]}`,
    firstDate: `${start[1]}-${start[2]}-${start[3]}`,
    until: until ? `${until[1]}-${until[2]}-${until[3]}` : undefined,
    duration,
  }
}

/** Newest first, as the rule for dates on or after it. */
function ruleFor(rules: Rule[], date: string) {
  return rules.find((rule) => rule.firstDate <= date) ?? rules[rules.length - 1]
}

function nearest(dates: string[], date: string) {
  const distance = (other: string) =>
    Math.abs(new Date(other).getTime() - new Date(date).getTime())
  return [...dates].sort((a, b) => distance(a) - distance(b))[0] as
    | string
    | undefined
}

function outcomesOf(routine: Routine, from: string, until?: string) {
  const within = (date: string) =>
    date >= from && (!until || date <= until)
  const outcomes: Record<string, EventOutcome> = {}
  const add = (dates: string[], outcome: EventOutcome) => {
    for (const date of dates) if (within(date)) outcomes[date] = outcome
  }
  add(routine.doneDates, "full")
  add(routine.minimumDates, "minimum")
  add(routine.skippedDates, "skipped")
  return outcomes
}

const placementOutcome = (item: RoutinePlacement): EventOutcome | null =>
  item.result ?? (item.done ? "full" : null)

/**
 * A routine and its one-offs as events. A rule that changed over time becomes
 * parts of one series, a moved occurrence becomes an override, and anything
 * that can't be paired stays as its own event in that series. Nothing is dropped.
 */
function migrateRoutine(
  routine: Routine,
  placements: RoutinePlacement[]
): CalendarEvent[] | null {
  const rules = [routine, ...routine.priorRules].map((rule) =>
    readRule(rule.rrule, rule.duration)
  )
  if (rules.some((rule) => !rule)) return null
  const known = (rules as Rule[]).sort((a, b) =>
    b.firstDate.localeCompare(a.firstDate)
  )
  const flexible = routine.kind === "flexible"
  const shared = {
    title: routine.name,
    taskId: null,
    kind: "event" as const,
    flexible,
    color: routine.color,
    minimum: routine.minimumVersion,
    link: "",
    notes: "",
    emoji: routine.emoji,
    label: "",
    window: null,
    createdAt: routine.createdAt,
  }
  const events: CalendarEvent[] = known.map((rule, index) => ({
    ...shared,
    // The live rule keeps the routine's id, so focus sessions still match it.
    id: index === 0 ? routine.id : `${routine.id}:${rule.firstDate}`,
    seriesId: known.length > 1 ? routine.id : null,
    date: rule.firstDate,
    start: rule.start,
    end: addClock(rule.start, Math.min(rule.duration, 1439)),
    repeat: { days: rule.days, ...(rule.until ? { until: rule.until } : {}) },
    overrides: {},
    outcomes: outcomesOf(routine, rule.firstDate, rule.until),
  }))
  const eventFor = (date: string) => {
    const rule = ruleFor(known, date)
    return events[known.indexOf(rule)]
  }

  const open = new Set(routine.exdates)
  const extras: RoutinePlacement[] = []
  const pair = (item: RoutinePlacement, key: string) => {
    open.delete(key)
    const target = eventFor(key)
    const start = item.time || target.start
    const change: EventOverride = {}
    if (item.date !== key) change.date = item.date
    if (start !== target.start) change.start = start
    const minutes = item.minutes ?? minutesBetween(target.start, target.end)
    change.end = addClock(start, minutes)
    target.overrides[key] = change
    const outcome = placementOutcome(item)
    if (outcome) target.outcomes[key] = outcome
  }
  for (const item of placements) {
    if (item.adjusted && open.has(item.date)) pair(item, item.date)
    else extras.push(item)
  }
  // A dragged occurrence didn't record where it came from, so nearest it is.
  const unpaired: RoutinePlacement[] = []
  for (const item of extras) {
    const key = item.adjusted ? nearest([...open], item.date) : undefined
    if (key) pair(item, key)
    else unpaired.push(item)
  }
  for (const key of open) {
    const target = eventFor(key)
    target.overrides[key] = { cancelled: true }
  }
  for (const item of unpaired) {
    const rule = ruleFor(known, item.date)
    const start = item.time || rule.start
    const outcome = placementOutcome(item)
    events.push({
      ...shared,
      id: item.id,
      seriesId: routine.id,
      date: item.date,
      start,
      end: addClock(start, Math.min(item.minutes ?? rule.duration, 1439)),
      flexible: !item.time,
      repeat: null,
      overrides: item.adjusted ? { [item.date]: {} } : {},
      outcomes: outcome ? { [item.date]: outcome } : {},
    })
  }
  return events
}

type Legacy = {
  planned: unknown
  routines: unknown
  routinePlacements: unknown
}

/**
 * Older saved calendar records as events, keeping their ids so timers, focus
 * sessions, and reminders that point at them still work. A record that can't be
 * read is handed back rather than lost.
 */
export function migrateCalendar(saved: Legacy, tasks: Task[]) {
  const events: CalendarEvent[] = []
  const unmigrated: UnmigratedRecord[] = []
  const keep = (source: string, record: unknown) =>
    unmigrated.push({ source, record })
  const list = (items: unknown) => (Array.isArray(items) ? items : [])

  for (const raw of list(saved.planned)) {
    const parsed = PlannedSessionSchema.safeParse(raw)
    if (!parsed.success) {
      keep("planned", raw)
      continue
    }
    const task = tasks.find((item) => item.id === parsed.data.taskId)
    const session = {
      ...parsed.data,
      minutes: Math.max(1, Math.round(parsed.data.minutes)),
    }
    events.push(eventFromPlanned(session, task?.title ?? ""))
  }

  const placements = list(saved.routinePlacements).flatMap((raw) => {
    const parsed = RoutinePlacementSchema.safeParse(raw)
    if (parsed.success) return [{ raw, item: parsed.data }]
    keep("routinePlacements", raw)
    return []
  })
  const claimed = new Set<unknown>()
  for (const raw of list(saved.routines)) {
    const parsed = RoutineSchema.safeParse(raw)
    if (!parsed.success) {
      keep("routines", raw)
      continue
    }
    const mine = placements.filter((p) => p.item.routineId === parsed.data.id)
    const migrated = migrateRoutine(
      parsed.data,
      mine.map((p) => p.item)
    )
    if (!migrated) {
      keep("routines", raw)
      continue
    }
    mine.forEach((p) => claimed.add(p.raw))
    events.push(...migrated)
  }
  // One-offs whose routine is gone or unreadable still belong to somebody.
  for (const { raw } of placements) {
    if (!claimed.has(raw)) keep("routinePlacements", raw)
  }
  return { events, unmigrated }
}

/** Reads events saved by this version, keeping any that can't be read. */
export function restoreEvents(saved: unknown) {
  const events: CalendarEvent[] = []
  const unmigrated: UnmigratedRecord[] = []
  for (const raw of Array.isArray(saved) ? saved : []) {
    const parsed = CalendarEventSchema.safeParse(raw)
    if (parsed.success) events.push(parsed.data)
    else unmigrated.push({ source: "events", record: raw })
  }
  return { events, unmigrated }
}
