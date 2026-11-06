"use client"

import { useState } from "react"
import { ArrowRight, Check, Undo2 } from "lucide-react"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ExpandableList } from "@/components/workspace/parts"
import { ReturnView } from "@/components/workspace/return-view"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { SupportNotice } from "@/components/workspace/support-notice"
import { isCrisisText } from "@/lib/guards"
import {
  CASE_STATUS_LABEL,
  caseStatus,
  deriveTitle,
  isSimpleErrand,
  suggestBlocker,
  suggestedNext,
} from "@/lib/recovery/case-engine"
import { formatDateTime } from "@/lib/workspace/dates"
import { returnSummary } from "@/lib/workspace/returning"
import { isActive } from "@/lib/workspace/schemas"
import type { Task } from "@/lib/workspace/schemas"

const lastTouched = (task: Task) =>
  task.recoveryCase?.lastActivity?.at ?? task.updatedAt

/** Most recently touched first, with anything finished left until last. */
export function recoveryCases(tasks: Task[]) {
  return tasks
    .filter((task) => task.recoveryCase)
    .sort((a, b) => lastTouched(b).localeCompare(lastTouched(a)))
}

export function RecoveryHome() {
  const { state, dispatch, today, returning, finishReturn, navigate } =
    useStore()
  const cases = recoveryCases(state.tasks)
  const open = cases.filter(isActive)
  const closed = cases.filter((task) => !isActive(task))
  const quick = state.tasks.filter((task) => task.quick && isActive(task))
  const resume = open.find((task) => task.status !== "paused") ?? null
  // Kept here, because finishing the last quick one empties its list.
  const [quickDone, setQuickDone] = useState<Task | null>(null)

  // Someone with no recovery cases still gets the existing way back in.
  const coming = returning && !resume ? returnSummary(state, today) : null
  if (coming) return <ReturnView summary={coming} />

  const others = state.tasks.filter(
    (task) => isActive(task) && !task.recoveryCase && !task.quick
  ).length

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {returning && resume && (
        <ResumePrompt
          task={resume}
          onChoose={(intent) => {
            finishReturn()
            dispatch({ type: "case-resume", id: resume.id, at: nowIso() })
            navigate({ view: "case", id: resume.id, intent })
          }}
          onDismiss={finishReturn}
        />
      )}

      <Intake />

      {(quick.length > 0 || quickDone) && (
        <QuickList tasks={quick} done={quickDone} setDone={setQuickDone} />
      )}

      <section aria-labelledby="cases-heading">
        <h2
          id="cases-heading"
          className="mb-3 font-sans text-[15px] font-semibold tracking-normal"
        >
          What you’re getting back on track
        </h2>
        {open.length ? (
          <ul className="space-y-3">
            {open.map((task) => (
              <CaseRow key={task.id} task={task} />
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-border p-5 text-[15px] leading-relaxed text-muted-foreground">
            {closed.length
              ? "Nothing is open right now. Whatever’s next can wait until you’re ready."
              : "Nothing here yet. When you’re ready, write down one thing above, even if it’s messy. It will be saved here so you can come back to it, and nothing is due just because you wrote it."}
          </p>
        )}
        {closed.length > 0 && (
          <details className="mt-4">
            <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-muted-foreground">
              Finished or released ({closed.length})
            </summary>
            <ul className="mt-2 space-y-3">
              {closed.map((task) => (
                <CaseRow key={task.id} task={task} />
              ))}
            </ul>
          </details>
        )}
      </section>

      {(others > 0 || state.tasks.length > 0) && (
        <nav
          aria-label="Other tools"
          className="flex flex-wrap gap-x-5 gap-y-1 border-t border-border/70 pt-4 text-sm"
        >
          <button
            type="button"
            onClick={() => navigate({ view: "plan" })}
            className="min-h-11 rounded-md font-medium text-indigo underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            Today’s plan and suggested task
          </button>
          <button
            type="button"
            onClick={() => navigate({ view: "tasks" })}
            className="min-h-11 rounded-md font-medium text-indigo underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            All tasks
          </button>
        </nav>
      )}
    </div>
  )
}

function Intake() {
  const { state, dispatch, navigate, mode } = useStore()
  const [concern, setConcern] = useState(false)
  const draft = state.intakeDraft
  const [added, setAdded] = useState<string | null>(null)

  function proceed() {
    const text = draft.trim()
    setConcern(false)
    if (!text) return
    // Sending the same words twice opens the same case instead of a second one.
    const same = state.tasks.find(
      (task) =>
        isActive(task) &&
        task.recoveryCase?.originalInput.trim().toLowerCase() ===
          text.toLowerCase()
    )
    if (same) {
      dispatch({ type: "set-intake-draft", text: "" })
      navigate({ view: "case", id: same.id })
      return
    }
    const id = newId()
    if (isSimpleErrand(text)) {
      dispatch({ type: "add-quick-task", id, at: nowIso(), title: text })
      setAdded(text)
      return
    }
    dispatch({
      type: "start-case",
      id,
      at: nowIso(),
      input: text,
      title: deriveTitle(text),
      suggestedBlocker: suggestBlocker(text),
    })
    navigate({ view: "case", id })
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    setAdded(null)
    if (!draft.trim()) return
    if (isCrisisText(draft)) setConcern(true)
    else proceed()
  }

  if (concern) {
    return (
      <SupportNotice onBack={() => setConcern(false)} onContinue={proceed} />
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <ScreenHeading>What’s something you’ve been putting off?</ScreenHeading>
        <p className="mt-2 text-[17px] text-muted-foreground">
          You don’t need a perfect plan. Tell me what’s been difficult to face.
        </p>
      </div>
      <div>
        <label htmlFor="intake-text" className="sr-only">
          What you’ve been putting off
        </label>
        <Textarea
          id="intake-text"
          value={draft}
          maxLength={2000}
          rows={4}
          placeholder="For example: I need to make an important phone call, but I keep avoiding it."
          onChange={(event) =>
            dispatch({ type: "set-intake-draft", text: event.target.value })
          }
          className="min-h-32 bg-card text-[17px] leading-relaxed"
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          {mode === "live"
            ? "Saved in this browser. In Live AI mode, what you write here is sent to the AI provider to suggest a next step."
            : "Saved in this browser. In Demo Mode, nothing is sent anywhere."}
        </p>
      </div>
      <Button
        type="submit"
        size="xl"
        disabled={!draft.trim()}
        className="w-full sm:w-auto"
      >
        Help me get back on track
        <ArrowRight aria-hidden />
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {added ? `Added “${added}” as a quick one, below.` : ""}
      </p>
    </form>
  )
}

export function ResumePrompt({
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

function CaseRow({ task }: { task: Task }) {
  const { navigate } = useStore()
  const activity = task.recoveryCase?.lastActivity
  const active = isActive(task)
  return (
    <li className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_2px_oklch(0.3_0.02_85/0.05)] sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 font-heading text-xl break-words">
          {task.title}
        </h3>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium">
          {CASE_STATUS_LABEL[caseStatus(task)]}
        </span>
      </div>
      {activity && (
        <p className="mt-1 text-xs text-muted-foreground">
          {activity.text} · {formatDateTime(activity.at)}
        </p>
      )}
      {active && (
        <p className="mt-2 text-[15px]">
          <span className="text-muted-foreground">Next: </span>
          {suggestedNext(task)}
        </p>
      )}
      <Button
        type="button"
        size="lg"
        variant={active ? "default" : "outline"}
        className="mt-3 min-h-11"
        aria-label={`${active ? "Resume" : "Open"} ${task.title}`}
        onClick={() => navigate({ view: "case", id: task.id })}
      >
        {active ? "Resume" : "Open"}
      </Button>
    </li>
  )
}

/** Errands stay light: they're done or they're not, with no workflow. */
function QuickList({
  tasks,
  done,
  setDone,
}: {
  tasks: Task[]
  done: Task | null
  setDone: (task: Task | null) => void
}) {
  const { dispatch, navigate } = useStore()
  return (
    <section aria-labelledby="quick-heading">
      <h2
        id="quick-heading"
        className="mb-3 font-sans text-[15px] font-semibold tracking-normal"
      >
        Quick ones
      </h2>
      {tasks.length > 0 && (
        <ExpandableList
          items={tasks}
          limit={5}
          label="quick ones"
          render={(task) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5"
            >
              <span className="min-w-0 text-[15px] font-medium break-words">
                {task.title}
              </span>
              <span className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="lg"
                  className="min-h-11"
                  aria-label={`Done: ${task.title}`}
                  onClick={() => {
                    dispatch({
                      type: "set-status",
                      id: task.id,
                      at: nowIso(),
                      status: "completed",
                    })
                    setDone(task)
                  }}
                >
                  <Check aria-hidden />
                  Done
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  className="min-h-11"
                  aria-label={`This is harder than it looks: ${task.title}`}
                  onClick={() => {
                    dispatch({
                      type: "start-case",
                      id: task.id,
                      at: nowIso(),
                      input: task.title,
                      title: task.title,
                      suggestedBlocker: null,
                    })
                    navigate({ view: "case", id: task.id })
                  }}
                >
                  Harder than it looks
                </Button>
              </span>
            </li>
          )}
        />
      )}
      <p role="status" className="mt-2 text-sm text-muted-foreground">
        {done && (
          <>
            Done: {done.title}.{" "}
            <button
              type="button"
              onClick={() => {
                dispatch({
                  type: "set-status",
                  id: done.id,
                  at: nowIso(),
                  status: "not-started",
                })
                setDone(null)
              }}
              className="inline-flex min-h-11 items-center gap-1 rounded-md font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <Undo2 className="size-3.5" aria-hidden />
              Undo
            </button>
          </>
        )}
      </p>
    </section>
  )
}
