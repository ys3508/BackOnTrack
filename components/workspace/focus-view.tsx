"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  Check,
  Coffee,
  LifeBuoy,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Square,
  TrendingUp,
} from "lucide-react"

import { ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ParkingLot } from "@/components/workspace/parking-lot"
import { FocusOrb, SunGlyph } from "@/components/workspace/aura"
import { ExpandableList, fieldClass } from "@/components/workspace/parts"
import {
  newId,
  nowIso,
  useEnterRecovery,
  useStore,
} from "@/components/workspace/store"
import { formatClock, formatMinutes, remainingSeconds } from "@/lib/focus/timer"
import { FOCUS_THEMES, taskColorVars, taskTheme } from "@/lib/calendar/task-colors"
import type { FocusThemeId } from "@/lib/calendar/task-colors"
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

/** While the room is open, hides what's behind it and lets Escape step out. */
export function useFocusRoomLock(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return
    const root = document.documentElement
    root.dataset.focusing = "true"
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEscape()
    }
    document.addEventListener("keydown", onKey)
    return () => {
      delete root.dataset.focusing
      document.removeEventListener("keydown", onKey)
    }
  }, [active, onEscape])
}

/** Starts focus from anywhere. A session already running is never overwritten. */
export function useStartFocus({ stay = false } = {}) {
  const { state, dispatch, navigate, setFocusRoomOpen } = useStore()
  return (
    taskId: string | null,
    minutes: number,
    plannedId?: string,
    restart = false
  ) => {
    // A new timer opens in the room by itself. One already going is reopened.
    if (state.timer) setFocusRoomOpen(true)
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
  const { state, route } = useStore()
  const preselected = route.view === "focus" ? route.taskId : undefined
  const finished = state.focusSessions.find(
    (session) => session.id === state.finishedSessionId
  )

  if (state.timer) return <ActiveTimer timer={state.timer} />

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="text-center">
        <ScreenHeading>
          Focus
        </ScreenHeading>
        <p className="mt-1 text-muted-foreground">
          Pick a task, choose a small window, and let the rest soften.
        </p>
      </div>
      {finished ? (
        <FinishedPanel session={finished} />
      ) : (
        <StartPanel preselected={preselected} />
      )}
      <SessionHistory />
    </div>
  )
}

function StartPanel({ preselected }: { preselected?: string }) {
  const { state, today, dispatch } = useStore()
  const start = useStartFocus()
  const tasks = state.tasks.filter(isActive)
  const [taskId, setTaskId] = useState(
    preselected ?? recommendTask(state, today)?.id ?? ""
  )

  const chosen = tasks.find((task) => task.id === taskId) ?? null
  return (
    <div
      style={taskColorVars(taskId || "focus", chosen?.focusTheme)}
      className="bot-stage bot-rise space-y-5 p-5 sm:p-7"
    >
      
      <div>
        <label htmlFor="focus-task" className="mb-1.5 block text-sm font-medium">
          What are you working on?
        </label>
        <select
          id="focus-task"
          value={taskId}
          onChange={(event) => setTaskId(event.target.value)}
          className={`${fieldClass} h-12 px-4`}
        >
          <option value="">No specific task</option>
          {tasks.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </div>
      {taskId && (
        <ThemePicker
          task={chosen}
          onChange={(focusTheme) =>
            dispatch({
              type: "edit-task",
              id: taskId,
              at: nowIso(),
              patch: { focusTheme },
            })
          }
        />
      )}
      <div className="grid gap-2 sm:grid-cols-3">
        {FOCUS_OPTIONS.map((option, index) => (
          <button
            key={option.minutes}
            type="button"
            style={{ "--tile": "white" } as React.CSSProperties}
            className="bot-tile min-h-32 flex-col justify-center gap-1 text-center"
            onClick={() => start(taskId || null, option.minutes)}
          >
            <span aria-hidden className="grid size-12 place-items-center">
              <span
                className="block rounded-full bg-[radial-gradient(closest-side,var(--task-vivid)_35%,var(--task-soft)_75%,transparent)]"
                style={{
                  width: `${1.5 + index * 0.9}rem`,
                  height: `${1.5 + index * 0.9}rem`,
                }}
              />
            </span>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function ActiveTimer({
  timer,
  compact = false,
  room = false,
}: {
  timer: TimerState
  /** A slim version for working alongside the document. */
  compact?: boolean
  /** Open over another screen, which it steps back to. */
  room?: boolean
}) {
  const { state, dispatch, navigate, focusRoomOpen, setFocusRoomOpen } =
    useStore()
  const stepOut = useCallback(() => setFocusRoomOpen(false), [setFocusRoomOpen])
  useFocusRoomLock(room, stepOut)
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
          : "flex flex-wrap justify-center gap-2"
      }
    >
      {compact && (
        <Button
          type="button"
          size="lg"
          variant="soft"
          className="min-h-11"
          onClick={() => setFocusRoomOpen(true)}
        >
          <Maximize2 aria-hidden />
          Enter Focus Mode
        </Button>
      )}
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
        variant={compact ? "ghost" : "soft"}
        onClick={() => dispatch({ type: "timer-reset" })}
      >
        <RotateCcw aria-hidden />
        Reset
      </Button>
      <Button
        type="button"
        size={compact ? "lg" : "xl"}
        className={compact ? "min-h-11" : undefined}
        variant={compact ? "ghost" : "soft"}
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
    // The room is showing this same timer, so it isn't drawn twice.
    if (focusRoomOpen) return null
    return (
      <div
        style={taskColorVars(isBreak ? null : timer.taskId, task?.focusTheme)}
        className="bot-task-accent sticky top-2 z-10 rounded-2xl border border-border bg-[color-mix(in_srgb,var(--task-soft,var(--brand-soft))_60%,white)] p-3 shadow-[var(--shadow-soft)]"
      >
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
    <section
      style={taskColorVars(
        isBreak ? "break" : (timer.taskId ?? "focus"),
        isBreak ? "mint-garden" : task?.focusTheme
      )}
      className={`bot-immersive ${running ? "is-running" : "is-paused"}`}
      aria-labelledby="focus-title"
    >
      <div className="mx-auto flex min-h-svh w-full max-w-3xl flex-col items-center gap-[1.5svh] px-4 py-3 text-center sm:py-4">
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            size="lg"
            variant="soft"
            className="h-11"
            onClick={() => {
              setFocusRoomOpen(false)
              if (!room) navigate({ view: "workspace" })
            }}
          >
            <ArrowLeft aria-hidden /> {room ? "Leave Focus" : "Today"}
          </Button>
          {task && (
            <ThemePicker
              compact
              task={task}
              onChange={(focusTheme) =>
                dispatch({
                  type: "edit-task",
                  id: task.id,
                  at: nowIso(),
                  patch: { focusTheme },
                })
              }
            />
          )}
        </div>

        <div className="my-auto flex w-full flex-col items-center gap-[1.5svh]">
          <p className={`bot-eyebrow ${running ? "" : "bot-paused-tag"}`}>
            {running
              ? isBreak
                ? "A quiet pause"
                : "Focus on this"
              : "Paused · your place is saved"}
          </p>
          <h1
            id="focus-title"
            className="font-heading text-[clamp(2.25rem,7svh,4.5rem)] leading-[1] tracking-[-0.025em] break-words"
          >
            {label}
          </h1>
          {task?.nextAction && !step && (
            <p className="bot-paper rounded-2xl px-3 py-1.5 text-sm font-medium shadow-none">
              Next: {task.nextAction}
            </p>
          )}
          {step && task && (
            <p className="text-sm font-semibold">Part of {task.title}</p>
          )}
          <FocusOrb
            fraction={
              timer.plannedSeconds ? remaining / timer.plannedSeconds : 0
            }
            running={running}
            className={
              stopping
                ? "w-[min(26svh,52vw)]"
                : "w-[min(46svh,82vw,30rem)]"
            }
          >
            <p
              role="timer"
              aria-label={`${formatClock(remaining)} remaining`}
              className={`font-heading leading-none tracking-[-0.04em] tabular-nums ${stopping ? "text-[clamp(2.5rem,7svh,3.5rem)]" : "text-[clamp(4rem,min(15svh,22vw),9rem)]"}`}
            >
              {formatClock(remaining)}
            </p>
          </FocusOrb>
          <div
            className={`w-full ${stopping ? "bot-paper max-w-2xl rounded-3xl p-4" : ""}`}
          >
            {controls}
          </div>
          {running && !isBreak && !stopping && (
            <ParkingLot taskId={timer.taskId} />
          )}
          {task && !isBreak && (
            <button
              type="button"
              onClick={() => {
                dispatch({
                  type: "enter-recovery",
                  at: nowIso(),
                  taskId: task.id,
                  source: "avoidance",
                })
                setFocusRoomOpen(false)
                navigate({ view: "workspace" })
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white/55 px-4 text-sm outline-none transition-colors hover:bg-white/85"
            >
              <LifeBuoy className="size-4" aria-hidden /> This isn’t working —
              help me recover
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

export function ThemePicker({
  task,
  onChange,
  compact = false,
}: {
  task: Task | null
  onChange: (theme: FocusThemeId) => void
  compact?: boolean
}) {
  if (!task) return null
  const current = taskTheme(task)
  return (
    <fieldset
      className={compact ? "bot-paper rounded-full px-1 py-0.5 shadow-none" : "space-y-2"}
    >
      <legend className={compact ? "sr-only" : "text-sm font-medium"}>
        Focus color
      </legend>
      <div className={compact ? "flex" : "flex flex-wrap gap-1"}>
        {FOCUS_THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            aria-label={theme.name}
            title={theme.name}
            aria-pressed={current.id === theme.id}
            onClick={() => onChange(theme.id)}
            className="group/swatch grid size-9 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <span
              className="size-6 rounded-full transition-transform duration-200 group-hover/swatch:scale-125 group-aria-pressed/swatch:scale-125 group-aria-pressed/swatch:shadow-[0_0_0_2px_white]"
              style={{ background: theme.vivid }}
            />
          </button>
        ))}
      </div>
    </fieldset>
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
  const { dispatch } = useStore()
  const [note, setNote] = useState("")
  const [askingMinimum, setAskingMinimum] = useState(false)
  const [minimum, setMinimum] = useState("")

  function saveMinimum() {
    const value = minimum.trim()
    if (value) {
      dispatch({
        type: "edit-task",
        id: task.id,
        at: nowIso(),
        patch: { minimumVersion: value },
      })
    }
    onOutcome("minimum", note)
  }

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
          className="mt-1 h-11 px-3.5"
        />
      </div>
      <div
        role="group"
        aria-label="What came of it"
        className="grid gap-2 sm:grid-cols-3"
      >
        <button
          type="button"
          style={{ "--tile": "var(--sky)" } as React.CSSProperties}
          className="bot-tile"
          onClick={() => onOutcome("progress", note)}
        >
          <span className="bot-tile-glyph">
            <TrendingUp className="size-4" aria-hidden />
          </span>
          I started / made progress
        </button>
        <button
          type="button"
          style={{ "--tile": "var(--butter)" } as React.CSSProperties}
          className="bot-tile"
          onClick={() =>
            task.minimumVersion
              ? onOutcome("minimum", note)
              : setAskingMinimum(true)
          }
        >
          <span className="bot-tile-glyph">
            <SunGlyph fill="half" className="size-5" />
          </span>
          I completed the minimum version
        </button>
        <button
          type="button"
          style={{ "--tile": "var(--mint)" } as React.CSSProperties}
          className="bot-tile"
          onClick={() => onOutcome("completed", note)}
        >
          <span className="bot-tile-glyph">
            <SunGlyph fill="full" className="size-5" />
          </span>
          I completed the original task
        </button>
      </div>
      {askingMinimum && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            saveMinimum()
          }}
        >
          <div className="min-w-0 flex-1">
            <label htmlFor="minimum-did" className="block text-sm font-medium">
              What did you do?
            </label>
            <Input
              id="minimum-did"
              autoFocus
              value={minimum}
              maxLength={300}
              onChange={(event) => setMinimum(event.target.value)}
              className="mt-1 h-11"
            />
          </div>
          <Button type="submit" size="xl" variant="outline">
            Save
          </Button>
        </form>
      )}
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
      <div
        style={taskColorVars(task.id, task.focusTheme)}
        className="bot-stage bot-rise space-y-3 p-5 sm:p-7"
      >
        
        <h2 className="bot-stage-title">
          {formatMinutes(session.actualSeconds)} of focus, done.
        </h2>
        <p className="text-sm font-medium">
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
      </div>
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
    <div
      style={taskColorVars(task?.id ?? "focus", task?.focusTheme)}
      className="bot-stage bot-rise space-y-4 p-5 sm:p-7"
    >
      
      <div>
        <h2 className="bot-stage-title">
          {formatMinutes(session.actualSeconds)} of focus, done.
        </h2>
        {task ? (
          <p className="mt-1 text-[15px] font-medium">
            Saved to “{task.title}”. The task stays open until you say it’s
            finished.
          </p>
        ) : (
          <p className="mt-1 text-[15px] font-medium">
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
          variant="soft"
          onClick={() => startNext("focus", session.plannedMinutes)}
        >
          Another {session.plannedMinutes} minutes
        </Button>
        {task && task.status !== "completed" && (
          <Button
            type="button"
            size="xl"
            variant="soft"
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
    </div>
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
        className="mb-2 font-heading text-lg"
      >
        Session history
      </h2>
      <SessionList sessions={state.focusSessions} />
    </section>
  )
}
