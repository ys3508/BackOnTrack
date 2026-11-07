"use client"

import { ChevronRight, Play } from "lucide-react"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { useStore } from "@/components/workspace/store"
import { shortDate } from "@/lib/workspace/dates"
import type { ReturnSummary } from "@/lib/workspace/returning"

/** One way back in. Everything else waits until the user asks for it. */
export function ReturnView({ summary }: { summary: ReturnSummary }) {
  const { navigate, finishReturn } = useStore()
  const { task } = summary
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <ScreenHeading>Pick up where you left off</ScreenHeading>
        <p className="mt-2 text-muted-foreground">
          Your work is still here. You don’t need to catch up on everything.
        </p>
      </div>

      <Card className="space-y-3">
        <div>
          <p className="text-sm font-medium text-brand">{task.title}</p>
          {summary.total > 0 && (
            <p className="text-sm text-muted-foreground">
              {summary.done} of {summary.total} steps done
            </p>
          )}
        </div>

        {summary.resumeNote && (
          <div className="rounded-xl bg-brand-soft p-3">
            <h2 className="text-sm font-medium text-brand">Pick up here</h2>
            <p className="mt-0.5 font-heading text-xl leading-snug break-words">
              {summary.resumeNote}
            </p>
          </div>
        )}

        <ul className="space-y-1 text-[15px]">
          {summary.lastFinished && (
            <li>Last step you finished: {summary.lastFinished}</li>
          )}
          {summary.documentWords > 0 && (
            <li>
              Your document is saved, at {summary.documentWords}{" "}
              {summary.documentWords === 1 ? "word" : "words"}.
              {summary.documentEndsWith &&
                ` It stops at: “${summary.documentEndsWith}”`}
            </li>
          )}
          {summary.neverStarted && (
            <li>You haven’t started this one, so there’s nothing to redo.</li>
          )}
        </ul>

        {summary.nextStep && (
          <div className="rounded-xl bg-secondary p-3">
            <h2 className="text-sm font-medium text-brand">Next up</h2>
            <p className="mt-0.5 font-heading text-xl leading-snug">
              {summary.nextStep}
            </p>
            {summary.firstAction && (
              <p className="mt-1 text-sm text-muted-foreground">
                A small way in: {summary.firstAction}. This is a built-in
                suggestion based on the step’s wording, not AI.
              </p>
            )}
          </div>
        )}

        {summary.deadlineWasMissed && task.deadline && (
          <p className="text-sm text-muted-foreground">
            Its deadline was {shortDate(task.deadline)}. That hasn’t been
            changed, and you can decide what to do about it once you’re back in.
          </p>
        )}

        <Button
          type="button"
          size="xl"
          className="w-full sm:w-auto"
          onClick={() => {
            finishReturn()
            navigate({
              view: "task",
              id: task.id,
              section: summary.neverStarted ? "setup" : "doc",
            })
          }}
        >
          <Play aria-hidden />
          {summary.neverStarted
            ? "Prepare a place to start"
            : "Continue working"}
        </Button>
      </Card>

      {summary.alsoDue && (
        <p className="text-sm text-muted-foreground">
          Also due soon: {summary.alsoDue.title},{" "}
          {shortDate(summary.alsoDue.deadline)}.
        </p>
      )}

      <button
        type="button"
        onClick={() => {
          finishReturn()
          navigate({ view: "tasks" })
        }}
        className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-link outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        Or choose a different task
        <ChevronRight className="size-4" aria-hidden />
      </button>
    </div>
  )
}
