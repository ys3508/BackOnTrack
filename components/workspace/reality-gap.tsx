"use client"

import { useState } from "react"
import { Check, Copy, Plus, Trash2 } from "lucide-react"

import { Card } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { nowIso, useStore } from "@/components/workspace/store"
import { messageDraftFor } from "@/lib/recovery/case-engine"
import type { RealityGap, Task } from "@/lib/workspace/schemas"

const GAP_SECTIONS: {
  key: keyof RealityGap
  title: string
  help: string
  add: string
  tile: string
}[] = [
  {
    key: "known",
    title: "Known Facts",
    help: "Facts you’ve confirmed.",
    add: "Add a fact",
    tile: "var(--mint)",
  },
  {
    key: "worried",
    title: "Worries / Assumptions",
    help: "These are possibilities, not facts. They may not happen.",
    add: "Add a worry",
    tile: "var(--peach)",
  },
  {
    key: "unknown",
    title: "Unknowns",
    help: "Things worth finding out.",
    add: "Add a question",
    tile: "var(--sky)",
  },
  {
    key: "can",
    title: "Possible Actions",
    help: "Realistic options. Choose one as your next step.",
    add: "Add an option",
    tile: "var(--butter)",
  },
]

function ItemEditor({
  label,
  items,
  onChange,
  addLabel,
  renderExtra,
}: {
  label: string
  items: string[]
  onChange: (items: string[]) => void
  addLabel: string
  renderExtra?: (item: string) => React.ReactNode
}) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="space-y-1">
          <div className="flex items-start gap-1.5">
            <label className="sr-only" htmlFor={`${label}-${index}`}>
              {label}, item {index + 1}
            </label>
            <Textarea
              id={`${label}-${index}`}
              value={item}
              maxLength={400}
              rows={1}
              onChange={(event) =>
                onChange(
                  items.map((value, at) =>
                    at === index ? event.target.value : value
                  )
                )
              }
              className="min-h-11 flex-1 bg-white"
            />
            <button
              type="button"
              aria-label={`Remove from ${label}: ${item}`}
              onClick={() => onChange(items.filter((_, at) => at !== index))}
              className="grid size-11 shrink-0 place-items-center rounded-full text-ink outline-none hover:bg-white/60 focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
          {renderExtra?.(item)}
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...items, ""])}
        className="inline-flex min-h-11 items-center gap-1 rounded-md text-sm font-medium text-ink font-semibold outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <Plus className="size-4" aria-hidden />
        {addLabel}
      </button>
    </div>
  )
}

export function RealityGapTool({ task }: { task: Task }) {
  const { dispatch } = useStore()
  const recovery = task.recoveryCase!
  const gap = recovery.realityGap ?? {
    known: [],
    worried: [],
    unknown: [],
    can: [],
  }
  const update = (key: keyof RealityGap, items: string[]) =>
    dispatch({
      type: "case-update",
      id: task.id,
      at: nowIso(),
      patch: { realityGap: { ...gap, [key]: items } },
    })

  return (
    <section aria-labelledby="gap-heading">
      <Card className="space-y-5">
        <div>
          <h2 id="gap-heading" className="font-heading text-[2.5rem] leading-none">
            Reality Gap
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            A first draft from what you wrote. It may have sorted something
            wrongly, so change anything here. BackOnTrack doesn’t know the
            actual rules or what will happen.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
        {GAP_SECTIONS.map((section) => (
          <div
            key={section.key}
            style={{ background: section.tile }}
            className="min-w-0 rounded-[1.5rem] p-4"
          >
            <h3 className="font-heading text-2xl">
              {section.title}
            </h3>
            <p className="mb-2 text-xs font-medium">{section.help}</p>
            <ItemEditor
              label={section.title}
              items={gap[section.key]}
              addLabel={section.add}
              onChange={(items) => update(section.key, items)}
              renderExtra={
                section.key === "can"
                  ? (item) =>
                      recovery.current?.text === item.trim() ? (
                        <p className="flex items-center gap-1 text-xs font-medium text-brand">
                          <Check className="size-3.5" aria-hidden />
                          Your next step
                        </p>
                      ) : item.trim() ? (
                        <button
                          type="button"
                          onClick={() =>
                            dispatch({
                              type: "case-write-action",
                              id: task.id,
                              at: nowIso(),
                              text: item,
                            })
                          }
                          className="min-h-11 bot-press rounded-2xl bg-white px-3 text-sm font-semibold outline-none"
                        >
                          Make this my next step
                        </button>
                      ) : null
                  : undefined
              }
            />
          </div>
        ))}
        </div>
        <MessageDraft task={task} />
      </Card>
    </section>
  )
}

function MessageDraft({ task }: { task: Task }) {
  const { dispatch } = useStore()
  const recovery = task.recoveryCase!
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const draft = recovery.messageDraft
  const write = (messageDraft: string) =>
    dispatch({
      type: "case-update",
      id: task.id,
      at: nowIso(),
      patch: { messageDraft },
    })

  if (!open) {
    return (
      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={() => {
            if (!draft)
              write(messageDraftFor(task.title, recovery.originalInput))
            setOpen(true)
          }}
          className="min-h-11 rounded-md text-sm font-medium text-link outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {draft ? "See the message draft" : "Draft a message to someone"}
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-2 border-t border-border pt-4">
      <label htmlFor="message-draft" className="block text-sm font-medium">
        A message you could send
      </label>
      <p className="text-xs text-muted-foreground">
        BackOnTrack doesn’t send anything. Fill in the [brackets], and change
        whatever doesn’t sound like you.
      </p>
      <Textarea
        id="message-draft"
        value={draft}
        maxLength={2000}
        onChange={(event) => write(event.target.value)}
        className="min-h-40 bg-card"
      />
      <Button
        type="button"
        size="lg"
        variant="outline"
        className="min-h-11"
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
  )
}
