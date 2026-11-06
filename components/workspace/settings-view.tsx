"use client"

import { useRef, useState } from "react"
import {
  CalendarArrowDown as CalendarDown,
  Download,
  Trash2,
  Upload,
} from "lucide-react"

import { Card, ScreenHeading } from "@/components/shared"
import { Button } from "@/components/ui/button"
import { LearningCard } from "@/components/workspace/learning-card"
import { ConfirmDialog, fieldClass } from "@/components/workspace/parts"
import { notificationStatus } from "@/components/workspace/reminder-watcher"
import { useStore } from "@/components/workspace/store"
import { downloadIcs } from "@/lib/calendar/ics"
import type { Source } from "@/lib/session"
import {
  STORAGE_LIMIT_BYTES,
  exportWorkspace,
  parseImport,
  storageUsedBytes,
} from "@/lib/workspace/storage"
import type { Settings, Workspace } from "@/lib/workspace/schemas"

function SuggestionsCard() {
  const { state, dispatch, mode, liveAvailable, statusChecked } = useStore()
  const options: { value: Source; label: string }[] = [
    { value: "demo", label: "Demo" },
    { value: "live", label: "Live AI" },
  ]
  return (
    <Card className="space-y-3">
      <h2 className="font-sans text-[15px] font-semibold tracking-normal">
        Where suggestions come from
      </h2>
      <div
        role="group"
        aria-label="Response source for suggestions"
        className="inline-flex rounded-lg bg-secondary p-0.5 text-sm font-medium"
      >
        {options.map((option) => {
          const unavailable = option.value === "live" && !liveAvailable
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={mode === option.value}
              disabled={unavailable || !statusChecked}
              onClick={() =>
                dispatch({
                  type: "settings",
                  patch: { modePreference: option.value },
                })
              }
              className={
                "min-h-10 rounded-md px-3.5 outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                (mode === option.value
                  ? "bg-card shadow-sm"
                  : "text-muted-foreground") +
                (unavailable ? " cursor-not-allowed" : "")
              }
            >
              {option.label}
            </button>
          )
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        {mode === "live"
          ? "Live AI sends what you write about a task to the AI provider, to suggest next steps. It can be wrong, and you confirm any change."
          : "Demo uses built-in templates and wording rules, not AI, and sends nothing anywhere. Each suggestion says so."}
        {statusChecked && !liveAvailable && !state.settings.modePreference
          ? " Live AI needs an API key on the server, and none is set here."
          : ""}
      </p>
      <p className="text-sm text-muted-foreground">
        Tasks, the timer, recovery, and the calendar all work without AI.
      </p>
    </Card>
  )
}

function RemindersCard() {
  const { state, dispatch } = useStore()
  const [permission, setPermission] = useState(notificationStatus)
  const on = state.settings.remindersEnabled

  async function turnOn() {
    dispatch({ type: "settings", patch: { remindersEnabled: true } })
    // Asked here, once they've read why and chosen to turn this on.
    if (notificationStatus() === "default") {
      try {
        setPermission(await Notification.requestPermission())
      } catch {
        setPermission(notificationStatus())
      }
    }
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-sans text-[15px] font-semibold tracking-normal">
        Reminders
      </h2>
      <p className="text-sm text-muted-foreground">
        A reminder about five minutes before a scheduled block. Your browser may
        ask for permission to show notifications, so they can reach you when
        you’re in another tab.
      </p>
      <p className="text-sm text-muted-foreground">
        These only work while BackOnTrack is open in a browser tab, and browsers
        can delay them in the background. They aren’t push notifications: a
        closed tab or a sleeping computer means no reminder, so don’t rely on
        them for anything critical.
      </p>
      <Button
        type="button"
        size="xl"
        variant={on ? "outline" : "default"}
        onClick={() =>
          on
            ? dispatch({ type: "settings", patch: { remindersEnabled: false } })
            : turnOn()
        }
      >
        {on ? "Turn off reminders" : "Turn on reminders"}
      </Button>
      {on && (
        <p role="status" className="text-sm text-muted-foreground">
          {permission === "granted"
            ? "On. You’ll get a browser notification and an on-screen reminder."
            : permission === "denied"
              ? "On, on screen only. Your browser is blocking notifications, which you can change in its site settings."
              : permission === "unsupported"
                ? "On, on screen only. This browser doesn’t support notifications."
                : "On, on screen only, unless you allow notifications."}
        </p>
      )}
    </Card>
  )
}

export function SettingsView() {
  const { state, dispatch, deleteAll, today } = useStore()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingImport, setPendingImport] = useState<Workspace | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

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
              Tasks shown per list on Today
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

      <SuggestionsCard />
      <RemindersCard />

      <Card className="space-y-3">
        <h2 className="font-sans text-[15px] font-semibold tracking-normal">
          Buffers
        </h2>
        <p className="text-sm text-muted-foreground">
          Time kept free for catching up. An unused buffer doesn’t count as
          anything missed.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label
              htmlFor="buffer-count"
              className="mb-1 block text-sm font-medium"
            >
              Buffers each day
            </label>
            <select
              id="buffer-count"
              value={state.settings.bufferCount}
              onChange={(event) =>
                dispatch({
                  type: "settings",
                  patch: { bufferCount: Number(event.target.value) },
                })
              }
              className={fieldClass}
            >
              {[0, 1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>
                  {count === 0 ? "None" : count}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="buffer-minutes"
              className="mb-1 block text-sm font-medium"
            >
              Length of each
            </label>
            <select
              id="buffer-minutes"
              value={state.settings.bufferMinutes}
              onChange={(event) =>
                dispatch({
                  type: "settings",
                  patch: { bufferMinutes: Number(event.target.value) },
                })
              }
              className={fieldClass}
            >
              {[15, 30, 45, 60].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes} minutes
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor="buffer-gap"
              className="mb-1 block text-sm font-medium"
            >
              Gap between work blocks
            </label>
            <select
              id="buffer-gap"
              value={state.settings.bufferGapMinutes}
              onChange={(event) =>
                dispatch({
                  type: "settings",
                  patch: { bufferGapMinutes: Number(event.target.value) },
                })
              }
              className={fieldClass}
            >
              {[0, 5, 10, 15].map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 0 ? "No gap" : `${minutes} minutes`}
                </option>
              ))}
            </select>
          </div>
        </div>
        {state.settings.bufferCount > 0 && (
          <p className="text-xs text-muted-foreground">
            They start at{" "}
            {["3:00 PM", "5:00 PM", "11:00 AM", "7:00 PM"]
              .slice(0, state.settings.bufferCount)
              .join(", ")}
            . A gap moves a newly placed block later, so it doesn’t sit right
            after another one.
          </p>
        )}
      </Card>

      <LearningCard />

      <Card className="space-y-3">
        <h2 className="font-sans text-[15px] font-semibold tracking-normal">
          Your data
        </h2>
        <Button
          type="button"
          size="xl"
          variant="outline"
          onClick={() => downloadIcs(state, today)}
        >
          <CalendarDown aria-hidden />
          Export calendar (.ics)
        </Button>
        <p className="text-sm text-muted-foreground">
          A one-time copy of upcoming planned blocks and deadlines, for another
          calendar app. It doesn’t stay in sync.
        </p>
        <p className="text-sm text-muted-foreground">
          Your tasks and documents are saved only in this browser. There’s no
          account, and they aren’t synced to other devices. Clearing your
          browser data deletes them, so export a backup now and then.
        </p>
        <p className="text-sm">
          Using about {(storageUsedBytes() / 1024 / 1024).toFixed(2)} MB of
          about {STORAGE_LIMIT_BYTES / 1024 / 1024} MB available.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="xl" variant="outline" onClick={download}>
            <Download aria-hidden />
            Export my data
          </Button>
          <Button
            type="button"
            size="xl"
            variant="outline"
            onClick={() => fileInput.current?.click()}
          >
            <Upload aria-hidden />
            Import a backup
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            aria-label="Backup file to import"
            className="sr-only"
            tabIndex={-1}
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (!file) return
              const parsed = parseImport(await file.text())
              setImportError(
                parsed ? null : "That isn’t a BackOnTrack backup file."
              )
              setPendingImport(parsed)
            }}
          />
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
        {importError && (
          <p role="alert" className="text-sm text-destructive">
            {importError}
          </p>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(pendingImport)}
        title="Replace your data with this backup?"
        confirmLabel="Replace my data"
        onCancel={() => setPendingImport(null)}
        onConfirm={() => {
          if (pendingImport) dispatch({ type: "replace", state: pendingImport })
          setPendingImport(null)
        }}
      >
        This backup has {pendingImport?.tasks.length ?? 0} tasks. It replaces
        everything now in this browser, so export first if you want to keep it.
      </ConfirmDialog>

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
