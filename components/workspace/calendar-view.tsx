"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { Plus } from "lucide-react"
import dayGridPlugin from "@fullcalendar/daygrid"
import interactionPlugin from "@fullcalendar/interaction"
import type {
  DateClickArg,
  EventResizeDoneArg,
} from "@fullcalendar/interaction"
import type { DropArg } from "@fullcalendar/interaction"
import multiMonthPlugin from "@fullcalendar/multimonth"
import FullCalendar from "@fullcalendar/react"
import rrulePlugin from "@fullcalendar/rrule"
import timeGridPlugin from "@fullcalendar/timegrid"
import type {
  DatesSetArg,
  DayCellContentArg,
  EventClickArg,
  EventContentArg,
  EventDropArg,
  EventMountArg,
  EventInput,
} from "@fullcalendar/core"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { CalendarDashboard } from "@/components/workspace/calendar-dashboard"
import {
  BlockPopover,
  InlineCreate,
} from "@/components/workspace/calendar-overlays"
import type { BlockRef, Point } from "@/components/workspace/calendar-overlays"
import {
  MyRoutines,
  NotStartedTray,
} from "@/components/workspace/calendar-sidebar"
import { ConfirmDialog } from "@/components/workspace/parts"
import { PlanRemaining } from "@/components/workspace/plan-remaining"
import {
  PlannedSessionRow,
  ReplanDialog,
} from "@/components/workspace/schedule"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import {
  focusMinutesByDay,
  formatClockTime,
  formatDuration,
  heatLevel,
  routineTime,
} from "@/lib/calendar/derived"
import { buildCalendarItems, droppedSlot } from "@/lib/calendar/events"
import type { CalendarItemKind } from "@/lib/calendar/events"
import { addDays, localToday, shortDate } from "@/lib/workspace/dates"
import { isActive } from "@/lib/workspace/schemas"
import type { Task } from "@/lib/workspace/schemas"

const DAY_VIEW = "timeGridDay"
const WEEK_VIEW = "timeGridWeek"
const MONTH_VIEW = "dayGridMonth"
const YEAR_VIEW = "multiMonthYear"

const SESSION_MINUTES = 25

type DeadlineMove = { task: Task; date: string }

type Creating = { at: Point; date: string; time: string | null }
type Open = { block: BlockRef; at: Point }
type Shown = { type: string; from: string; until: string }

export function CalendarView() {
  const { state, dispatch, navigate, today } = useStore()
  const [selected, setSelected] = useState(today)
  const [deadlineMove, setDeadlineMove] = useState<DeadlineMove | null>(null)
  const [replanning, setReplanning] = useState<Task | null>(null)
  const [creating, setCreating] = useState<Creating | null>(null)
  const [opened, setOpened] = useState<Open | null>(null)
  const [editingRoutine, setEditingRoutine] = useState<string | null>(null)
  const [shown, setShown] = useState<Shown>({
    type: DAY_VIEW,
    from: today,
    until: addDays(today, 1),
  })
  const calendar = useRef<FullCalendar>(null)
  const surface = useRef<HTMLDivElement>(null)

  const isYear = shown.type === YEAR_VIEW
  const isTimed = shown.type === DAY_VIEW || shown.type === WEEK_VIEW
  const closeCreating = useCallback(() => setCreating(null), [])
  const closeOpened = useCallback(() => setOpened(null), [])

  const heat = useMemo(() => focusMinutesByDay(state), [state])

  const events = useMemo<EventInput[]>(() => {
    // The year shows only how focus was spread. No tasks, no blocks.
    if (isYear) return []
    const routines = state.routines.map((routine): EventInput => ({
      id: `routine:${routine.id}`,
      title: `${routine.emoji} ${routine.name}`.trim(),
      rrule: routine.rrule,
      duration: { minutes: routine.duration },
      exdate: routine.exdates.map(
        (date) => `${date}T${routineTime(routine)}:00`
      ),
      editable: true,
      durationEditable: false,
      classNames: ["bot-routine"],
      extendedProps: {
        kind: "routine",
        refId: routine.id,
        taskId: null,
        color: routine.color,
      },
    }))
    const placed = state.routinePlacements.flatMap((item): EventInput[] => {
      const routine = state.routines.find((r) => r.id === item.routineId)
      if (!routine) return []
      const start = new Date(`${item.date}T${item.time}:00`)
      return [
        {
          id: `placement:${item.id}`,
          title: `${routine.emoji} ${routine.name}`.trim(),
          start,
          end: new Date(start.getTime() + routine.duration * 60_000),
          editable: true,
          durationEditable: false,
          classNames: ["bot-routine"],
          extendedProps: {
            kind: "routine-placement",
            refId: item.id,
            taskId: null,
            color: routine.color,
          },
        },
      ]
    })
    return [...buildCalendarItems(state, today), ...routines, ...placed]
  }, [state, today, isYear])

  const dueOnDay = state.tasks.filter((task) => task.deadline === selected)
  const plannedOnDay = state.planned.filter((item) => item.date === selected)

  const selectedDay = useCallback(
    (date: Date) => (localToday(date) === selected ? ["bot-selected-day"] : []),
    [selected]
  )

  /** Where to float something, relative to the calendar's own box. */
  function pointFrom(clientX: number, clientY: number): Point {
    const box = surface.current?.getBoundingClientRect()
    return {
      x: clientX - (box?.left ?? 0),
      y: clientY - (box?.top ?? 0) + 4,
    }
  }

  function handleDateClick(info: DateClickArg) {
    const date = info.dateStr.slice(0, 10)
    setSelected(date)
    setOpened(null)
    if (shown.type === YEAR_VIEW) {
      calendar.current?.getApi().changeView(DAY_VIEW, date)
      return
    }
    const { clientX, clientY } = info.jsEvent
    setCreating({
      at: pointFrom(clientX, clientY),
      date,
      time: info.allDay ? null : info.dateStr.slice(11, 16),
    })
  }

  function createFromTitle(title: string) {
    if (!creating) return
    const at = nowIso()
    const { date, time } = creating
    if (shown.type === MONTH_VIEW) {
      dispatch({ type: "create-task", id: newId(), at, title, deadline: date })
    } else {
      // A title matching an open task sets aside time for it, not a duplicate.
      const existing = state.tasks.find(
        (task) =>
          isActive(task) && task.title.toLowerCase() === title.toLowerCase()
      )
      const taskId = existing?.id ?? newId()
      if (!existing) dispatch({ type: "create-task", id: taskId, at, title })
      dispatch({
        type: "add-planned",
        at,
        session: {
          id: newId(),
          taskId,
          date,
          time,
          minutes: SESSION_MINUTES,
          label: "",
          done: false,
        },
      })
    }
    setCreating(null)
  }

  function handleEventClick(info: EventClickArg) {
    const { kind, refId, taskId } = info.event.extendedProps as {
      kind: CalendarItemKind
      refId: string
      taskId: string | null
    }
    const start = info.event.start
    info.jsEvent.preventDefault()
    setCreating(null)
    const box = info.el.getBoundingClientRect()
    setOpened({
      at: pointFrom(box.left, box.bottom),
      block: {
        kind,
        refId,
        taskId,
        title: info.event.title,
        date: start ? localToday(start) : selected,
      },
    })
  }

  function handleEventDrop(info: EventDropArg) {
    const kind = info.event.extendedProps.kind as CalendarItemKind
    const refId = info.event.extendedProps.refId as string
    const start = info.event.start
    if (!start) return info.revert()
    const slot = droppedSlot(start, info.event.allDay)

    if (kind === "planned") {
      dispatch({
        type: "move-planned",
        at: nowIso(),
        id: refId,
        date: slot.date,
        time: slot.time,
      })
      return
    }
    // The calendar would move the whole series, so it snaps back first.
    info.revert()
    if (kind === "routine") {
      const routine = state.routines.find((item) => item.id === refId)
      const from = info.oldEvent.start
      if (!routine || !from) return
      dispatch({
        type: "move-routine-occurrence",
        routineId: refId,
        fromDate: localToday(from),
        placement: {
          id: newId(),
          routineId: refId,
          date: slot.date,
          time: slot.time ?? routineTime(routine),
          done: routine.doneDates.includes(localToday(from)),
        },
      })
      return
    }
    if (kind === "routine-placement") {
      const placement = state.routinePlacements.find((i) => i.id === refId)
      if (!placement) return
      dispatch({
        type: "move-placement",
        id: refId,
        date: slot.date,
        time: slot.time ?? placement.time,
      })
      return
    }
    // A deadline never moves without a decision, so it snaps back and asks.
    const task = state.tasks.find((item) => item.id === refId)
    if (kind === "deadline" && task) {
      setDeadlineMove({ task, date: slot.date })
    }
  }

  function handleEventResize(info: EventResizeDoneArg) {
    const { start, end } = info.event
    if (info.event.extendedProps.kind !== "planned" || !start || !end) {
      return info.revert()
    }
    dispatch({
      type: "resize-planned",
      at: nowIso(),
      id: info.event.extendedProps.refId as string,
      minutes: (end.getTime() - start.getTime()) / 60_000,
    })
  }

  /** Something dragged in from the tray or from My routines. */
  function handleDrop(info: DropArg) {
    const slot = droppedSlot(info.date, info.allDay)
    const kind = info.draggedEl.getAttribute("data-kind")
    const id = info.draggedEl.getAttribute("data-id")
    if (!id) return
    if (kind === "task") {
      dispatch({
        type: "add-planned",
        at: nowIso(),
        session: {
          id: newId(),
          taskId: id,
          date: slot.date,
          time: slot.time,
          minutes: SESSION_MINUTES,
          label: "",
          done: false,
        },
      })
    }
    if (kind === "routine") {
      const routine = state.routines.find((item) => item.id === id)
      if (!routine) return
      dispatch({
        type: "place-routine",
        placement: {
          id: newId(),
          routineId: id,
          date: slot.date,
          time: slot.time ?? routineTime(routine),
          done: false,
        },
      })
    }
  }

  /** Which occurrence of a routine is done, or has gone by, varies by date. */
  const eventClasses = useCallback(
    (arg: EventContentArg) => {
      const { kind, refId } = arg.event.extendedProps as {
        kind: CalendarItemKind
        refId: string
      }
      if (kind !== "routine" && kind !== "routine-placement") return []
      const date = arg.event.start ? localToday(arg.event.start) : ""
      const done =
        kind === "routine"
          ? state.routines
              .find((item) => item.id === refId)
              ?.doneDates.includes(date)
          : state.routinePlacements.find((item) => item.id === refId)?.done
      if (done) return ["bot-routine-done"]
      return arg.event.end && arg.event.end.getTime() < Date.now()
        ? ["bot-missed"]
        : []
    },
    [state.routines, state.routinePlacements]
  )

  const handleDatesSet = useCallback((info: DatesSetArg) => {
    const from = localToday(info.start)
    setShown({
      type: info.view.type,
      from,
      until: localToday(info.end),
    })
    // In Day view, the day on screen is the chosen day.
    if (info.view.type === DAY_VIEW) setSelected(from)
    // Coming from a view with no hours, the grid would otherwise start at 12am.
    if (info.view.type === DAY_VIEW || info.view.type === WEEK_VIEW) {
      window.setTimeout(() => {
        calendar.current?.getApi().scrollToTime("07:00:00")
      }, 0)
    }
    setCreating(null)
    setOpened(null)
  }, [])

  const dayClasses = useCallback(
    (arg: DayCellContentArg) => {
      const date = localToday(arg.date)
      // A whole outlined column would be noise, so Week marks its header instead.
      if (shown.type === MONTH_VIEW) return selectedDay(arg.date)
      if (shown.type !== YEAR_VIEW) return []
      const level = heatLevel(heat.get(date) ?? 0)
      return level ? [`bot-heat-${level}`] : []
    },
    [heat, selectedDay, shown.type]
  )

  const dayContent = useCallback(
    (arg: DayCellContentArg) => {
      if (shown.type !== YEAR_VIEW) return undefined
      const minutes = heat.get(localToday(arg.date)) ?? 0
      return (
        <span
          title={minutes ? `${formatDuration(minutes)} of focus` : undefined}
        >
          {arg.dayNumberText}
          {minutes > 0 && (
            <span className="sr-only">
              , {formatDuration(minutes)} of focus
            </span>
          )}
        </span>
      )
    },
    [heat, shown.type]
  )

  function goToSelected(date: string) {
    setSelected(date)
    calendar.current?.getApi().gotoDate(date)
  }

  /** The same quick add as clicking the grid, for anyone not using a mouse. */
  function addToSelected() {
    setOpened(null)
    setCreating({
      at: { x: 8, y: 56 },
      date: selected,
      time: shown.type === MONTH_VIEW ? null : "09:00",
    })
  }

  return (
    <div className="space-y-4">
      <ScreenHeading>Calendar</ScreenHeading>

      {isTimed && (
        <CalendarDashboard
          from={shown.from}
          until={shown.until}
          week={shown.type === WEEK_VIEW}
        />
      )}

      <div
        className={
          isYear
            ? "space-y-4"
            : "grid items-start gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]"
        }
      >
        {!isYear && (
          <aside
            aria-label="Things to put on the calendar"
            className="order-2 space-y-5 lg:order-none"
          >
            {isTimed && (
              <NotStartedTray
                onSchedule={(taskId) =>
                  setReplanning(
                    state.tasks.find((task) => task.id === taskId) ?? null
                  )
                }
              />
            )}
            <MyRoutines
              editingId={editingRoutine}
              setEditingId={setEditingRoutine}
              selected={selected}
            />
          </aside>
        )}

        <div className="min-w-0 space-y-2">
          {isYear ? (
            <ul
              aria-label="Focus minutes key"
              className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
            >
              <li>Focus each day:</li>
              {["up to 25 min", "up to 1 h", "up to 2 h", "more"].map(
                (label, index) => (
                  <li key={label} className="flex items-center gap-1">
                    <span
                      aria-hidden
                      className={`inline-block size-3.5 rounded-sm bot-heat-swatch-${index + 1}`}
                    />
                    {label}
                  </li>
                )
              )}
            </ul>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ul
                aria-label="Calendar key"
                className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
              >
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-3.5 w-5 rounded-full border border-sand bg-sand-soft"
                  />
                  Deadline
                </li>
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-3.5 w-5 rounded-sm border border-dashed border-sage bg-sage-soft"
                  />
                  Planned
                </li>
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-3.5 w-5 rounded-sm bg-primary"
                  />
                  Focus you did
                </li>
              </ul>
              <Button
                type="button"
                size="lg"
                variant="outline"
                className="min-h-10"
                onClick={addToSelected}
              >
                <Plus aria-hidden />
                Add to {shortDate(selected)}
              </Button>
            </div>
          )}

          <div ref={surface} className="relative">
            <Card className="p-3 sm:p-4">
              <FullCalendar
                ref={calendar}
                plugins={[
                  dayGridPlugin,
                  timeGridPlugin,
                  multiMonthPlugin,
                  interactionPlugin,
                  rrulePlugin,
                ]}
                initialView={DAY_VIEW}
                headerToolbar={{
                  left: "title",
                  right: `today prev,next ${DAY_VIEW},${WEEK_VIEW},${MONTH_VIEW},${YEAR_VIEW}`,
                }}
                buttonText={{
                  today: "Today",
                  day: "Day",
                  week: "Week",
                  month: "Month",
                  year: "Year",
                }}
                height={isTimed ? 720 : "auto"}
                scrollTime="07:00:00"
                snapDuration="00:05:00"
                nowIndicator
                allDayText=""
                dayMaxEvents={3}
                multiMonthMaxColumns={4}
                multiMonthMinWidth={200}
                eventInteractive
                eventDisplay="block"
                editable
                droppable
                events={events}
                eventClassNames={eventClasses}
                eventDidMount={(arg: EventMountArg) => {
                  const color = arg.event.extendedProps.color as
                    string | undefined
                  if (color) arg.el.style.setProperty("--routine", color)
                }}
                dayCellClassNames={dayClasses}
                dayCellContent={dayContent}
                dayHeaderClassNames={(info) =>
                  shown.type === WEEK_VIEW ? selectedDay(info.date) : []
                }
                dateClick={handleDateClick}
                eventClick={handleEventClick}
                eventDrop={handleEventDrop}
                eventResize={handleEventResize}
                drop={handleDrop}
                datesSet={handleDatesSet}
              />
            </Card>
            {creating && (
              <InlineCreate
                key={`${creating.date}-${creating.time}`}
                at={creating.at}
                label={
                  shown.type === MONTH_VIEW
                    ? `New task due ${shortDate(creating.date)}`
                    : `${SESSION_MINUTES} minutes on ${shortDate(creating.date)}${creating.time ? ` at ${formatClockTime(new Date(`${creating.date}T${creating.time}:00`))}` : ""}`
                }
                placeholder={
                  shown.type === MONTH_VIEW ? "Task title" : "What’s this for?"
                }
                suggestTasks={shown.type !== MONTH_VIEW}
                onCreate={createFromTitle}
                onClose={closeCreating}
              />
            )}
            {opened && (
              <BlockPopover
                key={`${opened.block.refId}-${opened.block.date}`}
                block={opened.block}
                at={opened.at}
                onClose={closeOpened}
                onChangeDeadline={(taskId) => {
                  const task = state.tasks.find((item) => item.id === taskId)
                  if (task) setReplanning(task)
                }}
                onOpenRoutine={setEditingRoutine}
              />
            )}
          </div>
        </div>
      </div>

      {!isYear && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="space-y-4">
            <div>
              <h2 className="font-heading text-2xl">{shortDate(selected)}</h2>
              <label htmlFor="calendar-day" className="sr-only">
                Choose a day
              </label>
              <input
                id="calendar-day"
                type="date"
                max="9999-12-31"
                value={selected}
                onChange={(event) => {
                  if (event.target.value) goToSelected(event.target.value)
                }}
                className="mt-1 h-10 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
              />
            </div>

            {dueOnDay.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold">Due this day</h3>
                <ul className="space-y-1">
                  {dueOnDay.map((task) => (
                    <li key={task.id}>
                      <button
                        type="button"
                        onClick={() => navigate({ view: "task", id: task.id })}
                        className="min-h-10 rounded-md text-left text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
                      >
                        {task.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {plannedOnDay.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold">Planned work</h3>
                <ul className="space-y-2">
                  {plannedOnDay.map((session) => (
                    <PlannedSessionRow
                      key={session.id}
                      session={session}
                      showTask
                    />
                  ))}
                </ul>
              </div>
            )}

            {!dueOnDay.length && !plannedOnDay.length && (
              <p className="text-sm text-muted-foreground">
                Nothing on this day.
              </p>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 font-sans text-[15px] font-semibold tracking-normal">
              Plan the rest of a task
            </h2>
            <PlanRemaining />
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deadlineMove)}
        title="Change the deadline?"
        confirmLabel={
          deadlineMove
            ? `Change it to ${shortDate(deadlineMove.date)}`
            : "Change it"
        }
        cancelLabel="Keep the deadline"
        onCancel={() => setDeadlineMove(null)}
        onConfirm={() => {
          if (deadlineMove) {
            dispatch({
              type: "set-deadline",
              id: deadlineMove.task.id,
              at: nowIso(),
              deadline: deadlineMove.date,
            })
          }
          setDeadlineMove(null)
        }}
      >
        <p>
          “{deadlineMove?.task.title}” is due{" "}
          {deadlineMove?.task.deadline && shortDate(deadlineMove.task.deadline)}
          . Only change this if the deadline itself has really moved.
        </p>
        <button
          type="button"
          onClick={() => {
            if (deadlineMove) {
              dispatch({
                type: "add-planned",
                at: nowIso(),
                session: {
                  id: newId(),
                  taskId: deadlineMove.task.id,
                  date: deadlineMove.date,
                  time: null,
                  minutes: 25,
                  label: "",
                  done: false,
                },
              })
            }
            setDeadlineMove(null)
          }}
          className="mt-3 min-h-11 rounded-md text-sm font-medium text-indigo underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          Plan work on {deadlineMove && shortDate(deadlineMove.date)} instead
        </button>
      </ConfirmDialog>

      <ReplanDialog task={replanning} onClose={() => setReplanning(null)} />
    </div>
  )
}
