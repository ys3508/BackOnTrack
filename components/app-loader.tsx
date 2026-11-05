"use client"

import dynamic from "next/dynamic"

// The session is restored from localStorage, which only exists in the browser.
export const AppLoader = dynamic(
  () => import("@/components/recovery-app").then((mod) => mod.RecoveryApp),
  {
    ssr: false,
    loading: () => (
      <p className="p-10 text-center text-sm text-muted-foreground">
        Loading BackOnTrack...
      </p>
    ),
  }
)
