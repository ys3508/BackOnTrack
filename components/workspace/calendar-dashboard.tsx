"use client"

import { useStore } from "@/components/workspace/store"
import {
  formatClockTime,
  formatDuration,
  formatTimeRange,
  rangeStats,
  sessionsFrom,
} from "@/lib/calendar/derived"
import type { CalendarSession } from "@/lib/calendar/derived"
import { addDays, shortDate } from "@/lib/workspace/dates"
import { cn } from "@/lib/utils"

const describe = (session: CalendarSession) =>
  `${session.kind === "planned" ? "Planned" : "Focus"}: ${session.title}, ${formatDuration(session.minutes)}, ${formatTimeRange(session.start, session.end)}`

/** The same two looks as the calendar: dashed for planned, solid for focus. */
const KIND_STYLE = {
  planned: "border border-dashed border-sage bg-sage-soft",
  actual: "bg-primary",
}

/** Hover or keyboard focus shows the details. A title alone wouldn't reach keys. */
function Segment({
  session,
  style,
  className,
}: {
  session: CalendarSession
  style: React.CSSProperties
  className: string
}) {
  return (
    <span
      tabIndex={0}
      role="img"
      aria-label={describe(session)}
      data-kind={session.kind}
      style={style}
      className={cn(
        "group outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        KIND_STYLE[session.kind],
        session.outcome === "didnt" && "opacity-50",
        className
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max max-w-56 -translate-x-1/2 rounded-lg bg-foreground px-2 py-1 text-xs text-background group-hover:block group-focus-visible:block"
      >
        <span className="block font-medium break-words">{session.title}</span>
        {formatDuration(session.minutes)} ·{" "}
        {formatTimeRange(session.start, session.end)}
      </span>
    </span>
  )
}

const hoursOf = (date: Date) => date.getHours() + date.getMinutes() / 60

function DayStrip({
  sessions,
  first,
  last,
}: {
  sessions: CalendarSession[]
  first: number
  last: number
}) {
  const span = Math.max(1, last - first)
  const label = (hour: number) =>
    formatClockTime(new Date(2000, 0, 1, hour % 24))
  return (
    <div>
      <div
        data-testid="day-strip"
        className="relative h-5 rounded-md bg-secondary"
      >
        {sessions.map((session) => {
          const left = ((hoursOf(session.start) - first) / span) * 100
          const width =
            ((session.end.getTime() - session.start.getTime()) /
              3_600_000 /
              span) *
            100
          return (
            <Segment
              key={session.id}
              session={session}
              className={cn(
                "absolute min-w-1 rounded-sm",
                // Focus sits on top, so it shows where the two overlap.
                session.kind === "actual" ? "inset-y-0 z-1" : "inset-y-0.5"
              )}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          )
        })}
      </div>
      <div className="mt-0.5 flex justify-between text-xs text-muted-foreground">
        <span>{label(first)}</span>
        <span>{label(last)}</span>
      </div>
    </div>
  )
}

function WeekBars({ from }: { from: string }) {
  const { state, today } = useStore()
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(from, index)
    return { date, ...rangeStats(state, date, addDays(date, 1)) }
  })
  const most = Math.max(60, ...days.map((day) => day.focusMinutes))
  return (
    <ol className="grid grid-cols-7 gap-1.5" aria-label="Focus time each day">
      {days.map((day) => (
        <li key={day.date} className="flex flex-col items-center gap-1">
          <div
            data-testid="week-bar"
            className="flex h-14 w-full max-w-10 flex-col-reverse gap-px rounded-md bg-secondary"
          >
            {day.actual.map((session) => (
              <Segment
                key={session.id}
                session={session}
                className="relative block w-full first:rounded-b-md last:rounded-t-md"
                style={{ height: `${(session.minutes / most) * 100}%` }}
              />
            ))}
          </div>
          <span
            className={cn(
              "text-xs",
              day.date === today ? "font-semibold" : "text-muted-foreground"
            )}
          >
            {shortDate(day.date).slice(0, 3)}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function CalendarDashboard({
  from,
  until,
  week,
  hours,
}: {
  from: string
  until: string
  week: boolean
  hours: { first: number; last: number }
}) {
  const { state } = useStore()
  const stats = rangeStats(state, from, until)
  const figures = [
    { label: "Focus time", value: formatDuration(stats.focusMinutes) },
    { label: "Tasks completed", value: String(stats.tasksCompleted) },
    { label: "Time planned", value: formatDuration(stats.plannedMinutes) },
  ]
  // Planned time that became focus is drawn once, as the focus it turned into.
  const onStrip = sessionsFrom(state).filter(
    (item) =>
      item.timed &&
      item.date >= from &&
      item.date < until &&
      !(item.kind === "planned" && item.outcome === "did")
  )
  // Nothing to report isn't worth a panel full of zeros.
  if (
    !onStrip.length &&
    stats.focusMinutes < 1 &&
    !stats.tasksCompleted &&
    !stats.plannedMinutes
  ) {
    return (
      <p
        role="region"
        aria-label={week ? "This week at a glance" : "This day at a glance"}
        className="text-sm text-muted-foreground"
      >
        Nothing recorded yet {week ? "this week" : "today"}.
      </p>
    )
  }
  return (
    <section
      aria-label={week ? "This week at a glance" : "This day at a glance"}
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
    >
      <dl className="grid grid-cols-3 gap-2">
        {figures.map((figure) => (
          <div key={figure.label}>
            <dt className="text-xs text-muted-foreground">{figure.label}</dt>
            <dd className="font-heading text-lg sm:text-2xl">{figure.value}</dd>
          </div>
        ))}
      </dl>
      {week ? (
        <WeekBars from={from} />
      ) : (
        <DayStrip sessions={onStrip} first={hours.first} last={hours.last} />
      )}
    </section>
  )
}
