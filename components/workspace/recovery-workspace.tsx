"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowLeft,
  Check,
  Copy,
  FlaskConical,
  HelpCircle,
  Minimize2,
  NotebookPen,
  Pause,
  Pencil,
  Play,
  Plus,
  Shuffle,
  Sparkles,
  Timer,
  Trash2,
  UserRound,
} from "lucide-react"

import { Card, LoadingNotice, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ActiveTimer, useStartFocus } from "@/components/workspace/focus-view"
import { ReleaseDialog, useStatusChange } from "@/components/workspace/status"
import { nowIso, useStore } from "@/components/workspace/store"
import type { CaseIntent } from "@/components/workspace/store"
import { SupportNotice } from "@/components/workspace/support-notice"
import {
  WorkingEditor,
  useWorkingEditor,
} from "@/components/workspace/working-editor"
import { isCrisisText } from "@/lib/guards"
import { requestCasePlan } from "@/lib/recovery-client"
import {
  CASE_STATUS_LABEL,
  RELEASE_CAUTION,
  caseContext,
  caseStatus,
  emptyRealityCheck,
  isConsequential,
  messageDraftFor,
  pathGuidance,
  pathLabel,
  toolsFor,
} from "@/lib/recovery/case-engine"
import type { CaseContext, CasePurpose } from "@/lib/recovery/case-engine"
import type { CaseRequest } from "@/lib/schemas"
import { formatDateTime } from "@/lib/workspace/dates"
import {
  BLOCKERS,
  BLOCKER_LABEL,
  RECOVERY_PATHS,
  STUCK_LABEL,
  STUCK_REASONS,
  isActive,
} from "@/lib/workspace/schemas"
import type {
  Blocker,
  RealityCheckAnswers,
  RealityGap,
  RecoveryCase,
  RecoveryPath,
  StuckReason,
  Task,
} from "@/lib/workspace/schemas"
import { cn } from "@/lib/utils"

const RESUME_AFTER_MS = 3 * 24 * 60 * 60 * 1000

type RunOptions = {
  overrides?: Partial<CaseContext>
  stuckReason?: StuckReason
  stuckDetail?: string
}

/** The one way a case gets a suggestion, in either mode. */
export function useCaseAssist(task: Task) {
  const { mode, dispatch } = useStore()
  const [pending, setPending] = useState(false)
  const [fellBack, setFellBack] = useState(false)
  const [concern, setConcern] = useState(false)
  const latest = useRef(task)
  useEffect(() => {
    latest.current = task
  }, [task])

  const run = useCallback(
    async (purpose: CasePurpose, options: RunOptions = {}) => {
      const current = latest.current
      const recovery = current.recoveryCase
      if (!recovery) return
      const context = { ...caseContext(current), ...options.overrides }
      if (
        isCrisisText(`${context.originalInput} ${options.stuckDetail ?? ""}`)
      ) {
        setConcern(true)
        return
      }
      const request: CaseRequest = {
        stage: "recovery-case",
        purpose,
        originalInput: context.originalInput.slice(0, 4000),
        title: context.title,
        blocker: context.blocker,
        path: context.path,
        current: recovery.current?.text ?? "",
        alternatives: recovery.alternatives.slice(0, 12),
        completed: context.completed.slice(-30),
        tried: context.tried.slice(-40),
        stuckReason: options.stuckReason ?? null,
        stuckDetail: options.stuckDetail ?? "",
        realityGap: context.realityGap,
        realityCheck: context.realityCheck,
      }
      setPending(true)
      const plan = await requestCasePlan(mode, request)
      setPending(false)
      setFellBack(Boolean(plan.usedFallback))
      if (plan.supportConcern) {
        setConcern(true)
        return
      }
      if (purpose === "understand") {
        dispatch({
          type: "case-understood",
          id: current.id,
          title: plan.title ?? null,
          suggestedBlocker: plan.suggestedBlocker ?? null,
        })
        return
      }
      dispatch({ type: "case-apply-plan", id: current.id, at: nowIso(), plan })
    },
    [dispatch, mode]
  )

  return {
    run,
    pending,
    fellBack,
    concern,
    clearConcern: () => setConcern(false),
  }
}

export function RecoveryWorkspace({
  id,
  intent,
}: {
  id: string
  intent?: CaseIntent
}) {
  const { state, navigate } = useStore()
  const task = state.tasks.find((item) => item.id === id)
  if (!task?.recoveryCase) {
    return (
      <div className="text-center">
        <ScreenHeading>This isn’t here anymore</ScreenHeading>
        <Button
          type="button"
          size="xl"
          className="mt-4"
          onClick={() => navigate({ view: "workspace" })}
        >
          Back to the start
        </Button>
      </div>
    )
  }
  return <CaseBody key={task.id} task={task} intent={intent} />
}

function CaseBody({ task, intent }: { task: Task; intent?: CaseIntent }) {
  const { dispatch, navigate } = useStore()
  const recovery = task.recoveryCase!
  const assist = useCaseAssist(task)
  const [stuckOpen, setStuckOpen] = useState(intent === "stuck")

  // A choice made elsewhere, such as "make it smaller" from the resume prompt.
  const applied = useRef(false)
  useEffect(() => {
    if (!intent || applied.current) return
    applied.current = true
    const at = nowIso()
    dispatch({ type: "case-resume", id: task.id, at })
    if (intent === "smaller" && recovery.current) assist.run("smaller")
    if (intent === "reconsider") {
      dispatch({
        type: "case-update",
        id: task.id,
        at,
        patch: {
          openTools: [...new Set([...recovery.openTools, "paths" as const])],
        },
      })
    }
    // Runs once, for the choice this page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent])

  function chooseBlocker(blocker: Blocker) {
    dispatch({ type: "case-set-blocker", id: task.id, at: nowIso(), blocker })
    assist.run("initial", {
      overrides: {
        blocker,
        // Finished steps and earlier ideas stay in view of the next suggestion.
        tried: recovery.current
          ? [...recovery.tried, recovery.current.text]
          : recovery.tried,
      },
    })
  }

  if (assist.concern) {
    return (
      <div className="mx-auto max-w-3xl">
        <SupportNotice
          onBack={() => {
            assist.clearConcern()
            navigate({ view: "workspace" })
          }}
        />
      </div>
    )
  }

  const tools = toolsFor(recovery)
  const closed = !isActive(task)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <button
        type="button"
        onClick={() => navigate({ view: "workspace" })}
        className="flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Back
      </button>

      <ResponsibilityContext task={task} />

      {recovery.blocker && !closed && !intent && (
        <ReturnBanner task={task} onSmaller={() => assist.run("smaller")} />
      )}

      <BlockerPanel
        recovery={recovery}
        onChoose={chooseBlocker}
        locked={closed}
      />

      {assist.fellBack && (
        <p
          role="status"
          className="rounded-xl bg-sand-soft p-3 text-sm text-sand"
        >
          Live AI couldn’t answer, so this is a built-in suggestion instead.
          Nothing you entered was lost.
        </p>
      )}

      {recovery.blocker && (
        <>
          <NextActionCard
            task={task}
            assist={assist}
            stuckOpen={stuckOpen}
            setStuckOpen={setStuckOpen}
          />
          {tools.has("reality-gap") && <RealityGapTool task={task} />}
          {tools.has("paths") && <PathsTool task={task} assist={assist} />}
          <NotesArea task={task} />
        </>
      )}
    </div>
  )
}

/* ---------- A. Responsibility context ---------- */

function ResponsibilityContext({ task }: { task: Task }) {
  const { dispatch } = useStore()
  const recovery = task.recoveryCase!
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(task.title)

  function saveTitle() {
    const value = title.trim()
    if (value && value !== task.title) {
      dispatch({
        type: "edit-task",
        id: task.id,
        at: nowIso(),
        patch: { title: value },
      })
    } else setTitle(task.title)
    setRenaming(false)
  }

  return (
    <header className="space-y-3">
      <div>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">
          {CASE_STATUS_LABEL[caseStatus(task)]}
        </span>
        {renaming ? (
          <div className="mt-2 flex flex-wrap gap-2">
            <label htmlFor="case-title" className="sr-only">
              Name of this responsibility
            </label>
            <Input
              id="case-title"
              value={title}
              maxLength={200}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveTitle()
              }}
              className="h-11 min-w-0 flex-1"
            />
            <Button type="button" size="xl" onClick={saveTitle}>
              Save
            </Button>
          </div>
        ) : (
          <div className="mt-2 flex items-start gap-1">
            <ScreenHeading className="min-w-0 break-words">
              {task.title}
            </ScreenHeading>
            <button
              type="button"
              aria-label="Rename this"
              title="Rename this"
              onClick={() => setRenaming(true)}
              className="mt-1 grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <Pencil className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <div className="flex items-center gap-2">
          <label htmlFor="case-deadline" className="text-muted-foreground">
            Deadline, if you know it
          </label>
          <input
            id="case-deadline"
            type="date"
            max="9999-12-31"
            value={task.deadline ?? ""}
            onChange={(event) =>
              dispatch({
                type: "set-deadline",
                id: task.id,
                at: nowIso(),
                deadline: event.target.value || null,
              })
            }
            className="h-10 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          />
        </div>
      </div>

      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 font-medium text-muted-foreground">
          What you wrote
          {recovery.completed.length > 0 &&
            `, and what’s done so far (${recovery.completed.length})`}
        </summary>
        <p className="mt-1 break-words whitespace-pre-wrap">
          “{recovery.originalInput}”
        </p>
        {recovery.completed.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {recovery.completed.map((item) => (
              <li key={item.id} className="flex gap-2">
                <Check
                  className="mt-0.5 size-4 shrink-0 text-sage"
                  aria-hidden
                />
                <span className="min-w-0 break-words">
                  {item.text}
                  <span className="block text-xs text-muted-foreground">
                    {formatDateTime(item.at)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </header>
  )
}

/* ---------- Coming back after some time ---------- */

function ReturnBanner({
  task,
  onSmaller,
}: {
  task: Task
  onSmaller: () => void
}) {
  const { dispatch, returning, finishReturn } = useStore()
  const recovery = task.recoveryCase!
  const [now] = useState(() => Date.now())
  const last = recovery.lastActivity?.at
  const answered =
    recovery.resumedAt && last ? recovery.resumedAt >= last : false
  const away = last ? now - Date.parse(last) >= RESUME_AFTER_MS : false
  if (!away || answered) return null

  const answer = (patch?: { reconsider: boolean }) => {
    const at = nowIso()
    if (returning) finishReturn()
    dispatch({ type: "case-resume", id: task.id, at })
    if (patch?.reconsider) {
      dispatch({
        type: "case-update",
        id: task.id,
        at,
        patch: {
          openTools: [...new Set([...recovery.openTools, "paths" as const])],
        },
      })
    }
  }

  return (
    <Card className="space-y-3 bg-secondary">
      <p className="text-[15px]">
        Last time, you were working on {task.title}. Would you like to continue,
        make the next step smaller, or reconsider the plan?
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          size="lg"
          className="min-h-11"
          onClick={() => answer()}
        >
          Continue
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="min-h-11"
          onClick={() => {
            answer()
            if (recovery.current) onSmaller()
          }}
        >
          Make the next step smaller
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="min-h-11"
          onClick={() => answer({ reconsider: true })}
        >
          Reconsider the plan
        </Button>
      </div>
    </Card>
  )
}

/* ---------- B. What's in the way ---------- */

function BlockerPanel({
  recovery,
  onChoose,
  locked,
}: {
  recovery: RecoveryCase
  onChoose: (blocker: Blocker) => void
  locked: boolean
}) {
  const [changing, setChanging] = useState(false)
  const { blocker, suggestedBlocker } = recovery

  if (blocker && !changing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl bg-secondary px-4 py-2.5">
        <p className="min-w-0 text-sm">
          <span className="text-muted-foreground">What’s in the way: </span>
          <span className="font-medium">{BLOCKER_LABEL[blocker]}</span>
        </p>
        {!locked && (
          <button
            type="button"
            onClick={() => setChanging(true)}
            className="min-h-11 rounded-md text-sm font-medium text-indigo underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            Change this
          </button>
        )}
      </div>
    )
  }

  return (
    <Card className="space-y-3">
      <div>
        <h2
          className="font-heading text-2xl leading-snug"
          id="blocker-question"
        >
          What’s making this difficult right now?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {blocker
            ? "Your notes and finished steps stay. Only the tools change."
            : "Pick the closest one. It only decides which tools to show, and you can change it any time."}
        </p>
      </div>
      <div
        role="group"
        aria-labelledby="blocker-question"
        className="grid gap-2"
      >
        {BLOCKERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={blocker === option}
            onClick={() => {
              setChanging(false)
              onChoose(option)
            }}
            className={cn(
              "flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border bg-card px-4 py-3 text-left text-[15px] transition-colors outline-none hover:border-primary/50 hover:bg-sage-soft focus-visible:ring-3 focus-visible:ring-ring/30",
              blocker === option ? "border-primary" : "border-border"
            )}
          >
            <span className="min-w-0">{BLOCKER_LABEL[option]}</span>
            {!blocker && suggestedBlocker === option && (
              <span className="text-xs text-muted-foreground">
                Closest to what you wrote
              </span>
            )}
          </button>
        ))}
      </div>
      {blocker && (
        <button
          type="button"
          onClick={() => setChanging(false)}
          className="min-h-11 rounded-md text-sm font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          Keep it as it is
        </button>
      )}
    </Card>
  )
}

/* ---------- D & E. One next action, and how it went ---------- */

export function OriginNote({ origin }: { origin: "live" | "demo" | "user" }) {
  const { Icon, text } =
    origin === "live"
      ? { Icon: Sparkles, text: "Suggested by AI. It can be wrong." }
      : origin === "user"
        ? { Icon: UserRound, text: "Your own step" }
        : { Icon: FlaskConical, text: "Built-in suggestion, not AI" }
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5" aria-hidden />
      {text}
    </p>
  )
}

export type Assist = ReturnType<typeof useCaseAssist>

function NextActionCard({
  task,
  assist,
  stuckOpen,
  setStuckOpen,
}: {
  task: Task
  assist: Assist
  stuckOpen: boolean
  setStuckOpen: (open: boolean) => void
}) {
  const { dispatch, state } = useStore()
  const recovery = task.recoveryCase!
  const { current, blocker } = recovery
  const [editing, setEditing] = useState(false)
  const [peek, setPeek] = useState(false)
  const statusChange = useStatusChange()

  const finishedHere = state.focusSessions.find(
    (session) =>
      session.id === state.finishedSessionId && session.taskId === task.id
  )

  if (task.status === "completed" || task.status === "released") {
    return (
      <Card className="space-y-3">
        <h2 className="font-heading text-2xl">
          {task.status === "completed"
            ? "This one is finished."
            : "You’ve let this one go."}
        </h2>
        <p className="text-[15px] text-muted-foreground">
          Your notes and everything you did are still here.
        </p>
        <Button
          type="button"
          size="xl"
          variant="outline"
          onClick={() =>
            dispatch({
              type: "set-status",
              id: task.id,
              at: nowIso(),
              status: "in-progress",
            })
          }
        >
          Open it again
        </Button>
      </Card>
    )
  }

  if (task.status === "paused") {
    return (
      <Card className="space-y-3">
        <h2 className="font-heading text-2xl">This is paused.</h2>
        <p className="text-[15px] text-muted-foreground">
          {current
            ? `When you come back, the next step is still: ${current.text}`
            : "Your work is saved for when you come back."}
        </p>
        <Button
          type="button"
          size="xl"
          onClick={() =>
            dispatch({
              type: "set-status",
              id: task.id,
              at: nowIso(),
              status: "in-progress",
            })
          }
        >
          <Play aria-hidden />
          Pick it back up
        </Button>
      </Card>
    )
  }

  const started = Boolean(current?.startedAt)
  const smaller = () => assist.run("smaller")
  const finishAll = () =>
    dispatch({
      type: "set-status",
      id: task.id,
      at: nowIso(),
      status: "completed",
    })

  return (
    <section aria-labelledby="next-step-heading">
      <Card className="space-y-4 p-6 sm:p-7">
        {recovery.adaptationNote && (
          <p className="rounded-xl bg-indigo-soft p-3 text-sm leading-relaxed text-indigo">
            {recovery.adaptationNote}
          </p>
        )}

        {recovery.missingDetail && (
          <MissingDetail task={task} assist={assist} />
        )}

        {assist.pending ? (
          <LoadingNotice>Working out a next step...</LoadingNotice>
        ) : current ? (
          <div>
            <div className="flex flex-wrap items-center justify-between gap-x-3">
              <h2
                id="next-step-heading"
                className="font-sans text-sm font-medium tracking-normal text-sage"
              >
                {started ? "You’re on this step" : "Your next step"}
              </h2>
              <OriginNote origin={current.origin} />
            </div>
            {editing ? (
              <WriteOwnStep
                label="Your next step"
                initial={current.text}
                onSave={(text) => {
                  dispatch({
                    type: "case-write-action",
                    id: task.id,
                    at: nowIso(),
                    text,
                  })
                  setEditing(false)
                }}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <div className="mt-1 flex items-start gap-1">
                <p
                  data-testid="next-action"
                  className="min-w-0 font-heading text-[1.625rem] leading-snug break-words sm:text-[2rem]"
                >
                  {current.text}
                </p>
                <button
                  type="button"
                  aria-label="Change this step"
                  title="Change this step"
                  onClick={() => setEditing(true)}
                  className="mt-1 grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
              </div>
            )}
            {current.why && !editing && (
              <p className="mt-1.5 text-sm text-muted-foreground">
                {current.why}
              </p>
            )}
          </div>
        ) : blocker === "behind" && !recovery.path ? (
          <div>
            <h2
              id="next-step-heading"
              className="font-heading text-2xl leading-snug"
            >
              Your next step comes after you choose how to handle this.
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Fill in what you can below, then choose Finish, Reduce, or
              Release.
            </p>
          </div>
        ) : recovery.openTools.includes("paths") && !recovery.path ? (
          <h2
            id="next-step-heading"
            className="font-heading text-2xl leading-snug"
          >
            Choose how you want to handle this, below.
          </h2>
        ) : (
          <NothingQueued
            task={task}
            assist={assist}
            statusChange={statusChange}
          />
        )}

        {current && !assist.pending && !editing && (
          <>
            {!started && !stuckOpen && (
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <Button
                  type="button"
                  size="xl"
                  onClick={() =>
                    dispatch({
                      type: "case-start-action",
                      id: task.id,
                      at: nowIso(),
                    })
                  }
                >
                  <Play aria-hidden />
                  {blocker === "cant-start" ? "Start" : "Start with this"}
                </Button>
                <Button
                  type="button"
                  size="xl"
                  variant="outline"
                  onClick={smaller}
                >
                  <Minimize2 aria-hidden />
                  Make it smaller
                </Button>
              </div>
            )}

            {(blocker === "cant-start" || started) && !stuckOpen && (
              <TimerArea task={task} />
            )}

            {finishedHere ? (
              <TimerFinished
                task={task}
                minutes={finishedHere.plannedMinutes}
                sessionId={finishedHere.id}
                onStuck={() => setStuckOpen(true)}
              />
            ) : stuckOpen ? (
              <StuckPanel
                recovery={recovery}
                onCancel={() => setStuckOpen(false)}
                onAnswer={(reason, detail) => {
                  setStuckOpen(false)
                  const at = nowIso()
                  dispatch({
                    type: "case-feedback",
                    id: task.id,
                    at,
                    feedback: { kind: "stuck", reason, detail, at },
                  })
                  assist.run("stuck", {
                    stuckReason: reason,
                    stuckDetail: detail,
                  })
                }}
              />
            ) : (
              <div className="border-t border-border pt-4">
                <p className="mb-2 text-sm font-medium" id="how-it-went">
                  How is it going?
                </p>
                <div
                  role="group"
                  aria-labelledby="how-it-went"
                  className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
                >
                  <Button
                    type="button"
                    size="xl"
                    variant={started ? "default" : "outline"}
                    onClick={() =>
                      dispatch({
                        type: "case-complete-action",
                        id: task.id,
                        at: nowIso(),
                      })
                    }
                  >
                    <Check aria-hidden />I did it
                  </Button>
                  <Button
                    type="button"
                    size="xl"
                    variant="outline"
                    onClick={() => setStuckOpen(true)}
                  >
                    <HelpCircle aria-hidden />
                    I’m stuck
                  </Button>
                  <Button
                    type="button"
                    size="xl"
                    variant="outline"
                    onClick={() => {
                      const at = nowIso()
                      dispatch({
                        type: "case-feedback",
                        id: task.id,
                        at,
                        feedback: {
                          kind: "another",
                          reason: null,
                          detail: "",
                          at,
                        },
                      })
                      assist.run("another")
                    }}
                  >
                    <Shuffle aria-hidden />
                    Try another approach
                  </Button>
                </div>
              </div>
            )}

            {recovery.queue.length > 0 && blocker === "dont-know-start" && (
              <div>
                <button
                  type="button"
                  aria-expanded={peek}
                  onClick={() => setPeek(!peek)}
                  className="min-h-11 rounded-md text-sm font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                >
                  {peek ? "Hide what comes after" : "What comes after this?"}
                </button>
                {peek && (
                  <p className="text-sm text-muted-foreground">
                    After this: {recovery.queue[0]}
                  </p>
                )}
              </div>
            )}
          </>
        )}

        {!assist.pending && (
          <QuietControls
            task={task}
            onPause={() =>
              dispatch({ type: "case-pause", id: task.id, at: nowIso() })
            }
            onFinish={finishAll}
          />
        )}
      </Card>
      <ReleaseDialog {...statusChange.dialog} />
    </section>
  )
}

export function WriteOwnStep({
  label,
  initial = "",
  onSave,
  onCancel,
}: {
  label: string
  initial?: string
  onSave: (text: string) => void
  onCancel?: () => void
}) {
  const [text, setText] = useState(initial)
  const inputId = `own-step-${label.replace(/\W+/g, "-").toLowerCase()}`
  return (
    <form
      className="mt-1 space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (text.trim()) onSave(text)
      }}
    >
      <label htmlFor={inputId} className="block text-sm font-medium">
        {label}
      </label>
      <Input
        id={inputId}
        value={text}
        maxLength={300}
        onChange={(event) => setText(event.target.value)}
        className="h-11"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="lg"
          className="min-h-11"
          disabled={!text.trim()}
        >
          Save this step
        </Button>
        {onCancel && (
          <Button
            type="button"
            size="lg"
            variant="ghost"
            className="min-h-11"
            onClick={onCancel}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

function MissingDetail({ task, assist }: { task: Task; assist: Assist }) {
  const { dispatch } = useStore()
  const recovery = task.recoveryCase!
  const [text, setText] = useState("")
  const [skipped, setSkipped] = useState(false)
  if (skipped) return null
  return (
    <form
      className="space-y-2 rounded-xl bg-secondary p-3.5"
      onSubmit={(event) => {
        event.preventDefault()
        const value = text.trim()
        if (!value) return
        const input = `${recovery.originalInput} ${value}`
        dispatch({
          type: "case-answer-detail",
          id: task.id,
          at: nowIso(),
          text: value,
        })
        assist.run("initial", {
          overrides: {
            originalInput: input,
            title: /^Something I/.test(task.title) ? value : task.title,
            tried: recovery.current
              ? [...recovery.tried, recovery.current.text]
              : recovery.tried,
          },
        })
      }}
    >
      <label htmlFor="missing-detail" className="block text-sm font-medium">
        {recovery.missingDetail}
      </label>
      <Input
        id="missing-detail"
        value={text}
        maxLength={300}
        onChange={(event) => setText(event.target.value)}
        className="h-11 bg-card"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          size="lg"
          className="min-h-11"
          disabled={!text.trim()}
        >
          Use this
        </Button>
        <Button
          type="button"
          size="lg"
          variant="ghost"
          className="min-h-11"
          onClick={() => setSkipped(true)}
        >
          Skip for now
        </Button>
      </div>
    </form>
  )
}

/** Nothing is queued: the user decides, instead of a filler step appearing. */
function NothingQueued({
  task,
  assist,
  statusChange,
}: {
  task: Task
  assist: Assist
  statusChange: ReturnType<typeof useStatusChange>
}) {
  const { dispatch } = useStore()
  const recovery = task.recoveryCase!
  const released = recovery.path === "release"
  return (
    <div className="space-y-3">
      <h2 id="next-step-heading" className="font-heading text-2xl leading-snug">
        {recovery.completed.length
          ? "That’s done. What’s next is up to you."
          : "What would you like to do first?"}
      </h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {released ? (
          <Button
            type="button"
            size="xl"
            onClick={() => statusChange.request(task, "released")}
          >
            Release this
          </Button>
        ) : (
          <Button
            type="button"
            size="xl"
            onClick={() => assist.run(recovery.path ? "path" : "initial")}
          >
            Suggest a next step
          </Button>
        )}
        {recovery.completed.length > 0 && !released && (
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={() =>
              dispatch({
                type: "set-status",
                id: task.id,
                at: nowIso(),
                status: "completed",
              })
            }
          >
            <Check aria-hidden />
            The whole thing is finished
          </Button>
        )}
      </div>
      <WriteOwnStep
        label="Or write your own next step"
        onSave={(text) =>
          dispatch({
            type: "case-write-action",
            id: task.id,
            at: nowIso(),
            text,
          })
        }
      />
    </div>
  )
}

function QuietControls({
  task,
  onPause,
  onFinish,
}: {
  task: Task
  onPause: () => void
  onFinish: () => void
}) {
  const recovery = task.recoveryCase!
  const lowEnergy =
    recovery.lastFeedback?.kind === "stuck" &&
    recovery.lastFeedback.reason === "low-energy"
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      <button
        type="button"
        onClick={onPause}
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
          lowEnergy
            ? "font-medium text-indigo"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Pause className="size-3.5" aria-hidden />
        Pause this on purpose
      </button>
      {recovery.current && recovery.completed.length > 0 && (
        <button
          type="button"
          onClick={onFinish}
          className="min-h-11 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          The whole thing is finished
        </button>
      )}
    </div>
  )
}

function TimerArea({ task }: { task: Task }) {
  const { state, navigate } = useStore()
  const start = useStartFocus({ stay: true })
  const { timer } = state
  if (timer?.taskId === task.id) return <ActiveTimer timer={timer} compact />
  if (timer) {
    const what = timer.kind === "break" ? "A break" : "A timer"
    return (
      <p className="text-sm text-muted-foreground">
        {what} is {timer.runningSince === null ? "paused" : "running"}{" "}
        elsewhere.{" "}
        <button
          type="button"
          onClick={() => navigate({ view: "focus" })}
          className="min-h-11 rounded-md font-medium text-indigo underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          Open it
        </button>
      </p>
    )
  }
  return (
    <div>
      <p className="mb-1.5 text-sm text-muted-foreground" id="timer-options">
        A timer, if it helps. It won’t mark anything done.
      </p>
      <div
        role="group"
        aria-labelledby="timer-options"
        className="flex flex-wrap gap-2"
      >
        {[2, 5].map((minutes) => (
          <Button
            key={minutes}
            type="button"
            size="lg"
            variant="outline"
            className="min-h-11"
            onClick={() => start(task.id, minutes)}
          >
            <Timer aria-hidden />
            {minutes} minutes
          </Button>
        ))}
      </div>
    </div>
  )
}

/** Time passing never finishes a step. Only the user can say that. */
function TimerFinished({
  task,
  minutes,
  sessionId,
  onStuck,
}: {
  task: Task
  minutes: number
  sessionId: string
  onStuck: () => void
}) {
  const { dispatch } = useStore()
  const report = (answer: "yes" | "a-little" | "stuck") => {
    const at = nowIso()
    dispatch({ type: "report-focus", sessionId, report: answer, at })
    dispatch({ type: "timer-acknowledge" })
    if (answer === "yes") {
      dispatch({ type: "case-complete-action", id: task.id, at })
    }
    if (answer === "stuck") onStuck()
  }
  return (
    <div className="space-y-2 rounded-xl bg-sage-soft p-3.5">
      <p className="text-[15px]" id="timer-question">
        Your {minutes} minutes are up. The step stays open until you say
        otherwise. How did it go?
      </p>
      <div
        role="group"
        aria-labelledby="timer-question"
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap"
      >
        <Button
          type="button"
          size="lg"
          className="min-h-11"
          onClick={() => report("yes")}
        >
          I did the step
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="min-h-11"
          onClick={() => report("a-little")}
        >
          I made a start
        </Button>
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="min-h-11"
          onClick={() => report("stuck")}
        >
          I got stuck
        </Button>
      </div>
    </div>
  )
}

function StuckPanel({
  recovery,
  onAnswer,
  onCancel,
}: {
  recovery: RecoveryCase
  onAnswer: (reason: StuckReason, detail: string) => void
  onCancel: () => void
}) {
  const [asking, setAsking] = useState<StuckReason | null>(null)
  const [detail, setDetail] = useState("")
  const tools = toolsFor(recovery)
  const reasons = STUCK_REASONS.filter(
    (reason) =>
      // Offer only what would change something from where they are now.
      !(reason === "worried" && tools.has("reality-gap")) &&
      !(reason === "not-viable" && tools.has("paths"))
  )

  if (asking) {
    return (
      <form
        className="space-y-2 rounded-xl bg-secondary p-3.5"
        onSubmit={(event) => {
          event.preventDefault()
          onAnswer(asking, detail.trim())
        }}
      >
        <label htmlFor="stuck-detail" className="block text-sm font-medium">
          {asking === "dont-know-how"
            ? "Which part don’t you know? (optional)"
            : "What happened? (optional)"}
        </label>
        <Input
          id="stuck-detail"
          value={detail}
          maxLength={300}
          autoFocus
          onChange={(event) => setDetail(event.target.value)}
          className="h-11 bg-card"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="lg" className="min-h-11">
            Find another way
          </Button>
          <Button
            type="button"
            size="lg"
            variant="ghost"
            className="min-h-11"
            onClick={() => setAsking(null)}
          >
            Back
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-2 rounded-xl bg-secondary p-3.5">
      <h3
        className="font-sans text-[15px] font-semibold tracking-normal"
        id="what-happened"
      >
        What happened?
      </h3>
      <div
        role="group"
        aria-labelledby="what-happened"
        className="grid gap-1.5"
      >
        {reasons.map((reason) => (
          <button
            key={reason}
            type="button"
            onClick={() =>
              reason === "dont-know-how" || reason === "other"
                ? setAsking(reason)
                : onAnswer(reason, "")
            }
            className="min-h-11 rounded-lg border border-border bg-card px-3.5 py-2 text-left text-[15px] outline-none hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            {STUCK_LABEL[reason]}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 rounded-md text-sm font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        Never mind
      </button>
    </div>
  )
}

/* ---------- C. Reality Gap ---------- */

const GAP_SECTIONS: {
  key: keyof RealityGap
  title: string
  help: string
  add: string
}[] = [
  {
    key: "known",
    title: "Known Facts",
    help: "Facts you’ve confirmed.",
    add: "Add a fact",
  },
  {
    key: "worried",
    title: "Worries / Assumptions",
    help: "These are possibilities, not facts. They may not happen.",
    add: "Add a worry",
  },
  {
    key: "unknown",
    title: "Unknowns",
    help: "Things worth finding out.",
    add: "Add a question",
  },
  {
    key: "can",
    title: "Possible Actions",
    help: "Realistic options. Choose one as your next step.",
    add: "Add an option",
  },
]

function ItemEditor({
  label,
  items,
  onChange,
  addLabel,
  renderExtra,
}: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
  addLabel: string
  renderExtra?: (item: string) => React.ReactNode
}) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="space-y-1">
          <div className="flex items-start gap-1.5">
            <label className="sr-only" htmlFor={`${label}-${index}`}>
              {label}, item {index + 1}
            </label>
            <Textarea
              id={`${label}-${index}`}
              value={item}
              maxLength={400}
              rows={1}
              onChange={(event) =>
                onChange(
                  items.map((value, at) =>
                    at === index ? event.target.value : value
                  )
                )
              }
              className="min-h-11 flex-1 bg-card"
            />
            <button
              type="button"
              aria-label={`Remove from ${label}: ${item}`}
              onClick={() => onChange(items.filter((_, at) => at !== index))}
              className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
          {renderExtra?.(item)}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <Plus className="size-4" aria-hidden />
        {addLabel}
      </button>
    </div>
  )
}

export function RealityGapTool({ task }: { task: Task }) {
  const { dispatch } = useStore()
  const recovery = task.recoveryCase!
  const gap = recovery.realityGap ?? {
    known: [],
    worried: [],
    unknown: [],
    can: [],
  }
  const update = (key: keyof RealityGap, items: string[]) =>
    dispatch({
      type: "case-update",
      id: task.id,
      at: nowIso(),
      patch: { realityGap: { ...gap, [key]: items } },
    })

  return (
    <section aria-labelledby="gap-heading">
      <Card className="space-y-5">
        <div>
          <h2 id="gap-heading" className="font-heading text-2xl">
            Reality Gap
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A first draft from what you wrote. It may have sorted something
            wrongly, so change anything here. BackOnTrack doesn’t know the
            actual rules or what will happen.
          </p>
        </div>
        {GAP_SECTIONS.map((section) => (
          <div key={section.key}>
            <h3 className="font-sans text-[15px] font-semibold tracking-normal">
              {section.title}
            </h3>
            <p className="mb-2 text-xs text-muted-foreground">{section.help}</p>
            <ItemEditor
              label={section.title}
              items={gap[section.key]}
              addLabel={section.add}
              onChange={(items) => update(section.key, items)}
              renderExtra={
                section.key === "can"
                  ? (item) =>
                      recovery.current?.text === item.trim() ? (
                        <p className="flex items-center gap-1 text-xs font-medium text-sage">
                          <Check className="size-3.5" aria-hidden />
                          Your next step
                        </p>
                      ) : item.trim() ? (
                        <button
                          type="button"
                          onClick={() =>
                            dispatch({
                              type: "case-write-action",
                              id: task.id,
                              at: nowIso(),
                              text: item,
                            })
                          }
                          className="min-h-11 rounded-md text-sm font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                        >
                          Make this my next step
                        </button>
                      ) : null
                  : undefined
              }
            />
          </div>
        ))}
        <MessageDraft task={task} />
      </Card>
    </section>
  )
}

function MessageDraft({ task }: { task: Task }) {
  const { dispatch } = useStore()
  const recovery = task.recoveryCase!
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const draft = recovery.messageDraft
  const write = (messageDraft: string) =>
    dispatch({
      type: "case-update",
      id: task.id,
      at: nowIso(),
      patch: { messageDraft },
    })

  if (!open) {
    return (
      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={() => {
            if (!draft)
              write(messageDraftFor(task.title, recovery.originalInput))
            setOpen(true)
          }}
          className="min-h-11 rounded-md text-sm font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {draft ? "See the message draft" : "Draft a message to someone"}
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <label htmlFor="message-draft" className="block text-sm font-medium">
        A message you could send
      </label>
      <p className="text-xs text-muted-foreground">
        BackOnTrack doesn’t send anything. Fill in the [brackets], and change
        whatever doesn’t sound like you.
      </p>
      <Textarea
        id="message-draft"
        value={draft}
        maxLength={2000}
        onChange={(event) => write(event.target.value)}
        className="min-h-40 bg-card"
      />
      <Button
        type="button"
        size="lg"
        variant="outline"
        className="min-h-11"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(draft)
            setCopied(true)
          } catch {
            setCopied(false)
          }
        }}
      >
        <Copy aria-hidden />
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}

/* ---------- Reality Check, and Finish / Reduce / Release ---------- */

const PATH_TEXT: Record<RecoveryPath, string> = {
  finish: "Continue toward the original outcome.",
  reduce: "Lower the scope, and keep the most valuable or necessary part.",
  release: "Consciously stop, or deprioritize this.",
}

function PathsTool({ task, assist }: { task: Task; assist: Assist }) {
  const { dispatch } = useStore()
  const recovery = task.recoveryCase!
  const answers =
    recovery.realityCheck ??
    emptyRealityCheck(recovery.originalInput, task.title)
  const [confirmingRelease, setConfirmingRelease] = useState(false)
  const consequential = isConsequential(
    `${task.title} ${recovery.originalInput}`
  )

  const update = (patch: Partial<RealityCheckAnswers>) =>
    dispatch({
      type: "case-update",
      id: task.id,
      at: nowIso(),
      patch: { realityCheck: { ...answers, ...patch } },
    })

  function choose(path: RecoveryPath) {
    setConfirmingRelease(false)
    dispatch({ type: "case-set-path", id: task.id, at: nowIso(), path })
    assist.run("path", {
      overrides: {
        path,
        realityCheck: answers,
        tried: recovery.current
          ? [...recovery.tried, recovery.current.text]
          : recovery.tried,
      },
    })
  }

  const fields: {
    key: "expected" | "happened" | "done" | "constraints"
    label: string
  }[] = [
    { key: "expected", label: "What was supposed to happen?" },
    { key: "happened", label: "What actually happened?" },
    { key: "done", label: "What’s already done, even partly?" },
    {
      key: "constraints",
      label: "Any known limits or consequences? Only what you know for sure.",
    },
  ]

  return (
    <section aria-labelledby="paths-heading">
      <Card className="space-y-5">
        <div>
          <h2 id="paths-heading" className="font-heading text-2xl">
            Reality Check
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Answer what you can. You can leave anything blank.
          </p>
        </div>
        {fields.map((field) => (
          <div key={field.key}>
            <label
              htmlFor={`check-${field.key}`}
              className="mb-1 block text-sm font-medium"
            >
              {field.label}
            </label>
            <Textarea
              id={`check-${field.key}`}
              value={answers[field.key]}
              maxLength={500}
              rows={2}
              onChange={(event) => update({ [field.key]: event.target.value })}
              className="min-h-14 bg-card"
            />
          </div>
        ))}
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">
            Is there still a meaningful chance to act on this?
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ["yes", "Yes"],
                ["no", "No"],
                ["unsure", "I’m not sure"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={answers.opportunity === value}
                onClick={() => update({ opportunity: value })}
                className={cn(
                  "min-h-11 rounded-full border px-3.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
                  answers.opportunity === value
                    ? "border-primary bg-sage-soft"
                    : "border-border bg-card"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="border-t border-border pt-5">
          <h3 className="font-heading text-xl">
            How do you want to handle this?
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {pathGuidance(`${task.title} ${recovery.originalInput}`, answers)}
          </p>
          <div
            className="mt-3 grid gap-2"
            role="group"
            aria-label="Recovery path"
          >
            {RECOVERY_PATHS.map((path) => (
              <button
                key={path}
                type="button"
                aria-pressed={recovery.path === path}
                onClick={() =>
                  path === "release" && consequential
                    ? setConfirmingRelease(true)
                    : choose(path)
                }
                className={cn(
                  "min-h-12 rounded-xl border bg-card px-4 py-3 text-left transition-colors outline-none hover:border-primary/50 focus-visible:ring-3 focus-visible:ring-ring/30",
                  recovery.path === path
                    ? "border-primary bg-sage-soft"
                    : "border-border"
                )}
              >
                <span className="block font-medium">{pathLabel(path)}</span>
                <span className="block text-sm text-muted-foreground">
                  {PATH_TEXT[path]}
                </span>
              </button>
            ))}
          </div>
          {confirmingRelease && (
            <div
              role="alert"
              className="mt-3 space-y-2 rounded-xl bg-sand-soft p-3.5 text-sm text-sand"
            >
              <p>{RELEASE_CAUTION}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="lg"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => choose("release")}
                >
                  I understand. Consider releasing it.
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => setConfirmingRelease(false)}
                >
                  Keep it for now
                </Button>
              </div>
            </div>
          )}
        </div>

        {recovery.path && recovery.queue.length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-indigo">
              The rest of this plan
            </summary>
            <div className="mt-2">
              <ItemEditor
                label="Later steps"
                items={recovery.queue}
                addLabel="Add a step"
                onChange={(queue) =>
                  dispatch({
                    type: "case-update",
                    id: task.id,
                    at: nowIso(),
                    patch: { queue },
                  })
                }
              />
            </div>
          </details>
        )}
      </Card>
    </section>
  )
}

/* ---------- F. The working area ---------- */

function NotesArea({ task }: { task: Task }) {
  const hasContent = Boolean(
    task.workDoc?.content.replace(/<[^>]*>/g, "").trim()
  )
  const [open, setOpen] = useState(hasContent)
  return (
    <section aria-label="Your notes">
      {open ? (
        <NotesEditor task={task} />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex min-h-12 w-full items-center gap-2 rounded-2xl border border-border bg-card px-5 text-left font-medium outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <NotebookPen className="size-4 text-muted-foreground" aria-hidden />
          Open notes and drafts
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            Saved in this browser
          </span>
        </button>
      )}
    </section>
  )
}

function NotesEditor({ task }: { task: Task }) {
  const { editor, dirty } = useWorkingEditor(task, false)
  return <WorkingEditor task={task} editor={editor} dirty={dirty} />
}
