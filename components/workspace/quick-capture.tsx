"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import { SupportNotice } from "@/components/workspace/support-notice"
import { isCrisisText } from "@/lib/guards"

/** Lets the rail's button open the same capture as ⌘K. */
export const QUICK_CAPTURE_EVENT = "backontrack:quick-capture"

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
  variant = "plain",
  onText,
}: {
  id?: string
  autoFocus?: boolean
  variant?: "plain" | "hero"
  /** Told as they type, for anything that reacts to it. */
  onText?: (text: string) => void
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
    <form onSubmit={capture.submit} className="flex items-center gap-1.5">
      <label htmlFor={id} className="sr-only">
        What do you need to do?
      </label>
      <Input
        id={id}
        value={capture.text}
        autoFocus={autoFocus}
        maxLength={200}
        placeholder="What have you been putting off?"
        onChange={(event) => {
          capture.setText(event.target.value)
          onText?.(event.target.value)
        }}
        className={
          variant === "hero"
            ? "h-12 min-w-0 flex-1 border-transparent bg-transparent px-3 text-base font-medium shadow-none placeholder:text-ink/70 focus-visible:border-transparent focus-visible:ring-0"
            : "h-12 min-w-0 flex-1 px-4 font-medium"
        }
      />
      <Button
        type="submit"
        size="xl"
        variant={variant === "hero" ? "default" : "outline"}
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
    const onOpen = () => {
      setAdded(null)
      setOpen(true)
    }
    window.addEventListener(QUICK_CAPTURE_EVENT, onOpen)
    return () => {
      document.removeEventListener("keydown", onKey)
      window.removeEventListener(QUICK_CAPTURE_EVENT, onOpen)
    }
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
          className="fixed inset-0 z-50 flex items-start justify-center bg-ink/25 p-4 pt-[15svh]"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div
            role="dialog"
            aria-label="Quick capture"
            className="bot-card w-full max-w-lg p-3"
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
            ? "fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-line bg-butter px-4 py-2 text-sm font-semibold text-ink"
            : "sr-only"
        }
      >
        {added ? `Added “${added}”` : ""}
      </p>
    </>,
    document.body
  )
}
