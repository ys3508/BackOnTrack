"use client"

import { useEffect } from "react"
import { Settings as SettingsIcon, Timer } from "lucide-react"

import { RecoveryApp } from "@/components/recovery-app"
import { CalendarView } from "@/components/workspace/calendar-view"
import { FocusView, useNow } from "@/components/workspace/focus-view"
import { RecoverView } from "@/components/workspace/recover-view"
import { SettingsView } from "@/components/workspace/settings-view"
import {
  WorkspaceProvider,
  newId,
  nowIso,
  useStore,
} from "@/components/workspace/store"
import type { Route } from "@/components/workspace/store"
import { TaskDetail } from "@/components/workspace/task-detail"
import { TasksView } from "@/components/workspace/tasks-view"
import { WorkspaceView } from "@/components/workspace/workspace-view"
import { formatClock, remainingSeconds } from "@/lib/focus/timer"
import type { Session, Source } from "@/lib/session"
import { taskFromSession } from "@/lib/workspace/storage"
import { cn } from "@/lib/utils"

export function WorkspaceApp() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  )
}

const NAV_ITEMS: { label: string; route: Route; match: Route["view"][] }[] = [
  {
    label: "Workspace",
    route: { view: "workspace" },
    match: ["workspace", "guided", "recover"],
  },
  { label: "Tasks", route: { view: "tasks" }, match: ["tasks", "task"] },
  { label: "Calendar", route: { view: "calendar" }, match: ["calendar"] },
  { label: "Focus", route: { view: "focus" }, match: ["focus"] },
]

function Shell() {
  const { route, navigate, mode, liveAvailable, statusChecked, dispatch } =
    useStore()
  const routeKey =
    route.view === "task"
      ? `task-${route.id}`
      : route.view === "recover"
        ? `recover-${route.taskId ?? ""}`
        : route.view

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => navigate({ view: "workspace" })}
            className="flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <Logo />
            <span className="font-heading text-xl">BackOnTrack</span>
          </button>
          <div className="flex items-center gap-1.5">
            <TimerPill />
            <ModeSwitch
              mode={mode}
              liveAvailable={liveAvailable}
              checked={statusChecked}
              onChange={(next) =>
                dispatch({ type: "settings", patch: { modePreference: next } })
              }
            />
            <button
              type="button"
              aria-label="Settings and data"
              onClick={() => navigate({ view: "settings" })}
              className="grid size-10 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/30"
            >
              <SettingsIcon className="size-5" aria-hidden />
            </button>
          </div>
        </div>
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-3 sm:px-4"
        >
          {NAV_ITEMS.map((item) => {
            const current = item.match.includes(route.view)
            return (
              <button
                key={item.label}
                type="button"
                aria-current={current ? "page" : undefined}
                onClick={() => navigate(item.route)}
                className={cn(
                  "min-h-11 flex-1 rounded-t-lg border-b-2 px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/30 sm:flex-none",
                  current
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {item.label}
              </button>
            )
          })}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 pt-6 pb-16 sm:px-6 sm:pt-8">
        <div
          key={routeKey}
          className="animate-in duration-300 fade-in slide-in-from-bottom-1"
        >
          {route.view === "workspace" && <WorkspaceView />}
          {route.view === "tasks" && <TasksView />}
          {route.view === "task" && <TaskDetail id={route.id} />}
          {route.view === "calendar" && <CalendarView />}
          {route.view === "focus" && <FocusView />}
          {route.view === "recover" && <RecoverView taskId={route.taskId} />}
          {route.view === "settings" && <SettingsView />}
          {route.view === "guided" && <GuidedView />}
        </div>
      </main>

      <footer className="border-t border-border/70 px-6 py-4 text-center text-xs text-muted-foreground">
        BackOnTrack offers suggestions and can be wrong. It is not medical,
        legal, or financial advice.
      </footer>
    </div>
  )
}

/** Keeps the running timer one click away from every view. */
function TimerPill() {
  const { state, route, navigate } = useStore()
  const { timer } = state
  const now = useNow(Boolean(timer))
  const remaining = timer ? remainingSeconds(timer, now) : 0
  const clock = formatClock(remaining)

  useEffect(() => {
    document.title = timer ? `${clock} · BackOnTrack` : "BackOnTrack AI"
  }, [timer, clock])

  if (!timer || route.view === "focus") return null
  return (
    <button
      type="button"
      aria-label={`Open focus timer, ${clock} remaining`}
      onClick={() => navigate({ view: "focus" })}
      className="flex min-h-10 items-center gap-1.5 rounded-lg bg-sage-soft px-2.5 text-sm font-medium text-sage tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <Timer className="size-4" aria-hidden />
      {clock}
    </button>
  )
}

function GuidedView() {
  const { mode, dispatch, navigate } = useStore()
  return (
    <RecoveryApp
      embedded
      modeOverride={mode}
      onSaveAsTask={(session: Session) => {
        const id = newId()
        const task = taskFromSession(session, id, nowIso())
        if (!task) return
        dispatch({ type: "add-existing-task", task })
        navigate({ view: "task", id })
      }}
    />
  )
}

function ModeSwitch({
  mode,
  liveAvailable,
  checked,
  onChange,
}: {
  mode: Source
  liveAvailable: boolean
  checked: boolean
  onChange: (mode: Source) => void
}) {
  const options: { value: Source; label: string }[] = [
    { value: "live", label: "Live AI" },
    { value: "demo", label: "Demo" },
  ]
  return (
    <div
      role="group"
      aria-label="Response source for suggestions"
      className="flex rounded-lg bg-secondary p-0.5 text-xs font-medium"
    >
      {options.map((option) => {
        const unavailable = option.value === "live" && !liveAvailable
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            disabled={unavailable || !checked}
            title={
              unavailable && checked
                ? "Live AI needs an API key on the server"
                : undefined
            }
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-8 rounded-md px-2.5 py-1.5 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mode === option.value
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground",
              unavailable && "cursor-not-allowed"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <path
        d="M8 22c5 0 4-12 9-12 3 0 3.500 4 7 4"
        fill="none"
        stroke="white"
        strokeWidth="2.600"
        strokeLinecap="round"
      />
      <circle cx="8" cy="22" r="2.300" fill="white" />
    </svg>
  )
}
