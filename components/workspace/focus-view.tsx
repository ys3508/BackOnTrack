"use client"

import { useEffect, useState } from "react"
import { Check, Coffee, Pause, Play, RotateCcw, Square } from "lucide-react"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ExpandableList, fieldClass } from "@/components/workspace/parts"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { formatClock, formatMinutes, remainingSeconds } from "@/lib/focus/timer"
import { formatDateTime } from "@/lib/workspace/dates"
import { isActive, isInterrupted } from "@/lib/workspace/schemas"
import type { FocusSession, Task, TimerState } from "@/lib/workspace/schemas"
import { currentSubtask, recommendTask } from "@/lib/workspace/selectors"

export const FOCUS_OPTIONS = [
  { minutes: 5, label: "5-minute Quick Start" },
  { minutes: 10, label: "10-minute Focus" },
  { minutes: 25, label: "25-minute Focus" },
] as const

const BREAK_MINUTES = 5

const OUTCOME_LABEL: Record<FocusSession["outcome"], string> = {
  completed: "Finished",
  "continue-later": "Will continue later",
  stuck: "Got stuck",
}

/** Re-renders every second while running, and right after returning to the tab. */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const update = () => setNow(Date.now())
    update()
    const id = window.setInterval(update, 1000)
    document.addEventListener("visibilitychange", update)
    window.addEventListener("focus", update)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", update)
      window.removeEventListener("focus", update)
    }
  }, [active])
  return now
}

/** Starts focus from anywhere. A session already running is never overwritten. */
export function useStartFocus({ stay = false } = {}) {
  const { state, dispatch, navigate } = useStore()
  return (taskId: string | null, minutes: number) => {
    if (!state.timer) {
      const task = state.tasks.find((item) => item.id === taskId)
      dispatch({
        type: "timer-start",
        id: newId(),
        kind: "focus",
        taskId,
        subtaskId: task ? (currentSubtask(task)?.id ?? null) : null,
        minutes,
        now: Date.now(),
        at: nowIso(),
      })
    }
    if (stay) return
    // Focus opens the work itself. Only a session with no task stays on Focus.
    const running = state.timer?.taskId ?? (state.timer ? null : taskId)
    navigate(
      running
        ? { view: "task", id: running, section: "doc" }
        : { view: "focus" }
    )
  }
}

export function FocusView() {
  const { state, route, navigate } = useStore()
  const preselected = route.view === "focus" ? route.taskId : undefined
  const finished = state.focusSessions.find(
    (session) => session.id === state.finishedSessionId
  )

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <ScreenHeading>Focus</ScreenHeading>
      {state.timer ? (
        <>
          <ActiveTimer timer={state.timer} />
          {state.timer.taskId && (
            <Button
              type="button"
              size="xl"
              className="w-full sm:w-auto"
              onClick={() =>
                navigate({
                  view: "task",
                  id: state.timer!.taskId!,
                  section: "doc",
                })
              }
            >
              Open my work
            </Button>
          )}
        </>
      ) : finished ? (
        <FinishedPanel session={finished} />
      ) : (
        <StartPanel preselected={preselected} />
      )}
      <SessionHistory />
    </div>
  )
}

function StartPanel({ preselected }: { preselected?: string }) {
  const { state, today } = useStore()
  const start = useStartFocus()
  const tasks = state.tasks.filter(isActive)
  const [taskId, setTaskId] = useState(
    preselected ?? recommendTask(state, today)?.id ?? ""
  )

  return (
    <Card className="space-y-4">
      <div>
        <label htmlFor="focus-task" className="mb-1 block text-sm font-medium">
          What are you working on?
        </label>
        <select
          id="focus-task"
          value={taskId}
          onChange={(event) => setTaskId(event.target.value)}
          className={fieldClass}
        >
          <option value="">No specific task</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {FOCUS_OPTIONS.map((option, index) => (
          <Button
            key={option.minutes}
            type="button"
            size="xl"
            variant={index === 0 ? "default" : "outline"}
            className="h-auto min-h-12 py-2 whitespace-normal"
            onClick={() => start(taskId || null, option.minutes)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </Card>
  )
}

export function ActiveTimer({
  timer,
  compact = false,
}: {
  timer: TimerState
  /** A slim version for working alongside the document. */
  compact?: boolean
}) {
  const { state, dispatch } = useStore()
  const running = timer.runningSince !== null
  const now = useNow(true)
  const remaining = remainingSeconds(timer, now)
  const task = state.tasks.find((item) => item.id === timer.taskId)
  const step = task?.subtasks.find((sub) => sub.id === timer.subtaskId)
  const [stopping, setStopping] = useState(false)
  const isBreak = timer.kind === "break"

  const controls = stopping ? (
    <StopChoice timer={timer} task={task} onCancel={() => setStopping(false)} />
  ) : (
    <div
      className={
        compact
          ? "flex flex-wrap gap-1"
          : "flex flex-col justify-center gap-2 sm:flex-row sm:flex-wrap"
      }
    >
      {running ? (
        <Button
          type="button"
          size={compact ? "lg" : "xl"}
          className={compact ? "min-h-11" : undefined}
          variant={compact ? "outline" : "default"}
          onClick={() => dispatch({ type: "timer-pause", now: Date.now() })}
        >
          <Pause aria-hidden />
          {compact ? "Pause timer" : "Pause"}
        </Button>
      ) : (
        <Button
          type="button"
          size={compact ? "lg" : "xl"}
          className={compact ? "min-h-11" : undefined}
          onClick={() => dispatch({ type: "timer-resume", now: Date.now() })}
        >
          <Play aria-hidden />
          {compact ? "Resume timer" : "Resume"}
        </Button>
      )}
      <Button
        type="button"
        size={compact ? "lg" : "xl"}
        className={compact ? "min-h-11" : undefined}
        variant={compact ? "ghost" : "outline"}
        onClick={() => dispatch({ type: "timer-reset" })}
      >
        <RotateCcw aria-hidden />
        Reset
      </Button>
      <Button
        type="button"
        size={compact ? "lg" : "xl"}
        className={compact ? "min-h-11" : undefined}
        variant="ghost"
        onClick={() =>
          isBreak ? dispatch({ type: "timer-cancel" }) : setStopping(true)
        }
      >
        <Square aria-hidden />
        {isBreak ? "End break" : "Stop"}
      </Button>
    </div>
  )

  const label = isBreak
    ? "Break"
    : (step?.title ?? task?.title ?? "Focus session")

  if (compact) {
    return (
      <div className="sticky top-2 z-10 rounded-2xl border border-primary/40 bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="flex min-w-0 items-baseline gap-2.5">
            <span
              role="timer"
              aria-label={`${formatClock(remaining)} remaining`}
              className="font-heading text-2xl tabular-nums"
            >
              {formatClock(remaining)}
            </span>
            <span className="min-w-0 text-sm break-words text-muted-foreground">
              {label}
              {!running && " (paused)"}
            </span>
          </p>
          {controls}
        </div>
      </div>
    )
  }

  return (
    <Card className="text-center">
      <p className="text-sm font-medium text-sage">
        {label}
        {!running && " (paused)"}
      </p>
      {step && task && (
        <p className="text-xs text-muted-foreground">{task.title}</p>
      )}
      <p
        role="timer"
        aria-label={`${formatClock(remaining)} remaining`}
        className="my-3 font-heading text-7xl tabular-nums sm:text-8xl"
      >
        {formatClock(remaining)}
      </p>
      {controls}
    </Card>
  )
}

function StopChoice({
  task,
  onCancel,
}: {
  timer: TimerState
  task?: Task
  onCancel: () => void
}) {
  const { dispatch, navigate } = useStore()
  const [askingWhy, setAskingWhy] = useState(false)
  const [note, setNote] = useState("")

  function stopStuck() {
    dispatch({
      type: "timer-stop",
      now: Date.now(),
      at: nowIso(),
      outcome: "stuck",
      note: note.trim(),
    })
    if (task) navigate({ view: "recover", taskId: task.id })
  }

  if (askingWhy) {
    return (
      <div className="mx-auto max-w-md space-y-2 text-left">
        <label htmlFor="stuck-note" className="block text-sm font-medium">
          What got in the way? (optional)
        </label>
        <Input
          id="stuck-note"
          value={note}
          maxLength={300}
          onChange={(event) => setNote(event.target.value)}
          className="h-11"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="xl" onClick={stopStuck}>
            {task ? "Find another way in" : "Stop session"}
          </Button>
          <Button
            type="button"
            size="xl"
            variant="ghost"
            onClick={() => setAskingWhy(false)}
          >
            Back
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col justify-center gap-2 sm:flex-row sm:flex-wrap">
      <Button
        type="button"
        size="xl"
        onClick={() =>
          dispatch({
            type: "timer-stop",
            now: Date.now(),
            at: nowIso(),
            outcome: "continue-later",
            note: "",
          })
        }
      >
        Continue later
      </Button>
      <Button
        type="button"
        size="xl"
        variant="outline"
        onClick={() => setAskingWhy(true)}
      >
        I got stuck
      </Button>
      <Button type="button" size="xl" variant="ghost" onClick={onCancel}>
        Keep going
      </Button>
    </div>
  )
}

export function FinishedPanel({
  session,
  onTask = false,
}: {
  session: FocusSession
  /** Already on the task's page, so there's nowhere to navigate to. */
  onTask?: boolean
}) {
  const { state, dispatch, navigate } = useStore()
  const task = state.tasks.find((item) => item.id === session.taskId)
  const step = task
    ? (task.subtasks.find((sub) => sub.id === session.subtaskId && !sub.done) ??
      currentSubtask(task))
    : null

  const answer = (report: "yes" | "a-little" | "stuck") => {
    dispatch({
      type: "report-focus",
      sessionId: session.id,
      report,
      at: nowIso(),
    })
    if (report === "stuck" && task) {
      dispatch({ type: "timer-acknowledge" })
      navigate({ view: "recover", taskId: task.id })
    }
  }

  if (task && session.progressReport === null) {
    return (
      <Card className="space-y-3">
        <h2 className="font-heading text-3xl">
          {formatMinutes(session.actualSeconds)} of focus, done.
        </h2>
        <p className="text-[15px]" id="progress-question">
          Did you make progress?
        </p>
        <div
          role="group"
          aria-labelledby="progress-question"
          className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
        >
          <Button type="button" size="xl" onClick={() => answer("yes")}>
            Yes
          </Button>
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={() => answer("a-little")}
          >
            A little
          </Button>
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={() => answer("stuck")}
          >
            I got stuck
          </Button>
        </div>
      </Card>
    )
  }

  const acknowledge = () => dispatch({ type: "timer-acknowledge" })
  const startNext = (kind: "focus" | "break", minutes: number) => {
    acknowledge()
    dispatch({
      type: "timer-start",
      id: newId(),
      kind,
      taskId: kind === "focus" ? session.taskId : null,
      minutes,
      now: Date.now(),
      at: nowIso(),
    })
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="font-heading text-3xl">
          {formatMinutes(session.actualSeconds)} of focus, done.
        </h2>
        {task ? (
          <p className="mt-1 text-[15px] text-muted-foreground">
            Saved to “{task.title}”. The task stays open until you say it’s
            finished.
          </p>
        ) : (
          <p className="mt-1 text-[15px] text-muted-foreground">
            Saved to your focus history.
          </p>
        )}
      </div>

      {step && task && (
        <Button
          type="button"
          size="xl"
          className="h-auto min-h-11 w-full justify-start py-2 text-left whitespace-normal sm:w-auto"
          onClick={() => {
            dispatch({
              type: "toggle-subtask",
              id: task.id,
              at: nowIso(),
              subId: step.id,
            })
            acknowledge()
          }}
        >
          <Check aria-hidden />
          Mark “{step.title}” done
        </Button>
      )}

      {task && !task.subtasks.length && (
        <div>
          <label
            htmlFor="focus-progress"
            className="mb-1 block text-sm font-medium"
          >
            Progress on this task: {task.progress}%
          </label>
          <input
            id="focus-progress"
            type="range"
            min={0}
            max={100}
            step={5}
            value={task.progress}
            onChange={(event) =>
              dispatch({
                type: "set-progress",
                id: task.id,
                at: nowIso(),
                progress: Number(event.target.value),
              })
            }
            className="h-6 w-full accent-[var(--primary)]"
          />
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          size="xl"
          onClick={() => startNext("break", BREAK_MINUTES)}
        >
          <Coffee aria-hidden />
          Take a {BREAK_MINUTES}-minute break
        </Button>
        <Button
          type="button"
          size="xl"
          variant="outline"
          onClick={() => startNext("focus", session.plannedMinutes)}
        >
          Another {session.plannedMinutes} minutes
        </Button>
        {task && task.status !== "completed" && (
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={() => {
              dispatch({
                type: "set-status",
                id: task.id,
                at: nowIso(),
                status: "completed",
              })
              acknowledge()
              if (!onTask) navigate({ view: "task", id: task.id })
            }}
          >
            The task is finished
          </Button>
        )}
        <Button
          type="button"
          size="xl"
          variant="ghost"
          onClick={() => {
            acknowledge()
            if (!onTask) {
              navigate(
                task ? { view: "task", id: task.id } : { view: "workspace" }
              )
            }
          }}
        >
          Done for now
        </Button>
      </div>
    </Card>
  )
}

export function SessionList({ sessions }: { sessions: FocusSession[] }) {
  return (
    <ExpandableList
      items={[...sessions].reverse()}
      limit={5}
      label="sessions"
      empty="No focus sessions yet."
      render={(session) => (
        <li key={session.id} className="text-sm">
          <span className="font-medium">
            {formatMinutes(session.actualSeconds)}
          </span>{" "}
          of {session.plannedMinutes} min on {session.taskTitle} ·{" "}
          {isInterrupted(session)
            ? "Interrupted attempt, not counted as focus time"
            : OUTCOME_LABEL[session.outcome]}
          {session.note && `: ${session.note}`}
          <span className="block text-xs text-muted-foreground">
            {formatDateTime(session.endedAt)}
          </span>
        </li>
      )}
    />
  )
}

function SessionHistory() {
  const { state } = useStore()
  return (
    <section aria-labelledby="session-history">
      <h2
        id="session-history"
        className="mb-2 font-sans text-[15px] font-semibold tracking-normal"
      >
        Session history
      </h2>
      <SessionList sessions={state.focusSessions} />
    </section>
  )
}
