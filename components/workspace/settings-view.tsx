"use client"

import { useState } from "react"
import { Download, Trash2 } from "lucide-react"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { ConfirmDialog, fieldClass } from "@/components/workspace/parts"
import { useStore } from "@/components/workspace/store"
import { exportWorkspace } from "@/lib/workspace/storage"
import type { Settings } from "@/lib/workspace/schemas"

export function SettingsView() {
  const { state, dispatch, deleteAll } = useStore()
  const [confirmDelete, setConfirmDelete] = useState(false)

  function download() {
    const url = URL.createObjectURL(
      new Blob([exportWorkspace(state)], { type: "application/json" })
    )
    const link = document.createElement("a")
    link.href = url
    link.download = "backontrack-data.json"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <ScreenHeading>Settings and data</ScreenHeading>

      <Card className="space-y-3">
        <h2 className="font-sans text-[15px] font-semibold tracking-normal">
          Make it yours
        </h2>
        <p className="text-sm text-muted-foreground">
          Everything works as it is. Change these only if you’d like to.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label
              htmlFor="default-focus"
              className="mb-1 block text-sm font-medium"
            >
              Default focus length
            </label>
            <select
              id="default-focus"
              value={state.settings.defaultFocusMinutes}
              onChange={(event) =>
                dispatch({
                  type: "settings",
                  patch: {
                    defaultFocusMinutes: Number(
                      event.target.value
                    ) as Settings["defaultFocusMinutes"],
                  },
                })
              }
              className={fieldClass}
            >
              <option value={5}>5 minutes</option>
              <option value={10}>10 minutes</option>
              <option value={25}>25 minutes</option>
            </select>
          </div>
          <div>
            <label
              htmlFor="home-size"
              className="mb-1 block text-sm font-medium"
            >
              Tasks shown per list on the home page
            </label>
            <select
              id="home-size"
              value={state.settings.homeListSize}
              onChange={(event) =>
                dispatch({
                  type: "settings",
                  patch: {
                    homeListSize: Number(
                      event.target.value
                    ) as Settings["homeListSize"],
                  },
                })
              }
              className={fieldClass}
            >
              <option value={3}>3</option>
              <option value={5}>5</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-sans text-[15px] font-semibold tracking-normal">
          Your data
        </h2>
        <p className="text-sm text-muted-foreground">
          Your tasks are saved only in this browser. There’s no account, and
          they aren’t synced to other devices.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="xl" variant="outline" onClick={download}>
            <Download aria-hidden />
            Export my data
          </Button>
          <Button
            type="button"
            size="xl"
            variant="ghost"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden />
            Delete all my data
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete everything?"
        confirmLabel="Delete everything"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false)
          deleteAll()
        }}
      >
        This removes all tasks, focus history, plans, and settings from this
        browser. It can’t be undone. You can export your data first.
      </ConfirmDialog>
    </div>
  )
}
