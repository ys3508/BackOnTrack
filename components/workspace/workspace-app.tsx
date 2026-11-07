"use client"

import { useEffect } from "react"
import { Plus, Timer } from "lucide-react"

import { CalendarView } from "@/components/workspace/calendar-view"
import {
  ActiveTimer,
  FocusView,
  useNow,
} from "@/components/workspace/focus-view"
import {
  GlobalQuickCapture,
  QUICK_CAPTURE_EVENT,
} from "@/components/workspace/quick-capture"
import { ReminderWatcher } from "@/components/workspace/reminder-watcher"
import { RoutinesView } from "@/components/workspace/routines-view"
import { SettingsView } from "@/components/workspace/settings-view"
import { WorkspaceProvider, useStore } from "@/components/workspace/store"
import type { Route } from "@/components/workspace/store"
import { TaskDetail } from "@/components/workspace/task-detail"
import { TasksView } from "@/components/workspace/tasks-view"
import { TodayView } from "@/components/workspace/today-view"
import { formatClock, remainingSeconds } from "@/lib/focus/timer"
import { cn } from "@/lib/utils"

export function WorkspaceApp() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  )
}

const NAV_ITEMS: {
  label: string
  route: Route
  match: Route["view"][]
}[] = [
  {
    label: "Today",
    route: { view: "workspace" },
    match: ["workspace", "tasks", "task", "focus"],
  },
  { label: "Calendar", route: { view: "calendar" }, match: ["calendar"] },
  { label: "Routines", route: { view: "routines" }, match: ["routines"] },
  { label: "Settings", route: { view: "settings" }, match: ["settings"] },
]

function Shell() {
  const { route, navigate, mode, storageFailed, state, focusRoomOpen } =
    useStore()
  const routeKey = route.view === "task" ? `task-${route.id}` : route.view
  const immersive = route.view === "focus" && Boolean(state.timer)

  const at = NAV_ITEMS.findIndex((item) => item.match.includes(route.view))

  return (
    <div
      data-app-shell
      data-mode={mode}
      className="flex min-h-svh flex-col"
    >
      <div aria-hidden className="bot-canvas" />
      {/* Stays mounted in Focus, so the tab title keeps counting down. */}
      <header className={cn(immersive && "hidden")}>
        <div className="flex items-center px-5 pt-4 md:absolute md:top-3.5 md:left-5 md:z-30 md:p-0">
          <button
            type="button"
            onClick={() => navigate({ view: "workspace" })}
            className="flex min-h-11 items-center gap-2 rounded-full pr-2 outline-none"
          >
            <Logo />
            <span className="font-heading text-2xl">BackOnTrack</span>
          </button>
        </div>
        <div className="fixed top-4 right-4 z-30">
          <TimerPill />
        </div>
        <div className="bot-rail">
          <nav aria-label="Main" className="bot-nav">
            <div
              aria-hidden
              className="bot-nav-marker"
              style={{ "--at": at } as React.CSSProperties}
            >
              <span />
            </div>
            {NAV_ITEMS.map(({ label, route: target, match }) => (
              <button
                key={label}
                type="button"
                aria-current={match.includes(route.view) ? "page" : undefined}
                onClick={() => navigate(target)}
                className="bot-nav-item"
              >
                {label}
              </button>
            ))}
          </nav>
          <button
            type="button"
            aria-label="Quick capture"
            title="Quick capture (⌘K)"
            onClick={() => window.dispatchEvent(new Event(QUICK_CAPTURE_EVENT))}
            className="ml-1 hidden size-11 shrink-0 place-items-center rounded-full bg-white/80 outline-none transition-transform duration-300 hover:scale-105 md:grid"
          >
            <Plus className="size-5" aria-hidden />
          </button>
        </div>
      </header>

      {storageFailed && (
        <div
          role="alert"
          className="bg-caution-soft px-6 py-3 text-center text-sm font-medium text-caution"
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

      <main
        className={cn(
          "mx-auto w-full max-w-[76rem] flex-1 px-4 pt-3 pb-10 sm:px-6 md:pt-24",
          immersive && "max-w-none p-0 sm:p-0"
        )}
      >
        <div
          key={routeKey}
          className="bot-fade"
        >
          {route.view === "workspace" && <TodayView />}
          {route.view === "routines" && <RoutinesView />}
          {route.view === "tasks" && <TasksView />}
          {route.view === "task" && (
            <TaskDetail id={route.id} section={route.section} />
          )}
          {route.view === "calendar" && <CalendarView />}
          {route.view === "focus" && <FocusView />}
          {route.view === "settings" && <SettingsView />}
        </div>
      </main>

      {/* Today draws the room itself, in its Now card. */}
      {state.timer &&
        focusRoomOpen &&
        route.view !== "workspace" &&
        route.view !== "focus" && <ActiveTimer room timer={state.timer} />}

      <GlobalQuickCapture />
      <ReminderWatcher />
      <footer
        className={cn(
          "px-6 pt-2 pb-28 text-center text-xs text-muted-foreground md:pb-5",
          immersive && "hidden"
        )}
      >
        BackOnTrack offers suggestions and can be wrong. It is not medical,
        legal, or financial advice.
      </footer>
    </div>
  )
}

/** Keeps the running timer one click away from every view. */
function TimerPill() {
  const { state, route, setFocusRoomOpen } = useStore()
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
    (route.view === "task" && route.id === timer?.taskId)
  if (!timer || shownHere) return null
  return (
    <button
      type="button"
      aria-label={`Open focus timer, ${paused ? "paused at " : ""}${clock}${paused ? "" : " remaining"}`}
      onClick={() => setFocusRoomOpen(true)}
      className="bot-press flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-white/85 px-3.5 text-sm font-medium tabular-nums outline-none"
    >
      <Timer className="size-4" aria-hidden />
      {clock}
      {paused && <span className="font-normal"> paused</span>}
    </button>
  )
}

function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-9" aria-hidden>
      <defs>
        <radialGradient id="bot-logo" cx="35%" cy="65%" r="80%">
          <stop offset="0%" stopColor="#f26a3d" />
          <stop offset="55%" stopColor="#ffa63d" />
          <stop offset="100%" stopColor="#86acea" />
        </radialGradient>
      </defs>
      <circle cx="16" cy="16" r="15.500" fill="url(#bot-logo)" />
      <path
        d="M8 22c5 0 4-12 9-12 3 0 3.500 4 7 4"
        fill="none"
        stroke="white"
        strokeWidth="2.200"
        strokeLinecap="round"
      />
      <circle cx="8" cy="22" r="2.300" fill="white" />
    </svg>
  )
}
