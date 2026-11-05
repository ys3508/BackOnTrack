"use client"

import { useState } from "react"
import { ChevronDown, FileUp, Trash2 } from "lucide-react"

import { Card, LoadingNotice } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { nowIso, useStore } from "@/components/workspace/store"
import {
  DocumentError,
  MAX_STORED_CHARS,
  extractDocument,
} from "@/lib/documents/extract"
import type { Task } from "@/lib/workspace/schemas"

export function InstructionsPanel({
  task,
  startOpen = false,
}: {
  task: Task
  startOpen?: boolean
}) {
  const { dispatch } = useStore()
  const { instructions } = task
  const [open, setOpen] = useState(startOpen)
  const [text, setText] = useState("")
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function readFile(file: File) {
    setReading(true)
    setError(null)
    setNotice(null)
    try {
      const result = await extractDocument(file)
      dispatch({
        type: "set-instructions",
        id: task.id,
        at: nowIso(),
        instructions: {
          text: result.text,
          sourceName: file.name,
          kind: "file",
          truncated: result.truncated,
          addedAt: nowIso(),
        },
      })
      setNotice(
        result.pageCount
          ? `Read ${result.pageCount} ${result.pageCount === 1 ? "page" : "pages"}.`
          : null
      )
    } catch (cause) {
      setError(
        cause instanceof DocumentError
          ? cause.message
          : "This file couldn’t be read. Please paste the relevant part instead."
      )
    } finally {
      setReading(false)
    }
  }

  const fileField = (
    <div>
      <label
        htmlFor="instructions-file"
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-border bg-background px-4 text-[15px] font-medium hover:bg-muted has-focus-visible:ring-3 has-focus-visible:ring-ring/30"
      >
        <FileUp className="size-4" aria-hidden />
        Upload a file
        <input
          id="instructions-file"
          type="file"
          accept=".pdf,.txt,.md,.markdown,text/plain,text/markdown,application/pdf"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ""
            if (file) void readFile(file)
          }}
        />
      </label>
      <p className="mt-1 text-xs text-muted-foreground">
        PDF up to 10 MB, or .txt or .md up to 1 MB. Files are read in your
        browser and not uploaded.
      </p>
    </div>
  )

  return (
    <Card className="space-y-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <span className="font-sans text-[15px] font-semibold tracking-normal">
          Instructions
          {instructions ? (
            <span className="ml-2 font-normal text-muted-foreground">
              {instructions.sourceName || "Pasted text"}
            </span>
          ) : (
            <span className="ml-2 font-normal text-muted-foreground">
              (optional)
            </span>
          )}
        </span>
        <ChevronDown
          aria-hidden
          className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {reading && <LoadingNotice>Reading your file...</LoadingNotice>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      {open &&
        (instructions ? (
          <div className="space-y-2">
            <div
              tabIndex={0}
              role="region"
              aria-label="Your instructions"
              className="max-h-64 overflow-auto rounded-xl bg-secondary p-3 text-sm leading-relaxed break-words whitespace-pre-wrap outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              {instructions.text}
            </div>
            {instructions.truncated && (
              <p className="text-sm text-sand">
                This was long, so only the first{" "}
                {MAX_STORED_CHARS.toLocaleString()} characters were kept.
                Anything after that won’t be used.
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              size="lg"
              className="text-muted-foreground"
              onClick={() =>
                dispatch({
                  type: "set-instructions",
                  id: task.id,
                  at: nowIso(),
                  instructions: null,
                })
              }
            >
              <Trash2 aria-hidden />
              Remove these instructions
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="instructions-text"
                className="mb-1 block text-sm font-medium"
              >
                Paste what you were asked to do
              </label>
              <Textarea
                id="instructions-text"
                value={text}
                maxLength={MAX_STORED_CHARS}
                onChange={(event) => setText(event.target.value)}
                className="min-h-28"
              />
              <Button
                type="button"
                size="xl"
                variant="outline"
                className="mt-2"
                disabled={!text.trim()}
                onClick={() => {
                  dispatch({
                    type: "set-instructions",
                    id: task.id,
                    at: nowIso(),
                    instructions: {
                      text: text.trim(),
                      sourceName: "",
                      kind: "paste",
                      truncated: false,
                      addedAt: nowIso(),
                    },
                  })
                  setText("")
                }}
              >
                Save instructions
              </Button>
            </div>
            {fileField}
          </div>
        ))}
    </Card>
  )
}
