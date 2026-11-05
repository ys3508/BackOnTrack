"use client"

import { useState } from "react"
import { Copy, CornerDownRight, RefreshCw, X } from "lucide-react"

import { ChoiceGroup } from "@/components/screens/intake"
import {
  DecisionWhy,
  ReleaseCaution,
  StrategyCards,
} from "@/components/screens/decision"
import { RealityCheckContent } from "@/components/screens/reality-check"
import {
  Card,
  ErrorNotice,
  LoadingNotice,
  ScreenHeading,
  SourceBadge,
} from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useAiConsent } from "@/components/workspace/ai-consent"
import { ExpandableList, StatusBadge } from "@/components/workspace/parts"
import { QuickAdd } from "@/components/workspace/quick-add"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { OBSTACLE_LABEL } from "@/lib/intake"
import { buildRecoveryRequest } from "@/lib/recovery/context"
import { requestTaskRecovery } from "@/lib/recovery-client"
import type { ObstacleChoice, RejectedPlan, Strategy } from "@/lib/schemas"
import { shortDate } from "@/lib/workspace/dates"
import { isActive } from "@/lib/workspace/schemas"
import type { StoredRecovery, Task } from "@/lib/workspace/schemas"
import {
  currentSubtask,
  tasksNeedingAttention,
  usefulSmallerSteps,
} from "@/lib/workspace/selectors"

export function RecoverView({ taskId }: { taskId?: string }) {
  const { state, navigate } = useStore()
  const task = state.tasks.find((item) => item.id === taskId)
  if (taskId && !task) {
    return (
      <div className="text-center">
        <ScreenHeading>This task isn’t here anymore</ScreenHeading>
        <Button
          type="button"
          size="xl"
          className="mt-4"
          onClick={() => navigate({ view: "recover" })}
        >
          Choose another task
        </Button>
      </div>
    )
  }
  return task ? <RecoverTask key={task.id} task={task} /> : <ChooseTask />
}

function ChooseTask() {
  const { state, today, navigate } = useStore()
  const attention = tasksNeedingAttention(state, today)
  const others = state.tasks.filter(
    (task) => isActive(task) && !attention.includes(task)
  )
  const open = (task: Task) => navigate({ view: "recover", taskId: task.id })

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <ScreenHeading>Which task are you stuck on?</ScreenHeading>
      <ExpandableList
        items={[...attention, ...others]}
        limit={state.settings.homeListSize + 2}
        label="tasks"
        empty="No active tasks yet."
        render={(task) => (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => open(task)}
              className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-3.5 py-2.5 text-left outline-none hover:border-primary/40 focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <span className="min-w-0 font-medium break-words">
                {task.title}
              </span>
              <StatusBadge status={task.status} />
            </button>
          </li>
        )}
      />
      <Card>
        <h2 className="mb-2 font-sans text-[15px] font-semibold tracking-normal">
          Not on your list yet?
        </h2>
        <QuickAdd onAdded={(id) => navigate({ view: "recover", taskId: id })} />
        <button
          type="button"
          onClick={() => navigate({ view: "guided" })}
          className="mt-2 min-h-11 rounded-md text-sm font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          Or talk it through with a guided check-in
        </button>
      </Card>
    </div>
  )
}

/** Fetches a plan for this task. Nothing changes until the user accepts it. */
function useRecoveryRequest(task: Task) {
  const { state, today, mode, dispatch } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<(() => void) | null>(null)

  async function run(options: {
    strategy?: Strategy | null
    obstacle?: string
    rejected?: RejectedPlan[]
    useMode?: typeof mode
  }) {
    const useMode = options.useMode ?? mode
    setBusy(true)
    setError(null)
    setLastRun(() => () => run(options))
    try {
      const result = await requestTaskRecovery(
        useMode,
        buildRecoveryRequest(task, state, today, options)
      )
      dispatch({
        type: "set-recovery",
        id: task.id,
        obstacle: options.obstacle ?? "",
        recovery: {
          analysis: result.analysis,
          plan: result.plan,
          strategy: options.strategy ?? null,
          // A built-in template is never labeled as AI output.
          source: result.usedFallback ? "demo" : useMode,
          usedFallback: Boolean(result.usedFallback),
          exhausted: Boolean(result.exhausted),
          createdAt: nowIso(),
        },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }

  return { run, busy, error, retry: lastRun }
}

function RecoverTask({ task }: { task: Task }) {
  const { navigate, mode, dispatch } = useStore()
  const recovery = useRecoveryRequest(task)
  const consent = useAiConsent(task)

  const useDemoLink =
    mode === "live" && recovery.error
      ? () => dispatch({ type: "settings", patch: { modePreference: "demo" } })
      : undefined

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <button
        type="button"
        onClick={() => navigate({ view: "task", id: task.id })}
        className="min-h-11 rounded-md text-sm font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        Back to “{task.title}”
      </button>

      {recovery.error && (
        <ErrorNotice
          message={recovery.error}
          onRetry={recovery.retry ?? undefined}
          onUseDemo={useDemoLink}
        />
      )}

      {recovery.busy ? (
        <Card className="py-10">
          <LoadingNotice>
            Working from what’s recorded for this task...
          </LoadingNotice>
        </Card>
      ) : task.recovery ? (
        <PlanPreview
          key={task.recovery.createdAt}
          task={task}
          pending={task.recovery}
          onRequest={(options) => consent.guard(() => recovery.run(options))}
        />
      ) : (
        <StartRecovery
          task={task}
          onRequest={(options) => consent.guard(() => recovery.run(options))}
        />
      )}
      {consent.dialog}
    </div>
  )
}

function StartRecovery({
  task,
  onRequest,
}: {
  task: Task
  onRequest: (options: { obstacle?: string }) => void
}) {
  const { dispatch, mode } = useStore()
  const [obstacle, setObstacle] = useState<ObstacleChoice | null>(null)
  const [other, setOther] = useState("")

  const options = (
    Object.entries(OBSTACLE_LABEL) as [ObstacleChoice, string][]
  ).map(([value, label]) => ({ value, label }))

  function start() {
    const text =
      obstacle === "something-else"
        ? other.trim()
        : obstacle && obstacle !== "unsure"
          ? OBSTACLE_LABEL[obstacle]
          : ""
    dispatch({ type: "report-stuck", id: task.id, at: nowIso(), text })
    onRequest({ obstacle: text })
  }

  return (
    <>
      <ScreenHeading>Let’s find a way back into this</ScreenHeading>
      <Card className="space-y-4">
        <ChoiceGroup
          legend="What’s in the way? (optional)"
          name="recover-obstacle"
          options={options}
          value={obstacle}
          onChange={setObstacle}
          className="sm:grid-cols-2"
        />
        {obstacle === "something-else" && (
          <div>
            <label
              htmlFor="recover-other"
              className="mb-1.5 block text-sm font-medium"
            >
              What is it? (optional)
            </label>
            <Input
              id="recover-other"
              value={other}
              maxLength={300}
              onChange={(event) => setOther(event.target.value)}
              className="h-12"
            />
          </div>
        )}
        <Button type="button" size="xl" onClick={start}>
          Get a recovery plan
        </Button>
        <p className="text-xs text-muted-foreground">
          {mode === "live"
            ? "This task’s details and history are sent to the AI provider. Nothing changes until you accept it."
            : "Demo Mode fills in fixed templates from this task’s details, in your browser. Nothing changes until you accept it."}
        </p>
      </Card>
    </>
  )
}

function PlanPreview({
  task,
  pending,
  onRequest,
}: {
  task: Task
  pending: StoredRecovery
  onRequest: (options: {
    strategy?: Strategy | null
    rejected?: RejectedPlan[]
  }) => void
}) {
  const { dispatch, navigate } = useStore()
  const { plan, analysis } = pending
  const { decision } = analysis

  const [useNextAction, setUseNextAction] = useState(true)
  const [splitStep, setSplitStep] = useState(true)
  const current = currentSubtask(task)
  const smaller = usefulSmallerSteps(task, plan.smallerSteps)
  const [useDraft, setUseDraft] = useState(true)
  const [draftTitle, setDraftTitle] = useState(plan.artifact.title)
  const [draft, setDraft] = useState(plan.artifact.body)
  const [steps, setSteps] = useState(plan.steps.map(() => true))
  const [schedule, setSchedule] = useState(plan.schedule.map(() => true))
  const [copied, setCopied] = useState(false)
  const [showWhy, setShowWhy] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [markReleased, setMarkReleased] = useState(false)

  const chosen = pending.strategy ?? decision.recommended
  const releaseBlocked = markReleased && decision.highStakes && !acknowledged

  function accept() {
    dispatch({
      type: "log-help",
      id: task.id,
      at: nowIso(),
      helpKind:
        splitStep && current && smaller.length
          ? "smaller-steps"
          : "recovery-plan",
    })
    dispatch({
      type: "apply-recovery",
      id: task.id,
      at: nowIso(),
      nextAction: useNextAction ? plan.nextStep.instruction : null,
      document: useDraft
        ? { id: newId(), title: draftTitle.trim() || "Draft", body: draft }
        : null,
      steps: plan.steps.flatMap((title, index) =>
        steps[index] ? [{ id: newId(), title }] : []
      ),
      schedule: plan.schedule.flatMap((item, index) =>
        schedule[index] ? [{ ...item, id: newId() }] : []
      ),
      release: chosen === "RELEASE" && markReleased,
    })
    if (splitStep && current && smaller.length) {
      dispatch({
        type: "split-subtask",
        id: task.id,
        at: nowIso(),
        subId: current.id,
        steps: smaller.map((title) => ({ id: newId(), title })),
      })
    }
    navigate({ view: "task", id: task.id })
  }

  const rejectedNow: RejectedPlan = {
    nextStep: plan.nextStep.instruction.slice(0, 400),
    artifactTitle: plan.artifact.title.slice(0, 400),
  }

  return (
    <>
      <div>
        <SourceBadge source={pending.source} className="mb-3" />
        <ScreenHeading>{plan.headline}</ScreenHeading>
        {pending.usedFallback && (
          <p className="mt-2 text-sm text-muted-foreground">
            The AI’s suggestions kept repeating, so this is a built-in template
            instead.
          </p>
        )}
      </div>

      {plan.adaptationNote && (
        <div className="flex gap-2.5 rounded-xl bg-indigo-soft p-3.5 text-sm leading-relaxed text-indigo">
          <CornerDownRight className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>{plan.adaptationNote}</p>
        </div>
      )}

      {analysis.supportConcern && (
        <div
          role="note"
          className="rounded-xl border border-indigo/30 bg-indigo-soft p-4 text-sm leading-relaxed text-indigo"
        >
          <strong className="font-semibold">
            Something you wrote sounds like more than a task.
          </strong>{" "}
          BackOnTrack is not able to support you with this. If you might be in
          danger or are thinking about hurting yourself, please reach out to
          someone now. In the US or Canada, you can call or text 988. Elsewhere,
          contact local emergency services or a crisis line.
        </div>
      )}

      <Card className="space-y-2">
        <h2 className="text-sm font-medium text-sage">
          Next step · about {plan.nextStep.minutes} min
        </h2>
        <p className="font-heading text-2xl leading-snug">
          {plan.nextStep.instruction}
        </p>
        {plan.nextStep.why && (
          <p className="text-[15px] text-muted-foreground">
            {plan.nextStep.why}
          </p>
        )}
        <CheckRow
          checked={useNextAction}
          onChange={setUseNextAction}
          label="Make this my next action"
        />
      </Card>

      <Card className="space-y-2">
        <label
          htmlFor="plan-draft-title"
          className="block text-sm font-medium text-sage"
        >
          Draft title
        </label>
        <Input
          id="plan-draft-title"
          value={draftTitle}
          maxLength={120}
          onChange={(event) => setDraftTitle(event.target.value)}
          className="h-11 font-medium"
        />
        <label
          htmlFor="plan-draft"
          className="block text-sm font-medium text-sage"
        >
          Your draft (edit anything)
        </label>
        <Textarea
          id="plan-draft"
          value={draft}
          maxLength={8000}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-52 font-mono text-sm leading-relaxed"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CheckRow
            checked={useDraft}
            onChange={setUseDraft}
            label="Save this draft to the task"
          />
          <Button
            type="button"
            variant="ghost"
            size="lg"
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
        {plan.artifact.kind === "code" && (
          <p className="text-xs text-muted-foreground">
            This code hasn’t been run, and BackOnTrack can’t run it. Copy it
            into your own environment, and fill in the brackets.
          </p>
        )}
        {plan.artifact.kind === "email" && (
          <p className="text-xs text-muted-foreground">
            BackOnTrack never sends anything. Sending this is up to you.
          </p>
        )}
      </Card>

      {smaller.length > 0 && current && (
        <Card>
          <h2 className="font-sans text-[15px] font-semibold tracking-normal">
            Make this step smaller
          </h2>
          <CheckRow
            checked={splitStep}
            onChange={setSplitStep}
            label={`Replace “${current.title}” with: ${smaller.join(" → ")}`}
          />
          <p className="text-xs text-muted-foreground">
            Finished steps aren’t touched.
          </p>
        </Card>
      )}

      {plan.choices.length > 0 && (
        <Card className="space-y-2">
          <h2 className="font-sans text-[15px] font-semibold tracking-normal">
            Pick one to put in your document
          </h2>
          <p className="text-xs text-muted-foreground">
            Suggested text for you to change. It’s marked as suggested until you
            clear the highlight.
          </p>
          <ul className="space-y-2">
            {plan.choices.map((choice) => (
              <li key={choice}>
                <Button
                  type="button"
                  size="xl"
                  variant="outline"
                  className="h-auto min-h-11 w-full justify-start py-2 text-left font-normal whitespace-normal"
                  onClick={() => {
                    dispatch({
                      type: "append-to-doc",
                      id: task.id,
                      at: nowIso(),
                      text: choice,
                      label: plan.headline,
                    })
                    accept()
                    navigate({ view: "task", id: task.id, section: "doc" })
                  }}
                >
                  {choice}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {plan.steps.length > 0 && (
        <Card>
          <h2 className="font-sans text-[15px] font-semibold tracking-normal">
            Steps to add
          </h2>
          <div className="mt-1">
            {plan.steps.map((step, index) => (
              <CheckRow
                key={step}
                checked={steps[index]}
                onChange={(value) =>
                  setSteps(steps.map((item, i) => (i === index ? value : item)))
                }
                label={step}
              />
            ))}
          </div>
        </Card>
      )}

      {plan.schedule.length > 0 && (
        <Card>
          <h2 className="font-sans text-[15px] font-semibold tracking-normal">
            Work sessions to plan
          </h2>
          <div className="mt-1">
            {plan.schedule.map((item, index) => (
              <CheckRow
                key={`${item.date}-${index}`}
                checked={schedule[index]}
                onChange={(value) =>
                  setSchedule(
                    schedule.map((entry, i) => (i === index ? value : entry))
                  )
                }
                label={`${shortDate(item.date)}, ${item.minutes} min: ${item.label}`}
              />
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            These are optional plans. Your deadline stays as it is.
          </p>
        </Card>
      )}

      {chosen === "RELEASE" && (
        <Card>
          <CheckRow
            checked={markReleased}
            onChange={setMarkReleased}
            label="Also mark this task as Released"
          />
          {markReleased && (
            <ReleaseCaution
              decision={decision}
              choice="RELEASE"
              acknowledged={acknowledged}
              onAcknowledge={setAcknowledged}
            />
          )}
        </Card>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          size="xl"
          disabled={releaseBlocked}
          onClick={accept}
        >
          Add selected to my task
        </Button>
        {!pending.exhausted && (
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={() => {
              dispatch({
                type: "decline-recovery",
                id: task.id,
                at: nowIso(),
              })
              onRequest({
                strategy: pending.strategy,
                rejected: [...task.rejectedPlans, rejectedNow],
              })
            }}
          >
            <RefreshCw aria-hidden />
            Still stuck: try something else
          </Button>
        )}
        <Button
          type="button"
          size="xl"
          variant="ghost"
          onClick={() => {
            dispatch({ type: "decline-recovery", id: task.id, at: nowIso() })
            navigate({ view: "task", id: task.id })
          }}
        >
          <X aria-hidden />
          No thanks
        </Button>
      </div>
      {pending.exhausted && (
        <p className="text-sm text-muted-foreground">
          That’s the last suggestion available here. You could pause this task,
          or ask someone for help.
        </p>
      )}

      <div>
        <button
          type="button"
          aria-expanded={showWhy}
          onClick={() => setShowWhy(!showWhy)}
          className="min-h-11 rounded-md text-sm font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {showWhy
            ? "Hide the reasoning"
            : "See why, or choose another strategy"}
        </button>
        {showWhy && (
          <div className="mt-2 animate-in space-y-4 duration-200 fade-in">
            <RealityCheckContent analysis={analysis} />
            <div>
              <h2 className="-mb-3 font-sans text-[15px] font-semibold tracking-normal">
                Finish, reduce, or release
              </h2>
              <StrategyCards
                decision={decision}
                choice={chosen}
                onChange={(strategy) => onRequest({ strategy })}
              />
              <DecisionWhy decision={decision} />
              <ReleaseCaution
                decision={decision}
                choice="FINISH"
                acknowledged={false}
                onAcknowledge={() => {}}
              />
            </div>
          </div>
        )}
      </div>
    </>
  )
}

function CheckRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg py-1 text-[15px] has-focus-visible:ring-3 has-focus-visible:ring-ring/30">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 shrink-0 accent-[var(--primary)]"
      />
      <span className="min-w-0 break-words">{label}</span>
    </label>
  )
}
