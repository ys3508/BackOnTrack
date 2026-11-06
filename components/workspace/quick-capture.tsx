"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { SupportNotice } from "@/components/workspace/support-notice"
import { isCrisisText } from "@/lib/guards"

/** A title alone is enough. Nothing else is asked for, or guessed. */
function useCapture(onAdded?: (title: string) => void) {
  const { dispatch } = useStore()
  const [text, setText] = useState("")
  const [concern, setConcern] = useState(false)

  const add = () => {
    const title = text.trim()
    if (!title) return
    dispatch({ type: "create-task", id: newId(), at: nowIso(), title })
    setText("")
    setConcern(false)
    onAdded?.(title)
  }
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!text.trim()) return
    if (isCrisisText(text)) setConcern(true)
    else add()
  }
  return { text, setText, concern, setConcern, add, submit }
}

export function QuickCapture({
  id = "quick-capture",
  autoFocus,
  onAdded,
}: {
  id?: string
  autoFocus?: boolean
  onAdded?: (title: string) => void
}) {
  const capture = useCapture(onAdded)
  if (capture.concern) {
    return (
      <SupportNotice
        onBack={() => capture.setConcern(false)}
        onContinue={capture.add}
      />
    )
  }
  return (
    <form onSubmit={capture.submit} className="flex gap-2">
      <label htmlFor={id} className="sr-only">
        What do you need to do?
      </label>
      <Input
        id={id}
        value={capture.text}
        autoFocus={autoFocus}
        maxLength={200}
        placeholder="What have you been putting off?"
        onChange={(event) => capture.setText(event.target.value)}
        className="h-11 flex-1 bg-card"
      />
      <Button
        type="submit"
        size="xl"
        variant="outline"
        disabled={!capture.text.trim()}
      >
        <Plus aria-hidden />
        Add
      </Button>
    </form>
  )
}

/** ⌘K or Ctrl+K, from anywhere in the app. */
export function GlobalQuickCapture() {
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setAdded(null)
        setOpen((value) => !value)
      } else if (event.key === "Escape") {
        setOpen(false)
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [])

  useEffect(() => {
    if (!added) return
    const timer = window.setTimeout(() => setAdded(null), 2500)
    return () => window.clearTimeout(timer)
  }, [added])

  return createPortal(
    <>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/20 p-4 pt-[15svh]"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-label="Quick capture"
            className="w-full max-w-lg rounded-2xl border border-border bg-card p-3 shadow-lg"
          >
            <QuickCapture
              id="global-capture"
              autoFocus
              onAdded={(title) => {
                setAdded(title)
                setOpen(false)
              }}
            />
          </div>
        </div>
      )}
      <p
        role="status"
        className={
          added
            ? "fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background"
            : "sr-only"
        }
      >
        {added ? `Added “${added}”` : ""}
      </p>
    </>,
    document.body
  )
}
