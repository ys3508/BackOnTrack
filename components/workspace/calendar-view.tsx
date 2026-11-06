"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Plus } from "lucide-react"
import dayGridPlugin from "@fullcalendar/daygrid"
import interactionPlugin from "@fullcalendar/interaction"
import type {
  DateClickArg,
  DropArg,
  EventResizeDoneArg,
} from "@fullcalendar/interaction"
import multiMonthPlugin from "@fullcalendar/multimonth"
import FullCalendar from "@fullcalendar/react"
import rrulePlugin from "@fullcalendar/rrule"
import timeGridPlugin from "@fullcalendar/timegrid"
import type {
  DateSelectArg,
  DateSpanApi,
  DatesSetArg,
  DayCellContentArg,
  EventClickArg,
  EventDropArg,
  EventInput,
} from "@fullcalendar/core"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { CalendarDashboard } from "@/components/workspace/calendar-dashboard"
import {
  BlockPopover,
  CreateSession,
  CreateTask,
} from "@/components/workspace/calendar-overlays"
import type { BlockRef } from "@/components/workspace/calendar-overlays"
import {
  MyRoutines,
  NotStartedTray,
} from "@/components/workspace/calendar-sidebar"
import { ConfirmDialog } from "@/components/workspace/parts"
import { useCalendarEvents } from "@/components/workspace/use-calendar-events"
import { ReplanDialog } from "@/components/workspace/schedule"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import {
  PALETTE,
  defaultSessionMinutes,
  focusMinutesByDay,
  formatClockTime,
  formatDuration,
  heatLevel,
  hourRange,
  occurrenceOutcome,
  routineTime,
} from "@/lib/calendar/derived"
import { droppedSlot } from "@/lib/calendar/events"
import { downloadIcs } from "@/lib/calendar/ics"
import { withGap } from "@/lib/today/buffer"
import type { CalendarItemKind } from "@/lib/calendar/events"
import { addDays, localToday, shortDate } from "@/lib/workspace/dates"
import { isActive } from "@/lib/workspace/schemas"
import type { Task } from "@/lib/workspace/schemas"

const DAY_VIEW = "timeGridDay"
const WEEK_VIEW = "timeGridWeek"
const MONTH_VIEW = "dayGridMonth"
const YEAR_VIEW = "multiMonthYear"

type DeadlineMove = { task: Task; date: string }

type Creating = {
  date: string
  time: string | null
  minutes: number
  /** Which way it was opened, since only "Add to" takes a remembered length. */
  source: "click" | "drag" | "add"
  /** True once a length was chosen on purpose, so it's remembered. */
  chosen: boolean
}
type Open = { block: BlockRef; element: Element }
type Shown = { type: string; from: string; until: string }

const pad = (value: number) => String(value).padStart(2, "0")

/** About an hour before now, so the current time is on screen and has context. */
function scrollPosition() {
  const now = new Date()
  return `${pad(Math.max(0, now.getHours() - 1))}:00:00`
}

export function CalendarView() {
  const { state, dispatch, today } = useStore()
  const { settings } = state
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

  const isYear = shown.type === YEAR_VIEW
  const isMonth = shown.type === MONTH_VIEW
  const isTimed = shown.type === DAY_VIEW || shown.type === WEEK_VIEW
  const closeCreating = useCallback(() => setCreating(null), [])
  const closeOpened = useCallback(() => setOpened(null), [])

  const heat = useMemo(() => focusMinutesByDay(state), [state])
  const hours = useMemo(
    () => hourRange(state, shown.from, shown.until),
    [state, shown.from, shown.until]
  )

  const { events, eventClasses, eventContent, eventDidMount } =
    useCalendarEvents(isYear)

  /** Shows where a new session will land, while it's being named. */
  const withPending = useMemo<EventInput[]>(() => {
    if (!creating?.time || !isTimed) return events
    const start = new Date(`${creating.date}T${creating.time}:00`)
    return [
      ...events,
      {
        id: "pending",
        title: "New session",
        start,
        end: new Date(start.getTime() + creating.minutes * 60_000),
        editable: false,
        classNames: ["bot-planned", "bot-pending"],
        extendedProps: { kind: "pending", refId: "pending", taskId: null },
      },
    ]
  }, [events, creating, isTimed])

  const selectedDay = useCallback(
    (date: Date) => (localToday(date) === selected ? ["bot-selected-day"] : []),
    [selected]
  )

  function handleDateClick(info: DateClickArg) {
    const date = info.dateStr.slice(0, 10)
    setSelected(date)
    setOpened(null)
    if (shown.type === YEAR_VIEW) {
      calendar.current?.getApi().changeView(DAY_VIEW, date)
      return
    }
    setCreating({
      date,
      time: info.allDay
        ? null
        : withGap(
            state,
            date,
            info.dateStr.slice(11, 16),
            defaultSessionMinutes(settings)
          ),
      // The length last used, or else the usual 25.
      minutes: defaultSessionMinutes(settings),
      source: "click",
      chosen: false,
    })
  }

  /** Dragging across slots sets the length directly. */
  function handleSelect(info: DateSelectArg) {
    const date = localToday(info.start)
    setSelected(date)
    setOpened(null)
    setCreating({
      date,
      time: `${pad(info.start.getHours())}:${pad(info.start.getMinutes())}`,
      minutes: (info.end.getTime() - info.start.getTime()) / 60_000,
      source: "drag",
      chosen: true,
    })
    // The pending block takes over from the selection's mirror.
    calendar.current?.getApi().unselect()
  }

  function createTask(title: string) {
    if (!creating) return
    dispatch({
      type: "create-task",
      id: newId(),
      at: nowIso(),
      title,
      deadline: creating.date,
    })
    setCreating(null)
  }

  function createSession(title: string, firstStep: string) {
    if (!creating) return
    const at = nowIso()
    const { date, time, minutes, chosen } = creating
    // A title matching an open task sets aside time for it, not a duplicate.
    const existing = state.tasks.find(
      (task) =>
        isActive(task) && task.title.toLowerCase() === title.toLowerCase()
    )
    const taskId = existing?.id ?? newId()
    if (!existing) dispatch({ type: "create-task", id: taskId, at, title })
    if (firstStep) {
      dispatch({ type: "edit-task", id: taskId, at, patch: { firstStep } })
    }
    dispatch({
      type: "add-planned",
      at,
      session: {
        id: newId(),
        taskId,
        date,
        time,
        minutes,
        label: "",
        done: false,
      },
    })
    if (chosen) {
      dispatch({ type: "settings", patch: { lastSessionMinutes: minutes } })
    }
    setCreating(null)
  }

  function handleEventClick(info: EventClickArg) {
    // Its own buttons on the block, such as Did it, have already done their job.
    if ((info.jsEvent.target as Element).closest?.("[data-block-action]")) {
      return
    }
    const { kind, refId, taskId } = info.event.extendedProps as {
      kind: CalendarItemKind
      refId: string
      taskId: string | null
    }
    if (kind === "pending" || kind === "buffer") return
    const { start, end } = info.event
    info.jsEvent.preventDefault()
    setCreating(null)
    setOpened({
      element: info.el,
      block: {
        kind,
        refId,
        taskId,
        title: info.event.title,
        date: start ? localToday(start) : selected,
        start,
        end,
      },
    })
  }

  function handleEventDrop(info: EventDropArg) {
    const kind = info.event.extendedProps.kind as CalendarItemKind
    const refId = info.event.extendedProps.refId as string
    const start = info.event.start
    if (!start) return info.revert()
    const slot = droppedSlot(start, info.event.allDay)
    setOpened(null)

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
      const oldEnd = info.oldEvent.end
      if (!routine || !from) return
      dispatch({
        type: "move-routine-occurrence",
        routineId: refId,
        fromDate: localToday(from),
        placement: {
          id: newId(),
          routineId: refId,
          date: slot.date,
          time:
            slot.time ??
            (routine.kind === "flexible" ? "" : routineTime(routine)),
          minutes: oldEnd ? (oldEnd.getTime() - from.getTime()) / 60_000 : null,
          adjusted: true,
          done: routine.doneDates.includes(localToday(from)),
          result: occurrenceOutcome(routine, localToday(from)),
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
    const { kind, refId } = info.event.extendedProps as {
      kind: CalendarItemKind
      refId: string
    }
    if (!start || !end) return info.revert()
    const minutes = (end.getTime() - start.getTime()) / 60_000
    setOpened(null)
    if (kind === "planned") {
      dispatch({ type: "resize-planned", at: nowIso(), id: refId, minutes })
      dispatch({ type: "settings", patch: { lastSessionMinutes: minutes } })
    } else if (kind === "routine") {
      // Resizing changes this one only, and the popover offers "All future".
      info.revert()
      const routine = state.routines.find((item) => item.id === refId)
      if (!routine) return
      const date = localToday(start)
      dispatch({
        type: "move-routine-occurrence",
        routineId: refId,
        fromDate: date,
        placement: {
          id: newId(),
          routineId: refId,
          date,
          time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
          minutes,
          adjusted: true,
          done: routine.doneDates.includes(date),
          result: occurrenceOutcome(routine, date),
        },
      })
    } else if (kind === "routine-placement") {
      info.revert()
      dispatch({
        type: "update-placement",
        id: refId,
        date: localToday(start),
        time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
        minutes,
      })
    } else return info.revert()
  }

  /** Something dragged in from the tray or from My routines. */
  function handleDrop(info: DropArg) {
    const slot = droppedSlot(info.date, info.allDay)
    const kind = info.draggedEl.getAttribute("data-kind")
    const id = info.draggedEl.getAttribute("data-id")
    if (!id) return
    if (kind === "task") {
      const task = state.tasks.find((item) => item.id === id)
      const length = defaultSessionMinutes(settings, task)
      dispatch({
        type: "add-planned",
        at: nowIso(),
        session: {
          id: newId(),
          taskId: id,
          date: slot.date,
          time: slot.time && withGap(state, slot.date, slot.time, length),
          minutes: length,
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
          time:
            slot.time ??
            (routine.kind === "flexible" ? "" : routineTime(routine)),
          done: false,
        },
      })
    }
  }

  const lastView = useRef("")
  const handleDatesSet = useCallback((info: DatesSetArg) => {
    const from = localToday(info.start)
    setShown({
      type: info.view.type,
      from,
      until: localToday(info.end),
    })
    // In Day view, the day on screen is the chosen day.
    if (info.view.type === DAY_VIEW) setSelected(from)
    setCreating(null)
    setOpened(null)
    if (info.view.type !== lastView.current) {
      lastView.current = info.view.type
      if (info.view.type === DAY_VIEW || info.view.type === WEEK_VIEW) {
        window.setTimeout(() => {
          calendar.current?.getApi().scrollToTime(scrollPosition())
        }, 0)
      }
    }
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

  /** The same quick add as clicking the grid, for anyone not using a mouse. */
  function addToSelected() {
    setOpened(null)
    const nowDate = new Date()
    setCreating({
      date: selected,
      time: isMonth
        ? null
        : selected === today
          ? `${pad(nowDate.getHours())}:${pad(Math.floor(nowDate.getMinutes() / 15) * 15)}`
          : "09:00",
      minutes: defaultSessionMinutes(settings),
      source: "add",
      chosen: false,
    })
  }

  const pendingAnchor = useCallback(
    () => document.querySelector(".bot-pending"),
    []
  )
  const creatingDate = creating?.date
  const dayAnchor = useCallback(
    () =>
      document.querySelector(`.fc-daygrid-day[data-date="${creatingDate}"]`) ??
      document.querySelector(".fc-view-harness"),
    [creatingDate]
  )
  const openedElement = opened?.element
  const openedId = opened?.block.refId
  const openedDate = opened?.block.date
  const blockAnchor = useCallback(() => {
    if (openedElement?.isConnected) return openedElement
    // The calendar redraws blocks, so it finds this one again by its id.
    return (
      [...document.querySelectorAll(`[data-block-id="${openedId}"]`)].find(
        (element) => element.getAttribute("data-date") === openedDate
      ) ?? null
    )
  }, [openedElement, openedId, openedDate])

  const pendingVisible = Boolean(creating?.time && isTimed)
  useEffect(() => {
    if (pendingVisible && creating?.source === "add") {
      document
        .querySelector(".bot-pending")
        ?.scrollIntoView({ block: "nearest" })
    }
    // Only when it first appears, so typing never moves the grid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingVisible])

  return (
    <div className="space-y-4">
      <ScreenHeading className="text-xl sm:text-xl">Calendar</ScreenHeading>

      {isTimed && (
        <CalendarDashboard
          from={shown.from}
          until={shown.until}
          week={shown.type === WEEK_VIEW}
          hours={hours}
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
            className="order-2 space-y-5 lg:sticky lg:top-4 lg:order-none"
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
                  Focus done
                </li>
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="bot-routine-swatch inline-block h-3.5 w-5 rounded-sm"
                    style={
                      {
                        "--routine": state.routines[0]?.color ?? PALETTE[1],
                      } as React.CSSProperties
                    }
                  />
                  Routine
                </li>
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="bot-buffer-swatch inline-block h-3.5 w-5 rounded-sm border border-border"
                  />
                  Buffer
                </li>
              </ul>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  className="min-h-10 text-muted-foreground"
                  onClick={() => downloadIcs(state, today)}
                >
                  Export .ics
                </Button>
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
            </div>
          )}

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
              slotMinTime={`${pad(hours.first)}:00:00`}
              slotMaxTime={`${pad(hours.last)}:00:00`}
              scrollTime={scrollPosition()}
              snapDuration="00:15:00"
              slotLabelContent={(arg) => formatClockTime(arg.date)}
              nowIndicator
              allDayText=""
              dayMaxEvents={3}
              multiMonthMaxColumns={4}
              multiMonthMinWidth={200}
              eventInteractive
              eventDisplay="block"
              editable
              droppable
              selectable={isTimed}
              selectMirror
              // A plain click stays a click, and only a real drag selects.
              selectMinDistance={5}
              selectAllow={(span: DateSpanApi) =>
                !span.allDay &&
                localToday(span.start) ===
                  localToday(new Date(span.end.getTime() - 1))
              }
              select={handleSelect}
              events={withPending}
              eventContent={eventContent}
              eventClassNames={eventClasses}
              eventDidMount={eventDidMount}
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
          {creating &&
            (isMonth ? (
              <CreateTask
                key={creating.date}
                anchor={dayAnchor}
                date={creating.date}
                onCreate={createTask}
                onClose={closeCreating}
              />
            ) : (
              <CreateSession
                key={`${creating.date}-${creating.time}`}
                anchor={creating.time ? pendingAnchor : dayAnchor}
                date={creating.date}
                time={creating.time}
                minutes={creating.minutes}
                onMinutes={(minutes) =>
                  setCreating({ ...creating, minutes, chosen: true })
                }
                onPickTask={(task) => {
                  // A remembered length wins, and then the task's own estimate.
                  if (
                    task?.estimateMinutes &&
                    creating.source === "add" &&
                    !creating.chosen &&
                    !settings.lastSessionMinutes
                  ) {
                    setCreating({
                      ...creating,
                      minutes: task.estimateMinutes,
                    })
                  }
                }}
                onCreate={createSession}
                onClose={closeCreating}
              />
            ))}
          {opened && (
            <BlockPopover
              key={`${opened.block.refId}-${opened.block.date}`}
              block={opened.block}
              anchor={blockAnchor}
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
