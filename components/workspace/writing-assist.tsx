"use client"

import { useState } from "react"
import { Check, X } from "lucide-react"
import type { Editor } from "@tiptap/react"
import type { HelpKind } from "@/lib/workspace/schemas"

import {
  Card,
  ErrorNotice,
  LoadingNotice,
  SourceBadge,
} from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { nowIso, useStore } from "@/components/workspace/store"
import { markAsSuggested } from "@/lib/editor/suggestion-mark"
import { buildWritingRequest } from "@/lib/recovery/context"
import { requestWritingAssist } from "@/lib/recovery-client"
import type { WritingAction, WritingAssistResult } from "@/lib/schemas"
import type { Task } from "@/lib/workspace/schemas"

const ACTIONS: {
  action: WritingAction
  label: string
  needsSelection?: boolean
}[] = [
  { action: "outline", label: "Generate an outline" },
  { action: "code", label: "Give me a code starting point" },
  { action: "starter", label: "Suggest a starting paragraph" },
  {
    action: "explain",
    label: "Explain this requirement",
    needsSelection: true,
  },
  { action: "split", label: "Break this into smaller steps" },
  { action: "summarize", label: "Summarize source material" },
  { action: "improve", label: "Improve selected text", needsSelection: true },
]

type Pending = WritingAssistResult & {
  action: WritingAction
  source: "live" | "demo"
  range: { from: number; to: number } | null
}

function selectedRange(editor: Editor) {
  const { from, to, empty } = editor.state.selection
  return empty ? null : { from, to }
}

/** Which of these are ways to start, and so worth learning about. */
const WRITING_HELP: Partial<Record<WritingAction, HelpKind>> = {
  outline: "outline",
  code: "code",
  starter: "draft",
  split: "smaller-steps",
}

export function insertSuggestion(
  editor: Editor,
  markdown: string,
  position: "end" | "cursor" | { from: number; to: number }
) {
  const parsed = editor.markdown?.parse(markdown)
  const blocks = (parsed?.content ?? []).map(markAsSuggested)
  const target =
    position === "end"
      ? editor.state.doc.content.size
      : position === "cursor"
        ? editor.state.selection.to
        : position
  // A one-paragraph edit inside a sentence stays inline, so it doesn't split it.
  if (
    typeof target === "object" &&
    blocks.length === 1 &&
    blocks[0].type === "paragraph"
  ) {
    editor
      .chain()
      .insertContentAt(target, blocks[0].content ?? [])
      .run()
    return
  }
  editor
    .chain()
    .insertContentAt(
      editor.isEmpty ? { from: 0, to: target as number } : target,
      blocks
    )
    .run()
}

export function WritingAssist({
  task,
  editor,
  guard,
}: {
  task: Task
  editor: Editor | null
  guard: (action: () => void) => void
}) {
  const { state, today, mode, commitNow } = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [edited, setEdited] = useState("")
  const [sourceOpen, setSourceOpen] = useState(false)
  const [sourceText, setSourceText] = useState("")
  const [lastRun, setLastRun] = useState<(() => void) | null>(null)

  async function run(action: WritingAction, source = "") {
    if (!editor) return
    const range = selectedRange(editor)
    const selection = range
      ? editor.state.doc.textBetween(range.from, range.to, "\n")
      : ""
    setBusy(true)
    setError(null)
    setHint(null)
    setSourceOpen(false)
    setLastRun(() => () => run(action, source))
    try {
      const result = await requestWritingAssist(
        mode,
        buildWritingRequest(task, state, today, action, { selection, source })
      )
      const origin = result.usedFallback ? "demo" : mode
      setPending({ ...result, action, source: origin, range })
      setEdited(result.content)
      commitNow({
        type: "log-doc-suggestion",
        id: task.id,
        at: nowIso(),
        text: `Suggested text for the document: ${result.title} (${origin === "live" ? "Live AI" : "Demo Mode template"})`,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }

  function choose(item: (typeof ACTIONS)[number]) {
    if (!editor) return
    if (item.needsSelection && !selectedRange(editor)) {
      setHint("Select some text in your document first.")
      return
    }
    if (item.action === "summarize") {
      setSourceOpen(true)
      setHint(null)
      return
    }
    guard(() => run(item.action))
  }

  function accept(position: "end" | "cursor" | "replace") {
    if (!editor || !pending) return
    const previous = editor.getHTML()
    const helpKind = WRITING_HELP[pending.action]
    if (helpKind) {
      commitNow({ type: "log-help", id: task.id, at: nowIso(), helpKind })
    }
    commitNow({
      type: "accept-doc-suggestion",
      id: task.id,
      at: nowIso(),
      label: pending.title,
      previous,
    })
    insertSuggestion(
      editor,
      edited,
      position === "replace" && pending.range
        ? pending.range
        : position === "replace"
          ? "cursor"
          : position
    )
    setPending(null)
  }

  function reject() {
    if (!pending) return
    commitNow({
      type: "log-doc-suggestion",
      id: task.id,
      at: nowIso(),
      text: `Declined a suggestion: ${pending.title}`,
    })
    setPending(null)
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-heading text-lg">
        Help with this document
      </h2>

      {pending ? (
        <div className="space-y-2 rounded-xl border border-dashed border-primary/50 p-3">
          <SourceBadge source={pending.source} />
          <p className="text-sm font-medium">
            Suggested: {pending.title}. It’s not in your document yet.
          </p>
          {pending.usedFallback && (
            <p className="text-sm text-muted-foreground">
              The AI’s answer couldn’t be used, so this is a built-in template.
            </p>
          )}
          {pending.note && (
            <p className="text-sm text-muted-foreground">{pending.note}</p>
          )}
          <label htmlFor="suggestion-preview" className="sr-only">
            Suggested text, which you can edit
          </label>
          <Textarea
            id="suggestion-preview"
            value={edited}
            maxLength={8000}
            onChange={(event) => setEdited(event.target.value)}
            className="min-h-40 font-mono text-sm leading-relaxed"
          />
          <p className="text-xs text-muted-foreground">
            You stay the author. Check it, change it, and don’t hand it in as
            your own research. Any sources need to be ones you’ve found and
            read.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {pending.action === "improve" && pending.range ? (
              <Button
                type="button"
                size="xl"
                disabled={!edited.trim()}
                onClick={() => accept("replace")}
              >
                <Check aria-hidden />
                Replace selected text
              </Button>
            ) : (
              <Button
                type="button"
                size="xl"
                disabled={!edited.trim()}
                onClick={() => accept("end")}
              >
                <Check aria-hidden />
                Add to my document
              </Button>
            )}
            <Button type="button" size="xl" variant="ghost" onClick={reject}>
              <X aria-hidden />
              No thanks
            </Button>
          </div>
        </div>
      ) : busy ? (
        <LoadingNotice>Working from this task...</LoadingNotice>
      ) : sourceOpen ? (
        <div className="space-y-2">
          <label htmlFor="source-text" className="block text-sm font-medium">
            Paste the source material
            {task.instructions
              ? " (or leave empty to use your instructions)"
              : ""}
          </label>
          <Textarea
            id="source-text"
            value={sourceText}
            maxLength={12000}
            onChange={(event) => setSourceText(event.target.value)}
            className="min-h-28"
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="xl"
              disabled={!sourceText.trim() && !task.instructions}
              onClick={() => guard(() => run("summarize", sourceText))}
            >
              Summarize
            </Button>
            <Button
              type="button"
              size="xl"
              variant="ghost"
              onClick={() => setSourceOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {ACTIONS.map((item) => (
            <Button
              key={item.action}
              type="button"
              size="xl"
              variant="outline"
              disabled={!editor}
              className="h-auto min-h-11 justify-start py-2 text-left whitespace-normal"
              // Keeps the selection in the document while clicking.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
            >
              {item.label}
            </Button>
          ))}
        </div>
      )}

      {hint && (
        <p role="status" className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
      {error && <ErrorNotice message={error} onRetry={lastRun ?? undefined} />}
      {mode === "demo" && !pending && (
        <p className="text-xs text-muted-foreground">
          Demo Mode uses templates and simple text rules, not AI.
        </p>
      )}
    </Card>
  )
}
