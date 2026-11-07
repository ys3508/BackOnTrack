"use client"

import { Lightbulb, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useStore } from "@/components/workspace/store"
import type { Pattern } from "@/lib/workspace/patterns"

/** A guess from the user's own records, with its evidence and a way to say no. */
export function PatternHint({
  hint,
  onAct,
}: {
  hint: Pattern
  onAct: () => void
}) {
  const { state, dispatch } = useStore()
  return (
    <section
      aria-label="Something BackOnTrack noticed"
      className="space-y-2 rounded-2xl border border-border bg-link-soft p-4"
    >
      <div className="flex gap-2.5">
        <Lightbulb className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0">
          <h2 className="font-heading text-lg">
            {hint.title}
          </h2>
          <p className="mt-0.5 text-sm">{hint.evidence}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            This is a guess from your records in this browser, not AI and not a
            diagnosis.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="xl" variant="outline" onClick={onAct}>
          {hint.actionLabel}
        </Button>
        <Button
          type="button"
          size="xl"
          variant="ghost"
          onClick={() =>
            dispatch({
              type: "learning",
              patch: { dismissed: [...state.learning.dismissed, hint.id] },
            })
          }
        >
          <X aria-hidden />
          This isn’t right
        </Button>
      </div>
    </section>
  )
}
