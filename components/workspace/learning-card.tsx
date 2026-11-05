"use client"

import { useState } from "react"

import { Card } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { ConfirmDialog, fieldClass } from "@/components/workspace/parts"
import { useStore } from "@/components/workspace/store"
import { formatDateTime } from "@/lib/workspace/dates"
import { MIN_EVIDENCE, detectPatterns } from "@/lib/workspace/patterns"
import {
  HELP_KINDS,
  HELP_LABEL,
  type FrictionEvent,
  type HelpKind,
} from "@/lib/workspace/schemas"

function describe(item: FrictionEvent) {
  if (item.kind === "stuck") return "Reported being stuck"
  if (item.kind === "moved") return "Moved a work session later"
  if (item.kind === "session") {
    return item.interrupted
      ? "Focus session stopped in under a minute"
      : "Focus session"
  }
  const label = item.helpKind ? HELP_LABEL[item.helpKind] : "Help"
  const outcome =
    item.outcome === "progress"
      ? "progress followed"
      : item.outcome === "stuck"
        ? "stuck again afterward"
        : "no result yet"
  return `Accepted: ${label} (${outcome})`
}

/** Everything the app has noticed, which the user can correct or delete. */
export function LearningCard() {
  const { state, dispatch } = useStore()
  const { learning, frictionLog } = state
  const [showRecords, setShowRecords] = useState(false)
  const [confirm, setConfirm] = useState(false)
  // The clock only matters to the nearest day here.
  const [now] = useState(() => Date.now())
  const patterns = detectPatterns(state, now)
  const shown = patterns.filter((item) => !learning.dismissed.includes(item.id))
  const hidden = patterns.length - shown.length
  const titleOf = (id: string) =>
    state.tasks.find((task) => task.id === id)?.title ?? "A task"

  return (
    <Card className="space-y-3">
      <h2 className="font-sans text-[15px] font-semibold tracking-normal">
        What BackOnTrack has noticed
      </h2>
      <p className="text-sm text-muted-foreground">
        It looks at what you do in this app to work out which kind of help to
        offer first. These are guesses, worked out by simple counting. They
        aren’t a diagnosis or a judgment, and they stay in this browser. With
        Live AI, they’re sent along with a task when you ask for help.
      </p>

      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
        <input
          type="checkbox"
          checked={learning.enabled}
          onChange={(event) =>
            dispatch({
              type: "learning",
              patch: { enabled: event.target.checked },
            })
          }
          className="size-5 accent-[var(--primary)]"
        />
        Learn from my activity
      </label>

      <div>
        <label
          htmlFor="preferred-help"
          className="mb-1 block text-sm font-medium"
        >
          When I need a place to start, I prefer
        </label>
        <select
          id="preferred-help"
          value={learning.preferred ?? ""}
          onChange={(event) =>
            dispatch({
              type: "learning",
              patch: {
                preferred: (event.target.value || null) as HelpKind | null,
              },
            })
          }
          className={fieldClass}
        >
          <option value="">No preference</option>
          {HELP_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {HELP_LABEL[kind]}
            </option>
          ))}
        </select>
      </div>

      {shown.length > 0 ? (
        <ul className="space-y-2" aria-label="What’s been noticed">
          {shown.map((item) => (
            <li key={item.id} className="rounded-xl bg-secondary p-3">
              <p className="text-[15px] font-medium">
                {item.title}
                {item.taskId ? `: ${titleOf(item.taskId)}` : ""}
              </p>
              <p className="text-sm text-muted-foreground">{item.evidence}</p>
              <Button
                type="button"
                size="lg"
                variant="ghost"
                className="mt-1"
                aria-label={`This isn’t right: ${item.title}`}
                onClick={() =>
                  dispatch({
                    type: "learning",
                    patch: { dismissed: [...learning.dismissed, item.id] },
                  })
                }
              >
                This isn’t right
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm">
          {learning.enabled
            ? `Nothing yet. It takes at least ${MIN_EVIDENCE} separate moments before anything shows up here, so one bad afternoon doesn’t become a “pattern”.`
            : "Learning is off, so nothing new is being recorded or used."}
        </p>
      )}

      {hidden > 0 && (
        <Button
          type="button"
          size="lg"
          variant="ghost"
          onClick={() =>
            dispatch({ type: "learning", patch: { dismissed: [] } })
          }
        >
          Bring back {hidden} I said weren’t right
        </Button>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="xl"
          variant="outline"
          aria-expanded={showRecords}
          onClick={() => setShowRecords(!showRecords)}
        >
          {showRecords ? "Hide" : "See"} the {frictionLog.length} records this
          is based on
        </Button>
        <Button
          type="button"
          size="xl"
          variant="ghost"
          disabled={!frictionLog.length}
          onClick={() => setConfirm(true)}
        >
          Delete these records
        </Button>
      </div>

      {showRecords && (
        <ul aria-label="Records" className="space-y-1">
          {[...frictionLog]
            .reverse()
            .slice(0, 50)
            .map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 break-words">
                  {formatDateTime(item.at)}: {describe(item)}, on{" "}
                  {titleOf(item.taskId)}
                </span>
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  aria-label={`Delete record: ${describe(item)}, ${formatDateTime(item.at)}`}
                  onClick={() =>
                    dispatch({ type: "delete-friction", id: item.id })
                  }
                >
                  Delete
                </Button>
              </li>
            ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirm}
        title="Delete these records?"
        confirmLabel="Delete records"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false)
          dispatch({ type: "clear-friction" })
        }}
      >
        BackOnTrack forgets what it has noticed, and starts counting again. Your
        tasks, documents, and stated preference stay as they are.
      </ConfirmDialog>
    </Card>
  )
}
