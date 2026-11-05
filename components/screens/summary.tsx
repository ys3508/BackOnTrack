"use client"

import { useState } from "react"
import { ArrowLeft, Check, Copy, Download, RotateCcw } from "lucide-react"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import type { Session } from "@/lib/session"
import {
  STRATEGY_LABEL,
  buildSummary,
  sourceText,
  summaryToMarkdown,
} from "@/lib/summary"
import type { SummaryStep } from "@/lib/summary"

function Block({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-border py-4 first:border-t-0 first:pt-0 last:pb-0">
      <h2 className="font-sans text-sm font-semibold tracking-normal">
        {title}
      </h2>
      <div className="mt-1.5 text-[15px] leading-relaxed">{children}</div>
    </section>
  )
}

function BulletList({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-muted-foreground">{empty}</p>
  return (
    <ul className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

function StepList({ steps, empty }: { steps: SummaryStep[]; empty: string }) {
  if (!steps.length) return <p className="text-muted-foreground">{empty}</p>
  return (
    <ul className="space-y-2.5">
      {steps.map((step, index) => (
        <li key={`${step.instruction}-${index}`}>
          {step.instruction}
          {step.userText && (
            <span className="mt-0.5 block text-sm text-muted-foreground">
              You wrote: &ldquo;{step.userText}&rdquo;
            </span>
          )}
          {step.note && (
            <span className="mt-0.5 block text-sm text-muted-foreground">
              Your note: &ldquo;{step.note}&rdquo;
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

export function SummaryScreen({
  session,
  onBack,
  onReset,
  onSaveAsTask,
}: {
  session: Session
  onBack?: () => void
  onReset: () => void
  onSaveAsTask?: () => void
}) {
  const summary = buildSummary(session)
  const markdown = summaryToMarkdown(summary)
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle"
  )

  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown)
      setCopyState("copied")
    } catch {
      setCopyState("failed")
    }
  }

  function download() {
    const url = URL.createObjectURL(
      new Blob([markdown], { type: "text/markdown" })
    )
    const link = document.createElement("a")
    link.href = url
    link.download = "backontrack-summary.md"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-2xl">
      <ScreenHeading>Where things stand.</ScreenHeading>
      <p className="mt-3 text-muted-foreground">
        This is a record of what actually happened, not a score. Only steps you
        marked as completed are listed as completed.
      </p>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="xl" onClick={copy}>
          {copyState === "copied" ? (
            <Check aria-hidden />
          ) : (
            <Copy aria-hidden />
          )}
          {copyState === "copied" ? "Copied" : "Copy summary"}
        </Button>
        <Button type="button" variant="outline" size="xl" onClick={download}>
          <Download aria-hidden />
          Download
        </Button>
      </div>
      {copyState === "failed" && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          Your browser blocked copying. Please use Download instead.
        </p>
      )}

      <Card className="mt-5">
        <Block title="Original responsibility">
          <p className="break-words">{summary.responsibility}</p>
        </Block>
        <Block title="Details you chose">
          <dl className="space-y-1">
            {summary.details.map(({ label, value }) => (
              <div key={label} className="sm:flex sm:gap-2">
                <dt className="text-muted-foreground">{label}:</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </Block>
        <Block title="What was known">
          <BulletList items={summary.knownFacts} empty="Nothing recorded." />
        </Block>
        <Block title="What was uncertain">
          <BulletList items={summary.uncertain} empty="Nothing recorded." />
        </Block>
        <Block title="Selected recovery strategy">
          {summary.strategy ? (
            <p>
              <strong className="font-semibold">
                {STRATEGY_LABEL[summary.strategy]}
              </strong>
              {summary.overridden &&
                summary.recommended &&
                ` (your choice; the suggestion was ${STRATEGY_LABEL[summary.recommended]})`}
            </p>
          ) : (
            <p className="text-muted-foreground">Not selected.</p>
          )}
        </Block>
        <Block title="Actions you marked completed">
          <StepList
            steps={summary.completed}
            empty="None yet, and that's okay."
          />
        </Block>
        {summary.attempted.length > 0 && (
          <Block title="Tried, but not completed">
            <StepList steps={summary.attempted} empty="" />
          </Block>
        )}
        <Block title="Remaining next step (suggested, not done)">
          {summary.remainingStep ? (
            <p>{summary.remainingStep}</p>
          ) : (
            <p className="text-muted-foreground">None set.</p>
          )}
        </Block>
        <Block title="Unresolved questions">
          <BulletList
            items={summary.unresolvedQuestions}
            empty="None recorded."
          />
        </Block>
      </Card>

      <p className="mt-3 text-xs text-muted-foreground">
        Source: {sourceText(summary.sources)}.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        {onSaveAsTask && (
          <Button type="button" size="xl" onClick={onSaveAsTask}>
            Save as a task
          </Button>
        )}
        {onBack && (
          <Button type="button" variant="ghost" size="xl" onClick={onBack}>
            <ArrowLeft aria-hidden />
            Back to my step
          </Button>
        )}
        <Button type="button" variant="ghost" size="xl" onClick={onReset}>
          <RotateCcw aria-hidden />
          Start over and delete this session
        </Button>
      </div>
    </div>
  )
}
