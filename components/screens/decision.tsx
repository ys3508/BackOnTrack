"use client"

import { useState } from "react"
import { ArrowLeft, ArrowRight, TriangleAlert } from "lucide-react"

import { Card, ScreenHeading, SourceBadge } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { STRATEGIES } from "@/lib/schemas"
import type { Analysis, Strategy } from "@/lib/schemas"
import type { Source } from "@/lib/session"
import { STRATEGY_LABEL } from "@/lib/summary"
import { cn } from "@/lib/utils"

const STRATEGY_MEANING: Record<Strategy, string> = {
  FINISH: "Continue the original responsibility.",
  REDUCE: "Keep what matters most, and make it smaller.",
  RELEASE: "Consciously stop pursuing it.",
}

type DecisionData = Analysis["decision"]

export function StrategyCards({
  decision,
  choice,
  onChange,
}: {
  decision: DecisionData
  choice: Strategy
  onChange: (strategy: Strategy) => void
}) {
  return (
    <fieldset className="mt-6">
      <legend className="sr-only">Choose a recovery strategy</legend>
      <div className="grid gap-3 md:grid-cols-3">
        {STRATEGIES.map((strategy) => {
          const selected = choice === strategy
          return (
            <label
              key={strategy}
              className={cn(
                "relative flex cursor-pointer flex-col rounded-2xl border bg-card p-5 transition-all duration-200 has-focus-visible:ring-3 has-focus-visible:ring-ring/30",
                selected
                  ? "border-primary shadow-[inset_0_0_0_1px_var(--primary)]"
                  : "border-border hover:border-primary/40"
              )}
            >
              <input
                type="radio"
                name="strategy"
                value={strategy}
                checked={selected}
                onChange={() => onChange(strategy)}
                className="sr-only"
              />
              <span className="flex min-h-6 flex-wrap items-center justify-between gap-2">
                <span className="font-heading text-2xl">
                  {STRATEGY_LABEL[strategy]}
                </span>
                {strategy === decision.recommended && (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                    Suggested
                  </span>
                )}
              </span>
              <span className="mt-1 text-sm text-muted-foreground">
                {STRATEGY_MEANING[strategy]}
              </span>
              <span className="mt-3 text-[15px] leading-snug">
                {decision.options[strategy]}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function DecisionWhy({ decision }: { decision: DecisionData }) {
  return (
    <Card className="mt-4 grid gap-4 md:grid-cols-2">
      <div>
        <h2 className="font-sans text-sm font-semibold tracking-normal">
          Why {STRATEGY_LABEL[decision.recommended].toLowerCase()} is suggested
        </h2>
        <p className="mt-1.5 text-[15px] leading-relaxed">
          {decision.reasoning}
        </p>
      </div>
      <div>
        <h2 className="font-sans text-sm font-semibold tracking-normal">
          What could change this
        </h2>
        <p className="mt-1.5 text-[15px] leading-relaxed">
          {decision.uncertainty}
        </p>
      </div>
    </Card>
  )
}

export function ReleaseCaution({
  decision,
  choice,
  acknowledged,
  onAcknowledge,
}: {
  decision: DecisionData
  choice: Strategy
  acknowledged: boolean
  onAcknowledge: (value: boolean) => void
}) {
  return (
    <>
      {decision.highStakes && decision.caution && (
        <div
          role="note"
          className="mt-4 flex gap-3 rounded-xl bg-caution-soft p-4 text-sm leading-relaxed text-caution"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <p>{decision.caution}</p>
            {choice === "RELEASE" && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => onAcknowledge(event.target.checked)}
                  className="mt-0.5 size-4 accent-[var(--sand)]"
                />
                I understand this may have consequences, and I still want to
                look at releasing it.
              </label>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export function DecisionScreen({
  analysis,
  source,
  initialChoice,
  onBack,
  onChoose,
}: {
  analysis: Analysis
  source: Source | null
  initialChoice: Strategy | null
  onBack: () => void
  onChoose: (strategy: Strategy) => void
}) {
  const { decision } = analysis
  const [choice, setChoice] = useState<Strategy>(
    initialChoice ?? decision.recommended
  )
  const [acknowledged, setAcknowledged] = useState(false)

  const needsAcknowledgement = choice === "RELEASE" && decision.highStakes
  const blocked = needsAcknowledgement && !acknowledged

  return (
    <div>
      <SourceBadge source={source} className="mb-4" />
      <ScreenHeading>What&rsquo;s the realistic way forward?</ScreenHeading>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Here is a suggestion and why. The decision is yours, and you can choose
        any of these.
      </p>

      <StrategyCards
        decision={decision}
        choice={choice}
        onChange={(strategy) => {
          setChoice(strategy)
          setAcknowledged(false)
        }}
      />
      <DecisionWhy decision={decision} />
      <ReleaseCaution
        decision={decision}
        choice={choice}
        acknowledged={acknowledged}
        onAcknowledge={setAcknowledged}
      />

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="xl"
          disabled={blocked}
          onClick={() => onChoose(choice)}
        >
          Continue with {STRATEGY_LABEL[choice]}
          <ArrowRight aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="xl" onClick={onBack}>
          <ArrowLeft aria-hidden />
          Back to the Reality Check
        </Button>
      </div>
    </div>
  )
}
