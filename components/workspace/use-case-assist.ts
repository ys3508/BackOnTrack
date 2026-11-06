"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import { useStore, nowIso } from "@/components/workspace/store"
import { isCrisisText } from "@/lib/guards"
import { requestCasePlan } from "@/lib/recovery-client"
import { caseContext } from "@/lib/recovery/case-engine"
import type { CaseContext, CasePurpose } from "@/lib/recovery/case-engine"
import type { CaseRequest } from "@/lib/schemas"
import type { StuckReason, Task } from "@/lib/workspace/schemas"

type RunOptions = {
  overrides?: Partial<CaseContext>
  stuckReason?: StuckReason
  stuckDetail?: string
}

/** The one way a case gets a suggestion, in either mode. */
export function useCaseAssist(task: Task) {
  const { mode, dispatch } = useStore()
  const [pending, setPending] = useState(false)
  const [fellBack, setFellBack] = useState(false)
  const [concern, setConcern] = useState(false)
  const latest = useRef(task)
  useEffect(() => {
    latest.current = task
  }, [task])

  const run = useCallback(
    async (purpose: CasePurpose, options: RunOptions = {}) => {
      const current = latest.current
      const recovery = current.recoveryCase
      if (!recovery) return
      const context = { ...caseContext(current), ...options.overrides }
      if (
        isCrisisText(`${context.originalInput} ${options.stuckDetail ?? ""}`)
      ) {
        setConcern(true)
        return
      }
      const request: CaseRequest = {
        stage: "recovery-case",
        purpose,
        originalInput: context.originalInput.slice(0, 4000),
        title: context.title,
        blocker: context.blocker,
        path: context.path,
        current: recovery.current?.text ?? "",
        alternatives: recovery.alternatives.slice(0, 12),
        completed: context.completed.slice(-30),
        tried: context.tried.slice(-40),
        stuckReason: options.stuckReason ?? null,
        stuckDetail: options.stuckDetail ?? "",
        realityGap: context.realityGap,
        realityCheck: context.realityCheck,
      }
      setPending(true)
      const plan = await requestCasePlan(mode, request)
      setPending(false)
      setFellBack(Boolean(plan.usedFallback))
      if (plan.supportConcern) {
        setConcern(true)
        return
      }
      if (purpose === "understand") {
        dispatch({
          type: "case-understood",
          id: current.id,
          title: plan.title ?? null,
          suggestedBlocker: plan.suggestedBlocker ?? null,
        })
        return
      }
      dispatch({ type: "case-apply-plan", id: current.id, at: nowIso(), plan })
    },
    [dispatch, mode]
  )

  return {
    run,
    pending,
    fellBack,
    concern,
    clearConcern: () => setConcern(false),
  }
}

export type Assist = ReturnType<typeof useCaseAssist>
