"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { fieldClass } from "@/components/workspace/parts"
import { newId, nowIso, useStore } from "@/components/workspace/store"
import {
  ESTIMATE_OPTIONS,
  PRIORITIES,
  PRIORITY_LABEL,
  estimateLabel,
} from "@/lib/workspace/schemas"
import type { Priority } from "@/lib/workspace/schemas"

/** A title is all that's required. Everything else can wait. */
export function QuickAdd({
  initialDeadline,
  onAdded,
  autoFocus,
  showDetails,
}: {
  initialDeadline?: string
  onAdded?: (id: string) => void
  autoFocus?: boolean
  showDetails?: boolean
}) {
  const { dispatch } = useStore()
  const [title, setTitle] = useState("")
  const [deadline, setDeadline] = useState(initialDeadline ?? "")
  const [priority, setPriority] = useState<Priority>("none")
  const [estimate, setEstimate] = useState("")

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!title.trim()) return
    const id = newId()
    dispatch({
      type: "create-task",
      id,
      at: nowIso(),
      title,
      deadline: deadline || null,
      priority,
      estimateMinutes: estimate ? Number(estimate) : null,
    })
    setEstimate("")
    setTitle("")
    setDeadline(initialDeadline ?? "")
    setPriority("none")
    onAdded?.(id)
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <label htmlFor="quick-add" className="sr-only">
          New task
        </label>
        <Input
          id="quick-add"
          value={title}
          maxLength={200}
          autoFocus={autoFocus}
          placeholder="Add a task..."
          onChange={(event) => setTitle(event.target.value)}
          className="h-11 flex-1"
        />
        <Button type="submit" size="xl" disabled={!title.trim()}>
          <Plus aria-hidden />
          Add
        </Button>
      </div>
      {showDetails && (
        <div className="grid gap-2 sm:grid-cols-3">
          <div>
            <label
              htmlFor="quick-add-deadline"
              className="mb-1 block text-sm font-medium"
            >
              Deadline (optional)
            </label>
            <input
              id="quick-add-deadline"
              type="date"
              max="9999-12-31"
              value={deadline}
              onChange={(event) => setDeadline(event.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label
              htmlFor="quick-add-priority"
              className="mb-1 block text-sm font-medium"
            >
              Priority (optional)
            </label>
            <select
              id="quick-add-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority)}
              className={fieldClass}
            >
              {PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {PRIORITY_LABEL[value]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="quick-add-estimate"
              className="mb-1 block text-sm font-medium"
            >
              Time needed (optional)
            </label>
            <select
              id="quick-add-estimate"
              value={estimate}
              onChange={(event) => setEstimate(event.target.value)}
              className={fieldClass}
            >
              <option value="">Not sure</option>
              {ESTIMATE_OPTIONS.map((value) => (
                <option key={value} value={value}>
                  {estimateLabel(value)}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </form>
  )
}
