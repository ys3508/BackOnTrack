// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { RecoveryApp } from "@/components/recovery-app"

function stubFetch(handler?: (init?: RequestInit) => Response) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.method) {
      return Response.json({
        live: Boolean(handler),
        model: handler ? "test-model" : null,
      })
    }
    return handler!(init)
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

const button = (name: RegExp | string) => screen.findByRole("button", { name })

async function startDemo(
  user: ReturnType<typeof userEvent.setup>,
  label: string
) {
  render(<RecoveryApp />)
  await waitFor(async () =>
    expect(await button(/help me restart/i)).toBeEnabled()
  )
  await user.click(await button(label))
  await user.click(await button(/help me restart/i))
}

beforeEach(() => {
  window.localStorage.clear()
  window.scrollTo = vi.fn() as typeof window.scrollTo
})

describe("Demo Mode workflow without an API key", () => {
  it("runs from intake to an accurate summary, adapting when stuck", async () => {
    const fetchMock = stubFetch()
    const user = userEvent.setup()
    await startDemo(user, "Avoiding job applications")

    // Reality Check
    expect(
      await screen.findByRole("heading", { name: /actually true/i })
    ).toBeInTheDocument()
    expect(screen.getByText("Known facts")).toBeInTheDocument()
    expect(screen.getByText("Assumptions")).toBeInTheDocument()
    expect(screen.getByText("Unknowns")).toBeInTheDocument()
    expect(screen.getByText("Potential consequences")).toBeInTheDocument()
    expect(
      screen.getByText(/prewritten, not AI-generated/i)
    ).toBeInTheDocument()
    await user.click(await button(/see the recovery options/i))

    // Decision: the suggestion is preselected
    expect(screen.getByRole("radio", { name: /reduce/i })).toBeChecked()
    await user.click(await button(/continue with reduce/i))

    // One-step workspace: exactly one action and the three required buttons
    const first = await screen.findByRole("heading", {
      name: "Type the name of one company you wanted to apply to.",
    })
    expect(first).toBeInTheDocument()
    await button("Completed")
    await button("I’m Still Stuck")
    await button("Change This Step")
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1)

    // Stuck: Plan B is different
    await user.click(await button("I’m Still Stuck"))
    expect(await screen.findByText(/Plan B/)).toBeInTheDocument()
    const planB = await screen.findByRole("heading", { level: 1 })
    expect(planB).not.toHaveTextContent("one company")

    // Stuck again: the user can explain the obstacle
    await user.click(await button("I’m Still Stuck"))
    await user.click(await button("It still feels too big"))
    await user.click(await button("Try another approach"))
    expect(await screen.findByText(/Plan C/)).toBeInTheDocument()
    expect(screen.getByText(/It still feels too big/)).toBeInTheDocument()

    // Complete this step with text
    await user.type(screen.getByRole("textbox"), "It feels vague")
    const plannedCompleted = screen.getByRole("heading", {
      level: 1,
    }).textContent!
    await user.click(await button("Completed"))

    // Finish while a new step is pending
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 }).textContent).not.toBe(
        plannedCompleted
      )
    )
    const pending = screen.getByRole("heading", { level: 1 }).textContent!
    await user.click(await button("Finish for now"))

    // Summary reflects only what happened
    await screen.findByRole("heading", { name: /where things stand/i })
    const completedBlock = screen.getByText(
      "Actions you marked completed"
    ).parentElement!
    expect(completedBlock).toHaveTextContent(plannedCompleted)
    expect(completedBlock).toHaveTextContent("It feels vague")
    expect(completedBlock).not.toHaveTextContent(pending)
    const attemptedBlock = screen.getByText(
      "Tried, but not completed"
    ).parentElement!
    expect(attemptedBlock).toHaveTextContent("one company")
    expect(
      screen.getByText("Remaining next step (suggested, not done)")
        .parentElement!
    ).toHaveTextContent(pending)
    expect(
      screen.getByText("Unresolved questions").parentElement!
    ).toHaveTextContent(/still accepting applications/)

    // Demo Mode made no POST requests
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")
    ).toHaveLength(0)
  })

  it("validates input before doing anything", async () => {
    stubFetch()
    const user = userEvent.setup()
    render(<RecoveryApp />)
    await waitFor(async () =>
      expect(await button(/help me restart/i)).toBeEnabled()
    )
    await user.click(await button(/help me restart/i))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /add a few words/i
    )
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "What’s been weighing on you?"
    )
  })

  it("lets the user override, requiring acknowledgement to release a high-stakes task", async () => {
    stubFetch()
    const user = userEvent.setup()
    await startDemo(user, "Missed an assignment deadline")
    await user.click(await button(/see the recovery options/i))

    await user.click(screen.getByRole("radio", { name: /release/i }))
    const proceed = await button(/continue with release/i)
    expect(proceed).toBeDisabled()
    await user.click(screen.getByRole("checkbox"))
    expect(proceed).toBeEnabled()
    await user.click(proceed)
    await screen.findByText(/release path/i)
    await user.click(await button("Finish for now"))
    expect(
      screen.getByText("Selected recovery strategy").parentElement!
    ).toHaveTextContent(/Release \(your choice; the suggestion was Reduce\)/)
  })

  it("restores the session from storage and deletes it on request", async () => {
    stubFetch()
    const user = userEvent.setup()
    await startDemo(user, "A suggestion that didn't work")
    await screen.findByRole("heading", { name: /actually true/i })
    expect(window.localStorage.getItem("backontrack.session.v1")).toContain(
      "couldn't start"
    )

    const { unmount } = render(<RecoveryApp />)
    expect(
      (await screen.findAllByRole("heading", { name: /actually true/i })).length
    ).toBeGreaterThan(0)
    unmount()

    await user.click(screen.getByRole("button", { name: /delete my data/i }))
    await screen.findByRole("heading", {
      name: "What’s been weighing on you?",
    })
    await waitFor(() =>
      expect(
        window.localStorage.getItem("backontrack.session.v1") ?? ""
      ).not.toContain("couldn't start")
    )
  })
})

describe("Summary export", () => {
  it("copies and downloads the summary", async () => {
    stubFetch()
    const user = userEvent.setup()
    await startDemo(user, "Avoiding job applications")
    await user.click(await button(/see the recovery options/i))
    await user.click(await button(/continue with reduce/i))
    await user.click(await button("Finish for now"))

    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined)
    await user.click(await button(/copy summary/i))
    expect(writeText.mock.calls[0][0]).toContain(
      "# BackOnTrack Recovery Summary"
    )
    expect(await button("Copied")).toBeInTheDocument()

    const createUrl = vi.fn(() => "blob:summary")
    URL.createObjectURL = createUrl
    URL.revokeObjectURL = vi.fn()
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {})
    await user.click(await button("Download"))
    expect(createUrl).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
  })
})

describe("Live mode failure handling (mocked server)", () => {
  it("shows a safe error, keeps the text, and offers Demo Mode without faking AI", async () => {
    stubFetch(() =>
      Response.json(
        {
          error: {
            code: "ai_unavailable",
            message: "The AI service could not complete this request.",
          },
        },
        { status: 502 }
      )
    )
    const user = userEvent.setup()
    render(<RecoveryApp />)
    await waitFor(async () =>
      expect(await button(/help me restart/i)).toBeEnabled()
    )
    await user.click(await button("Avoiding job applications"))
    await user.click(await button(/help me restart/i))

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not complete/i
    )
    expect(
      screen.getByRole("textbox", { name: /weighing on you/i })
    ).toHaveValue(
      "I have avoided job applications for two weeks and feel overwhelmed."
    )

    await user.click(await button(/continue in demo mode/i))
    await user.click(await button(/help me restart/i))
    expect(
      await screen.findByText(/prewritten, not AI-generated/i)
    ).toBeInTheDocument()
  })

  it("keeps a completed step on record even when the next request fails", async () => {
    const { DEMO_SCENARIOS } = await import("@/lib/demo/scenarios")
    const scenario = DEMO_SCENARIOS[0]
    let posts = 0
    stubFetch((init) => {
      posts++
      const body = JSON.parse(init!.body as string)
      if (body.stage === "analyze")
        return Response.json({ analysis: scenario.analysis })
      if (posts === 2) {
        return Response.json({
          action: scenario.ladders.REDUCE[0][0],
          adaptationNote: "",
          suggestWrapUp: false,
        })
      }
      return Response.json(
        { error: { code: "ai_unavailable", message: "Service down." } },
        { status: 502 }
      )
    })
    const user = userEvent.setup()
    render(<RecoveryApp />)
    await waitFor(async () =>
      expect(await button(/help me restart/i)).toBeEnabled()
    )
    await user.click(await button("Avoiding job applications"))
    await user.click(await button(/help me restart/i))
    expect(await screen.findByText(/generated by live ai/i)).toBeInTheDocument()
    await user.click(await button(/see the recovery options/i))
    await user.click(await button(/continue with reduce/i))
    await user.click(await button("Completed"))

    expect(await screen.findByRole("alert")).toHaveTextContent("Service down.")
    await user.click(await button(/go to my summary/i))
    expect(
      screen.getByText("Actions you marked completed").parentElement!
    ).toHaveTextContent("one company")
  })
})
