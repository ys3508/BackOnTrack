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
    loading: () => (
      <p className="p-10 text-center text-sm text-muted-foreground">
        Loading BackOnTrack...
      </p>
    ),
  }
)
