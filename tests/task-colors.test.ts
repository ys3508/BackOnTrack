import { describe, expect, it } from "vitest"

import {
  TASK_COLORS,
  taskColor,
  taskColorVars,
} from "@/lib/calendar/task-colors"

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe("task colours", () => {
  it("gives the same task the same colour", () => {
    expect(taskColor("task-1")).toBe(taskColor("task-1"))
  })

  it("spreads tasks across the palette", () => {
    const used = new Set(
      Array.from({ length: 200 }, (_, i) => taskColor(crypto.randomUUID() + i))
    )
    expect(used.size).toBe(TASK_COLORS.length)
  })

  it("has nothing to set without a task", () => {
    expect(taskColorVars(null)).toBeUndefined()
  })

  it.each(TASK_COLORS)("keeps text readable on $name", ({ soft, strong }) => {
    // Dark app text on the pastel, and white text on the deep shade.
    expect(contrast("#1f2433", soft)).toBeGreaterThanOrEqual(4.5)
    expect(contrast("#ffffff", strong)).toBeGreaterThanOrEqual(4.5)
  })
})
