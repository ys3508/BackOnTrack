import { MockLanguageModelV4 } from "ai/test"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEMO_SCENARIOS } from "@/lib/demo/scenarios"
import { resetRateLimitForTests } from "@/lib/ai/rate-limit"
import { normalizePlan, planProblem } from "@/lib/ai/task-recovery"
import { buildRecoveryRequest, buildTaskContext } from "@/lib/recovery/context"
import { categorize } from "@/lib/recovery/categorize"
import { demoTaskRecovery } from "@/lib/recovery/demo-plan"
import { TaskRecoveryRequestSchema } from "@/lib/schemas"
import type { RecoveryPlan, TaskRecoveryRequest } from "@/lib/schemas"
import { workspaceReducer } from "@/lib/workspace/reducer"
import type { WorkspaceAction } from "@/lib/workspace/reducer"
import { EMPTY_WORKSPACE } from "@/lib/workspace/schemas"
import type { Workspace } from "@/lib/workspace/schemas"

const providerMock = vi.hoisted(() => ({
  config: null as null | { provider: string; modelId: string; apiKey: string },
  model: null as unknown,
}))
vi.mock("@/lib/ai/provider", () => ({
  getLiveConfig: () => providerMock.config,
  getLiveModel: () => providerMock.model,
}))

import { POST } from "@/app/api/recovery/route"

const TODAY = "2026-11-05"
const AT = "2026-11-05T12:00:00.000Z"
const VAGUE =
  /why (this|it) matters|your priorities|your motivation|reflect on|think about/i

function requestFor(
  title: string,
  extra: Partial<TaskRecoveryRequest["task"]> = {},
  options: Partial<TaskRecoveryRequest> = {}
): TaskRecoveryRequest {
  return {
    stage: "task-recovery",
    today: TODAY,
    strategy: null,
    obstacle: "",
    rejected: [],
    ...options,
    task: {
      title,
      description: "",
      deadline: null,
      originalDeadline: null,
      status: "Needs Recovery",
      priority: "Medium",
      progress: 0,
      completedActions: [],
      attempts: [],
      obstacles: [],
      openSteps: [],
      instructions: "",
      document: "",
      currentStep: "",
      focusSessions: [],
      ...extra,
    },
  }
}

describe("Demo Mode recovery plans", () => {
  it("answers the homework problem with a worksheet, not a question about meaning", () => {
    const { plan } = demoTaskRecovery(requestFor("I have avoided my homework"))
    expect(plan.artifact.kind).toBe("outline")
    expect(plan.artifact.body).toContain("I have avoided my homework")
    expect(plan.artifact.body).toMatch(/Parts to finish/)
    expect(plan.nextStep.instruction).toMatch(/Paste the instructions/)
    expect(plan.steps.length).toBeGreaterThan(1)
    expect(
      `${plan.nextStep.instruction} ${plan.nextStep.why} ${plan.headline}`
    ).not.toMatch(VAGUE)
  })

  it("drafts an editable message to the professor for a missed deadline, inventing nothing", () => {
    const { plan, analysis } = demoTaskRecovery(
      requestFor("Biology essay", {
        deadline: "2026-11-01",
        originalDeadline: "2026-11-01",
      })
    )
    expect(plan.artifact.kind).toBe("email")
    expect(plan.artifact.body).toContain("[Professor's name]")
    expect(plan.artifact.body).toContain("Biology essay")
    expect(plan.artifact.body).toContain("Sun, Nov 1")
    expect(plan.artifact.body).toContain("whether late work is accepted")
    expect(analysis.realityCheck.unknowns.join(" ")).toMatch(
      /late-submission policy/
    )
    expect(analysis.decision.highStakes).toBe(true)
    expect(analysis.decision.recommended).not.toBe("RELEASE")
  })

  it("helps a job seeker with a specific, in-app next step", () => {
    const { plan } = demoTaskRecovery(requestFor("Apply for jobs"))
    expect(plan.artifact.title).toBe("Application tracker")
    expect(plan.artifact.body).toMatch(/Company: \[name\]/)
    expect(plan.nextStep.instruction).toMatch(/first row/)
  })

  it("makes the step shorter after a stopped focus session, and uses the reported obstacle", () => {
    const fresh = demoTaskRecovery(requestFor("Do my homework"))
    const stuck = demoTaskRecovery(
      requestFor(
        "Do my homework",
        {
          focusSessions: [
            {
              date: TODAY,
              plannedMinutes: 25,
              actualMinutes: 3,
              outcome: "stuck",
              note: "too hard",
            },
          ],
        },
        { obstacle: "Too noisy here" }
      )
    )
    expect(stuck.plan.nextStep.instruction).not.toBe(
      fresh.plan.nextStep.instruction
    )
    expect(stuck.plan.nextStep.instruction).toMatch(/5-minute/)
    expect(stuck.plan.adaptationNote).toContain("stopped early")
    expect(stuck.plan.adaptationNote).toContain("Too noisy here")
    expect(stuck.analysis.realityCheck.knownFacts.join(" ")).toContain(
      "Too noisy here"
    )
    expect(stuck.analysis.realityCheck.knownFacts.join(" ")).toMatch(
      /about 3 minutes/
    )
  })

  it.each([
    "Do my homework",
    "Biology paper",
    "Apply for jobs",
    "Reply to the email",
    "File my taxes",
    "Clean the garage",
  ])(
    "never repeats a plan for %s when asked again, then says when it's out of ideas",
    (title) => {
      const rejected: TaskRecoveryRequest["rejected"] = []
      const seen = new Set<string>()
      let result = demoTaskRecovery(requestFor(title))
      for (let i = 0; i < 12 && !result.exhausted; i++) {
        expect(seen.has(result.plan.nextStep.instruction)).toBe(false)
        seen.add(result.plan.nextStep.instruction)
        expect(result.plan.nextStep.instruction).not.toMatch(VAGUE)
        expect(result.plan.artifact.body.length).toBeGreaterThan(20)
        rejected.push({
          nextStep: result.plan.nextStep.instruction,
          artifactTitle: result.plan.artifact.title,
        })
        result = demoTaskRecovery(requestFor(title, {}, { rejected }))
      }
      expect(result.exhausted).toBe(true)
      expect(seen.size).toBeGreaterThanOrEqual(2)
    }
  )

  it("respects a chosen strategy", () => {
    const { plan } = demoTaskRecovery(
      requestFor("Clean the garage", {}, { strategy: "RELEASE" })
    )
    expect(plan.artifact.title).toContain("Closing note")
    expect(plan.schedule).toHaveLength(1)
  })

  it("only schedules from today onward, and has no way to change a deadline", () => {
    const { plan } = demoTaskRecovery(
      requestFor("Biology essay", { deadline: "2026-01-01" })
    )
    expect(plan.schedule.every((item) => item.date >= TODAY)).toBe(true)
    expect(JSON.stringify(Object.keys(plan))).not.toContain("deadline")
  })

  it("detects crisis language in the reported obstacle", () => {
    const { analysis } = demoTaskRecovery(
      requestFor("Taxes", {}, { obstacle: "I want to die" })
    )
    expect(analysis.supportConcern).toBe(true)
  })

  it("sorts tasks into template families", () => {
    expect(categorize("Math homework")).toBe("academic")
    expect(categorize("Update resume")).toBe("job")
    expect(categorize("Reply to Sam's email")).toBe("message")
    expect(categorize("Renew insurance")).toBe("admin")
    expect(categorize("Fix the bike")).toBe("general")
  })
})

describe("task context", () => {
  const run = (actions: WorkspaceAction[]) =>
    actions.reduce(workspaceReducer, EMPTY_WORKSPACE as Workspace)

  it("includes the task's real data, and passes validation", () => {
    const state = run([
      {
        type: "create-task",
        id: "a",
        at: AT,
        title: "Essay",
        description: "Chapter 4",
        deadline: "2026-11-20",
        priority: "high",
      },
      { type: "add-subtask", id: "a", at: AT, subId: "1", title: "Outline" },
      { type: "add-subtask", id: "a", at: AT, subId: "2", title: "Draft" },
      { type: "toggle-subtask", id: "a", at: AT, subId: "1" },
      { type: "log-obstacle", id: "a", at: AT, text: "Can't find my notes" },
      {
        type: "timer-start",
        id: "s",
        kind: "focus",
        taskId: "a",
        minutes: 25,
        now: 0,
        at: AT,
      },
      {
        type: "timer-stop",
        now: 180_000,
        at: AT,
        outcome: "stuck",
        note: "Lost focus",
      },
    ])
    const task = state.tasks[0]
    const context = buildTaskContext(task, state)
    expect(context).toMatchObject({
      title: "Essay",
      description: "Chapter 4",
      deadline: "2026-11-20",
      status: "Needs Recovery",
      priority: "High",
      progress: 50,
      completedActions: ["Completed: Outline"],
      openSteps: ["Draft"],
      focusSessions: [
        expect.objectContaining({
          actualMinutes: 3,
          outcome: "stuck",
          note: "Lost focus",
        }),
      ],
    })
    expect(context.obstacles).toEqual(["Can't find my notes", "Lost focus"])
    expect(context.attempts.join(" ")).toContain("got stuck")
    expect(
      TaskRecoveryRequestSchema.safeParse(
        buildRecoveryRequest(task, state, TODAY)
      ).success
    ).toBe(true)
  })

  it("keeps large histories within the request limits", () => {
    let state = run([{ type: "create-task", id: "a", at: AT, title: "Big" }])
    for (let i = 0; i < 60; i++) {
      state = workspaceReducer(state, {
        type: "log-obstacle",
        id: "a",
        at: AT,
        text: "x".repeat(900),
      })
      state = workspaceReducer(state, {
        type: "add-subtask",
        id: "a",
        at: AT,
        subId: `${i}`,
        title: "y".repeat(900),
      })
    }
    expect(
      TaskRecoveryRequestSchema.safeParse(
        buildRecoveryRequest(state.tasks[0], state, TODAY)
      ).success
    ).toBe(true)
  })
})

describe("plan checks", () => {
  const plan: RecoveryPlan = {
    headline: "Plan",
    adaptationNote: "",
    nextStep: {
      instruction: "Paste the question here",
      why: "",
      minutes: 500,
      approach: "write-in-app",
    },
    artifact: { kind: "note", title: "Note", body: "Body" },
    steps: Array.from({ length: 9 }, (_, i) => `Step ${i}`),
    choices: ["a", "b", "c", "d"],
    schedule: [
      { date: "2020-01-01", minutes: 10, label: "Past" },
      { date: "not a date", minutes: 10, label: "Bad" },
      { date: TODAY, minutes: 999, label: "Ok" },
    ],
  }

  it("removes past or invalid dates, and caps sizes", () => {
    const normalized = normalizePlan(plan, TODAY)
    expect(normalized.schedule).toEqual([
      { date: TODAY, minutes: 60, label: "Ok" },
    ])
    expect(normalized.steps).toHaveLength(6)
    expect(normalized.nextStep.minutes).toBe(30)
  })

  it("rejects an empty draft", () => {
    expect(() =>
      normalizePlan(
        { ...plan, artifact: { ...plan.artifact, body: "  " } },
        TODAY
      )
    ).toThrow()
  })

  it.each([
    "Write why this matters to you",
    "Think about your priorities",
    "Reflect on your motivation",
    "Write what matters most",
  ])("rejects vague advice: %s", (instruction) => {
    expect(
      planProblem(
        { ...plan, nextStep: { ...plan.nextStep, instruction } },
        requestFor("x")
      )
    ).toMatch(/reflection/)
  })

  it("rejects a reworded repeat of a declined plan or earlier attempt", () => {
    const rejected = [
      { nextStep: "Paste the question here now", artifactTitle: "x" },
    ]
    expect(planProblem(plan, requestFor("x", {}, { rejected }))).toMatch(
      /repeats/
    )
    expect(
      planProblem(
        plan,
        requestFor("x", { attempts: ["Paste the question here"] })
      )
    ).toMatch(/repeats/)
    expect(planProblem(plan, requestFor("x"))).toBeNull()
  })
})

describe("POST /api/recovery task-recovery", () => {
  const analysis = DEMO_SCENARIOS[0].analysis
  const modelPlan = (
    instruction: string,
    extra: Partial<RecoveryPlan> = {}
  ): RecoveryPlan => ({
    headline: "A plan",
    adaptationNote: "",
    nextStep: {
      instruction,
      why: "Because",
      minutes: 5,
      approach: "write-in-app",
    },
    artifact: { kind: "email", title: "Draft", body: "Hello [name]" },
    steps: ["One"],
    choices: [],
    schedule: [{ date: TODAY, minutes: 10, label: "Start" }],
    ...extra,
  })
  const modelReturning = (...outputs: unknown[]) => {
    let call = 0
    return new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(outputs[Math.min(call++, outputs.length - 1)]),
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage: {
          inputTokens: {
            total: 1,
            noCache: 1,
            cacheRead: undefined,
            cacheWrite: undefined,
          },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    })
  }
  const post = (body: unknown) =>
    POST(
      new Request("http://t/api/recovery", {
        method: "POST",
        body: JSON.stringify(body),
      })
    )

  beforeEach(() => {
    resetRateLimitForTests()
    providerMock.config = { provider: "anthropic", modelId: "m", apiKey: "k" }
    vi.spyOn(console, "error").mockImplementation(() => {})
  })

  it("sends the task's real data to the model, as data", async () => {
    const model = modelReturning({
      ...analysis,
      plan: modelPlan("Paste the prompt"),
    })
    providerMock.model = model
    const response = await post(
      requestFor(
        "Biology essay",
        {
          description: "Chapter 4 lab",
          deadline: "2026-11-20",
          completedActions: ["Completed: Outline"],
          attempts: ["Tried: opening the doc"],
          obstacles: ["Can't find notes"],
          focusSessions: [
            {
              date: TODAY,
              plannedMinutes: 25,
              actualMinutes: 3,
              outcome: "stuck",
              note: "Lost focus",
            },
          ],
        },
        { obstacle: "Too noisy" }
      )
    )
    expect(response.status).toBe(200)
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt)
    for (const expected of [
      "Biology essay",
      "Chapter 4 lab",
      "2026-11-20",
      "Completed: Outline",
      "Tried: opening the doc",
      "Can't find notes",
      "3 of 25 minutes",
      "Lost focus",
      "Too noisy",
      "<task_data>",
    ]) {
      expect(prompt).toContain(expected)
    }
    const data = await response.json()
    expect(data.plan.artifact.body).toBe("Hello [name]")
    expect(data.analysis.realityCheck.knownFacts[0]).toContain("Biology essay")
  })

  it("retries vague advice, then uses an honestly labeled template if it persists", async () => {
    const model = modelReturning({
      ...analysis,
      plan: modelPlan("Write why this matters to you"),
    })
    providerMock.model = model
    const data = await (await post(requestFor("Do my homework"))).json()
    expect(model.doGenerateCalls).toHaveLength(2)
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain(
      "rejected"
    )
    expect(data.usedFallback).toBe(true)
    expect(data.plan.nextStep.instruction).not.toMatch(VAGUE)
  })

  it("accepts a corrected plan on the retry", async () => {
    providerMock.model = modelReturning(
      { ...analysis, plan: modelPlan("Reflect on your motivation") },
      { ...analysis, plan: modelPlan("Paste the first question") }
    )
    const data = await (await post(requestFor("Do my homework"))).json()
    expect(data.usedFallback).toBeUndefined()
    expect(data.plan.nextStep.instruction).toBe("Paste the first question")
  })

  it("rewrites the plan when safety changes a high-stakes RELEASE to REDUCE", async () => {
    const model = modelReturning(
      {
        ...analysis,
        decision: { ...analysis.decision, recommended: "RELEASE" },
        plan: modelPlan("Close this out"),
      },
      { ...analysis, plan: modelPlan("Ask about the policy") }
    )
    providerMock.model = model
    const data = await (await post(requestFor("Finish my tax return"))).json()
    expect(model.doGenerateCalls).toHaveLength(2)
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain(
      "Strategy the user chose: REDUCE"
    )
    expect(data.plan.nextStep.instruction).toBe("Ask about the policy")
    expect(data.analysis.decision.recommended).toBe("REDUCE")
  })

  it("rejects invalid requests", async () => {
    providerMock.model = modelReturning({})
    expect(
      (await post({ stage: "task-recovery", task: { title: "" } })).status
    ).toBe(400)
    const bad = requestFor("x", { deadline: "2026-02-31" })
    expect((await post(bad)).status).toBe(400)
  })

  it("returns a safe error if the provider fails", async () => {
    providerMock.model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("secret detail")
      },
    })
    const response = await post(requestFor("Essay"))
    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain("secret detail")
  })
})
