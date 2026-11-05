"use client"

import { useState } from "react"
import { Check, Copy, X } from "lucide-react"
import { Selection } from "@tiptap/pm/state"
import type { Editor } from "@tiptap/react"

import {
  Card,
  ErrorNotice,
  LoadingNotice,
  SourceBadge,
} from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { insertSuggestion } from "@/components/workspace/writing-assist"
import {
  buildStepHelpRequest,
  buildWorkspaceSetupRequest,
} from "@/lib/recovery/context"
import {
  entryPoints,
  preparedDocument,
  type EntryPoint,
} from "@/lib/recovery/prepared"
import { requestStepHelp, requestWorkspaceSetup } from "@/lib/recovery-client"
import type { StepHelpResult, WorkspaceSetupResult } from "@/lib/schemas"
import type { Task } from "@/lib/workspace/schemas"
import { cn } from "@/lib/utils"
import {
  currentSubtask,
  nextActionFor,
  usefulSmallerSteps,
} from "@/lib/workspace/selectors"

type HelpState =
  | { type: "step"; result: StepHelpResult; source: "live" | "demo" }
  | { type: "setup"; result: WorkspaceSetupResult; source: "live" | "demo" }

/**
 * Starts work in the chosen section. The first [placeholder] there is selected,
 * so typing replaces it. Without one, the cursor goes to the end of the line.
 */
function moveToHeading(editor: Editor, text: string) {
  const { doc } = editor.state
  let after = -1
  doc.descendants((node, position) => {
    if (node.type.name === "heading" && node.textContent === text) {
      after = position + node.nodeSize
    }
  })
  if (after < 0) return
  const { $from } = Selection.near(doc.resolve(after), 1)
  const start = $from.start()
  const placeholder = $from.parent.textContent.match(/\[[^\]]*\]/)
  const from = placeholder
    ? start + (placeholder.index ?? 0)
    : start + $from.parent.content.size
  const to = placeholder ? from + placeholder[0].length : from
  editor.chain().setTextSelection({ from, to }).scrollIntoView().run()
}

/** Copies only the code from a fenced block, so it can be pasted straight in. */
function copyableText(content: string) {
  const match = content.match(/```[^\n]*\n([\s\S]*?)```/)
  return match ? match[1].trim() : content
}

export function useTaskHelp(
  task: Task,
  editor: Editor | null,
  guard: (action: () => void) => void
) {
  const { state, today, mode, dispatch, commitNow } = useStore()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [help, setHelp] = useState<HelpState | null>(null)
  const [draft, setDraft] = useState("")
  const [retry, setRetry] = useState<(() => void) | null>(null)

  const originOf = (fallback?: boolean) => (fallback ? "demo" : mode)

  async function runStepHelp() {
    setBusy("Working out the smallest place to begin...")
    setError(null)
    setRetry(() => () => runStepHelp())
    try {
      const result = await requestStepHelp(
        mode,
        buildStepHelpRequest(task, state, today, nextActionFor(task))
      )
      const source = originOf(result.usedFallback)
      setHelp({ type: "step", result, source })
      setDraft(result.starter.content)
      commitNow({
        type: "log-doc-suggestion",
        id: task.id,
        at: nowIso(),
        text: `Suggested a smaller start (${source === "live" ? "Live AI" : "Demo Mode template"}): ${result.firstAction}`,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.")
    } finally {
      setBusy(null)
    }
  }

  async function runSetup() {
    setBusy("Reading what this task asks for...")
    setError(null)
    setRetry(() => () => runSetup())
    try {
      const result = await requestWorkspaceSetup(
        mode,
        buildWorkspaceSetupRequest(task, state, today)
      )
      const source = originOf(result.usedFallback)
      setHelp({ type: "setup", result, source })
      setDraft(preparedDocument(result))
      commitNow({
        type: "log-doc-suggestion",
        id: task.id,
        at: nowIso(),
        text: `Suggested a first workspace (${source === "live" ? "Live AI" : "Demo Mode template"}): ${result.steps.length} steps and a starter`,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.")
    } finally {
      setBusy(null)
    }
  }

  return {
    requestStep: () => guard(() => void runStepHelp()),
    requestSetup: () => guard(() => void runSetup()),
    panel: (
      <>
        {busy && (
          <Card className="py-6">
            <LoadingNotice>{busy}</LoadingNotice>
          </Card>
        )}
        {error && <ErrorNotice message={error} onRetry={retry ?? undefined} />}
        {help && (
          <HelpPreview
            task={task}
            editor={editor}
            help={help}
            draft={draft}
            onDraft={setDraft}
            onClose={() => setHelp(null)}
            dispatch={dispatch}
            commitNow={commitNow}
          />
        )}
      </>
    ),
  }
}

function HelpPreview({
  task,
  editor,
  help,
  draft,
  onDraft,
  onClose,
  dispatch,
  commitNow,
}: {
  task: Task
  editor: Editor | null
  help: HelpState
  draft: string
  onDraft: (value: string) => void
  onClose: () => void
  dispatch: ReturnType<typeof useStore>["dispatch"]
  commitNow: ReturnType<typeof useStore>["commitNow"]
}) {
  const { result, source, type } = help
  const [split, setSplit] = useState(true)
  const [copied, setCopied] = useState(false)
  const current = currentSubtask(task)
  const smaller =
    type === "step" ? usefulSmallerSteps(task, help.result.smallerSteps) : []

  function accept(entry?: EntryPoint) {
    const at = nowIso()
    const splitting = type === "step" && split && current && smaller.length
    commitNow({
      type: "log-help",
      id: task.id,
      at,
      helpKind:
        type === "setup"
          ? "prepared"
          : splitting
            ? "smaller-steps"
            : result.starter.kind,
    })
    if (editor && draft.trim()) {
      commitNow({
        type: "accept-doc-suggestion",
        id: task.id,
        at,
        label: result.starter.title,
        previous: editor.getHTML(),
      })
      insertSuggestion(editor, draft, "end")
      if (entry) moveToHeading(editor, entry.heading)
    }
    dispatch({
      type: "edit-task",
      id: task.id,
      at,
      patch: { nextAction: entry?.nextAction ?? result.firstAction },
    })
    if (type === "step" && split && current && smaller.length) {
      dispatch({
        type: "split-subtask",
        id: task.id,
        at,
        subId: current.id,
        steps: smaller.map((title) => ({ id: newId(), title })),
      })
    }
    // A task that already has steps keeps them.
    if (type === "setup" && !task.subtasks.length) {
      // These stay editable, in the Steps panel, until the user adds them.
      dispatch({
        type: "set-breakdown",
        id: task.id,
        at,
        breakdown: {
          steps: help.result.steps,
          note: help.result.note,
          ambiguities: help.result.unclear,
          source,
          usedFallback: Boolean(help.result.usedFallback),
          createdAt: at,
        },
      })
    }
    onClose()
    editor?.commands.focus()
  }

  function reject() {
    commitNow({
      type: "log-doc-suggestion",
      id: task.id,
      at: nowIso(),
      text: `Declined a suggestion: ${result.starter.title}`,
    })
    onClose()
  }

  return (
    <Card className="space-y-3 border-dashed border-primary/50">
      <SourceBadge source={source} />
      {result.usedFallback && (
        <p className="text-sm text-muted-foreground">
          The AI’s answer couldn’t be used, so this is a built-in template.
        </p>
      )}
      {result.note && (
        <p className="text-sm text-muted-foreground">{result.note}</p>
      )}

      {type === "setup" && <Understood result={help.result} />}

      <div>
        <h2 className="text-sm font-medium text-sage">Start with this</h2>
        <p className="mt-1 font-heading text-2xl leading-snug">
          {result.firstAction}
        </p>
        {type === "step" && help.result.why && (
          <p className="mt-1 text-[15px] text-muted-foreground">
            {help.result.why}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="starter-preview" className="text-sm font-medium">
          {type === "setup" ? "Your prepared document" : result.starter.title}.
          Suggested, and not in your document yet.
        </label>
        <Textarea
          id="starter-preview"
          value={draft}
          maxLength={8000}
          onChange={(event) => onDraft(event.target.value)}
          className={cn(
            "mt-1 font-mono text-sm leading-relaxed",
            type === "setup" ? "min-h-72" : "min-h-36"
          )}
        />
        {type === "setup" && (
          <p className="mt-1 text-xs text-muted-foreground">
            This is structure to edit, not research or finished work. Anything
            in [brackets] is yours to fill in, and nothing here has been checked
            against your sources.
          </p>
        )}
        {result.starter.kind === "code" && (
          <p className="mt-1 text-xs text-muted-foreground">
            This code hasn’t been run. BackOnTrack can’t run it, so copy it into
            your own environment, and fill in the brackets.
          </p>
        )}
      </div>

      {smaller.length > 0 && current && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg py-1 text-[15px] has-focus-visible:ring-3 has-focus-visible:ring-ring/30">
          <input
            type="checkbox"
            checked={split}
            onChange={(event) => setSplit(event.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[var(--primary)]"
          />
          <span className="min-w-0">
            Replace “{current.title}” with these smaller steps:
            <span className="mt-1 block text-sm text-muted-foreground">
              {smaller.join(" → ")}
            </span>
          </span>
        </label>
      )}

      {type === "setup" && (
        <div role="group" aria-labelledby="entry-heading">
          <h2 id="entry-heading" className="text-sm font-medium">
            Where do you want to begin?
          </h2>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {entryPoints(help.result).map((entry, index) => (
              <Button
                key={entry.label}
                type="button"
                size="xl"
                variant={index === 0 ? "default" : "outline"}
                onClick={() => accept(entry)}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {type === "step" && (
          <Button type="button" size="xl" onClick={() => accept()}>
            <Check aria-hidden />
            Use this
          </Button>
        )}
        <Button
          type="button"
          size="xl"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(copyableText(draft))
              setCopied(true)
            } catch {
              setCopied(false)
            }
          }}
        >
          <Copy aria-hidden />
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" size="xl" variant="ghost" onClick={reject}>
          <X aria-hidden />
          No thanks
        </Button>
      </div>
    </Card>
  )
}

function Understood({ result }: { result: WorkspaceSetupResult }) {
  const groups = [
    { title: "What has to be handed in", items: result.deliverables },
    { title: "What it depends on", items: result.dependencies },
    { title: "Worth asking about", items: result.unclear },
  ].filter((group) => group.items.length)
  return (
    <div className="space-y-2 rounded-xl bg-secondary p-3 text-sm">
      {result.summary && <p>{result.summary}</p>}
      {groups.map((group) => (
        <div key={group.title}>
          <h3 className="font-medium">{group.title}</h3>
          <ul className="mt-0.5 list-disc pl-5">
            {group.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
      {result.datesMentioned.length > 0 && (
        <p>
          <span className="font-medium">Dates mentioned: </span>
          {result.datesMentioned.join(", ")}. Your deadline hasn’t been changed.
          You can set it yourself under “More about this task”.
        </p>
      )}
    </div>
  )
}
