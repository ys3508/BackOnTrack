import type { Metadata } from "next"
import { Instrument_Sans, Instrument_Serif } from "next/font/google"

import "./globals.css"
import { cn } from "@/lib/utils"

const fontInterface = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-interface",
})
const fontDisplay = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
})

export const metadata: Metadata = {
  title: "BackOnTrack",
  description:
    "A failure-aware action system: find one concrete next action, start it, and recover when the plan doesn't work.",
  openGraph: {
    title: "BackOnTrack",
    description: "Plan, start, get stuck, recover, continue.",
    type: "website",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={cn(
        "font-sans antialiased",
        fontInterface.variable,
        fontDisplay.variable
      )}
    >
      <body>{children}</body>
    </html>
  )
}
