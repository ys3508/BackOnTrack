"use client"

import { useEffect, useState } from "react"
import {
  Clock,
  HelpCircle,
  Inbox,
  Minimize2,
  NotebookPen,
  Pause,
  Pencil,
  Play,
  Shuffle,
  Square,
} from "lucide-react"

import { Card } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ReportedMinutes } from "@/components/workspace/calendar-overlays"
import {
  FinishedPanel,
  StopChoice,
  useNow,
  useStartFocus,
} from "@/components/workspace/focus-view"
import { DeadlineChip, TaskLink } from "@/components/workspace/parts"
import { RecoveryPanel } from "@/components/workspace/recovery-panel"
import { RescheduleForm } from "@/components/workspace/reschedule-form"
import {
  newId,
  nowIso,
  useEnterRecovery,
  useStore,
} from "@/components/workspace/store"
import { formatClockTime, formatDuration } from "@/lib/calendar/derived"
import { caseContext, demoSmaller } from "@/lib/recovery/case-engine"
import type { CaseContext } from "@/lib/recovery/case-engine"
import {
  elapsedMs,
  formatClock,
  formatMinutes,
  remainingSeconds,
} from "@/lib/focus/timer"
import { chooseBuffer } from "@/lib/today/buffer"
import type { BufferSlot } from "@/lib/today/buffer"
import { shortDate } from "@/lib/workspace/dates"
import {
  blockHasEnded,
  firstStepOf,
  minimumMet,
  nowState,
  pickAnother,
  sessionMinutes,
} from "@/lib/today/now"
import type { NowState } from "@/lib/today/now"
import type { PlannedSession, Task, TimerState } from "@/lib/workspace/schemas"
import { startCue } from "@/lib/workspace/selectors"
import { cn } from "@/lib/utils"

const quiet = "min-h-11 justify-start text-muted-foreground"

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-sans text-sm font-medium tracking-normal text-sage">
      {children}
    </h2>
  )
}

/** One step, which can always be rewritten in the user's own words. */
function StepLine({ task }: { task: Task }) {
  const { dispatch } = useStore()
  const cue = startCue(task)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(cue?.text ?? "")
  const label =
    cue?.source === "resume"
      ? "Pick up here"
      : cue?.source === "step"
        ? "Next step"
        : "What you’ll do first"

  if (editing) {
    return (
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const value = text.trim()
          // It goes back where it came from, so nothing else is overwritten.
          const patch =
            cue?.source === "resume"
              ? { resumeNote: value }
              : task.recoveryCase || cue?.source === "step"
                ? { nextAction: value }
                : { firstStep: value }
          dispatch({ type: "edit-task", id: task.id, at: nowIso(), patch })
          setEditing(false)
        }}
      >
        <label htmlFor="now-step" className="sr-only">
          {cue ? label : "What will you do first?"}
        </label>
        <Input
          id="now-step"
          autoFocus
          value={text}
          maxLength={300}
          placeholder="What will you do first?"
          onChange={(event) => setText(event.target.value)}
          className="h-11 flex-1"
        />
        <Button type="submit" size="xl" variant="outline">
          Save
        </Button>
      </form>
    )
  }
  if (!cue) {
    return (
      <button
        type="button"
        onClick={() => {
          setText("")
          setEditing(true)
        }}
        className="min-h-9 rounded-md text-sm font-medium text-indigo underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        What will you do first?
      </button>
    )
  }
  return (
    <div
      className={cn(
        "flex items-start gap-1 text-[15px]",
        cue.source === "resume" && "rounded-xl bg-sage-soft p-3"
      )}
    >
      <p className="min-w-0 flex-1 break-words">
        <span
          className={
            cue.source === "resume"
              ? "block text-sm font-medium text-sage"
              : "text-muted-foreground"
          }
        >
          {label}
          {cue.source === "resume" ? "" : ": "}
        </span>
        {cue.text}
      </p>
      <button
        type="button"
        aria-label="Edit this step"
        title="Edit this step"
        onClick={() => {
          setText(cue.text)
          setEditing(true)
        }}
        className="-mt-1.5 grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <Pencil className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}

/** A quiet line: the smaller version counted, and the task itself is still open. */
function MinimumNote({ task }: { task: Task }) {
  const { state } = useStore()
  if (task.status === "completed" || !minimumMet(state, task.id)) return null
  return (
    <p className="text-sm text-muted-foreground">
      ◐ Minimum version done. The original task is still open.
    </p>
  )
}

/** A smaller version of the step, from templates, and shorter time to go with it. */
function useMakeSmaller(task: Task) {
  const { dispatch } = useStore()
  const [tried, setTried] = useState<string[]>([])
  const [made, setMade] = useState(false)
  const [outOfIdeas, setOutOfIdeas] = useState(false)

  const makeSmaller = () => {
    const current = firstStepOf(task) ?? task.title
    const context: CaseContext = task.recoveryCase
      ? caseContext(task)
      : {
          originalInput: `${task.title} ${task.description}`.trim(),
          title: task.title,
          blocker: null,
          path: null,
          completed: [],
          tried: [],
          realityGap: null,
          realityCheck: null,
        }
    const plan = demoSmaller(
      { ...context, tried: [...context.tried, ...tried] },
      current
    )
    if (!plan.action) {
      setOutOfIdeas(true)
      return
    }
    setTried([...tried, current])
    setMade(true)
    if (task.recoveryCase) {
      dispatch({ type: "case-apply-plan", id: task.id, at: nowIso(), plan })
    } else {
      dispatch({
        type: "edit-task",
        id: task.id,
        at: nowIso(),
        // The smaller step is what's next now, ahead of an older note.
        patch: { nextAction: plan.action.text, resumeNote: "" },
      })
    }
  }
  return { makeSmaller, made, outOfIdeas }
}

function ReadyControls({
  task,
  session,
  minutes,
  label,
  extra,
}: {
  task: Task
  session?: PlannedSession
  minutes: number
  label: string
  extra?: React.ReactNode
}) {
  const start = useStartFocus({ stay: true })
  const smaller = useMakeSmaller(task)
  const [changing, setChanging] = useState(false)
  // A scheduled block keeps its own length, even after making the step smaller.
  const length = smaller.made && !session ? 5 : minutes

  if (changing) {
    return (
      <RescheduleForm
        task={task}
        session={session}
        minutes={minutes}
        onDone={() => setChanging(false)}
      />
    )
  }
  return (
    <>
      <div className="space-y-1">
        <StepLine task={task} />
        <MinimumNote task={task} />
        {smaller.made && (
          <p className="text-xs text-muted-foreground">
            A smaller way in, from a built-in suggestion, not AI. It’s yours to
            change.
          </p>
        )}
        {smaller.outOfIdeas && (
          <p className="text-sm text-muted-foreground">
            BackOnTrack is out of built-in ways to shrink this. What would feel
            possible in one minute? You can write it above.
          </p>
        )}
        <p className="text-sm text-muted-foreground">
          {label} · {formatDuration(length)}
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="button"
          size="xl"
          onClick={() => start(task.id, length, session?.id)}
        >
          <Play aria-hidden />
          Start
        </Button>
        <Button
          type="button"
          size="xl"
          variant="ghost"
          className={quiet}
          onClick={smaller.makeSmaller}
        >
          <Minimize2 aria-hidden />
          Make it smaller
        </Button>
        <Button
          type="button"
          size="xl"
          variant="ghost"
          className={quiet}
          onClick={() => setChanging(true)}
        >
          <Clock aria-hidden />
          Change time
        </Button>
        {extra}
        <TaskLink task={task} className="px-2" />
      </div>
    </>
  )
}

function Ring({ timer, now }: { timer: TimerState; now: number }) {
  const remaining = remainingSeconds(timer, now)
  const fraction = timer.plannedSeconds
    ? Math.min(1, remaining / timer.plannedSeconds)
    : 0
  const radius = 54
  const circle = 2 * Math.PI * radius
  return (
    <div className="relative size-36 shrink-0 sm:size-40">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          className="stroke-secondary"
        />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circle}
          strokeDashoffset={circle * (1 - fraction)}
          className="stroke-primary transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span
        role="timer"
        aria-label={`${formatClock(remaining)} remaining`}
        className="absolute inset-0 grid place-items-center font-heading text-3xl tabular-nums"
      >
        {formatClock(remaining)}
      </span>
    </div>
  )
}

function ParkingLot({ taskId }: { taskId: string | null }) {
  const { state, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [saved, setSaved] = useState(false)
  const count = state.parkingLot.length
  if (!open) {
    return (
      <Button
        type="button"
        size="xl"
        variant="ghost"
        className={quiet}
        onClick={() => setOpen(true)}
      >
        <NotebookPen aria-hidden />
        Parking Lot{count > 0 && ` (${count})`}
      </Button>
    )
  }
  return (
    <form
      className="w-full space-y-1"
      onSubmit={(event) => {
        event.preventDefault()
        if (!text.trim()) return
        dispatch({
          type: "park-thought",
          id: newId(),
          at: nowIso(),
          text,
          taskId,
        })
        setText("")
        setSaved(true)
      }}
    >
      <label htmlFor="parking-lot" className="block text-sm font-medium">
        Park a stray thought, and keep going
      </label>
      <div className="flex gap-2">
        <Input
          id="parking-lot"
          autoFocus
          value={text}
          maxLength={300}
          onChange={(event) => {
            setText(event.target.value)
            setSaved(false)
          }}
          className="h-11 flex-1"
        />
        <Button
          type="submit"
          size="xl"
          variant="outline"
          disabled={!text.trim()}
        >
          Save
        </Button>
        <Button
          type="button"
          size="xl"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Close
        </Button>
      </div>
      <p role="status" className="min-h-5 text-xs text-muted-foreground">
        {saved ? "Saved. It’ll be below when you’re done." : ""}
      </p>
    </form>
  )
}

function SessionCard({
  timer,
  task,
  paused,
}: {
  timer: TimerState
  task: Task | null
  paused: boolean
}) {
  const { dispatch } = useStore()
  const now = useNow(!paused)
  const [stopping, setStopping] = useState(false)
  const [adjusting, setAdjusting] = useState(false)
  const isBreak = timer.kind === "break"
  const elapsed = Math.floor(elapsedMs(timer, now) / 1000)
  const remaining = remainingSeconds(timer, now)
  const title = isBreak ? "Break" : (task?.title ?? "Focus session")

  const end = () =>
    isBreak ? dispatch({ type: "timer-cancel" }) : setStopping(true)

  return (
    <Card className="space-y-4 p-6 sm:p-8">
      <Label>{paused ? "Paused" : isBreak ? "On a break" : "Working on"}</Label>
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        <Ring timer={timer} now={now} />
        <div className="w-full min-w-0 flex-1 space-y-2">
          <p className="font-heading text-[1.625rem] leading-tight break-words sm:text-[2rem]">
            {title}
          </p>
          <p className="text-sm text-muted-foreground">
            {paused
              ? `${formatMinutes(elapsed)} so far, with ${formatClock(remaining)} left`
              : `${formatMinutes(elapsed)} in, ${formatClock(remaining)} left`}
          </p>
          {task && !isBreak && <StepLine task={task} />}
          {task && !isBreak && <MinimumNote task={task} />}
        </div>
      </div>
      {adjusting && task ? (
        <RescheduleForm
          task={task}
          minutes={timer.plannedSeconds / 60}
          onDone={() => setAdjusting(false)}
        />
      ) : stopping ? (
        <StopChoice
          timer={timer}
          task={task ?? undefined}
          onCancel={() => setStopping(false)}
        />
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {paused ? (
            <Button
              type="button"
              size="xl"
              onClick={() =>
                dispatch({ type: "timer-resume", now: Date.now() })
              }
            >
              <Play aria-hidden />
              Resume
            </Button>
          ) : (
            <Button
              type="button"
              size="xl"
              onClick={() => dispatch({ type: "timer-pause", now: Date.now() })}
            >
              <Pause aria-hidden />
              Pause
            </Button>
          )}
          <Button
            type="button"
            size="xl"
            variant="ghost"
            className={quiet}
            onClick={end}
          >
            <Square aria-hidden />
            {isBreak ? "End break" : "End session"}
          </Button>
          {paused && task && !isBreak && (
            <Button
              type="button"
              size="xl"
              variant="ghost"
              className={quiet}
              onClick={() => setAdjusting(true)}
            >
              <Clock aria-hidden />
              Adjust plan
            </Button>
          )}
          {task && !isBreak && <TaskLink task={task} className="px-2" />}
          {!paused && !isBreak && <ParkingLot taskId={timer.taskId} />}
        </div>
      )}
    </Card>
  )
}

/** A short time they say they spent, for when no timer was running. */
function WorkedOnThis({ session }: { session: PlannedSession }) {
  const { dispatch } = useStore()
  const [confirming, setConfirming] = useState(false)
  const answer = (outcome: "did" | "didnt", minutes?: number) =>
    dispatch({
      type: "planned-outcome",
      at: nowIso(),
      id: session.id,
      outcome,
      sessionId: newId(),
      minutes,
    })
  return (
    <div className="space-y-2 rounded-xl bg-secondary p-3.5 text-sm">
      <p id="worked-question" className="font-medium">
        Did you work on this?
      </p>
      {confirming ? (
        <ReportedMinutes
          planned={session.minutes}
          onSave={(minutes) => answer("did", minutes)}
          onCancel={() => setConfirming(false)}
          cancelLabel="Back"
        />
      ) : (
        <div
          role="group"
          aria-labelledby="worked-question"
          className="flex flex-wrap gap-2"
        >
          <Button
            type="button"
            size="lg"
            variant="outline"
            className="min-h-11"
            onClick={() => setConfirming(true)}
          >
            Yes
          </Button>
          <Button
            type="button"
            size="lg"
            variant="ghost"
            className="min-h-11"
            onClick={() => answer("didnt")}
          >
            Not yet
          </Button>
        </div>
      )}
    </div>
  )
}

function bufferLabel(slot: BufferSlot, today: string) {
  const time = formatClockTime(new Date(`${slot.date}T${slot.time}:00`))
  return slot.date === today
    ? `Today, ${time}`
    : `${shortDate(slot.date)}, ${time}`
}

function MissedCard({
  task,
  session,
  now,
}: {
  task: Task
  session: PlannedSession
  now: number
}) {
  const { state, dispatch, today } = useStore()
  const start = useStartFocus({ stay: true })
  const enterRecovery = useEnterRecovery()
  const [changing, setChanging] = useState(false)
  const [choosing, setChoosing] = useState<{
    slots: BufferSlot[]
    needed: number
  } | null>(null)
  const when = formatClockTime(new Date(`${session.date}T${session.time}:00`))

  useEffect(() => {
    dispatch({
      type: "recovery-shown",
      at: nowIso(),
      taskId: task.id,
      plannedId: session.id,
    })
  }, [dispatch, task.id, session.id])

  function moveTo(slot: BufferSlot, minutes: number) {
    const at = nowIso()
    dispatch({
      type: "move-planned",
      at,
      id: session.id,
      date: slot.date,
      time: slot.time,
    })
    if (minutes !== session.minutes) {
      dispatch({ type: "resize-planned", at, id: session.id, minutes })
    }
    dispatch({ type: "recovery-action", at, taskId: task.id })
  }

  function moveToBuffer() {
    const choice = chooseBuffer(state, session, today, now)
    if (choice.kind === "fits") moveTo(choice.slot, session.minutes)
    else setChoosing({ slots: choice.slots, needed: choice.needed })
  }

  return (
    <Card className="space-y-4 p-6 sm:p-8">
      <div>
        <Label>Still here when you’re ready</Label>
        <p className="mt-1 font-heading text-[1.625rem] leading-tight break-words sm:text-[2rem]">
          {task.title}
        </p>
        <p className="mt-2 text-[15px]">
          You planned to start this at {when}, but haven’t started yet.
        </p>
        <div className="mt-1">
          <DeadlineChip task={task} />
        </div>
      </div>
      {changing ? (
        <RescheduleForm
          fromRecovery
          task={task}
          session={session}
          minutes={session.minutes}
          onDone={() => setChanging(false)}
        />
      ) : choosing ? (
        <div className="space-y-2 rounded-xl bg-secondary p-3.5 text-sm">
          {choosing.slots.length ? (
            <>
              <p>
                This is planned for {formatDuration(choosing.needed)}, and no
                buffer left today has that much room. Nothing has moved. You
                could:
              </p>
              <ul className="space-y-1.5">
                {choosing.slots.map((slot) => {
                  const shorter = slot.minutes < choosing.needed
                  return (
                    <li key={`${slot.date}-${slot.time}`}>
                      <Button
                        type="button"
                        size="lg"
                        variant="outline"
                        className="h-auto min-h-11 py-1.5 text-left whitespace-normal"
                        onClick={() =>
                          moveTo(slot, Math.min(slot.minutes, choosing.needed))
                        }
                      >
                        {shorter
                          ? `Use a shorter session: ${formatDuration(slot.minutes)}, ${bufferLabel(slot, today)}`
                          : `Choose another buffer: ${bufferLabel(slot, today)}`}
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <p>There’s no free buffer today or tomorrow. Nothing has moved.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="min-h-11"
              onClick={() => {
                setChoosing(null)
                setChanging(true)
              }}
            >
              Reschedule manually
            </Button>
            <Button
              type="button"
              size="lg"
              variant="ghost"
              className="min-h-11"
              onClick={() => setChoosing(null)}
            >
              Back
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Button
              type="button"
              size="xl"
              onClick={() => start(task.id, 5, session.id, true)}
            >
              <Play aria-hidden />
              Do 5 minutes now
            </Button>
            <Button
              type="button"
              size="xl"
              variant="ghost"
              className={quiet}
              onClick={moveToBuffer}
            >
              <Inbox aria-hidden />
              Move to buffer
            </Button>
            <Button
              type="button"
              size="xl"
              variant="ghost"
              className={quiet}
              onClick={() => setChanging(true)}
            >
              <Clock aria-hidden />
              Reschedule
            </Button>
            <Button
              type="button"
              size="xl"
              variant="ghost"
              className={quiet}
              onClick={() => enterRecovery(task.id, session.id)}
            >
              <HelpCircle aria-hidden />
              I’m stuck
            </Button>
          </div>
          {blockHasEnded(session, now) && <WorkedOnThis session={session} />}
        </>
      )}
    </Card>
  )
}

function StuckLink({
  taskId,
  plannedId,
}: {
  taskId: string
  plannedId: string
}) {
  const enterRecovery = useEnterRecovery()
  return (
    <button
      type="button"
      onClick={() => enterRecovery(taskId, plannedId)}
      className="min-h-11 rounded-md px-2 text-left text-sm font-medium text-muted-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      I’m stuck
    </button>
  )
}

/** Exactly one thing to do next, with one main button. */
export function NowCard({ empty }: { empty: React.ReactNode }) {
  const { state, today, settings } = useNowStore()
  const now = useNow(true)
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [kept, setKept] = useState<string | null>(null)
  const current: NowState = nowState(state, today, now, pickedId)

  if (current.kind === "active" || current.kind === "paused") {
    return (
      <SessionCard
        key={current.timer.id}
        timer={current.timer}
        task={current.task}
        paused={current.kind === "paused"}
      />
    )
  }
  if (current.kind === "finished") {
    return <FinishedPanel session={current.session} onTask wrapOnly />
  }
  if (current.kind === "recovering") {
    return <RecoveryPanel task={current.task} recovery={current.recovery} />
  }
  if (current.kind === "missed") {
    return (
      <MissedCard
        key={current.session.id}
        task={current.task}
        session={current.session}
        now={now}
      />
    )
  }
  if (current.kind === "empty") return <>{empty}</>

  const { task } = current
  const session = current.kind === "upcoming" ? current.session : undefined
  const label = session
    ? `At ${formatClockTime(new Date(`${session.date}T${session.time}:00`))}`
    : "Suggested for now"
  return (
    <Card className="space-y-4 p-6 sm:p-8">
      <div>
        <Label>{session ? "Coming up" : "You could start with"}</Label>
        <p className="mt-1 font-heading text-[1.625rem] leading-tight break-words sm:text-[2rem]">
          {task.title}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3">
          <DeadlineChip task={task} />
          {current.kind === "suggested" && current.reason && (
            <span className="text-xs text-muted-foreground">
              {current.reason}
            </span>
          )}
        </div>
      </div>
      <ReadyControls
        key={task.id}
        task={task}
        session={session}
        minutes={session?.minutes ?? sessionMinutes(task, settings)}
        label={label}
        extra={
          session ? (
            <StuckLink taskId={task.id} plannedId={session.id} />
          ) : (
            current.kind === "suggested" && (
              <Button
                type="button"
                size="xl"
                variant="ghost"
                className={quiet}
                onClick={() => {
                  const next = pickAnother(state, today, task.id)
                  setPickedId(next.id)
                  setKept(next.keptBecause)
                }}
              >
                <Shuffle aria-hidden />
                Pick one for me
              </Button>
            )
          )
        }
      />
      {kept && (
        <p role="status" className="text-sm text-muted-foreground">
          {kept}
        </p>
      )}
    </Card>
  )
}

function useNowStore() {
  const { state, today } = useStore()
  return { state, today, settings: state.settings }
}
