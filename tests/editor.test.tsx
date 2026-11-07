// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Editor } from "@tiptap/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { workspaceReducer } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import { parseImport, restoreWorkspace } from "@/lib/workspace/storage"

vi.mock("@fullcalendar/react", () => ({ default: () => <div>Calendar</div> }))
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }))
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }))
vi.mock("@fullcalendar/interaction", () => ({
  default: {},
  Draggable: class {
    destroy() {}
  },
}))
vi.mock("@fullcalendar/multimonth", () => ({ default: {} }))

const STORAGE = "backontrack.workspace.v1"
const AT = "2026-11-05T12:00:00.000Z"
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
const button = (name: RegExp | string) => screen.findByRole("button", { name })

const seeded = () =>
  workspaceReducer(EMPTY_WORKSPACE, {
    type: "create-task",
    id: "a",
    at: AT,
    title: "ML assignment",
  })

async function getEditor(): Promise<Editor> {
  await waitFor(() =>
    expect(document.querySelector(".ProseMirror")).toBeTruthy()
  )
  return (
    document.querySelector(".ProseMirror") as unknown as { editor: Editor }
  ).editor
}

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/tasks/a"
  window.scrollTo = vi.fn() as typeof window.scrollTo
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ live: false, model: null }))
  )
  window.localStorage.setItem(
    STORAGE,
    JSON.stringify({ ...seeded(), legacyMigrated: true })
  )
})

describe("working document", () => {
  it("works with no AI: autosaves, and shows the save status", async () => {
    render(<WorkspaceApp />)
    const editor = await getEditor()
    act(() => {
      editor.commands.insertContent("My first paragraph")
    })
    expect(screen.getByText("Saving...")).toBeInTheDocument()
    await waitFor(
      () =>
        expect(saved().tasks[0].workDoc?.content).toContain(
          "My first paragraph"
        ),
      { timeout: 2000 }
    )
    await screen.findByText(/^Saved /)
    expect(saved().tasks[0].history.at(-1).text).toBe(
      "Started the working document"
    )
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it("restores the document and cursor after a reload", async () => {
    const { unmount } = render(<WorkspaceApp />)
    let editor = await getEditor()
    act(() => {
      editor.commands.insertContent("<h2>Outline</h2><p>Keep this safe</p>")
    })
    await waitFor(
      () =>
        expect(saved().tasks[0].workDoc?.content).toContain("Keep this safe"),
      { timeout: 2000 }
    )
    const cursor = saved().tasks[0].workDoc.cursor
    unmount()
    render(<WorkspaceApp />)
    editor = await getEditor()
    await waitFor(() => expect(editor.getText()).toContain("Keep this safe"))
    expect(editor.getHTML()).toContain("<h2>Outline</h2>")
    expect(editor.state.selection.anchor).toBe(cursor)
  })

  it("saves pending work when the view is left before the delay ends", async () => {
    const { unmount } = render(<WorkspaceApp />)
    const editor = await getEditor()
    act(() => {
      editor.commands.insertContent("Typed just before leaving")
    })
    unmount()
    expect(saved().tasks[0].workDoc?.content).toContain(
      "Typed just before leaving"
    )
  })

  it("has working formatting, list, checklist, undo, and redo controls", async () => {
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const editor = await getEditor()
    act(() => {
      editor.commands.insertContent("Line")
      editor.commands.setTextSelection({ from: 1, to: 5 })
    })
    for (const [label, name] of [
      ["Bold", "bold"],
      ["Italic", "italic"],
    ] as const) {
      await user.click(screen.getByRole("button", { name: label }))
      expect(editor.isActive(name)).toBe(true)
    }
    await user.click(screen.getByRole("button", { name: "Heading" }))
    expect(editor.isActive("heading", { level: 2 })).toBe(true)
    await user.click(screen.getByRole("button", { name: "Subheading" }))
    expect(editor.isActive("heading", { level: 3 })).toBe(true)
    await user.click(screen.getByRole("button", { name: "Subheading" }))

    await user.click(screen.getByRole("button", { name: "Bullet list" }))
    expect(editor.isActive("bulletList")).toBe(true)
    await user.click(screen.getByRole("button", { name: "Numbered list" }))
    expect(editor.isActive("orderedList")).toBe(true)
    await user.click(screen.getByRole("button", { name: "Checklist" }))
    expect(editor.isActive("taskList")).toBe(true)

    await user.click(screen.getByRole("button", { name: "Undo" }))
    expect(editor.isActive("taskList")).toBe(false)
    await user.click(screen.getByRole("button", { name: "Redo" }))
    expect(editor.isActive("taskList")).toBe(true)
  })

  it("copies content and exports Markdown and plain text", async () => {
    const user = userEvent.setup()
    const created: Blob[] = []
    URL.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob)
      return "blob:x"
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    const names: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      names.push(this.download)
    })
    render(<WorkspaceApp />)
    const editor = await getEditor()
    act(() => {
      editor.commands.setContent("<h2>Title</h2><ul><li><p>Point</p></li></ul>")
    })
    await user.click(await button("Markdown"))
    await user.click(await button("Text"))
    expect(names).toEqual(["ml-assignment.md", "ml-assignment.txt"])
    const markdown = await created[0].text()
    expect(markdown).toContain("## Title")
    expect(markdown).toContain("- Point")
    expect(await created[1].text()).toContain("Title")

    const write = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined)
    await user.click(await button("Copy"))
    expect(write.mock.calls[0][0]).toContain("Point")
  })

  it("focuses the document when opened from the home page", async () => {
    window.location.hash = "#/tasks/a/doc"
    render(<WorkspaceApp />)
    const editor = await getEditor()
    await waitFor(() => expect(editor.isFocused).toBe(true))
  })

  it("tells the user if the browser refuses to save", async () => {
    render(<WorkspaceApp />)
    const editor = await getEditor()
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError")
    })
    act(() => {
      editor.commands.insertContent("Won't fit")
    })
    expect(
      await screen.findByText(/storage is full, so recent changes/, undefined, {
        timeout: 2000,
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Not saved: browser storage is full/)
    ).toBeInTheDocument()
    vi.restoreAllMocks()
  })
})

describe("backups", () => {
  it("round-trips documents through an export", () => {
    const state = workspaceReducer(seeded(), {
      type: "save-work-doc",
      id: "a",
      at: AT,
      content: "<p>Precious</p>",
      cursor: 3,
    })
    const imported = parseImport(
      JSON.stringify({ app: "BackOnTrack", ...state })
    )
    expect(imported?.tasks[0].workDoc?.content).toBe("<p>Precious</p>")
  })

  it("rejects files that aren't BackOnTrack backups", () => {
    expect(parseImport("not json")).toBeNull()
    expect(parseImport(JSON.stringify({ version: 2, tasks: [] }))).toBeNull()
  })

  it("keeps a copy of data it can't understand, instead of losing it", async () => {
    window.localStorage.setItem(STORAGE, "{not json")
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: /This task isn/ })
    expect(window.localStorage.getItem("backontrack.workspace.backup")).toBe(
      "{not json"
    )
  })

  it("imports a backup only after confirming", async () => {
    window.location.hash = "#/settings"
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: /Settings/ })
    const backup = JSON.stringify({
      app: "BackOnTrack",
      ...workspaceReducer(EMPTY_WORKSPACE, {
        type: "create-task",
        id: "z",
        at: AT,
        title: "From backup",
      }),
    })
    fireEvent.change(screen.getByLabelText("Backup file to import"), {
      target: {
        files: [
          new File([backup], "backup.json", { type: "application/json" }),
        ],
      },
    })
    const confirm = await button("Replace my data")
    expect(saved().tasks[0].title).toBe("ML assignment")
    await user.click(confirm)
    await waitFor(() => expect(saved().tasks[0].title).toBe("From backup"))
    expect(restoreWorkspace(saved()).tasks).toHaveLength(1)
  })

  it("rejects a bad backup with a message", async () => {
    window.location.hash = "#/settings"
    render(<WorkspaceApp />)
    await screen.findByRole("heading", { name: /Settings/ })
    fireEvent.change(screen.getByLabelText("Backup file to import"), {
      target: { files: [new File(["nope"], "backup.json")] },
    })
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /isn’t a BackOnTrack backup/
    )
  })
})
