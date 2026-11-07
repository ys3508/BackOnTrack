"use client"

import { useMemo } from "react"
import { ChevronDown } from "lucide-react"

import { useStore } from "@/components/workspace/store"
import { WEEKDAYS, formatDuration, heatLevel } from "@/lib/calendar/derived"
import {
  focusByDay,
  overviewOf,
  plannedByDay,
  previousPeriod,
  trackingSince,
} from "@/lib/calendar/overview"
import type {
  Overview as OverviewData,
  PeriodKind,
} from "@/lib/calendar/overview"
import { addDays, shortDate } from "@/lib/workspace/dates"
import { cn } from "@/lib/utils"

/** Charts that need a few points before they say anything real. */
const MIN_CHART_POINTS = 3

const NO_VALUE = "—"

function formatWait(minutes: number) {
  return minutes >= 2880
    ? `${Math.round(minutes / 1440)} days`
    : formatDuration(minutes)
}

const percent = (share: number) => `${Math.round(share * 100)}%`

function Tile({
  label,
  value,
  detail,
  before,
  why,
  wide,
}: {
  label: string
  value: React.ReactNode
  detail?: React.ReactNode
  /** The same figure for the period before. Only ever context, never a verdict. */
  before?: string | null
  /** Why there's nothing to show, when there isn't. */
  why?: string | null
  wide?: boolean
}) {
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>
        <span className="block font-heading text-xl leading-tight sm:text-2xl">
          {value}
        </span>
        {detail && <span className="block text-xs">{detail}</span>}
        {why && (
          <span className="block text-xs text-muted-foreground">{why}</span>
        )}
        {before && (
          <span className="block text-xs text-muted-foreground">{before}</span>
        )}
      </dd>
    </div>
  )
}

function WeekBars({ from }: { from: string }) {
  const { state, today } = useStore()
  const days = useMemo(() => {
    const until = addDays(from, 7)
    const planned = plannedByDay(state.activity, { from, until })
    const focus = focusByDay(state.activity)
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(from, index)
      return {
        date,
        planned: planned.get(date) ?? 0,
        focus: focus.get(date) ?? 0,
      }
    })
  }, [state.activity, from])
  if (!days.some((day) => day.planned > 0 || day.focus > 0)) {
    return (
      <p className="text-xs text-muted-foreground">
        {NO_VALUE} Nothing planned or focused this week yet, so there are no bars
        to draw.
      </p>
    )
  }
  const most = Math.max(60, ...days.map((day) => Math.max(day.planned, day.focus)))
  const height = (minutes: number) =>
    minutes > 0 ? `${Math.max(4, (minutes / most) * 100)}%` : "0"
  return (
    <figure>
      <figcaption className="mb-1.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span aria-hidden className="bot-bar-planned inline-block size-3" />
          Planned
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="bot-bar-focus inline-block size-3" />
          Focus
        </span>
      </figcaption>
      <ol className="grid grid-cols-7 gap-1.5">
        {days.map((day) => {
          const name = shortDate(day.date)
          const text = `${name}: ${formatDuration(day.planned)} planned, ${formatDuration(day.focus)} focus`
          return (
            <li key={day.date} className="min-w-0 text-center">
              <div
                data-testid="week-bar"
                role="img"
                tabIndex={0}
                aria-label={text}
                title={text}
                className="flex h-16 items-end justify-center gap-0.5 border-b border-line outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              >
                <span
                  className="bot-bar-planned block w-full max-w-3"
                  style={{
                    height: height(day.planned),
                    borderWidth: day.planned ? undefined : 0,
                  }}
                />
                <span
                  className="bot-bar-focus block w-full max-w-3"
                  style={{ height: height(day.focus) }}
                />
              </div>
              <span
                className={cn(
                  "text-xs",
                  day.date === today
                    ? "font-semibold"
                    : "text-muted-foreground"
                )}
              >
                {name.slice(0, 3)}
              </span>
            </li>
          )
        })}
      </ol>
    </figure>
  )
}

function HeatKey() {
  return (
    <ul
      aria-label="Focus minutes key"
      className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
    >
      {["up to 25 min", "up to 1 h", "up to 2 h", "more"].map((label, index) => (
        <li key={label} className="flex items-center gap-1">
          <span
            aria-hidden
            className={`inline-block size-3 rounded-[3px] bot-heat-swatch-${index + 1}`}
          />
          {label}
        </li>
      ))}
    </ul>
  )
}

function HeatCell({ date, minutes }: { date: string; minutes: number }) {
  const text = `${shortDate(date)}: ${minutes > 0 ? formatDuration(minutes) : "no"} focus`
  const level = heatLevel(minutes)
  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className={cn("bot-heat-cell block", level && `bot-heat-swatch-${level}`)}
    />
  )
}

const pad = (value: number) => String(value).padStart(2, "0")

function MonthHeat({ from, until }: { from: string; until: string }) {
  const { state } = useStore()
  const days = useMemo(() => focusByDay(state.activity), [state.activity])
  const dates: string[] = []
  for (let date = from; date < until; date = addDays(date, 1)) dates.push(date)
  const [year, month] = from.split("-").map(Number)
  const lead = new Date(year, month - 1, 1).getDay()
  return (
    <figure className="max-w-xs">
      <figcaption className="mb-1 text-xs text-muted-foreground">
        Focus each day
      </figcaption>
      <div className="grid grid-cols-7 gap-1" data-testid="month-heat">
        {Array.from({ length: lead }, (_, index) => (
          <span key={index} aria-hidden />
        ))}
        {dates.map((date) => (
          <HeatCell key={date} date={date} minutes={days.get(date) ?? 0} />
        ))}
      </div>
      <HeatKey />
    </figure>
  )
}

function YearHeat({ from }: { from: string }) {
  const { state } = useStore()
  const days = useMemo(() => focusByDay(state.activity), [state.activity])
  const year = Number(from.slice(0, 4))
  return (
    <figure>
      <figcaption className="mb-1 text-xs text-muted-foreground">
        Focus each day, by month
      </figcaption>
      <div data-testid="year-heat" className="space-y-0.5">
        {Array.from({ length: 12 }, (_, month) => {
          const count = new Date(year, month + 1, 0).getDate()
          const name = new Date(year, month, 1).toLocaleDateString("en-US", {
            month: "short",
          })
          return (
            <div
              key={month}
              className="grid grid-cols-[2rem_1fr] items-center gap-1 text-xs text-muted-foreground"
            >
              <span>{name}</span>
              <div
                className="grid gap-0.5"
                style={{ gridTemplateColumns: "repeat(31, minmax(0, 1fr))" }}
              >
                {Array.from({ length: count }, (_, day) => {
                  const date = `${year}-${pad(month + 1)}-${pad(day + 1)}`
                  return (
                    <HeatCell
                      key={date}
                      date={date}
                      minutes={days.get(date) ?? 0}
                    />
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
      <HeatKey />
    </figure>
  )
}

function BestHours({ data }: { data: OverviewData }) {
  const most = Math.max(1, ...data.startHours.flat())
  return (
    <figure>
      <figcaption className="mb-1 text-xs text-muted-foreground">
        Best hours to start
      </figcaption>
      <div data-testid="best-hours" className="space-y-0.5">
        {data.startHours.map((hours, day) => (
          <div
            key={day}
            className="grid grid-cols-[2rem_1fr] items-center gap-1 text-xs text-muted-foreground"
          >
            <span>{WEEKDAYS[day].label}</span>
            <div
              className="grid gap-0.5"
              style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}
            >
              {hours.map((count, hour) => {
                const text = `${WEEKDAYS[day].label}, ${hour}:00: ${count} ${count === 1 ? "start" : "starts"}`
                const level = count ? Math.ceil((count / most) * 4) : 0
                return (
                  <span
                    key={hour}
                    role="img"
                    aria-label={text}
                    title={text}
                    className={cn(
                      "bot-heat-cell block",
                      level > 0 && `bot-heat-swatch-${level}`
                    )}
                  />
                )
              })}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[2rem_1fr] gap-1 text-xs text-muted-foreground">
          <span />
          <div className="flex justify-between">
            <span>12 AM</span>
            <span>12 PM</span>
            <span>11 PM</span>
          </div>
        </div>
      </div>
    </figure>
  )
}

const PERIOD_WORD: Record<PeriodKind, string> = {
  day: "day",
  week: "week",
  month: "month",
  year: "year",
}

/** What happened in the period on screen. No targets, no scores, no streaks. */
export function Overview({
  kind,
  from,
  until,
}: {
  kind: PeriodKind
  from: string
  until: string
}) {
  const { state, dispatch } = useStore()
  const { activity, settings } = state
  const collapsed = settings.overviewCollapsed
  const range = useMemo(() => ({ from, until }), [from, until])
  const now = useMemo(() => overviewOf(activity, range), [activity, range])
  const earlier = useMemo(
    () => overviewOf(activity, previousPeriod(kind, range)),
    [activity, kind, range]
  )
  const since = trackingSince(activity)
  const word = PERIOD_WORD[kind]
  const previous = (text: string | null) =>
    text ? `Previous ${word}: ${text}` : null

  const hasStarts = now.starts >= MIN_CHART_POINTS
  const heatDays = useMemo(() => {
    let count = 0
    for (const [date, minutes] of focusByDay(activity)) {
      if (date >= from && date < until && minutes > 0) count += 1
    }
    return count
  }, [activity, from, until])

  return (
    <section aria-label="Overview" className="bot-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={() =>
            dispatch({
              type: "settings",
              patch: { overviewCollapsed: !collapsed },
            })
          }
          className="flex min-h-9 items-center gap-1.5 rounded-md font-heading text-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 transition-transform",
              collapsed && "-rotate-90"
            )}
          />
          Overview
        </button>
        <p className="text-xs text-muted-foreground">
          {since ? `Tracking since ${shortDate(since)}` : "Nothing tracked yet"}
        </p>
      </div>

      {!collapsed && (
        <div className="mt-3 space-y-4">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile
              label="Focus time"
              value={
                now.focusSessions
                  ? formatDuration(now.focusMinutes)
                  : NO_VALUE
              }
              why={
                now.focusSessions
                  ? null
                  : `No focus sessions this ${word} yet.`
              }
              before={previous(
                earlier.focusSessions
                  ? formatDuration(earlier.focusMinutes)
                  : null
              )}
            />
            <Tile
              label="Planned vs done"
              value={
                now.plannedMinutes
                  ? `${formatDuration(now.plannedMinutes)} / ${formatDuration(now.doneMinutes)}`
                  : NO_VALUE
              }
              why={
                now.plannedMinutes
                  ? null
                  : `Nothing planned this ${word}. Buffers don’t count.`
              }
              before={previous(
                earlier.plannedMinutes
                  ? `${formatDuration(earlier.plannedMinutes)} / ${formatDuration(earlier.doneMinutes)}`
                  : null
              )}
            />
            <Tile
              label="Start delay"
              value={
                now.startDelay
                  ? `${formatDuration(now.startDelay.median)}`
                  : NO_VALUE
              }
              detail={
                now.startDelay &&
                `${percent(now.startDelay.within10)} within 10 min`
              }
              why={
                now.startDelay
                  ? null
                  : `No planned block was started this ${word}.`
              }
              before={previous(
                earlier.startDelay
                  ? formatDuration(earlier.startDelay.median)
                  : null
              )}
            />
            <Tile
              label="Time to first start"
              value={now.firstStart ? formatWait(now.firstStart.median) : NO_VALUE}
              why={
                now.firstStart ? null : `No new task was first started this ${word}.`
              }
              before={previous(
                earlier.firstStart ? formatWait(earlier.firstStart.median) : null
              )}
            />
            <Tile
              label="Comebacks"
              value={now.comebacks || now.recovery ? now.comebacks : NO_VALUE}
              detail={
                now.recovery &&
                `Recovery-to-Action ${percent(now.recovery.acted / now.recovery.shown)}`
              }
              why={
                now.comebacks || now.recovery
                  ? null
                  : `Recovery didn’t come up this ${word}.`
              }
              before={previous(
                earlier.comebacks || earlier.recovery
                  ? String(earlier.comebacks)
                  : null
              )}
            />
            <Tile
              label="Buffers used / created"
              value={
                now.buffers.used || now.buffers.created
                  ? `${now.buffers.used} / ${now.buffers.created}`
                  : NO_VALUE
              }
              why={
                now.buffers.used || now.buffers.created
                  ? null
                  : `No buffers this ${word}.`
              }
              before={previous(
                earlier.buffers.used || earlier.buffers.created
                  ? `${earlier.buffers.used} / ${earlier.buffers.created}`
                  : null
              )}
            />
            <Tile
              label="Tasks completed / reduced / released"
              value={
                now.tasks.completed || now.tasks.reduced || now.tasks.released
                  ? `${now.tasks.completed} / ${now.tasks.reduced} / ${now.tasks.released}`
                  : NO_VALUE
              }
              why={
                now.tasks.completed || now.tasks.reduced || now.tasks.released
                  ? null
                  : `No task reached an end this ${word}.`
              }
              before={previous(
                earlier.tasks.completed ||
                  earlier.tasks.reduced ||
                  earlier.tasks.released
                  ? `${earlier.tasks.completed} / ${earlier.tasks.reduced} / ${earlier.tasks.released}`
                  : null
              )}
            />
            <Tile
              label="Routines"
              value={now.routines.length ? "" : NO_VALUE}
              detail={
                now.routines.length > 0 && (
                  <span className="block space-y-0.5">
                    {now.routines.map((row) => (
                      <span key={row.series} className="block break-words">
                        {row.title}: ● {row.full} ◐ {row.minimum} · skipped{" "}
                        {row.skipped}
                      </span>
                    ))}
                  </span>
                )
              }
              why={
                now.routines.length ? null : `No routine marked this ${word}.`
              }
              before={previous(
                earlier.routines.length
                  ? `${earlier.routines.reduce((sum, row) => sum + row.full, 0)} full, ${earlier.routines.reduce((sum, row) => sum + row.minimum, 0)} minimum, ${earlier.routines.reduce((sum, row) => sum + row.skipped, 0)} skipped`
                  : null
              )}
            />
            <Tile
              label="Stuck reasons"
              value={now.stuck.length ? "" : NO_VALUE}
              detail={
                now.stuck.length > 0 && (
                  <span className="block space-y-0.5">
                    {now.stuck.map((row) => (
                      <span key={row.label} className="block break-words">
                        {row.label}: {row.count}
                      </span>
                    ))}
                  </span>
                )
              }
              why={now.stuck.length ? null : `No reasons given this ${word}.`}
              before={previous(
                earlier.stuck.length
                  ? String(
                      earlier.stuck.reduce((sum, row) => sum + row.count, 0)
                    )
                  : null
              )}
              wide
            />
          </dl>

          {kind === "week" && <WeekBars from={from} />}

          {(kind === "month" || kind === "year") && (
            <div className="grid gap-4 md:grid-cols-2">
              {heatDays >= MIN_CHART_POINTS ? (
                kind === "month" ? (
                  <MonthHeat from={from} until={until} />
                ) : (
                  <YearHeat from={from} />
                )
              ) : (
                <p className="text-xs text-muted-foreground">
                  {NO_VALUE} The heatmap needs focus on at least{" "}
                  {MIN_CHART_POINTS} days this {word}.
                </p>
              )}
              {hasStarts ? (
                <BestHours data={now} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {NO_VALUE} Best hours need at least {MIN_CHART_POINTS} starts
                  this {word}.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
