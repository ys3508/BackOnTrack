// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { Editor } from "@tiptap/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { WorkspaceApp } from "@/components/workspace/workspace-app"
import { inventedCitations } from "@/lib/ai/task-assist"
import { buildWritingRequest } from "@/lib/recovery/context"
import { demoWritingAssist } from "@/lib/recovery/demo-assist"
import { workspaceReducer } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Task } from "@/lib/workspace/schemas"

vi.mock("@fullcalendar/react", () => ({ default: () => <div>Calendar</div> }))
vi.mock("@fullcalendar/daygrid", () => ({ default: {} }))
vi.mock("@fullcalendar/timegrid", () => ({ default: {} }))
vi.mock("@fullcalendar/interaction", () => ({ default: {} }))

const STORAGE = "backontrack.workspace.v1"
const AT = "2026-11-05T12:00:00.000Z"
const TODAY = "2026-11-05"
const saved = () => JSON.parse(window.localStorage.getItem(STORAGE)!)
const button = (name: RegExp | string) => screen.findByRole("button", { name })
const seeded = (title = "ML assignment") =>
  workspaceReducer(EMPTY_WORKSPACE, {
    type: "create-task",
    id: "a",
    at: AT,
    title,
  })

const INSTRUCTIONS =
  "Build a model.\n- Train a classifier on the data\n- Report the accuracy\nYou must submit a PDF."
const withInstructions = (task: Task): Task => ({
  ...task,
  instructions: {
    text: INSTRUCTIONS,
    sourceName: "",
    kind: "paste",
    truncated: false,
    addedAt: AT,
  },
})

async function getEditor(): Promise<Editor> {
  await waitFor(() =>
    expect(document.querySelector(".ProseMirror")).toBeTruthy()
  )
  return (
    document.querySelector(".ProseMirror") as unknown as { editor: Editor }
  ).editor
}

function stubFetch(
  live = false,
  post?: (body: Record<string, unknown>) => Response
) {
  const mock = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method && post
      ? post(JSON.parse(init.body as string))
      : Response.json({ live, model: live ? "m" : null })
  )
  vi.stubGlobal("fetch", mock)
  return mock
}

beforeEach(() => {
  window.localStorage.clear()
  window.location.hash = "#/tasks/a"
  window.scrollTo = vi.fn() as typeof window.scrollTo
  window.localStorage.setItem(
    STORAGE,
    JSON.stringify({ ...seeded(), legacyMigrated: true })
  )
})

describe("demo writing help", () => {
  const request = (
    action: Parameters<typeof buildWritingRequest>[3],
    options = {}
  ) => {
    const state = seeded()
    return buildWritingRequest(
      withInstructions(state.tasks[0]),
      state,
      TODAY,
      action,
      options
    )
  }

  it("makes an outline from the instructions, saying it used simple rules", () => {
    const result = demoWritingAssist(request("outline"))
    expect(result.content).toContain("## Train a classifier on the data")
    expect(result.content).toContain("## Report the accuracy")
    expect(result.note).toMatch(/simple text rules/)
  })

  it("is honest that it can't truly explain or improve text", () => {
    expect(
      demoWritingAssist(request("explain", { selection: "classifier" })).note
    ).toMatch(/can’t explain/)
    expect(
      demoWritingAssist(request("explain", { selection: "classifier" })).content
    ).toContain("Train a classifier")
    const improved = demoWritingAssist(
      request("improve", { selection: "this  is rough ." })
    )
    expect(improved.content).toBe("This is rough.")
    expect(improved.note).toMatch(/only fixes spacing/)
  })

  it("gives three starts, smaller steps, and key lines, inventing no sources", () => {
    const starter = demoWritingAssist(request("starter"))
    expect(starter.content.match(/^\d\. /gm)).toHaveLength(3)
    expect(starter.content).toContain("[")
    expect(demoWritingAssist(request("split")).content).toContain("- [ ]")
    const summary = demoWritingAssist(
      request("summarize", {
        source: "The study must include controls. Other text.",
      })
    )
    expect(summary.content).toContain("must include controls")
    expect(summary.note).toMatch(/isn’t a real summary/)
    for (const action of [
      "outline",
      "starter",
      "split",
      "summarize",
      "explain",
      "improve",
    ] as const) {
      expect(
        inventedCitations(
          demoWritingAssist(request(action)).content,
          request(action)
        )
      ).toEqual([])
    }
  })
})

describe("invented citations", () => {
  const state = seeded()
  const request = buildWritingRequest(state.tasks[0], state, TODAY, "outline", {
    source: "(Lee, 2019) said so",
  })

  it("finds citations and links that weren't provided, and allows ones that were", () => {
    expect(
      inventedCitations("As shown (Smith et al., 2021).", request)
    ).toEqual(["(Smith et al., 2021)"])
    expect(inventedCitations("See https://example.com/paper", request)).toEqual(
      ["https://example.com/paper"]
    )
    expect(inventedCitations("As (Lee, 2019) said.", request)).toEqual([])
    expect(inventedCitations("No sources here.", request)).toEqual([])
  })
})

describe("suggestions in the editor", () => {
  it("never changes the document before acceptance, and keeps text on rejection", async () => {
    stubFetch()
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const editor = await getEditor()
    act(() => {
      editor.commands.insertContent("<p>My own words</p>")
    })
    await user.click(await button("Generate an outline"))
    const preview = await screen.findByLabelText(/Suggested text/)
    expect(
      screen.getByText(/It’s not in your document yet/)
    ).toBeInTheDocument()
    expect(screen.getByText(/prewritten, not AI-generated/)).toBeInTheDocument()
    expect((preview as HTMLTextAreaElement).value).toContain("##")
    expect(editor.getText()).toBe("My own words")

    await user.click(await button("No thanks"))
    expect(editor.getText()).toBe("My own words")
    await waitFor(() =>
      expect(JSON.stringify(saved().tasks[0].history)).toContain(
        "Declined a suggestion"
      )
    )
  })

  it("adds accepted text after the user's writing, marked as suggested, with edits and a way back", async () => {
    stubFetch()
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const editor = await getEditor()
    act(() => {
      editor.commands.setContent("<p>My own words</p>")
    })
    await user.click(await button("Generate an outline"))
    fireEvent.change(await screen.findByLabelText(/Suggested text/), {
      target: { value: "## My heading\n\n- Edited point" },
    })
    await user.click(await button("Add to my document"))
    const html = editor.getHTML()
    expect(html.indexOf("My own words")).toBeLessThan(
      html.indexOf("My heading")
    )
    expect(html).toContain("<h2")
    expect(html).toContain("<ul")
    expect(html).toContain("data-suggested")
    expect(html).not.toMatch(/data-suggested[^>]*>My own words/)

    await waitFor(
      () => expect(saved().tasks[0].workDoc?.content).toContain("Edited point"),
      { timeout: 2000 }
    )
    const task = saved().tasks[0]
    expect(task.workDoc.previous).toContain("My own words")
    expect(task.workDoc.previous).not.toContain("Edited point")
    expect(
      task.history.map((event: { text: string }) => event.text).join(" ")
    ).toContain("Accepted a suggestion")

    await user.click(await button("Before the last suggestion"))
    await user.click(await button("Go back"))
    expect(editor.getText()).toBe("My own words")

    act(() => {
      editor.commands.setContent(html)
    })
    await user.click(await button("Clear suggestion highlights"))
    expect(editor.getHTML()).not.toContain("data-suggested")
  })

  it("replaces selected text only when accepted, and asks for a selection first", async () => {
    stubFetch()
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    const editor = await getEditor()
    await user.click(await button("Improve selected text"))
    expect(await screen.findByText(/Select some text/)).toBeInTheDocument()

    act(() => {
      editor.commands.setContent("<p>keep this  rough text . end</p>")
      editor.commands.setTextSelection({ from: 11, to: 23 })
    })
    await user.click(await button("Improve selected text"))
    await screen.findByLabelText(/Suggested text/)
    expect(editor.getText()).toContain("rough text")
    await user.click(await button("Replace selected text"))
    expect(editor.getText()).toBe("keep this Rough text. end")
  })

  it("summarizes pasted source material", async () => {
    stubFetch()
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await getEditor()
    await user.click(await button("Summarize source material"))
    fireEvent.change(
      await screen.findByLabelText(/Paste the source material/),
      {
        target: { value: "The report must include a chart. Other words." },
      }
    )
    await user.click(await button("Summarize"))
    expect(await screen.findByLabelText(/Suggested text/)).toHaveValue(
      "- The report must include a chart."
    )
  })
})

describe("instructions", () => {
  it("saves pasted text and feeds it to a breakdown", async () => {
    stubFetch()
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/Instructions/))
    fireEvent.change(screen.getByLabelText(/Paste what you were asked/), {
      target: { value: INSTRUCTIONS },
    })
    await user.click(await button("Save instructions"))
    expect(saved().tasks[0].instructions.text).toBe(INSTRUCTIONS)
    await user.click(await button("Break this down"))
    expect(
      await screen.findByDisplayValue("Train a classifier on the data")
    ).toBeInTheDocument()
    await user.click(await button("Remove these instructions")).catch(() => {})
  })

  it("reads an uploaded text file, without sending anything", async () => {
    const fetchMock = stubFetch()
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/Instructions/))
    fireEvent.change(screen.getByLabelText(/Upload a file/), {
      target: { files: [new File(["# Brief\n- Do the work"], "brief.md")] },
    })
    await waitFor(() =>
      expect(saved().tasks[0].instructions?.sourceName).toBe("brief.md")
    )
    expect(saved().tasks[0].instructions.text).toContain("Do the work")
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method)).toEqual([])
  })

  it("explains an unsupported file, and saves nothing", async () => {
    stubFetch()
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/Instructions/))
    fireEvent.change(screen.getByLabelText(/Upload a file/), {
      target: { files: [new File(["x"], "brief.docx")] },
    })
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /isn’t supported/
    )
    expect(saved().tasks[0].instructions).toBeNull()
  })

  it("explains a malformed PDF, and doesn't claim to have read it", async () => {
    stubFetch()
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button(/Instructions/))
    fireEvent.change(screen.getByLabelText(/Upload a file/), {
      target: { files: [new File(["not really a pdf"], "brief.pdf")] },
    })
    expect(await screen.findByRole("alert")).toHaveTextContent(/valid PDF/)
    expect(saved().tasks[0].instructions).toBeNull()
  })
})

describe("sending documents to Live AI", () => {
  const seedWithDocs = () => {
    const state = workspaceReducer(seeded(), {
      type: "set-instructions",
      id: "a",
      at: AT,
      instructions: {
        text: INSTRUCTIONS,
        sourceName: "brief.pdf",
        kind: "file",
        truncated: false,
        addedAt: AT,
      },
    })
    window.localStorage.setItem(
      STORAGE,
      JSON.stringify({ ...state, legacyMigrated: true })
    )
  }
  const ready = () =>
    waitFor(() =>
      expect(screen.getByRole("button", { name: "Live AI" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    )

  it("asks first, sends nothing if cancelled, and remembers a yes for this task", async () => {
    seedWithDocs()
    const posts: Record<string, unknown>[] = []
    stubFetch(true, (body) => {
      posts.push(body)
      return Response.json({ steps: ["AI step"], note: "", ambiguities: [] })
    })
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await ready()
    await user.click(await button("Break this down with AI"))
    const dialog = await screen.findByRole("dialog")
    expect(dialog).toHaveTextContent(/third-party AI service/)
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    expect(posts).toEqual([])

    await user.click(await button("Break this down with AI"))
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Send and continue",
      })
    )
    await screen.findByDisplayValue("AI step")
    expect(posts).toHaveLength(1)
    expect(JSON.stringify(posts[0])).toContain("Train a classifier")
    expect(saved().tasks[0].aiConsentAt).toBeTruthy()
    expect(screen.getByText("Generated by live AI")).toBeInTheDocument()

    // Accepted once, it doesn't ask again for the same text.
    await user.click(await button("Try something else"))
    await screen.findByDisplayValue("AI step")
    expect(posts).toHaveLength(2)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("asks again after the instructions change", () => {
    const state = workspaceReducer(
      workspaceReducer(seeded(), { type: "set-ai-consent", id: "a", at: AT }),
      { type: "set-instructions", id: "a", at: AT, instructions: null }
    )
    expect(state.tasks[0].aiConsentAt).toBeNull()
  })

  it("never asks in Demo Mode, because nothing is sent", async () => {
    seedWithDocs()
    stubFetch()
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await user.click(await button("Break this down"))
    await screen.findByLabelText("Suggested step 1")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("labels a live suggestion, and never labels a template as AI", async () => {
    seedWithDocs()
    stubFetch(true, () =>
      Response.json({
        title: "Outline",
        content: "- Point",
        note: "",
        usedFallback: true,
      })
    )
    const user = userEvent.setup()
    render(<WorkspaceApp />)
    await ready()
    await user.click(await button("Generate an outline"))
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Send and continue",
      })
    )
    await screen.findByText(/couldn’t be used, so this is a built-in template/)
    expect(screen.queryByText("Generated by live AI")).not.toBeInTheDocument()
  })
})
