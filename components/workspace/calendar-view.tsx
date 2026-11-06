"use client"

import { useMemo, useRef, useState } from "react"
import dayGridPlugin from "@fullcalendar/daygrid"
import interactionPlugin from "@fullcalendar/interaction"
import type { DateClickArg } from "@fullcalendar/interaction"
import FullCalendar from "@fullcalendar/react"
import timeGridPlugin from "@fullcalendar/timegrid"
import type { EventClickArg, EventDropArg } from "@fullcalendar/core"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { ConfirmDialog, DeadlineChip } from "@/components/workspace/parts"
import { PlanRemaining } from "@/components/workspace/plan-remaining"
import { QuickAdd } from "@/components/workspace/quick-add"
import {
  PlanSessionForm,
  PlannedSessionRow,
  ReplanDialog,
} from "@/components/workspace/schedule"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { buildCalendarItems, droppedSlot } from "@/lib/calendar/events"
import type { CalendarItemKind } from "@/lib/calendar/events"
import { localToday, shortDate } from "@/lib/workspace/dates"
import type { Task } from "@/lib/workspace/schemas"
import { deadlinePassed } from "@/lib/workspace/selectors"

type DeadlineMove = { task: Task; date: string }

export function CalendarView() {
  const { state, dispatch, navigate, today } = useStore()
  const [selected, setSelected] = useState(today)
  const calendar = useRef<FullCalendar>(null)
  const selectedDay = (date: Date) =>
    localToday(date) === selected ? ["bot-selected-day"] : []
  const [deadlineMove, setDeadlineMove] = useState<DeadlineMove | null>(null)
  const [replanning, setReplanning] = useState<Task | null>(null)

  const events = useMemo(() => buildCalendarItems(state, today), [state, today])

  const passed = state.tasks.filter((task) => deadlinePassed(task, today))
  const dueOnDay = state.tasks.filter((task) => task.deadline === selected)
  const plannedOnDay = state.planned.filter((item) => item.date === selected)

  function handleEventClick(info: EventClickArg) {
    const taskId = info.event.extendedProps.taskId as string | null
    if (taskId && state.tasks.some((task) => task.id === taskId)) {
      navigate({ view: "task", id: taskId })
    }
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
    // A deadline never moves without a decision, so it snaps back and asks.
    info.revert()
    const task = state.tasks.find((item) => item.id === refId)
    if (kind === "deadline" && task) {
      setDeadlineMove({ task, date: slot.date })
    }
  }

  return (
    <div className="space-y-4">
      <ScreenHeading>Calendar</ScreenHeading>

      <ul
        aria-label="Calendar key"
        className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground"
      >
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-3.5 w-5 rounded-sm border border-l-4 border-sand bg-sand-soft"
          />
          Deadline
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-3.5 w-5 rounded-sm border border-dashed border-sage bg-sage-soft"
          />
          Planned work (optional)
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-3.5 w-5 rounded-sm bg-indigo-soft"
          />
          Focus you did
        </li>
      </ul>

      <Card className="p-3 sm:p-4">
        <FullCalendar
          ref={calendar}
          dayCellClassNames={(info) => selectedDay(info.date)}
          dayHeaderClassNames={(info) => selectedDay(info.date)}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: "title",
            right: "today prev,next dayGridMonth,timeGridWeek",
          }}
          buttonText={{ today: "Today", month: "Month", week: "Week" }}
          height="auto"
          dayMaxEvents={3}
          eventInteractive
          eventDisplay="block"
          editable
          eventDurationEditable={false}
          events={events}
          dateClick={(info: DateClickArg) =>
            setSelected(info.dateStr.slice(0, 10))
          }
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
        />
      </Card>

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
                if (event.target.value) {
                  setSelected(event.target.value)
                  calendar.current?.getApi().gotoDate(event.target.value)
                }
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

          <div>
            <h3 className="mb-1 text-sm font-semibold">
              Add a task due this day
            </h3>
            <QuickAdd key={selected} initialDeadline={selected} />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 font-sans text-[15px] font-semibold tracking-normal">
              Plan the rest of a task
            </h2>
            <PlanRemaining />
          </Card>

          <Card>
            <h2 className="mb-2 font-sans text-[15px] font-semibold tracking-normal">
              Plan work on {shortDate(selected)}
            </h2>
            <PlanSessionForm
              key={selected}
              date={selected}
              idPrefix="cal-plan"
            />
          </Card>

          {passed.length > 0 && (
            <Card>
              <h2 className="mb-2 font-sans text-[15px] font-semibold tracking-normal">
                Could use a new plan
              </h2>
              <ul className="space-y-2">
                {passed.slice(0, 3).map((task) => (
                  <li
                    key={task.id}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <span className="min-w-0 text-sm">
                      <span className="block font-medium break-words">
                        {task.title}
                      </span>
                      <DeadlineChip task={task} />
                    </span>
                    <Button
                      type="button"
                      size="lg"
                      variant="outline"
                      onClick={() => setReplanning(task)}
                    >
                      Replan
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
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
