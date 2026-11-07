import type { Task } from "@/lib/workspace/schemas"

/** Curated task palettes, shared by Today, Calendar, and the Focus atmosphere. */
export const FOCUS_THEMES = [
  { id: "citrus-glow", name: "Apricot", soft: "#FFDFA8", strong: "#8A4B00", vivid: "#FFA63D", wash: "#FFF4DF", roomBg: "#FBF3E3", roomCore: "#FF9A2E", roomMid: "#FFC98A" },
  { id: "blue-daydream", name: "Sky", soft: "#C9E0F5", strong: "#0B4FB3", vivid: "#6FA5EC", wash: "#EAF3FC", roomBg: "#86ACEA", roomCore: "#F3A95F", roomMid: "#C3A5A8" },
  { id: "mint-garden", name: "Lime", soft: "#E2F3BE", strong: "#3F6B12", vivid: "#BFE58A", wash: "#F4FAE3", roomBg: "#F2F7DF", roomCore: "#A6DC78", roomMid: "#D6EFAE" },
  { id: "coral-bloom", name: "Coral", soft: "#FFD2C4", strong: "#BF3F1B", vivid: "#F2643A", wash: "#FFEFE8", roomBg: "#F8F0EA", roomCore: "#F26A3D", roomMid: "#F9A58C" },
  { id: "lavender-haze", name: "Periwinkle", soft: "#D6DBFF", strong: "#4650C8", vivid: "#8E9BF8", wash: "#EEF0FF", roomBg: "#AEB6F9", roomCore: "#F78CCB", roomMid: "#EFC3EC" },
  { id: "pink-sunrise", name: "Rose", soft: "#FFD3E6", strong: "#B42A78", vivid: "#F77FC4", wash: "#FFEFF6", roomBg: "#FBD3DD", roomCore: "#EE5F33", roomMid: "#F7A48E" },
] as const

export type FocusThemeId = (typeof FOCUS_THEMES)[number]["id"]
export const TASK_COLORS = FOCUS_THEMES

/** The same task always gets the same colour, and nothing extra is saved. */
export function taskColor(taskId: string, selected?: FocusThemeId | null) {
  const chosen = FOCUS_THEMES.find((theme) => theme.id === selected)
  if (chosen) return chosen
  let hash = 0
  for (const character of taskId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  }
  return FOCUS_THEMES[hash % FOCUS_THEMES.length]
}

export function taskTheme(task: Pick<Task, "id" | "focusTheme"> | null) {
  return task ? taskColor(task.id, task.focusTheme) : FOCUS_THEMES[0]
}

/** For the style of anything that reads the --task-* colours. */
export function taskColorVars(
  taskId: string | null | undefined,
  selected?: FocusThemeId | null
) {
  if (!taskId) return undefined
  const theme = taskColor(taskId, selected)
  return {
    "--task-soft": theme.soft,
    "--task-strong": theme.strong,
    "--task-vivid": theme.vivid,
    "--task-wash": theme.wash,
    "--room-bg": theme.roomBg,
    "--room-core": theme.roomCore,
    "--room-mid": theme.roomMid,
  } as React.CSSProperties
}
