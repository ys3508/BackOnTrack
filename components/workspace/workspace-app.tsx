"use client"

import { useEffect } from "react"
import { Timer } from "lucide-react"

import { RecoveryApp } from "@/components/recovery-app"
import { CalendarView } from "@/components/workspace/calendar-view"
import { FocusView, useNow } from "@/components/workspace/focus-view"
import { GlobalQuickCapture } from "@/components/workspace/quick-capture"
import { RecoverView } from "@/components/workspace/recover-view"
import { RecoveryHome } from "@/components/workspace/recovery-home"
import { RecoveryWorkspace } from "@/components/workspace/recovery-workspace"
import { ReminderWatcher } from "@/components/workspace/reminder-watcher"
import { RoutinesView } from "@/components/workspace/routines-view"
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
import { TodayView } from "@/components/workspace/today-view"
import { WorkspaceView } from "@/components/workspace/workspace-view"
import { formatClock, remainingSeconds } from "@/lib/focus/timer"
import type { Session } from "@/lib/session"
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
    label: "Today",
    route: { view: "workspace" },
    match: [
      "workspace",
      "plan",
      "avoid",
      "guided",
      "recover",
      "case",
      "tasks",
      "task",
      "focus",
    ],
  },
  { label: "Calendar", route: { view: "calendar" }, match: ["calendar"] },
  { label: "Routines", route: { view: "routines" }, match: ["routines"] },
  { label: "Settings", route: { view: "settings" }, match: ["settings"] },
]

function Shell() {
  const { route, navigate, mode, storageFailed } = useStore()
  const routeKey =
    route.view === "task"
      ? `task-${route.id}`
      : route.view === "case"
        ? `case-${route.id}`
        : route.view === "recover"
          ? `recover-${route.taskId ?? ""}`
          : route.view

  return (
    <div data-mode={mode} className="flex min-h-svh flex-col">
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => navigate({ view: "workspace" })}
            className="flex min-h-11 items-center gap-2.5 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
          >
            <Logo />
            <span className="font-heading text-xl">BackOnTrack</span>
          </button>
          <div className="flex items-center gap-1.5">
            <TimerPill />
          </div>
        </div>
        <nav
          aria-label="Main"
          className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 sm:px-4"
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

      {storageFailed && (
        <div
          role="alert"
          className="bg-sand-soft px-6 py-3 text-center text-sm text-sand"
        >
          Your browser’s storage is full, so recent changes aren’t saved.{" "}
          <button
            type="button"
            onClick={() => navigate({ view: "settings" })}
            className="font-medium underline underline-offset-2"
          >
            Export your data
          </button>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pt-6 pb-16 sm:px-6 sm:pt-8">
        <div
          key={routeKey}
          className="animate-in duration-300 fade-in slide-in-from-bottom-1"
        >
          {route.view === "workspace" && <TodayView />}
          {route.view === "avoid" && <RecoveryHome />}
          {route.view === "plan" && <WorkspaceView />}
          {route.view === "routines" && <RoutinesView />}
          {route.view === "case" && (
            <RecoveryWorkspace id={route.id} intent={route.intent} />
          )}
          {route.view === "tasks" && <TasksView />}
          {route.view === "task" && (
            <TaskDetail id={route.id} section={route.section} />
          )}
          {route.view === "calendar" && <CalendarView />}
          {route.view === "focus" && <FocusView />}
          {route.view === "recover" && <RecoverView taskId={route.taskId} />}
          {route.view === "settings" && <SettingsView />}
          {route.view === "guided" && <GuidedView />}
        </div>
      </main>

      <GlobalQuickCapture />
      <ReminderWatcher />
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

  const paused = timer?.runningSince === null

  useEffect(() => {
    document.title = timer
      ? `${paused ? "Paused" : clock} · BackOnTrack`
      : "BackOnTrack"
  }, [timer, clock, paused])

  // These views already show the timer.
  const shownHere =
    route.view === "focus" ||
    route.view === "workspace" ||
    (route.view === "task" && route.id === timer?.taskId) ||
    (route.view === "case" && route.id === timer?.taskId)
  if (!timer || shownHere) return null
  const timerTask = state.tasks.find((task) => task.id === timer.taskId)
  return (
    <button
      type="button"
      aria-label={`Open focus timer, ${paused ? "paused at " : ""}${clock}${paused ? "" : " remaining"}`}
      onClick={() =>
        navigate(
          timerTask?.recoveryCase
            ? { view: "workspace" }
            : timer.taskId
              ? { view: "task", id: timer.taskId, section: "doc" }
              : { view: "focus" }
        )
      }
      className="flex min-h-10 items-center gap-1.5 rounded-lg bg-sage-soft px-2.5 text-sm font-medium text-sage tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
    >
      <Timer className="size-4" aria-hidden />
      {clock}
      {paused && <span className="font-normal"> paused</span>}
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
