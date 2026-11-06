"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, ChevronRight } from "lucide-react"
import interactionPlugin from "@fullcalendar/interaction"
import FullCalendar from "@fullcalendar/react"
import rrulePlugin from "@fullcalendar/rrule"
import timeGridPlugin from "@fullcalendar/timegrid"
import type { EventClickArg } from "@fullcalendar/core"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { BlockPopover } from "@/components/workspace/calendar-overlays"
import type { BlockRef } from "@/components/workspace/calendar-overlays"
import { NotStartedTray } from "@/components/workspace/calendar-sidebar"
import { useNow } from "@/components/workspace/focus-view"
import { NowCard } from "@/components/workspace/now-card"
import { DeadlineChip, ExpandableList } from "@/components/workspace/parts"
import { QuickCapture } from "@/components/workspace/quick-capture"
import { ReturnView } from "@/components/workspace/return-view"
import { ReplanDialog } from "@/components/workspace/schedule"
import { nowIso, useStore } from "@/components/workspace/store"
import { useCalendarEvents } from "@/components/workspace/use-calendar-events"
import {
  formatClockTime,
  formatDuration,
  occurrenceOutcome,
  rangeStats,
  routineOccursOn,
  routineTime,
  trayItems,
} from "@/lib/calendar/derived"
import type { CalendarItemKind } from "@/lib/calendar/events"
import { caseContext, demoSmaller } from "@/lib/recovery/case-engine"
import {
  HEAVY_DAY_MINUTES,
  nowState,
  plannedMinutesOn,
  restartsOn,
  splitTasks,
} from "@/lib/today/now"
import {
  blocksOutsideWindow,
  hasScheduleToday,
  timelineWindow,
} from "@/lib/today/timeline"
import { addDays, formatDateTime, localToday } from "@/lib/workspace/dates"
import { returnSummary } from "@/lib/workspace/returning"
import { isActive } from "@/lib/workspace/schemas"
import type { Task } from "@/lib/workspace/schemas"
import { cn } from "@/lib/utils"

const sectionTitle = "font-sans text-[15px] font-semibold tracking-normal"
const linkButton =
  "min-h-11 rounded-md text-sm font-medium text-indigo underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"

const pad = (value: number) => String(value).padStart(2, "0")

function TodayTimeline() {
  const { state, today, navigate } = useStore()
  const { events, eventClasses, eventContent, eventDidMount } =
    useCalendarEvents()
  const [hour, setHour] = useState(() => new Date().getHours())
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
    const id = window.setInterval(() => setHour(new Date().getHours()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  function open(info: EventClickArg) {
    if ((info.jsEvent.target as Element).closest?.("[data-block-action]")) {
      return
    }
    const { kind, refId, taskId } = info.event.extendedProps as {
      kind: BlockRef["kind"] | Extract<CalendarItemKind, "pending" | "buffer">
      refId: string
      taskId: string | null
    }
    if (kind === "pending" || kind === "buffer") return
    const { start, end } = info.event
    info.jsEvent.preventDefault()
    setOpened({
      element: info.el,
      block: {
        kind,
        refId,
        taskId,
        title: info.event.title,
        date: start ? localToday(start) : today,
        start,
        end,
      },
    })
  }

  const clock = new Date(`${today}T${pad(hour)}:00:00`)
  const hours = timelineWindow(clock)
  const scheduled = hasScheduleToday(state, today, clock.getTime())
  const elsewhere = blocksOutsideWindow(state, today, hours)

  if (!scheduled && !expanded) {
    return (
      <section aria-labelledby="timeline-heading" className="min-w-0">
        <h2 id="timeline-heading" className="sr-only">
          Today’s timeline
        </h2>
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setExpanded(true)}
          className="flex min-h-11 w-full items-center gap-1 rounded-xl border border-border bg-card px-3.5 py-2 text-left text-sm text-muted-foreground outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <span className="min-w-0 flex-1">
            Nothing scheduled today · plan a block
          </span>
          <ChevronRight className="size-4 shrink-0" aria-hidden />
        </button>
      </section>
    )
  }

  return (
    <section aria-labelledby="timeline-heading" className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="timeline-heading" className={sectionTitle}>
          Today’s timeline
        </h2>
        <button
          type="button"
          className={linkButton}
          onClick={() => navigate({ view: "calendar" })}
        >
          {elsewhere > 0
            ? `${elsewhere} more today · full Calendar`
            : "Full Calendar"}
        </button>
      </div>
      <Card className="p-2 sm:p-3">
        <FullCalendar
          plugins={[timeGridPlugin, interactionPlugin, rrulePlugin]}
          initialView="timeGridDay"
          headerToolbar={false}
          dayHeaders={false}
          height="auto"
          allDayText=""
          nowIndicator
          slotMinTime={`${pad(hours.first)}:00:00`}
          slotMaxTime={`${pad(hours.last)}:00:00`}
          slotLabelContent={(arg) => formatClockTime(arg.date)}
          eventInteractive
          eventDisplay="block"
          editable={false}
          events={events}
          eventContent={eventContent}
          eventClassNames={eventClasses}
          eventDidMount={eventDidMount}
          eventClick={open}
        />
      </Card>
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

function TaskLine({ task }: { task: Task }) {
  const { dispatch, navigate } = useStore()
  return (
    <li className="flex items-start gap-2 rounded-xl border border-border bg-card px-2 py-1.5">
      <button
        type="button"
        aria-label={`Mark ${task.title} complete`}
        onClick={() =>
          dispatch({
            type: "set-status",
            id: task.id,
            at: nowIso(),
            status: "completed",
          })
        }
        className="group grid size-9 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <span
          aria-hidden
          className="grid size-6 place-items-center rounded-full border border-input group-hover:border-primary/60"
        >
          <Check className="size-3.5 opacity-0 group-hover:opacity-40" />
        </span>
      </button>
      <button
        type="button"
        onClick={() => navigate({ view: "task", id: task.id })}
        className="min-h-9 min-w-0 flex-1 rounded-md py-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <span className="block text-sm font-medium break-words">
          {task.title}
        </span>
        <DeadlineChip task={task} />
      </button>
    </li>
  )
}

function RoutinesToday() {
  const { state, dispatch, today } = useStore()
  const regular = state.routines
    .filter((routine) => routineOccursOn(routine, today))
    .map((routine) => ({
      id: routine.id,
      routineId: routine.id,
      placementId: null as string | null,
      title: `${routine.emoji} ${routine.name}`.trim(),
      time: routine.kind === "flexible" ? "" : routineTime(routine),
      minimum: routine.minimumVersion,
      outcome: occurrenceOutcome(routine, today),
    }))
  const placed = state.routinePlacements.flatMap((item) => {
    const routine = state.routines.find((r) => r.id === item.routineId)
    return routine && item.date === today
      ? [
          {
            id: item.id,
            routineId: routine.id,
            placementId: item.id as string | null,
            title: `${routine.emoji} ${routine.name}`.trim(),
            time: item.time,
            minimum: routine.minimumVersion,
            outcome: item.result ?? (item.done ? "full" : null),
          },
        ]
      : []
  })
  const items = [...regular, ...placed].sort((a, b) =>
    a.time.localeCompare(b.time)
  )
  if (!items.length) return null
  return (
    <section aria-labelledby="routines-today">
      <h2 id="routines-today" className={cn(sectionTitle, "mb-2")}>
        Routines today
      </h2>
      <ul className="space-y-2">
        {items.map((item) => {
          const set = (outcome: "full" | "minimum" | "skipped") =>
            dispatch({
              type: "routine-outcome",
              routineId: item.routineId,
              date: today,
              placementId: item.placementId,
              outcome: item.outcome === outcome ? null : outcome,
            })
          const chip = (active: boolean) =>
            cn(
              "min-h-9 rounded-full border px-2.5 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
              active
                ? "border-primary bg-sage-soft font-medium"
                : "border-border bg-card"
            )
          return (
            <li key={item.id} className="text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 font-medium break-words">
                  {item.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.time
                    ? formatClockTime(new Date(`2000-01-15T${item.time}:00`))
                    : "Any time"}
                </span>
              </div>
              {item.minimum && (
                <p className="text-xs text-muted-foreground">
                  Minimum: {item.minimum}
                </p>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                <button
                  type="button"
                  aria-pressed={item.outcome === "full"}
                  aria-label={`Done in full: ${item.title}`}
                  onClick={() => set("full")}
                  className={chip(item.outcome === "full")}
                >
                  ● Full
                </button>
                <button
                  type="button"
                  aria-pressed={item.outcome === "minimum"}
                  aria-label={`Minimum version: ${item.title}`}
                  onClick={() => set("minimum")}
                  className={chip(item.outcome === "minimum")}
                >
                  ◐ Minimum
                </button>
                <button
                  type="button"
                  aria-pressed={item.outcome === "skipped"}
                  aria-label={`Skip: ${item.title}`}
                  onClick={() => set("skipped")}
                  className={chip(item.outcome === "skipped")}
                >
                  Skip
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ParkedThoughts() {
  const { state, dispatch } = useStore()
  if (!state.parkingLot.length) return null
  return (
    <details>
      <summary className={cn(sectionTitle, "min-h-11 cursor-pointer py-2")}>
        Parked thoughts ({state.parkingLot.length})
      </summary>
      <ul className="space-y-1 text-sm">
        {[...state.parkingLot].reverse().map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            <span className="min-w-0 flex-1 break-words">
              {item.text}
              <span className="block text-xs text-muted-foreground">
                {formatDateTime(item.at)}
              </span>
            </span>
            <button
              type="button"
              aria-label={`Clear: ${item.text}`}
              onClick={() => dispatch({ type: "remove-thought", id: item.id })}
              className="min-h-9 rounded-md px-1 text-xs font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              Clear
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

function TodayColumn() {
  const { state, dispatch, today, navigate } = useStore()
  const avoid = () => {
    dispatch({
      type: "enter-recovery",
      at: nowIso(),
      taskId: null,
      source: "avoidance",
    })
    window.scrollTo?.({ top: 0 })
  }
  const [replanning, setReplanning] = useState<Task | null>(null)
  const [heavyHidden, setHeavyHidden] = useState(false)
  const lists = splitTasks(state, today)
  const planned = plannedMinutesOn(state, today)
  const notStarted = trayItems(state, today).length
  const now = useNow(true)
  const nowKind = nowState(state, today, now).kind
  // The Now card already has this among its actions, so it isn't said twice.
  const cardOffersAvoiding = nowKind === "suggested" || nowKind === "upcoming"
  return (
    <aside aria-label="Today’s items" className="min-w-0 space-y-5">
      <section aria-labelledby="tasks-today" className="space-y-2">
        <h2 id="tasks-today" className={sectionTitle}>
          Today’s tasks
        </h2>
        <QuickCapture />
        <ExpandableList
          items={lists.today}
          limit={state.settings.homeListSize}
          label="tasks"
          render={(task) => <TaskLine key={task.id} task={task} />}
        />
        {lists.later.length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-muted-foreground">
              Other open tasks ({lists.later.length})
            </summary>
            <ExpandableList
              items={lists.later}
              limit={state.settings.homeListSize}
              label="tasks"
              render={(task) => <TaskLine key={task.id} task={task} />}
            />
          </details>
        )}
        {planned > HEAVY_DAY_MINUTES && !heavyHidden && (
          <p className="rounded-xl bg-secondary p-3 text-sm">
            That’s {formatDuration(planned)} planned today. You could move
            something, if that feels like a lot.{" "}
            <button
              type="button"
              onClick={() => setHeavyHidden(true)}
              className="font-medium text-indigo underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              It’s fine
            </button>
          </p>
        )}
      </section>

      <RoutinesToday />

      {notStarted > 0 && (
        <details>
          <summary className={cn(sectionTitle, "min-h-11 cursor-pointer py-2")}>
            Not started yet ({notStarted})
          </summary>
          <NotStartedTray
            hideHeading
            onSchedule={(taskId) =>
              setReplanning(
                state.tasks.find((task) => task.id === taskId) ?? null
              )
            }
          />
        </details>
      )}

      <ParkedThoughts />

      <nav aria-label="More" className="flex flex-wrap gap-x-4 gap-y-0">
        {!cardOffersAvoiding && (
          <button type="button" className={linkButton} onClick={avoid}>
            I’ve been avoiding something
          </button>
        )}
        <button
          type="button"
          className={linkButton}
          onClick={() => navigate({ view: "tasks" })}
        >
          All tasks
        </button>
        <button
          type="button"
          className={linkButton}
          onClick={() => navigate({ view: "focus" })}
        >
          Focus history
        </button>
      </nav>
      <ReplanDialog task={replanning} onClose={() => setReplanning(null)} />
    </aside>
  )
}

function Summary() {
  const { state, today } = useStore()
  const { focusMinutes } = rangeStats(state, today, addDays(today, 1))
  const restarts = restartsOn(state, today)
  const parts = [
    focusMinutes >= 1 && `Focused ${formatDuration(focusMinutes)}`,
    restarts > 0 &&
      `Restarted ${restarts} ${restarts === 1 ? "time" : "times"}`,
  ].filter(Boolean)
  if (!parts.length) return null
  return <p className="text-sm text-muted-foreground">{parts.join(" · ")}</p>
}

function ResumePrompt({
  task,
  onChoose,
  onDismiss,
}: {
  task: Task
  onChoose: (intent?: "smaller" | "reconsider") => void
  onDismiss: () => void
}) {
  return (
    <Card className="space-y-3">
      <p className="font-heading text-2xl leading-snug">
        Last time, you were working on {task.title}. Would you like to continue,
        make the next step smaller, or reconsider the plan?
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" size="xl" onClick={() => onChoose()}>
          Continue
        </Button>
        <Button
          type="button"
          size="xl"
          variant="outline"
          onClick={() => onChoose("smaller")}
        >
          Make the next step smaller
        </Button>
        <Button
          type="button"
          size="xl"
          variant="outline"
          onClick={() => onChoose("reconsider")}
        >
          Reconsider the plan
        </Button>
        <Button type="button" size="xl" variant="ghost" onClick={onDismiss}>
          Something else
        </Button>
      </div>
    </Card>
  )
}

export function TodayView() {
  const { state, today, returning, finishReturn, dispatch } = useStore()
  const resume = state.tasks.find(
    (task) => task.recoveryCase && isActive(task) && task.status !== "paused"
  )
  const coming = returning && !resume ? returnSummary(state, today) : null
  if (coming) return <ReturnView summary={coming} />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <ScreenHeading className="text-xl sm:text-xl">Today</ScreenHeading>
        <Summary />
      </div>

      {!state.settings.storageNoticeSeen && (
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
          Everything you enter is saved in this browser only, on this device.
          Clearing browser data deletes it, and Settings can export a copy.
          <button
            type="button"
            onClick={() =>
              dispatch({
                type: "settings",
                patch: { storageNoticeSeen: true },
              })
            }
            className="min-h-9 rounded-md font-medium text-indigo underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            Got it
          </button>
        </p>
      )}

      {returning && resume && (
        <ResumePrompt
          task={resume}
          onChoose={(intent) => {
            const at = nowIso()
            finishReturn()
            dispatch({ type: "case-resume", id: resume.id, at })
            if (intent === "reconsider") {
              dispatch({
                type: "enter-recovery",
                at,
                taskId: resume.id,
                source: "avoidance",
              })
              dispatch({ type: "recovery-reason", reason: "no-time" })
            } else if (intent === "smaller" && resume.recoveryCase?.current) {
              const plan = demoSmaller(
                caseContext(resume),
                resume.recoveryCase.current.text
              )
              dispatch({ type: "case-apply-plan", id: resume.id, at, plan })
            }
          }}
          onDismiss={finishReturn}
        />
      )}

      <section aria-label="Now">
        <NowCard
          empty={
            <Card className="space-y-3 p-6 sm:p-8">
              <h2 className="font-heading text-[1.625rem] leading-tight">
                What do you need to do?
              </h2>
              <p className="text-[15px] text-muted-foreground">
                A few words are enough. Nothing else is needed yet.
              </p>
              <QuickCapture id="now-capture" autoFocus />
            </Card>
          }
        />
      </section>

      {state.tasks.some(isActive) ||
      state.planned.length ||
      state.routines.length ? (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <TodayTimeline />
          <TodayColumn />
        </div>
      ) : (
        <nav aria-label="More" className="flex flex-wrap gap-x-4">
          <button
            type="button"
            className={linkButton}
            onClick={() =>
              dispatch({
                type: "enter-recovery",
                at: nowIso(),
                taskId: null,
                source: "avoidance",
              })
            }
          >
            I’ve been avoiding something
            <ChevronRight className="ml-0.5 inline size-3.5" aria-hidden />
          </button>
        </nav>
      )}
    </div>
  )
}
