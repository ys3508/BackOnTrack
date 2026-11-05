"use client"

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Cloud,
  Signpost,
} from "lucide-react"

import { Card, ScreenHeading, SourceBadge } from "@/components/shared"
import { Button } from "@/components/ui/button"
import type { Analysis } from "@/lib/schemas"
import type { Source } from "@/lib/session"
import { cn } from "@/lib/utils"

function Section({
  icon: Icon,
  title,
  hint,
  tone,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  hint: string
  tone: string
  children: React.ReactNode
}) {
  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={cn("grid size-8 place-items-center rounded-lg", tone)}
        >
          <Icon className="size-4" />
        </span>
        <h2 className="font-sans text-[15px] font-semibold tracking-normal">
          {title}
        </h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{hint}</p>
      <div className="mt-3">{children}</div>
    </Card>
  )
}

function Items({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) {
    return <p className="text-sm text-muted-foreground">{empty}</p>
  }
  return (
    <ul className="space-y-2.5 text-[15px] leading-snug">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  )
}

export function RealityCheckContent({ analysis }: { analysis: Analysis }) {
  const { knownFacts, assumptions, unknowns, consequences } =
    analysis.realityCheck

  return (
    <>
      {analysis.supportConcern && (
        <div
          role="note"
          className="mt-5 rounded-xl border border-indigo/30 bg-indigo-soft p-4 text-sm leading-relaxed text-indigo"
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

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Section
          icon={Check}
          title="Known facts"
          hint="What you actually told me."
          tone="bg-sage-soft text-sage"
        >
          <Items items={knownFacts} empty="Nothing definite yet." />
        </Section>
        <Section
          icon={Cloud}
          title="Assumptions"
          hint="Interpretations that haven't been verified."
          tone="bg-sand-soft text-sand"
        >
          <Items items={assumptions} empty="None identified." />
        </Section>
        <Section
          icon={CircleHelp}
          title="Unknowns"
          hint="What's needed to decide with confidence."
          tone="bg-indigo-soft text-indigo"
        >
          <Items items={unknowns} empty="None identified." />
        </Section>
        <Section
          icon={Signpost}
          title="Potential consequences"
          hint="Realistic outcomes, marked by how certain they are."
          tone="bg-secondary text-foreground"
        >
          {consequences.length ? (
            <ul className="space-y-3 text-[15px] leading-snug">
              {consequences.map((item) => (
                <li key={item.text}>
                  <span
                    className={cn(
                      "mb-1 block w-fit rounded-full px-2 py-0.5 text-xs font-medium",
                      item.status === "confirmed"
                        ? "bg-sage-soft text-sage"
                        : "bg-sand-soft text-sand"
                    )}
                  >
                    {item.status === "confirmed" ? "Confirmed" : "Uncertain"}
                  </span>
                  {item.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">None identified.</p>
          )}
        </Section>
      </div>
    </>
  )
}

export function RealityCheckScreen({
  analysis,
  source,
  onBack,
  onContinue,
}: {
  analysis: Analysis
  source: Source | null
  onBack: () => void
  onContinue: () => void
}) {
  return (
    <div>
      <SourceBadge source={source} className="mb-4" />
      <ScreenHeading>Let&rsquo;s see what&rsquo;s actually true.</ScreenHeading>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        {analysis.acknowledgement}
      </p>

      <RealityCheckContent analysis={analysis} />

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button type="button" size="xl" onClick={onContinue}>
          See the recovery options
          <ArrowRight aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="xl" onClick={onBack}>
          <ArrowLeft aria-hidden />
          Edit what I wrote
        </Button>
      </div>
    </div>
  )
}
