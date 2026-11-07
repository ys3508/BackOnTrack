"use client"

import { useState } from "react"
import { NotebookPen } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { newId, nowIso, useStore } from "@/components/workspace/store"

/** Somewhere to put a stray thought, so the session can carry on. */
export function ParkingLot({ taskId }: { taskId: string | null }) {
  const { state, dispatch } = useStore()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [saved, setSaved] = useState(false)
  const count = state.parkingLot.length
  if (!open) {
    return (
      <Button
        type="button"
        size="lg"
        variant="soft"
        className="h-11 min-h-11"
        onClick={() => setOpen(true)}
      >
        <NotebookPen aria-hidden />
        Parking Lot{count > 0 && ` (${count})`}
      </Button>
    )
  }
  return (
    <form
      className="w-full space-y-1 text-left"
      onSubmit={(event) => {
        event.preventDefault()
        if (!text.trim()) return
        dispatch({
          type: "park-thought",
          id: newId(),
          at: nowIso(),
          text,
          taskId,
        })
        setText("")
        setSaved(true)
      }}
    >
      <label htmlFor="parking-lot" className="block text-sm font-medium">
        Park a stray thought, and keep going
      </label>
      <div className="flex gap-2">
        <Input
          id="parking-lot"
          autoFocus
          value={text}
          maxLength={300}
          onChange={(event) => {
            setText(event.target.value)
            setSaved(false)
          }}
          className="h-11 flex-1"
        />
        <Button
          type="submit"
          size="xl"
          variant="outline"
          disabled={!text.trim()}
        >
          Save
        </Button>
        <Button
          type="button"
          size="xl"
          variant="ghost"
          onClick={() => setOpen(false)}
        >
          Close
        </Button>
      </div>
      <p role="status" className="min-h-5 text-xs text-muted-foreground">
        {saved ? "Saved. It’ll be below when you’re done." : ""}
      </p>
    </form>
  )
}
