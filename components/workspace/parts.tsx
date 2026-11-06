"use client"

import { useState } from "react"
import { Dialog } from "@base-ui/react/dialog"
import { ExternalLink, CalendarClock, Flag } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useStore } from "@/components/workspace/store"
import { deadlineText } from "@/lib/workspace/dates"
import { PRIORITY_LABEL, STATUS_LABEL } from "@/lib/workspace/schemas"
import type { Task, TaskStatus } from "@/lib/workspace/schemas"
import { deadlinePassed } from "@/lib/workspace/selectors"
import { cn } from "@/lib/utils"

const STATUS_STYLE: Record<TaskStatus, string> = {
  "not-started": "bg-secondary text-foreground",
  "in-progress": "bg-sage-soft text-sage",
  paused: "bg-secondary text-muted-foreground",
  "needs-recovery": "bg-indigo-soft text-indigo",
  completed: "bg-sage-soft text-sage",
  released: "bg-secondary text-muted-foreground",
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLE[status]
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

/** Only web addresses, so a pasted script can never run from a link. */
export function safeLink(link: string) {
  const text = link.trim()
  if (!text) return null
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
    )
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null
  } catch {
    return null
  }
}

export function TaskLink({
  task,
  className,
}: {
  task: Task
  className?: string
}) {
  const href = safeLink(task.link)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm font-medium text-indigo underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30",
        className
      )}
    >
      <ExternalLink className="size-4" aria-hidden />
      Open link
    </a>
  )
}

export function DeadlineChip({ task }: { task: Task }) {
  const { today } = useStore()
  if (!task.deadline) return null
  const passed = deadlinePassed(task, today)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        passed ? "font-medium text-sand" : "text-muted-foreground"
      )}
    >
      <CalendarClock className="size-3.5" aria-hidden />
      {deadlineText(task.deadline, today)}
    </span>
  )
}

export function PriorityChip({ task }: { task: Task }) {
  if (task.priority === "medium" || task.priority === "none") return null
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Flag className="size-3.5" aria-hidden />
      {PRIORITY_LABEL[task.priority]} priority
    </span>
  )
}

export function ProgressBar({
  value,
  label,
  className,
}: {
  value: number
  label: string
  className?: string
}) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "h-1.5 overflow-hidden rounded-full bg-secondary",
        className
      )}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-300"
        style={{ width: `${value}%` }}
      />
    </div>
  )
}

/** Shows a limited number of items, with an option to see the rest. */
export function ExpandableList<T>({
  items,
  limit,
  label,
  render,
  empty,
}: {
  items: T[]
  limit: number
  label: string
  render: (item: T) => React.ReactNode
  empty?: string
}) {
  const [expanded, setExpanded] = useState(false)
  if (!items.length) {
    return empty ? (
      <p className="text-sm text-muted-foreground">{empty}</p>
    ) : null
  }
  const shown = expanded ? items : items.slice(0, limit)
  return (
    <>
      <ul className="space-y-2">{shown.map(render)}</ul>
      {items.length > limit && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="mt-2 min-h-11 rounded-md text-sm font-medium text-indigo outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {expanded
            ? "Show fewer"
            : `Show ${items.length - limit} more ${label}`}
        </button>
      )}
    </>
  )
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  confirmDisabled,
}: {
  open: boolean
  title: string
  children?: React.ReactNode
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  onCancel: () => void
  confirmDisabled?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-foreground/20" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[85svh] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border border-border bg-card p-6 shadow-lg outline-none">
          <Dialog.Title className="font-heading text-2xl">{title}</Dialog.Title>
          {children && (
            <Dialog.Description
              render={<div />}
              className="mt-2 text-[15px] leading-relaxed text-muted-foreground"
            >
              {children}
            </Dialog.Description>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              type="button"
              size="xl"
              disabled={confirmDisabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
            <Button type="button" size="xl" variant="ghost" onClick={onCancel}>
              {cancelLabel}
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export const fieldClass =
  "h-11 w-full rounded-xl border border-input bg-card px-3 text-base outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm"
