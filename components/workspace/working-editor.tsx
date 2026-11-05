"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { Placeholder } from "@tiptap/extensions"
import { Markdown } from "@tiptap/markdown"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import type { Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  Bold,
  Check,
  Copy,
  Download,
  Heading2,
  Heading3,
  Italic,
  List,
  ListChecks,
  ListOrdered,
  Redo2,
  Undo2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { nowIso, useStore } from "@/components/workspace/store"
import { formatDateTime } from "@/lib/workspace/dates"
import { SuggestionMark } from "@/lib/editor/suggestion-mark"
import type { Task } from "@/lib/workspace/schemas"
import { cn } from "@/lib/utils"

const AUTOSAVE_MS = 700

const toolButton =
  "grid size-10 shrink-0 place-items-center rounded-lg text-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-30 aria-pressed:bg-sage-soft aria-pressed:text-sage"

export function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

function safeFileName(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "document"
  )
}

export function useWorkingEditor(task: Task, focusOnLoad: boolean) {
  const { commitNow } = useStore()
  const taskId = task.id
  const timer = useRef<number | null>(null)
  const [dirty, setDirty] = useState(false)

  const flush = useCallback(
    (editor: Editor) => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
        timer.current = null
      }
      commitNow({
        type: "save-work-doc",
        id: taskId,
        at: nowIso(),
        content: editor.getHTML(),
        cursor: editor.state.selection.anchor,
      })
      setDirty(false)
    },
    [commitNow, taskId]
  )

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown,
      SuggestionMark,
      Placeholder.configure({
        placeholder: "Start here. Rough is fine.",
      }),
    ],
    content: task.workDoc?.content ?? "",
    editorProps: {
      attributes: {
        class: "bot-editor",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": `Working document for ${task.title}`,
      },
    },
    onCreate: ({ editor: created }) => {
      const cursor = task.workDoc?.cursor ?? 0
      if (cursor > 0 && cursor <= created.state.doc.content.size) {
        created.commands.setTextSelection(cursor)
      }
      if (focusOnLoad) created.commands.focus()
    },
    onUpdate: ({ editor: updated }) => {
      setDirty(true)
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => flush(updated), AUTOSAVE_MS)
    },
    onBlur: ({ editor: blurred }) => {
      if (timer.current !== null) flush(blurred)
    },
  })

  // Saves pending work when leaving the page or this view, so nothing is lost.
  useEffect(() => {
    if (!editor) return
    const save = () => {
      if (timer.current !== null) flush(editor)
    }
    window.addEventListener("pagehide", save)
    document.addEventListener("visibilitychange", save)
    return () => {
      window.removeEventListener("pagehide", save)
      document.removeEventListener("visibilitychange", save)
      save()
    }
  }, [editor, flush])

  // Picks up text added from elsewhere, such as a saved draft, without clobbering
  // anything the user is in the middle of typing.
  const savedContent = task.workDoc?.content
  useEffect(() => {
    if (!editor || savedContent === undefined) return
    if (timer.current === null && savedContent !== editor.getHTML()) {
      editor.commands.setContent(savedContent, { emitUpdate: false })
    }
  }, [editor, savedContent])

  return { editor, dirty, flush }
}

export function WorkingEditor({
  task,
  editor,
  dirty,
}: {
  task: Task
  editor: Editor | null
  dirty: boolean
}) {
  const { dispatch, storageFailed } = useStore()
  const [copied, setCopied] = useState(false)
  const [restoreOpen, setRestoreOpen] = useState(false)

  return (
    <section
      aria-label="Working document"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_oklch(0.3_0.02_85/0.05)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border px-4 py-2.5">
        <h2 className="font-sans text-[15px] font-semibold tracking-normal">
          Working document
        </h2>
        <p
          role="status"
          className={cn(
            "flex items-center gap-1 text-xs",
            storageFailed
              ? "font-medium text-destructive"
              : "text-muted-foreground"
          )}
        >
          {storageFailed ? (
            "Not saved: browser storage is full. Copy or export your work."
          ) : dirty ? (
            "Saving..."
          ) : task.workDoc ? (
            <>
              <Check className="size-3.5 text-sage" aria-hidden />
              Saved {formatDateTime(task.workDoc.updatedAt)}
            </>
          ) : (
            "Saves automatically in this browser"
          )}
        </p>
      </div>

      {editor && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />

      <div className="flex flex-wrap items-center gap-1 border-t border-border px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          disabled={!editor}
          onClick={async () => {
            if (!editor) return
            try {
              await navigator.clipboard.writeText(editor.getText())
              setCopied(true)
            } catch {
              setCopied(false)
            }
          }}
        >
          <Copy aria-hidden />
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          disabled={!editor}
          onClick={() =>
            editor &&
            downloadText(
              `${safeFileName(task.title)}.md`,
              editor.getMarkdown(),
              "text/markdown"
            )
          }
        >
          <Download aria-hidden />
          Markdown
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          disabled={!editor}
          onClick={() =>
            editor &&
            downloadText(
              `${safeFileName(task.title)}.txt`,
              editor.getText(),
              "text/plain"
            )
          }
        >
          <Download aria-hidden />
          Text
        </Button>
        {editor && task.workDoc?.content.includes("data-suggested") && (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="text-muted-foreground"
            onClick={() =>
              editor.chain().selectAll().unsetMark("suggestion").run()
            }
          >
            Clear suggestion highlights
          </Button>
        )}
        {task.workDoc?.previous !== null &&
          task.workDoc?.previous !== undefined && (
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="text-muted-foreground"
              onClick={() => setRestoreOpen(!restoreOpen)}
            >
              Before the last suggestion
            </Button>
          )}
      </div>

      {restoreOpen && task.workDoc?.previous !== null && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3 text-sm">
          <span className="min-w-0 flex-1">
            Go back to the version from before you accepted the last suggestion?
          </span>
          <Button
            type="button"
            size="lg"
            variant="outline"
            onClick={() => {
              const previous = task.workDoc?.previous
              if (previous === null || previous === undefined || !editor) return
              const current = editor.getHTML()
              editor.commands.setContent(previous)
              // Swaps them, so this can be undone the same way.
              dispatch({
                type: "restore-work-doc",
                id: task.id,
                at: nowIso(),
                content: previous,
                previous: current,
              })
              setRestoreOpen(false)
            }}
          >
            Go back
          </Button>
        </div>
      )}
    </section>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      h2: current.isActive("heading", { level: 2 }),
      h3: current.isActive("heading", { level: 3 }),
      bullet: current.isActive("bulletList"),
      ordered: current.isActive("orderedList"),
      tasks: current.isActive("taskList"),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  })

  const chain = () => editor.chain().focus()
  const items = [
    {
      label: "Bold",
      Icon: Bold,
      pressed: active.bold,
      run: () => chain().toggleBold().run(),
    },
    {
      label: "Italic",
      Icon: Italic,
      pressed: active.italic,
      run: () => chain().toggleItalic().run(),
    },
    {
      label: "Heading",
      Icon: Heading2,
      pressed: active.h2,
      run: () => chain().toggleHeading({ level: 2 }).run(),
    },
    {
      label: "Subheading",
      Icon: Heading3,
      pressed: active.h3,
      run: () => chain().toggleHeading({ level: 3 }).run(),
    },
    {
      label: "Bullet list",
      Icon: List,
      pressed: active.bullet,
      run: () => chain().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      Icon: ListOrdered,
      pressed: active.ordered,
      run: () => chain().toggleOrderedList().run(),
    },
    {
      label: "Checklist",
      Icon: ListChecks,
      pressed: active.tasks,
      run: () => chain().toggleTaskList().run(),
    },
  ]

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1"
    >
      {items.map(({ label, Icon, pressed, run }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          title={label}
          onClick={run}
          className={toolButton}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
      <span aria-hidden className="mx-1 h-6 w-px bg-border" />
      <button
        type="button"
        aria-label="Undo"
        title="Undo"
        disabled={!active.canUndo}
        onClick={() => chain().undo().run()}
        className={toolButton}
      >
        <Undo2 className="size-4" aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Redo"
        title="Redo"
        disabled={!active.canRedo}
        onClick={() => chain().redo().run()}
        className={toolButton}
      >
        <Redo2 className="size-4" aria-hidden />
      </button>
    </div>
  )
}
