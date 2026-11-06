"use client"

import { useEffect, useState } from "react"
import { BellRing, X } from "lucide-react"

import { useStore } from "@/components/workspace/store"
import { dueReminders } from "@/lib/today/reminders"
import type { Reminder } from "@/lib/today/reminders"

/** Whether browser notifications can be used here at all. */
export function notificationStatus() {
  return typeof window !== "undefined" && "Notification" in window
    ? Notification.permission
    : "unsupported"
}

/**
 * Checks while the app is open, and only then. Browsers slow timers in background
 * tabs, so a reminder there can be late, which Settings says plainly.
 */
export function ReminderWatcher() {
  const { state, dispatch, navigate } = useStore()
  const [showing, setShowing] = useState<Reminder | null>(null)

  useEffect(() => {
    const check = () => {
      const [due] = dueReminders(state, Date.now())
      if (!due) return
      dispatch({ type: "mark-reminded", key: due.key })
      setShowing(due)
      if (notificationStatus() === "granted") {
        try {
          const notice = new Notification(due.title, { body: due.body })
          notice.onclick = () => {
            window.focus()
            navigate({ view: "workspace" })
            notice.close()
          }
        } catch {
          // Some browsers only allow this through a service worker.
          // The on-screen reminder has already been shown.
        }
      }
    }
    check()
    const id = window.setInterval(check, 20_000)
    document.addEventListener("visibilitychange", check)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", check)
    }
  }, [state, dispatch, navigate])

  if (!showing) return null
  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-40 flex max-w-[calc(100vw-2rem)] items-start gap-2 rounded-2xl border border-border bg-card p-3 shadow-lg sm:max-w-sm"
    >
      <BellRing className="mt-0.5 size-4 shrink-0 text-sage" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium break-words">{showing.title}</p>
        <p className="text-muted-foreground">{showing.body}</p>
        <button
          type="button"
          onClick={() => {
            setShowing(null)
            navigate({ view: "workspace" })
          }}
          className="mt-1 min-h-9 rounded-md font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          Go to Today
        </button>
      </div>
      <button
        type="button"
        aria-label="Dismiss reminder"
        onClick={() => setShowing(null)}
        className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  )
}
