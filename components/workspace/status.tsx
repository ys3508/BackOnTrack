"use client"

import { useState } from "react"

import { ConfirmDialog } from "@/components/workspace/parts"
import { nowIso, useStore } from "@/components/workspace/store"
import { DEFAULT_CAUTION, detectHighStakes } from "@/lib/guards"
import { EMPTY_INTAKE } from "@/lib/intake"
import type { Task, TaskStatus } from "@/lib/workspace/schemas"

export function isHighStakesTask(task: Task) {
  return detectHighStakes({
    ...EMPTY_INTAKE,
    responsibility: `${task.title} ${task.description}`,
  })
}

/**
 * Changes a task's status from anywhere in the app. Releasing an obligation that
 * looks high stakes needs a confirmation, which the AI can never give for the user.
 */
export function useStatusChange() {
  const { dispatch } = useStore()
  const [pending, setPending] = useState<Task | null>(null)

  function apply(task: Task, status: TaskStatus) {
    dispatch({ type: "set-status", id: task.id, at: nowIso(), status })
  }

  return {
    request(task: Task, status: TaskStatus) {
      if (status === "released" && isHighStakesTask(task)) setPending(task)
      else apply(task, status)
    },
    dialog: {
      task: pending,
      onConfirm() {
        if (pending) apply(pending, "released")
        setPending(null)
      },
      onCancel: () => setPending(null),
    },
  }
}

export function ReleaseDialog({
  task,
  onConfirm,
  onCancel,
}: {
  task: Task | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <ConfirmDialog
      open={Boolean(task)}
      title="Release this task?"
      confirmLabel="Release it"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      {DEFAULT_CAUTION}
    </ConfirmDialog>
  )
}
