"use client"

import { useRef, useState } from "react"
import {
  BellRing,
  CalendarArrowDown as CalendarDown,
  Coffee,
  Database,
  Download,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { ScreenHeading } from "@/components/shared"
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

/** One settings group: a coloured tab to find it by, then its controls. */
function Section({
  title,
  Icon,
  tone,
  wide,
  children,
}: {
  title: string
  Icon: LucideIcon
  tone: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={`bot-card bot-rise overflow-hidden ${wide ? "lg:col-span-2" : ""}`}
    >
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-1">
        <span style={{ background: tone }} className="bot-tile-glyph size-8">
          <Icon className="size-4" aria-hidden />
        </span>
        <h2 className="text-[2rem] leading-none">{title}</h2>
      </div>
      <div className="space-y-3 p-5">{children}</div>
    </section>
  )
}

function SuggestionsCard() {
  const { state, dispatch, mode, liveAvailable, statusChecked } = useStore()
  const options: { value: Source; label: string }[] = [
    { value: "demo", label: "Demo" },
    { value: "live", label: "Live AI" },
  ]
  return (
    <Section title="Where suggestions come from" Icon={Sparkles} tone="var(--lilac)">
      <div
        role="group"
        aria-label="Response source for suggestions"
        className="inline-flex rounded-full bg-white/70 p-1 text-sm font-medium"
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
                "min-h-10 rounded-full px-4 transition-colors outline-none  " +
                (mode === option.value
                  ? "bg-primary text-primary-foreground"
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
    </Section>
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
    <Section title="Reminders" Icon={BellRing} tone="var(--pink)">
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
        <span
          aria-hidden
          className={`relative h-5 w-9 rounded-full border-2 border-current transition-colors`}
        >
          <span
            className={`absolute top-0.5 size-3 rounded-full bg-current transition-[left] duration-200 ${on ? "left-[1.125rem]" : "left-0.5"}`}
          />
        </span>
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
    </Section>
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
    <div className="mx-auto grid max-w-5xl items-start gap-5 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <ScreenHeading>
          Settings <span className="bot-accent">and data</span>
        </ScreenHeading>
      </div>

      <Section title="Make it yours" Icon={SlidersHorizontal} tone="var(--butter)" wide>
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
      </Section>

      <SuggestionsCard />
      <RemindersCard />

      <Section title="Buffers" Icon={Coffee} tone="var(--sky)" wide>
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
      </Section>

      <div className="lg:col-span-2">
        <LearningCard />
      </div>

      <Section title="Your data" Icon={Database} tone="var(--mint)" wide>
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
        <p className="text-sm font-semibold">
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
      </Section>

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
