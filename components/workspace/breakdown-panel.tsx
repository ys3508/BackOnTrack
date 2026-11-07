"use client"

import { useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  Check,
  Pencil,
  Plus,
  Sparkles,
  X,
} from "lucide-react"

import {
  Card,
  ErrorNotice,
  LoadingNotice,
  SourceBadge,
} from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ProgressBar } from "@/components/workspace/parts"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { buildBreakdownRequest } from "@/lib/recovery/context"
import { requestBreakdown } from "@/lib/recovery-client"
import type { Subtask, Task } from "@/lib/workspace/schemas"
import { currentSubtask, stepCounts } from "@/lib/workspace/selectors"
import { cn } from "@/lib/utils"

const iconButton =
  "grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-30"

export function BreakdownPanel({
  task,
  guard,
}: {
  task: Task
  /** Runs the action, asking first if data is about to leave the browser. */
  guard: (action: () => void) => void
}) {
  const { state, today, mode, dispatch } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejected, setRejected] = useState<string[][]>([])
  const { done, total } = stepCounts(task)

  async function generate(previous: string[][] = rejected) {
    setBusy(true)
    setError(null)
    try {
      const result = await requestBreakdown(
        mode,
        buildBreakdownRequest(task, state, today, previous)
      )
      dispatch({
        type: "set-breakdown",
        id: task.id,
        at: nowIso(),
        breakdown: {
          steps: result.steps,
          note: result.note,
          ambiguities: result.ambiguities,
          source: result.usedFallback ? "demo" : mode,
          usedFallback: Boolean(result.usedFallback),
          createdAt: nowIso(),
        },
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }

  const label = mode === "live" ? "Break this down with AI" : "Break this down"

  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-heading text-lg">
          Steps
        </h2>
        {total > 0 && (
          <span className="text-sm text-muted-foreground">
            {done} of {total} done
          </span>
        )}
      </div>
      {total > 0 && (
        <ProgressBar value={task.progress} label="Steps finished" />
      )}

      {error && (
        <ErrorNotice message={error} onRetry={() => guard(() => generate())} />
      )}

      {task.pendingBreakdown ? (
        <BreakdownPreview
          key={task.pendingBreakdown.createdAt}
          task={task}
          onTryAgain={(steps) => {
            const next = [...rejected, steps]
            setRejected(next)
            guard(() => generate(next))
          }}
        />
      ) : (
        <>
          <StepList task={task} />
          {busy ? (
            <LoadingNotice>Working from this task’s details...</LoadingNotice>
          ) : (
            <Button
              type="button"
              size="xl"
              variant={total ? "ghost" : "default"}
              onClick={() => guard(() => generate())}
            >
              <Sparkles aria-hidden />
              {total ? "Replan the remaining steps" : label}
            </Button>
          )}
          {mode === "demo" && !total && !busy && (
            <p className="text-xs text-muted-foreground">
              Demo Mode uses templates and your instructions, not AI.
            </p>
          )}
        </>
      )}
    </Card>
  )
}

function StepList({ task }: { task: Task }) {
  const { dispatch } = useStore()
  const [title, setTitle] = useState("")
  const [editingSteps, setEditingSteps] = useState(false)
  const current = currentSubtask(task)

  return (
    <>
      {task.subtasks.length > 0 && (
        <ol className="space-y-1">
          {task.subtasks.map((sub, index) => (
            <StepRow
              key={sub.id}
              task={task}
              sub={sub}
              index={index}
              isCurrent={sub.id === current?.id}
              showControls={editingSteps}
            />
          ))}
        </ol>
      )}
      {task.subtasks.length > 0 && (
        <button
          type="button"
          aria-pressed={editingSteps}
          onClick={() => setEditingSteps(!editingSteps)}
          className="min-h-11 rounded-md text-sm font-medium text-link outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {editingSteps ? "Done editing steps" : "Edit steps"}
        </button>
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!title.trim()) return
          dispatch({
            type: "add-subtask",
            id: task.id,
            at: nowIso(),
            subId: newId(),
            title,
          })
          setTitle("")
        }}
      >
        <label htmlFor="new-step" className="sr-only">
          New step
        </label>
        <Input
          id="new-step"
          value={title}
          maxLength={200}
          placeholder="Add a step..."
          onChange={(event) => setTitle(event.target.value)}
          className="h-11 flex-1"
        />
        <Button
          type="submit"
          size="xl"
          variant="outline"
          disabled={!title.trim()}
        >
          <Plus aria-hidden />
          Add
        </Button>
      </form>
    </>
  )
}

function StepRow({
  task,
  sub,
  index,
  isCurrent,
  showControls,
}: {
  task: Task
  sub: Subtask
  index: number
  isCurrent: boolean
  showControls: boolean
}) {
  const { dispatch } = useStore()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(sub.title)

  function saveEdit() {
    dispatch({
      type: "edit-subtask",
      id: task.id,
      at: nowIso(),
      subId: sub.id,
      title: value,
    })
    setValue(value.trim() || sub.title)
    setEditing(false)
  }

  return (
    <li className={cn("rounded-lg", isCurrent && "bg-brand-soft")}>
      <div className="flex items-center gap-0.5">
        {editing ? (
          <>
            <label htmlFor={`edit-${sub.id}`} className="sr-only">
              Edit step
            </label>
            <Input
              id={`edit-${sub.id}`}
              value={value}
              maxLength={200}
              autoFocus
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  saveEdit()
                }
                if (event.key === "Escape") {
                  setValue(sub.title)
                  setEditing(false)
                }
              }}
              className="ml-1 h-11 flex-1"
            />
            <button
              type="button"
              aria-label="Save step"
              onClick={saveEdit}
              className={iconButton}
            >
              <Check className="size-4" aria-hidden />
            </button>
          </>
        ) : (
          <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-lg px-2 py-1 has-focus-visible:ring-3 has-focus-visible:ring-ring/30">
            <input
              type="checkbox"
              checked={sub.done}
              onChange={() =>
                dispatch({
                  type: "toggle-subtask",
                  id: task.id,
                  at: nowIso(),
                  subId: sub.id,
                })
              }
              className="size-5 shrink-0 accent-[var(--primary)]"
            />
            <span
              className={cn(
                "min-w-0 text-[15px] leading-snug break-words",
                sub.done && "text-muted-foreground line-through",
                isCurrent && "font-medium"
              )}
            >
              {sub.title}
              {isCurrent && <span className="sr-only"> (current step)</span>}
            </span>
          </label>
        )}
      </div>
      {!editing && showControls && (
        <div className="flex flex-wrap justify-end pb-1">
          {!sub.done && !isCurrent && (
            <button
              type="button"
              aria-label={`Work on ${sub.title} next`}
              title="Work on this next"
              onClick={() =>
                dispatch({
                  type: "set-current-subtask",
                  id: task.id,
                  at: nowIso(),
                  subId: sub.id,
                })
              }
              className={iconButton}
            >
              <Sparkles className="size-4" aria-hidden />
            </button>
          )}
          <button
            type="button"
            aria-label={`Edit ${sub.title}`}
            onClick={() => setEditing(true)}
            className={iconButton}
          >
            <Pencil className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Move ${sub.title} up`}
            disabled={index === 0}
            onClick={() =>
              dispatch({
                type: "move-subtask",
                id: task.id,
                subId: sub.id,
                direction: -1,
              })
            }
            className={iconButton}
          >
            <ArrowUp className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Move ${sub.title} down`}
            disabled={index === task.subtasks.length - 1}
            onClick={() =>
              dispatch({
                type: "move-subtask",
                id: task.id,
                subId: sub.id,
                direction: 1,
              })
            }
            className={iconButton}
          >
            <ArrowDown className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`Delete ${sub.title}`}
            onClick={() =>
              dispatch({
                type: "remove-subtask",
                id: task.id,
                at: nowIso(),
                subId: sub.id,
              })
            }
            className={iconButton}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </li>
  )
}

/** Suggested steps stay here, fully editable, until the user accepts them. */
function BreakdownPreview({
  task,
  onTryAgain,
}: {
  task: Task
  onTryAgain: (steps: string[]) => void
}) {
  const { dispatch } = useStore()
  const pending = task.pendingBreakdown!
  const [steps, setSteps] = useState(pending.steps)
  const done = task.subtasks.filter((sub) => sub.done)
  const open = task.subtasks.filter((sub) => !sub.done)
  const filled = steps.map((step) => step.trim()).filter(Boolean)

  const update = (index: number, value: string) =>
    setSteps(steps.map((step, i) => (i === index ? value : step)))
  const move = (index: number, direction: -1 | 1) => {
    const next = [...steps]
    const [item] = next.splice(index, 1)
    next.splice(index + direction, 0, item)
    setSteps(next)
  }

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-primary/50 p-3">
      <div>
        <SourceBadge source={pending.source} />
        <p className="mt-2 text-sm font-medium">
          Suggested steps. Edit anything, then add them.
        </p>
        {pending.usedFallback && (
          <p className="mt-1 text-sm text-muted-foreground">
            The AI’s answer couldn’t be used, so this is a built-in template.
          </p>
        )}
        {pending.note && (
          <p className="mt-1 text-sm text-muted-foreground">{pending.note}</p>
        )}
      </div>

      {done.length > 0 && (
        <div>
          <p className="text-sm font-medium">Already done, and staying</p>
          <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
            {done.map((sub) => (
              <li key={sub.id} className="flex gap-1.5">
                <Check
                  className="mt-0.5 size-4 shrink-0 text-brand"
                  aria-hidden
                />
                <span className="min-w-0 break-words">{sub.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="space-y-1.5">
        {steps.map((step, index) => (
          <li key={index} className="flex items-center gap-0.5">
            <label htmlFor={`proposed-${index}`} className="sr-only">
              Suggested step {index + 1}
            </label>
            <Input
              id={`proposed-${index}`}
              value={step}
              maxLength={200}
              onChange={(event) => update(index, event.target.value)}
              className="h-11 min-w-0 flex-1"
            />
            <button
              type="button"
              aria-label={`Move suggested step ${index + 1} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
              className={cn(iconButton, "hidden sm:grid")}
            >
              <ArrowUp className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Move suggested step ${index + 1} down`}
              disabled={index === steps.length - 1}
              onClick={() => move(index, 1)}
              className={cn(iconButton, "hidden sm:grid")}
            >
              <ArrowDown className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={`Remove suggested step ${index + 1}`}
              onClick={() => setSteps(steps.filter((_, i) => i !== index))}
              className={iconButton}
            >
              <X className="size-4" aria-hidden />
            </button>
          </li>
        ))}
      </ol>
      <Button
        type="button"
        variant="ghost"
        size="lg"
        onClick={() => setSteps([...steps, ""])}
      >
        <Plus aria-hidden />
        Add a step
      </Button>

      {pending.ambiguities.length > 0 && (
        <div className="rounded-lg bg-caution-soft p-3 text-sm text-caution">
          <p className="font-medium">Worth asking about</p>
          <ul className="mt-1 list-disc pl-4">
            {pending.ambiguities.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {open.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Adding these replaces your {open.length} open{" "}
          {open.length === 1 ? "step" : "steps"}.
        </p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          size="xl"
          disabled={!filled.length}
          onClick={() =>
            dispatch({
              type: "accept-breakdown",
              id: task.id,
              at: nowIso(),
              steps: filled.map((title) => ({ id: newId(), title })),
            })
          }
        >
          <Check aria-hidden />
          Add these steps
        </Button>
        <Button
          type="button"
          size="xl"
          variant="outline"
          onClick={() => {
            dispatch({ type: "decline-breakdown", id: task.id, at: nowIso() })
            onTryAgain(pending.steps)
          }}
        >
          Try something else
        </Button>
        <Button
          type="button"
          size="xl"
          variant="ghost"
          onClick={() =>
            dispatch({ type: "decline-breakdown", id: task.id, at: nowIso() })
          }
        >
          <X aria-hidden />
          No thanks
        </Button>
      </div>
    </div>
  )
}
