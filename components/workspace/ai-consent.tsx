"use client"

import { useState } from "react"

import { ConfirmDialog } from "@/components/workspace/parts"
import { nowIso, useStore } from "@/components/workspace/store"
import type { Task } from "@/lib/workspace/schemas"

/**
 * In Live AI, asks before a task's instructions or document first leave the
 * browser. Demo Mode never sends anything, so it never needs to ask.
 */
export function useAiConsent(task: Task) {
  const { mode, dispatch } = useStore()
  const [pending, setPending] = useState<(() => void) | null>(null)

  const hasDocuments = Boolean(task.instructions || task.workDoc?.content)

  return {
    guard(action: () => void) {
      if (mode === "live" && hasDocuments && !task.aiConsentAt) {
        setPending(() => action)
      } else {
        action()
      }
    },
    dialog: (
      <ConfirmDialog
        open={pending !== null}
        title="Send this to the AI provider?"
        confirmLabel="Send and continue"
        onCancel={() => setPending(null)}
        onConfirm={() => {
          dispatch({ type: "set-ai-consent", id: task.id, at: nowIso() })
          pending?.()
          setPending(null)
        }}
      >
        To help with this task, its details,{" "}
        {task.instructions ? "instructions, " : ""}working document text, and
        anything BackOnTrack has noticed about what helps you will be sent to
        the third-party AI service. Please leave out private details you don’t
        want to share.
      </ConfirmDialog>
    ),
  }
}
