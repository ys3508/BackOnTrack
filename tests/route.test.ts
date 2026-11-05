import { MockLanguageModelV4 } from "ai/test"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEMO_SCENARIOS } from "@/lib/demo/scenarios"
import { resetRateLimitForTests } from "@/lib/ai/rate-limit"

const providerMock = vi.hoisted(() => ({
  config: null as null | { provider: string; modelId: string; apiKey: string },
  model: null as unknown,
}))

vi.mock("@/lib/ai/provider", () => ({
  getLiveConfig: () => providerMock.config,
  getLiveModel: () => providerMock.model,
}))

import { GET, POST } from "@/app/api/recovery/route"

const usage = {
  inputTokens: {
    total: 1,
    noCache: 1,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

/** A fake model that returns the given JSON outputs in order. */
function modelReturning(...outputs: unknown[]) {
  let call = 0
  const model = new MockLanguageModelV4({
    doGenerate: async () => {
      const output = outputs[Math.min(call++, outputs.length - 1)]
      return {
        content: [
          {
            type: "text" as const,
            text: typeof output === "string" ? output : JSON.stringify(output),
          },
        ],
        finishReason: { unified: "stop" as const, raw: undefined },
        usage,
        warnings: [],
      }
    },
  })
  return model
}

function post(body: unknown, raw = false) {
  return POST(
    new Request("http://test/api/recovery", {
      method: "POST",
      body: raw ? (body as string) : JSON.stringify(body),
    })
  )
}

const intake = {
  responsibility:
    "I have avoided job applications for two weeks and feel overwhelmed.",
}
const analysis = DEMO_SCENARIOS[0].analysis

const step = (instruction: string, approach: string) => ({
  action: {
    instruction,
    approach,
    why: "because",
    inputLabel: "Answer",
    inputPlaceholder: "",
    minutes: 2,
  },
  adaptationNote: "",
  suggestWrapUp: false,
})

const stuckRequest = {
  stage: "next-step",
  intake,
  knownFacts: ["fact"],
  unknowns: ["unknown"],
  strategy: "REDUCE",
  event: "stuck",
  note: "",
  history: [
    {
      instruction: "Open the job application website.",
      approach: "gather-information",
      outcome: "stuck",
      userText: "",
      note: "",
    },
  ],
}

beforeEach(() => {
  resetRateLimitForTests()
  providerMock.config = {
    provider: "anthropic",
    modelId: "test-model",
    apiKey: "secret-key",
  }
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("GET /api/recovery", () => {
  it("reports availability without exposing the key", async () => {
    const response = GET()
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ live: true, model: "test-model" })
    expect(text).not.toContain("secret-key")
  })

  it("reports not live when no key is configured", async () => {
    providerMock.config = null
    expect(await GET().json()).toEqual({ live: false, model: null })
  })
})

describe("POST /api/recovery validation", () => {
  beforeEach(() => {
    providerMock.model = modelReturning(analysis)
  })

  it("returns 503 when not configured", async () => {
    providerMock.config = null
    const response = await post({ stage: "analyze", intake })
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe("not_configured")
  })

  it.each([
    ["malformed JSON", "{not json", true],
    ["an unknown stage", { stage: "hack", intake }, false],
    [
      "empty text",
      { stage: "analyze", intake: { responsibility: "   " } },
      false,
    ],
    [
      "too-short text",
      { stage: "analyze", intake: { responsibility: "hi" } },
      false,
    ],
    [
      "digits only",
      { stage: "analyze", intake: { responsibility: "1234567890123" } },
      false,
    ],
    [
      "over-long text",
      { stage: "analyze", intake: { responsibility: "a".repeat(2001) } },
      false,
    ],
  ])("rejects %s with 400", async (_name, body, raw) => {
    expect((await post(body, raw)).status).toBe(400)
  })

  it("rejects oversized bodies with 413", async () => {
    expect((await post("x".repeat(70_000), true)).status).toBe(413)
  })

  it("rate limits repeated clients", async () => {
    let last = 0
    for (let i = 0; i < 41; i++) {
      last = (await post({ stage: "analyze", intake: { responsibility: "x" } }))
        .status
    }
    expect(last).toBe(429)
  })
})

describe("POST /api/recovery analyze", () => {
  it("returns a validated analysis from the model", async () => {
    providerMock.model = modelReturning(analysis)
    const response = await post({ stage: "analyze", intake })
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.analysis.realityCheck.knownFacts.length).toBeGreaterThan(0)
  })

  it("overrides a model that recommends releasing an academic obligation", async () => {
    providerMock.model = modelReturning({
      ...analysis,
      decision: { ...analysis.decision, recommended: "RELEASE" },
    })
    const response = await post({
      stage: "analyze",
      intake: {
        responsibility: "I missed my assignment deadline three days ago.",
      },
    })
    const data = await response.json()
    expect(data.analysis.decision.recommended).toBe("REDUCE")
    expect(data.analysis.decision.highStakes).toBe(true)
  })

  it("retries once on invalid output, then returns a safe 502", async () => {
    const model = modelReturning("not json at all")
    providerMock.model = model
    const response = await post({ stage: "analyze", intake })
    expect(response.status).toBe(502)
    expect(model.doGenerateCalls).toHaveLength(2)
    expect((await response.json()).error.code).toBe("ai_unavailable")
  })

  it("recovers when the retry succeeds", async () => {
    providerMock.model = modelReturning("not json", analysis)
    expect((await post({ stage: "analyze", intake })).status).toBe(200)
  })

  it("does not leak provider errors or user text", async () => {
    providerMock.model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error("401 invalid key secret-key")
      },
    })
    const response = await post({ stage: "analyze", intake })
    expect(response.status).toBe(502)
    const text = await response.text()
    expect(text).not.toContain("secret-key")
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(logged).not.toContain("secret-key")
    expect(logged).not.toContain("job applications")
  })
})

describe("POST /api/recovery optional details", () => {
  const promptFor = async (extra: object) => {
    const model = modelReturning(analysis)
    providerMock.model = model
    const response = await post({
      stage: "analyze",
      intake: { ...intake, ...extra },
    })
    return {
      response,
      data: await response.json(),
      prompt: JSON.stringify(model.doGenerateCalls[0]?.prompt),
    }
  }

  it("labels skipped questions as unknown, not as answers", async () => {
    const { prompt, data } = await promptFor({})
    expect(prompt).toContain("Original deadline: not answered (unknown)")
    expect(prompt).toContain("Current status: not answered (unknown)")
    expect(prompt).toContain("Main obstacle: not answered (unknown)")
    expect(prompt).not.toContain("the user said there is no deadline")
    expect(data.analysis.realityCheck.knownFacts).toEqual(
      analysis.realityCheck.knownFacts
    )
  })

  it("passes selected answers to the model and the Reality Check", async () => {
    const { prompt, data } = await promptFor({
      deadline: { type: "date", date: "2026-03-01" },
      status: "started-stopped",
      obstacle: "something-else",
      obstacleOther: "My laptop is broken",
    })
    expect(prompt).toContain("Original deadline: 2026-03-01")
    expect(prompt).toContain("Started, then stopped")
    expect(prompt).toContain("Something else: My laptop is broken")
    const facts = data.analysis.realityCheck.knownFacts.join(" ")
    expect(facts).toContain("Sunday, March 1, 2026")
    expect(facts).toContain("Started, then stopped")
    expect(facts).toContain("My laptop is broken")
  })

  it("tells the model when the user says there is no deadline or isn't sure", async () => {
    expect((await promptFor({ deadline: { type: "none" } })).prompt).toContain(
      "the user said there is no deadline"
    )
    expect(
      (await promptFor({ deadline: { type: "unsure" } })).prompt
    ).toContain("the user said they are not sure")
  })

  it("checks crisis language in the Something else text", async () => {
    const { data } = await promptFor({
      obstacle: "something-else",
      obstacleOther: "I want to die",
    })
    expect(data.analysis.supportConcern).toBe(true)
  })

  it.each([
    ["an impossible date", { deadline: { type: "date", date: "2026-02-31" } }],
    [
      "a wrongly formatted date",
      { deadline: { type: "date", date: "3/1/26" } },
    ],
    ["old free-text deadline", { deadline: "last Friday" }],
    ["an unknown status", { status: "finished" }],
    ["an unknown obstacle", { obstacle: "lazy" }],
    ["over-long other text", { obstacleOther: "a".repeat(301) }],
  ])("rejects %s with 400", async (_name, extra) => {
    expect((await promptFor(extra)).response.status).toBe(400)
  })
})

describe("POST /api/recovery next step (Plan B enforcement)", () => {
  it("accepts a genuinely different step", async () => {
    const model = modelReturning(
      step("Type the company name you remember here.", "recall-from-memory")
    )
    providerMock.model = model
    const data = await (await post(stuckRequest)).json()
    expect(data.action.instruction).toBe(
      "Type the company name you remember here."
    )
    expect(data.usedFallback).toBeUndefined()
    expect(model.doGenerateCalls).toHaveLength(1)
  })

  it("rejects a reworded repeat and asks again with a correction", async () => {
    const model = modelReturning(
      step("Open up the job application website.", "write-in-app"),
      step("Type the company name you remember here.", "recall-from-memory")
    )
    providerMock.model = model
    const data = await (await post(stuckRequest)).json()
    expect(data.action.instruction).toBe(
      "Type the company name you remember here."
    )
    expect(model.doGenerateCalls).toHaveLength(2)
    expect(JSON.stringify(model.doGenerateCalls[1].prompt)).toContain(
      "was rejected"
    )
  })

  it("uses a built-in step when the model keeps repeating", async () => {
    const model = modelReturning(
      step("Open the job application website.", "gather-information")
    )
    providerMock.model = model
    const data = await (await post(stuckRequest)).json()
    expect(data.usedFallback).toBe(true)
    expect(data.action.instruction).not.toContain("website")
    expect(data.action.approach).not.toBe("gather-information")
  })

  it("passes the user's obstacle and history to the model", async () => {
    const model = modelReturning(
      step("Type one word about the job.", "write-in-app")
    )
    providerMock.model = model
    await post({ ...stuckRequest, note: "I can't face the login page" })
    const prompt = JSON.stringify(model.doGenerateCalls[0].prompt)
    expect(prompt).toContain("I can't face the login page")
    expect(prompt).toContain("Open the job application website.")
  })
})
