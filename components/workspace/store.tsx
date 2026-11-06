"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react"

import { isTimerFinished } from "@/lib/focus/timer"
import { fetchLiveStatus } from "@/lib/recovery-client"
import type { Source } from "@/lib/session"
import { localToday } from "@/lib/workspace/dates"
import { isAway } from "@/lib/workspace/returning"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import type { Workspace } from "@/lib/workspace/schemas"
import {
  clearAllData,
  loadWorkspace,
  saveWorkspace,
} from "@/lib/workspace/storage"

/** Where a task opens: its document, or straight into getting help. */
export type TaskSection = "doc" | "help" | "setup"

/** A choice made before opening a case, such as from the resume prompt. */
export type CaseIntent = "smaller" | "reconsider" | "stuck"

export type Route =
  | { view: "workspace" }
  | { view: "plan" }
  | { view: "avoid" }
  | { view: "routines" }
  | { view: "case"; id: string; intent?: CaseIntent }
  | { view: "tasks" }
  | { view: "task"; id: string; section?: TaskSection }
  | { view: "calendar" }
  | { view: "recover"; taskId?: string }
  | { view: "focus"; taskId?: string }
  | { view: "guided" }
  | { view: "settings" }

export function parseHash(hash: string): Route {
  const [view, id, section] = hash.replace(/^#\/?/, "").split("/")
  if (view === "tasks" && id) {
    return section === "doc" || section === "help" || section === "setup"
      ? { view: "task", id, section }
      : { view: "task", id }
  }
  if (view === "case" && id) return { view: "case", id }
  if (view === "plan" || view === "avoid" || view === "routines") {
    return { view }
  }
  if (view === "focus") return { view: "focus", taskId: id }
  if (view === "recover") return { view: "recover", taskId: id }
  if (
    view === "tasks" ||
    view === "calendar" ||
    view === "guided" ||
    view === "settings"
  ) {
    return { view }
  }
  return { view: "workspace" }
}

export function routeHash(route: Route) {
  if (route.view === "task") {
    return `#/tasks/${route.id}${route.section ? `/${route.section}` : ""}`
  }
  if (route.view === "workspace") return "#/"
  // A choice like "make it smaller" happens once, so a reload can't repeat it.
  if (route.view === "case") return `#/case/${route.id}`
  if (route.view === "recover") {
    return route.taskId ? `#/recover/${route.taskId}` : "#/recover"
  }
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
  /** Applies a change and writes it to storage right away, before returning. */
  commitNow: (action: WorkspaceAction) => void
  /** True when the browser refused the last save, usually because it's full. */
  storageFailed: boolean
  /** True after time away, until the user has chosen a way back in. */
  returning: boolean
  finishReturn: () => void
}

const StoreContext = createContext<Store | null>(null)

export function useStore() {
  const store = useContext(StoreContext)
  if (!store) throw new Error("useStore must be used inside WorkspaceProvider")
  return store
}

/** Goes back to the Now card, where recovery happens, for this task. */
export function useEnterRecovery() {
  const { dispatch, navigate } = useStore()
  return useCallback(
    (taskId: string, plannedId: string | null = null) => {
      dispatch({
        type: "enter-recovery",
        at: nowIso(),
        taskId,
        plannedId,
        source: plannedId ? "scheduled" : "avoidance",
      })
      navigate({ view: "workspace" })
    },
    [dispatch, navigate]
  )
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

  const [storageFailed, setStorageFailed] = useState(false)
  const latest = useRef(state)
  const [returning, setReturning] = useState(() =>
    isAway(state.lastOpenedAt, Date.now())
  )
  const finishReturn = useCallback(() => setReturning(false), [])

  useEffect(() => {
    latest.current = state
  }, [state])

  // Used for documents, because a closing page won't wait for React to save.
  const commitNow = useCallback((action: WorkspaceAction) => {
    latest.current = workspaceReducer(latest.current, action)
    saveWorkspace(latest.current)
    dispatch(action)
  }, [])

  useEffect(() => {
    let active = true
    const saved = saveWorkspace(state)
    queueMicrotask(() => {
      if (active) setStorageFailed(!saved)
    })
    return () => {
      active = false
    }
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
    // Also covers a tab left open for days and only now looked at again.
    const opened = () => {
      if (document.visibilityState !== "visible") return
      if (isAway(latest.current.lastOpenedAt, Date.now())) setReturning(true)
      dispatch({ type: "mark-opened", at: nowIso() })
    }
    dispatch({ type: "mark-opened", at: nowIso() })
    document.addEventListener("visibilitychange", opened)
    return () => document.removeEventListener("visibilitychange", opened)
  }, [])

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
      commitNow,
      storageFailed,
      returning,
      finishReturn,
    }),
    [
      state,
      route,
      navigate,
      today,
      mode,
      status,
      deleteAll,
      commitNow,
      storageFailed,
      returning,
      finishReturn,
    ]
  )

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}
