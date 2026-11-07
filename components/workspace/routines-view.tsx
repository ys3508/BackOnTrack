"use client"

import { useState } from "react"

import { ScreenHeading } from "@/components/shared"
import { MyRoutines } from "@/components/workspace/calendar-sidebar"
import { useStore } from "@/components/workspace/store"
import { taskColorVars } from "@/lib/calendar/task-colors"

export function RoutinesView() {
  const { today } = useStore()
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div
        style={taskColorVars("routines", "mint-garden")}
        className="bot-stage bot-rise p-6 sm:p-8"
      >
        <ScreenHeading>Routines</ScreenHeading>
        <p className="mt-2 max-w-md">
          Small things that repeat. On a hard day,{" "}
          <span className="bot-accent text-2xl">the minimum still counts.</span>
        </p>
      </div>
      <MyRoutines
        page
        editingId={editing}
        setEditingId={setEditing}
        selected={today}
      />
    </div>
  )
}
