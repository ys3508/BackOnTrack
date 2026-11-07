"use client"

import { useCallback, useEffect, useState } from "react"
import { CalendarDays, ChevronRight } from "lucide-react"

import { BlockPopover } from "@/components/workspace/calendar-overlays"
import type { BlockRef } from "@/components/workspace/calendar-overlays"
import { BlockContent } from "@/components/workspace/calendar-block"
import { ReplanDialog } from "@/components/workspace/schedule"
import { useStore } from "@/components/workspace/store"
import { formatClockTime } from "@/lib/calendar/derived"
import { taskColorVars } from "@/lib/calendar/task-colors"
import { buffersFor } from "@/lib/today/buffer"
import {
  agendaColumns,
  agendaHours,
  hasScheduleToday,
  todayAgenda,
} from "@/lib/today/timeline"
import type { AgendaItem } from "@/lib/today/timeline"
import type { Task } from "@/lib/workspace/schemas"

const HOUR_PX = 68
const RAIL = "3.75rem"

function eventOf(item: AgendaItem, untimed: boolean) {
  return {
    title: item.title,
    start: item.start,
    end: item.end,
    allDay: untimed,
    extendedProps: {
      kind: item.kind,
      refId: item.refId,
      taskId: item.taskId,
      awaitingAnswer: item.awaitingAnswer,
      timed: !untimed,
      adjusted: item.adjusted,
      window: item.window,
    },
  }
}

export function TodayTimeline() {
  const { state, today, navigate } = useStore()
  const [now, setNow] = useState(() => Date.now())
  const [opened, setOpened] = useState<{
    block: BlockRef
    element: Element
  } | null>(null)
  const [replanning, setReplanning] = useState<Task | null>(null)
  const [expanded, setExpanded] = useState(false)
  const close = useCallback(() => setOpened(null), [])
  const element = opened?.element ?? null
  const anchor = useCallback(() => element, [element])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const { timed, untimed } = todayAgenda(state, today, now)
  const scheduled = hasScheduleToday(state, today, now)

  if (!scheduled && !expanded) {
    return (
      <section
        aria-labelledby="timeline-heading"
        className="bot-card bot-rise relative min-w-0 overflow-hidden p-5"
      >
        <h2 id="timeline-heading" className="sr-only">
          Today’s timeline
        </h2>
        <div aria-hidden className="mb-3 space-y-2">
          <div className="bot-ghost-block h-10 w-3/4" />
          <div className="bot-ghost-block ml-8 h-14 w-2/3" />
          <div className="bot-ghost-block ml-3 h-9 w-1/2" />
        </div>
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          style={{ "--tile": "var(--glass-strong)" } as React.CSSProperties}
          className="bot-tile w-full"
        >
          <span className="bot-tile-glyph">
            <CalendarDays className="size-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            Nothing scheduled today · plan a block
          </span>
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        </button>
      </section>
    )
  }

  const clock = new Date(now)
  const hours = agendaHours(timed, clock)
  const top = (date: Date) =>
    ((date.getHours() + date.getMinutes() / 60 - hours.first) * HOUR_PX) | 0
  const height = (hours.last - hours.first) * HOUR_PX
  const columns = agendaColumns(timed)
  const nowTop = top(clock)
  const buffers = buffersFor(state.settings).flatMap((buffer) => {
    const start = new Date(`${today}T${buffer.time}:00`)
    const startAt = top(start)
    return startAt >= 0 && startAt < height
      ? [{ time: buffer.time, top: startAt, minutes: buffer.minutes }]
      : []
  })

  const open = (item: AgendaItem, target: Element, untimedItem: boolean) =>
    setOpened({
      element: target,
      block: {
        kind: item.kind,
        refId: item.refId,
        taskId: item.taskId,
        title: item.title,
        date: today,
        start: item.start,
        end: untimedItem ? null : item.end,
      },
    })

  const itemStyle = (item: AgendaItem) =>
    ({
      ...taskColorVars(
        item.taskId,
        state.tasks.find((task) => task.id === item.taskId)?.focusTheme
      ),
      ...(item.color ? { "--routine": item.color } : {}),
    }) as React.CSSProperties

  return (
    <section
      aria-labelledby="timeline-heading"
      className="bot-card bot-rise min-w-0 p-4 sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="timeline-heading" className="font-heading text-[2.25rem] leading-none">
          Today’s timeline
        </h2>
        <button
          type="button"
          onClick={() => navigate({ view: "calendar" })}
          className="bot-press inline-flex min-h-10 items-center gap-1.5 rounded-2xl bg-card px-3 text-sm font-semibold outline-none"
        >
          <CalendarDays className="size-4" aria-hidden />
          Full Calendar
        </button>
      </div>

      {untimed.length > 0 && (
        <ul aria-label="Any time today" className="mb-3 flex flex-wrap gap-1.5">
          {untimed.map((item) => (
            <li
              key={item.key}
              data-kind={item.kind}
              data-block-id={item.refId}
              style={itemStyle(item)}
              className="bot-any-chip"
            >
              <button
                type="button"
                aria-label={`Open ${item.title}`}
                className="bot-tl-open"
                onClick={(event) => open(item, event.currentTarget, true)}
              />
              <BlockContent
                event={eventOf(item, true)}
                viewType="timeGridDay"
              />
            </li>
          ))}
        </ul>
      )}

      <div className="relative" style={{ height }}>
        {Array.from({ length: hours.last - hours.first + 1 }, (_, index) => {
          const hour = hours.first + index
          return (
            <div
              key={hour}
              aria-hidden
              className="bot-tl-hour"
              style={{ top: index * HOUR_PX }}
            >
              {hour < 24 && (
                <span>
                  {formatClockTime(new Date(`${today}T${String(hour).padStart(2, "0")}:00:00`))}
                </span>
              )}
            </div>
          )
        })}

        {buffers.map((buffer) => (
          <div
            key={buffer.time}
            className="bot-tl-buffer px-3 py-1 text-[0.6875rem]"
            style={{
              top: buffer.top,
              height: Math.min(
                (buffer.minutes / 60) * HOUR_PX,
                height - buffer.top
              ),
            }}
          >
            Buffer
          </div>
        ))}

        {timed.map((item, index) => {
          const place = columns.get(item.key)!
          const minutes = (item.end.getTime() - item.start.getTime()) / 60_000
          const startAt = top(item.start)
          const width = `calc((100% - ${RAIL}) / ${place.columns} - 4px)`
          return (
            <div
              key={item.key}
              data-state={item.state}
              data-block-id={item.refId}
              data-date={today}
              className="bot-tl-block"
              style={{
                ...itemStyle(item),
                top: startAt,
                height: Math.min(
                  Math.max((minutes / 60) * HOUR_PX - 3, 38),
                  height - startAt
                ),
                width,
                left: `calc(${RAIL} + (100% - ${RAIL}) / ${place.columns} * ${place.column})`,
                animationDelay: `${Math.min(index, 8) * 40}ms`,
              }}
            >
              <button
                type="button"
                aria-label={`Open ${item.title}`}
                className="bot-tl-open"
                onClick={(event) =>
                  open(item, event.currentTarget.parentElement!, false)
                }
              />
              <BlockContent
                event={eventOf(item, false)}
                viewType="timeGridDay"
              />
            </div>
          )
        })}

        {nowTop >= 0 && nowTop <= height && (
          <div aria-hidden className="bot-tl-now" style={{ top: nowTop }} />
        )}
      </div>

      {opened && (
        <BlockPopover
          key={`${opened.block.refId}-${opened.block.date}`}
          block={opened.block}
          anchor={anchor}
          onClose={close}
          onChangeDeadline={(taskId) =>
            setReplanning(
              state.tasks.find((task) => task.id === taskId) ?? null
            )
          }
          onOpenRoutine={() => navigate({ view: "routines" })}
        />
      )}
      <ReplanDialog task={replanning} onClose={() => setReplanning(null)} />
    </section>
  )
}
