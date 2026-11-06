"use client"

import { useState } from "react"

import { ScreenHeading } from "@/components/shared"
import { MyRoutines } from "@/components/workspace/calendar-sidebar"
import { useStore } from "@/components/workspace/store"

export function RoutinesView() {
  const { today } = useStore()
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ScreenHeading>Routines</ScreenHeading>
      <MyRoutines
        editingId={editing}
        setEditingId={setEditing}
        selected={today}
      />
    </div>
  )
}
