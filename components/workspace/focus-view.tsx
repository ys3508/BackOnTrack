"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Coffee, Pause, Play, RotateCcw, Square } from "lucide-react"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ExpandableList, fieldClass } from "@/components/workspace/parts"
import {
  newId,
  nowIso,
  useEnterRecovery,
  useStore,
} from "@/components/workspace/store"
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
  completed: "Ran the full time",
  "continue-later": "Will continue later",
  stuck: "Got stuck",
}

const OUTCOME_REPORT = {
  progress: "You said you made progress",
  minimum: "You said you completed the minimum version",
  completed: "You said you completed the task",
} as const

const REPORT_LABEL = {
  yes: "You said you made progress",
  "a-little": "You said you made a little progress",
  stuck: "You said you got stuck",
} as const

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
  return (
    taskId: string | null,
    minutes: number,
    plannedId?: string,
    restart = false
  ) => {
    if (!state.timer) {
      const task = state.tasks.find((item) => item.id === taskId)
      dispatch({
        type: "timer-start",
        id: newId(),
        kind: "focus",
        taskId,
        subtaskId: task ? (currentSubtask(task)?.id ?? null) : null,
        plannedId: plannedId ?? null,
        restart,
        minutes,
        now: Date.now(),
        at: nowIso(),
      })
    }
    if (stay) return
    // Focus opens the work itself. Only a session with no task stays on Focus.
    const running = state.timer?.taskId ?? (state.timer ? null : taskId)
    const onCase = state.tasks.find((item) => item.id === running)?.recoveryCase
    navigate(
      running
        ? onCase
          ? { view: "workspace" }
          : { view: "task", id: running, section: "doc" }
        : { view: "focus" }
    )
  }
}

/**
 * What a start button should say. With a timer already going, it can't start a
 * new one, so it says it opens that one instead of promising a different length.
 */
export function startLabel(timer: TimerState | null, minutes: number) {
  if (!timer) return `Start ${minutes} minutes`
  const length = timer.plannedSeconds / 60
  return `Open the ${timer.runningSince === null ? "paused" : "running"} ${length}-minute ${timer.kind === "break" ? "break" : "timer"}`
}

/** One accurate line about a session, without implying the work got finished. */
export function describeSession(session: FocusSession) {
  const where = session.taskId === null ? "no specific task" : session.taskTitle
  const length = formatMinutes(session.actualSeconds)
  const summary = session.reported
    ? `You said you did this: ${length} on ${where}`
    : isInterrupted(session)
      ? `Interrupted attempt, not counted as focus time: ${length} of ${session.plannedMinutes} min on ${where}`
      : session.outcome === "completed"
        ? `Ran the full ${session.plannedMinutes} min on ${where}`
        : `Stopped after ${length} of ${session.plannedMinutes} min on ${where}. ${OUTCOME_LABEL[session.outcome]}`
  // What they said came of it is more specific than a plain progress report.
  const report = session.endOutcome
    ? OUTCOME_REPORT[session.endOutcome]
    : session.progressReport && REPORT_LABEL[session.progressReport]
  return report ? `${summary}. ${report}` : summary
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
                navigate(
                  state.tasks.find((task) => task.id === state.timer!.taskId)
                    ?.recoveryCase
                    ? { view: "workspace" }
                    : {
                        view: "task",
                        id: state.timer!.taskId!,
                        section: "doc",
                      }
                )
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

type EndOutcome = "progress" | "minimum" | "completed"

/** Where to pick up, then what really came of it. The three are kept apart. */
function WrapUpForm({
  task,
  onOutcome,
  children,
}: {
  task: Task
  onOutcome: (outcome: EndOutcome, resumeNote: string) => void
  children?: React.ReactNode
}) {
  const [note, setNote] = useState("")
  return (
    <div className="space-y-3 text-left">
      <div>
        <label htmlFor="resume-note" className="block text-sm font-medium">
          Where should you start next time?
        </label>
        <Input
          id="resume-note"
          value={note}
          maxLength={300}
          placeholder="Optional. For example: continue from paragraph two."
          onChange={(event) => setNote(event.target.value)}
          className="mt-1 h-11"
        />
      </div>
      <div
        role="group"
        aria-label="What came of it"
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
      >
        <Button
          type="button"
          size="xl"
          onClick={() => onOutcome("progress", note)}
        >
          I started / made progress
        </Button>
        <Button
          type="button"
          size="xl"
          variant="outline"
          className="h-auto min-h-11 py-2 whitespace-normal"
          onClick={() => onOutcome("minimum", note)}
        >
          I completed the minimum version
        </Button>
        <Button
          type="button"
          size="xl"
          variant="outline"
          onClick={() => onOutcome("completed", note)}
        >
          I completed the original task
        </Button>
      </div>
      {task.minimumVersion && (
        <p className="text-sm text-muted-foreground">
          Minimum version: {task.minimumVersion}. The original task stays open
          if that’s all you did.
        </p>
      )}
      {children && (
        <div className="flex flex-wrap items-center gap-x-2">{children}</div>
      )}
    </div>
  )
}

/** Ending a session. The clock stops first, so answering adds no focus time. */
export function StopChoice({
  timer,
  task,
  onCancel,
}: {
  timer: TimerState
  task?: Task
  onCancel: () => void
}) {
  const { dispatch } = useStore()
  const enterRecovery = useEnterRecovery()
  const [askingWhy, setAskingWhy] = useState(false)
  const [note, setNote] = useState("")
  const wasRunning = useRef(false)

  useEffect(() => {
    if (timer.runningSince !== null) {
      wasRunning.current = true
      dispatch({ type: "timer-pause", now: Date.now() })
    }
    // Only as this opens: pausing is what changes the timer it was given.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function keepGoing() {
    if (wasRunning.current) {
      dispatch({ type: "timer-resume", now: Date.now() })
    }
    onCancel()
  }

  function stopStuck() {
    dispatch({
      type: "timer-stop",
      now: Date.now(),
      at: nowIso(),
      outcome: "stuck",
      note: note.trim(),
    })
    if (task) enterRecovery(task.id, timer.plannedId)
  }

  function finish(outcome: EndOutcome, resumeNote: string) {
    const at = nowIso()
    dispatch({
      type: "timer-stop",
      now: Date.now(),
      at,
      outcome: "continue-later",
      note: "",
    })
    dispatch({
      type: "session-wrap-up",
      sessionId: timer.id,
      at,
      outcome,
      resumeNote,
    })
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

  if (!task) {
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
          End session
        </Button>
        <Button type="button" size="xl" variant="ghost" onClick={keepGoing}>
          Keep going
        </Button>
      </div>
    )
  }

  return (
    <WrapUpForm task={task} onOutcome={finish}>
      <Button
        type="button"
        size="xl"
        variant="ghost"
        className="text-muted-foreground"
        onClick={() => setAskingWhy(true)}
      >
        I got stuck
      </Button>
      <Button
        type="button"
        size="xl"
        variant="ghost"
        className="text-muted-foreground"
        onClick={keepGoing}
      >
        Keep going
      </Button>
    </WrapUpForm>
  )
}

export function FinishedPanel({
  session,
  onTask = false,
  wrapOnly = false,
}: {
  session: FocusSession
  /** Already on the task's page, so there's nowhere to navigate to. */
  onTask?: boolean
  /** Moves on after the answer, instead of offering breaks and more time. */
  wrapOnly?: boolean
}) {
  const { state, dispatch, navigate } = useStore()
  const enterRecovery = useEnterRecovery()
  const task = state.tasks.find((item) => item.id === session.taskId)
  const step = task
    ? (task.subtasks.find((sub) => sub.id === session.subtaskId && !sub.done) ??
      currentSubtask(task))
    : null

  const stuck = () => {
    dispatch({
      type: "report-focus",
      sessionId: session.id,
      report: "stuck",
      at: nowIso(),
    })
    if (task) {
      dispatch({ type: "timer-acknowledge" })
      enterRecovery(task.id, session.plannedId)
    }
  }

  if (task && session.progressReport === null) {
    return (
      <Card className="space-y-3">
        <h2 className="font-heading text-3xl">
          {formatMinutes(session.actualSeconds)} of focus, done.
        </h2>
        <p className="text-sm text-muted-foreground">
          The task stays open until you say otherwise.
        </p>
        <WrapUpForm
          task={task}
          onOutcome={(outcome, resumeNote) => {
            dispatch({
              type: "session-wrap-up",
              sessionId: session.id,
              at: nowIso(),
              outcome,
              resumeNote,
            })
            if (wrapOnly || outcome === "completed") {
              dispatch({ type: "timer-acknowledge" })
              if (!onTask && outcome === "completed") {
                navigate(
                  task.recoveryCase
                    ? { view: "workspace" }
                    : { view: "task", id: task.id }
                )
              }
            }
          }}
        >
          <Button
            type="button"
            size="xl"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => {
              dispatch({ type: "timer-acknowledge" })
              dispatch({
                type: "timer-start",
                id: newId(),
                kind: "focus",
                taskId: session.taskId,
                minutes: session.plannedMinutes,
                now: Date.now(),
                at: nowIso(),
              })
            }}
          >
            Keep going, {session.plannedMinutes} more minutes
          </Button>
          <Button
            type="button"
            size="xl"
            variant="ghost"
            className="text-muted-foreground"
            onClick={stuck}
          >
            I got stuck
          </Button>
        </WrapUpForm>
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
              if (!onTask) {
                navigate(
                  task.recoveryCase
                    ? { view: "workspace" }
                    : { view: "task", id: task.id }
                )
              }
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
                task?.recoveryCase
                  ? { view: "workspace" }
                  : task
                    ? { view: "task", id: task.id }
                    : { view: "workspace" }
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
          {describeSession(session)}
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
