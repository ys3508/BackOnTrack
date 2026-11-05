import type { Metadata } from "next"
import { Geist, Newsreader } from "next/font/google"

import "./globals.css"
import { cn } from "@/lib/utils"

const fontSans = Geist({ subsets: ["latin"], variable: "--font-sans" })
const fontHeading = Newsreader({
  subsets: ["latin"],
  variable: "--font-heading-serif",
})

export const metadata: Metadata = {
  title: "BackOnTrack AI",
  description: "When plans fall apart, find your way forward.",
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
        fontSans.variable,
        fontHeading.variable
      )}
    >
      <body>{children}</body>
    </html>
  )
}
