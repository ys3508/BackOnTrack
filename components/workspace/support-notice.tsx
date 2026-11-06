"use client"

import { Button } from "@/components/ui/button"

/** Interrupts the productivity flow. It offers people, not steps. */
export function SupportNotice({
  onBack,
  onContinue,
}: {
  onBack: () => void
  /** Wording rules can misfire, so someone who isn't in danger can carry on. */
  onContinue?: () => void
}) {
  return (
    <section
      role="alert"
      aria-labelledby="support-heading"
      className="space-y-3 rounded-2xl border border-indigo/30 bg-indigo-soft p-5 text-indigo sm:p-6"
    >
      <h2 id="support-heading" className="font-heading text-2xl leading-snug">
        This sounds like more than a task, and it matters more than one.
      </h2>
      <p className="text-[15px] leading-relaxed">
        BackOnTrack can’t give you the support this deserves. If you’re thinking
        about hurting yourself, please reach out to someone now. In the US or
        Canada, you can call or text <strong>988</strong> at any hour. If you’re
        in immediate danger, call your local emergency number. Elsewhere,{" "}
        <a
          href="https://findahelpline.com"
          target="_blank"
          rel="noreferrer"
          className="font-medium underline underline-offset-2"
        >
          findahelpline.com
        </a>{" "}
        lists crisis lines by country. If you can, tell someone you trust.
      </p>
      <p className="text-[15px] leading-relaxed">
        Nothing here needs doing right now. It will wait.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button type="button" size="xl" variant="outline" onClick={onBack}>
          Go back
        </Button>
        {onContinue && (
          <Button type="button" size="xl" variant="ghost" onClick={onContinue}>
            I’m not in danger. Continue with this.
          </Button>
        )}
      </div>
    </section>
  )
}
