"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react"

import { isTimerFinished } from "@/lib/focus/timer"
import { fetchLiveStatus } from "@/lib/recovery-client"
import type { Source } from "@/lib/session"
import { localToday } from "@/lib/workspace/dates"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import type { Workspace } from "@/lib/workspace/schemas"
import {
  clearAllData,
  loadWorkspace,
  saveWorkspace,
} from "@/lib/workspace/storage"

export type Route =
  | { view: "workspace" }
  | { view: "tasks" }
  | { view: "task"; id: string }
  | { view: "focus"; taskId?: string }
  | { view: "guided" }
  | { view: "settings" }

export function parseHash(hash: string): Route {
  const [view, id] = hash.replace(/^#\/?/, "").split("/")
  if (view === "tasks" && id) return { view: "task", id }
  if (view === "focus") return { view: "focus", taskId: id }
  if (view === "tasks" || view === "guided" || view === "settings") {
    return { view }
  }
  return { view: "workspace" }
}

export function routeHash(route: Route) {
  if (route.view === "task") return `#/tasks/${route.id}`
  if (route.view === "workspace") return "#/"
  if (route.view === "focus") {
    return route.taskId ? `#/focus/${route.taskId}` : "#/focus"
  }
  return `#/${route.view}`
}

type Store = {
  state: Workspace
  dispatch: React.Dispatch<WorkspaceAction>
  route: Route
  navigate: (route: Route) => void
  today: string
  mode: Source
  liveAvailable: boolean
  statusChecked: boolean
  liveModel: string | null
  deleteAll: () => void
}

const StoreContext = createContext<Store | null>(null)

export function useStore() {
  const store = useContext(StoreContext)
  if (!store) throw new Error("useStore must be used inside WorkspaceProvider")
  return store
}

export function newId() {
  return crypto.randomUUID()
}

export function nowIso() {
  return new Date().toISOString()
}

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(
    workspaceReducer,
    undefined,
    loadWorkspace
  )
  const [route, setRoute] = useState<Route>(() =>
    parseHash(window.location.hash)
  )
  const [today, setToday] = useState(() => localToday())
  const [status, setStatus] = useState<{
    checked: boolean
    live: boolean
    model: string | null
  }>({ checked: false, live: false, model: null })

  useEffect(() => {
    saveWorkspace(state)
  }, [state])

  useEffect(() => {
    // Finishes the timer from the wall clock, including after a reload or when
    // a background tab wakes up, however long the browser throttled it.
    const { timer } = state
    if (!timer || timer.runningSince === null) return
    const check = () => {
      if (isTimerFinished(timer, Date.now())) {
        dispatch({ type: "timer-finish", now: Date.now() })
      }
    }
    check()
    const id = window.setInterval(check, 1000)
    document.addEventListener("visibilitychange", check)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", check)
    }
  }, [state])

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash))
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  useEffect(() => {
    // Keeps "today" right if the app stays open past midnight.
    const update = () => setToday(localToday())
    const timer = window.setInterval(update, 60_000)
    document.addEventListener("visibilitychange", update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", update)
    }
  }, [])

  useEffect(() => {
    let active = true
    fetchLiveStatus().then((result) => {
      if (active) setStatus({ checked: true, ...result })
    })
    return () => {
      active = false
    }
  }, [])

  const navigate = useCallback((next: Route) => {
    window.location.hash = routeHash(next)
    setRoute(next)
  }, [])

  const deleteAll = useCallback(() => {
    clearAllData()
    dispatch({ type: "replace", state: { ...loadWorkspace() } })
    navigate({ view: "workspace" })
  }, [navigate])

  const mode: Source =
    status.live && state.settings.modePreference !== "demo" ? "live" : "demo"

  const store = useMemo<Store>(
    () => ({
      state,
      dispatch,
      route,
      navigate,
      today,
      mode,
      liveAvailable: status.live,
      statusChecked: status.checked,
      liveModel: status.model,
      deleteAll,
    }),
    [state, route, navigate, today, mode, status, deleteAll]
  )

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
