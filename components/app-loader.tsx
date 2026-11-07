"use client"

import dynamic from "next/dynamic"

// The session is restored from localStorage, which only exists in the browser.
export const AppLoader = dynamic(
  () =>
    import("@/components/workspace/workspace-app").then(
      (mod) => mod.WorkspaceApp
    ),
  {
    ssr: false,
    // This is also what's in the page before scripts run, so it says something.
    loading: () => (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="font-heading text-5xl">BackOnTrack</h1>
        <p className="mt-3 text-lg">
          When you’ve been avoiding something, it helps you find one concrete
          thing to do, start it, and recover when the plan doesn’t work.
        </p>
        <p className="mt-3 text-muted-foreground">
          Plan, start, get stuck, recover, continue. Your tasks are saved in
          this browser.
        </p>
        <p role="status" className="mt-6 text-sm text-muted-foreground">
          Loading your day...
        </p>
        <noscript>
          <p className="mt-6">BackOnTrack needs JavaScript to run.</p>
        </noscript>
      </main>
    ),
  }
)
