import { describe, expect, it } from "vitest"

import {
  DocumentError,
  MAX_PDF_BYTES,
  MAX_STORED_CHARS,
  MAX_TEXT_FILE_BYTES,
  extractDocument,
  readPdf,
  readText,
} from "@/lib/documents/extract"

const encoder = new TextEncoder()
const fileOf = (name: string, content: string | Uint8Array) =>
  new File([content as BlobPart], name)

/** Builds a small, real PDF with one line of text on each page. */
function makePdf(lines: string[]) {
  const objects: string[] = []
  const add = (body: string) => objects.push(body)
  const pageIds = lines.map((_, index) => 4 + index * 2)
  add("<< /Type /Catalog /Pages 2 0 R >>")
  add(
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${lines.length} >>`
  )
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
  lines.forEach((line, index) => {
    const stream = `BT /F1 12 Tf 50 700 Td (${line}) Tj ET`
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`
    )
    add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })
  let pdf = "%PDF-1.4\n"
  const offsets = objects.map((body, index) => {
    const offset = pdf.length
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const start = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`
  })
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
  return encoder.encode(pdf)
}

// In Node, PDF.js runs its own worker from this legacy build.
const nodePdfJs = async () =>
  (await import("pdfjs-dist/legacy/build/pdf.mjs")) as never

describe("text files", () => {
  it("reads a valid text or Markdown file", async () => {
    expect(
      (await extractDocument(fileOf("brief.txt", "Write an essay"))).text
    ).toBe("Write an essay")
    expect(
      (await extractDocument(fileOf("brief.md", "# Title\n- Do this"))).text
    ).toContain("- Do this")
  })

  it("rejects unsupported types", async () => {
    for (const name of [
      "brief.docx",
      "photo.png",
      "noextension",
      "script.exe",
    ]) {
      await expect(extractDocument(fileOf(name, "x"))).rejects.toThrow(
        /isn’t supported/
      )
    }
  })

  it("rejects files over the size limit", async () => {
    await expect(
      extractDocument(fileOf("big.txt", "a".repeat(MAX_TEXT_FILE_BYTES + 1)))
    ).rejects.toThrow(/too large/)
  })

  it("rejects binary content with a text extension", () => {
    expect(() => readText(new Uint8Array([0xff, 0xfe, 0x00, 0x80]))).toThrow(
      DocumentError
    )
    expect(() => readText(encoder.encode("abc\u0000def"))).toThrow(
      DocumentError
    )
  })

  it("rejects an empty file", () => {
    expect(() => readText(encoder.encode("   \n"))).toThrow(/empty/)
  })

  it("keeps a safe amount of long text, and says it was cut", () => {
    const result = readText(encoder.encode("a".repeat(MAX_STORED_CHARS + 500)))
    expect(result.text).toHaveLength(MAX_STORED_CHARS)
    expect(result.truncated).toBe(true)
  })
})

describe("PDF files", () => {
  it("extracts real text from a real PDF, across pages", async () => {
    const pdf = makePdf([
      "Train a classifier on the provided dataset",
      "You must submit a report by Friday",
    ])
    const result = await readPdf(pdf, nodePdfJs)
    expect(result.pageCount).toBe(2)
    expect(result.text).toContain("Train a classifier on the provided dataset")
    expect(result.text).toContain("You must submit a report by Friday")
    expect(result.truncated).toBe(false)
  })

  it("explains that a PDF with almost no text may be a scan", async () => {
    await expect(readPdf(makePdf(["x"]), nodePdfJs)).rejects.toThrow(
      /may be a scan/
    )
  })

  it("rejects a file that only claims to be a PDF", async () => {
    await expect(
      extractDocument(fileOf("fake.pdf", "just some text"))
    ).rejects.toThrow(/valid PDF/)
  })

  it("handles a corrupted PDF without crashing", async () => {
    await expect(
      readPdf(encoder.encode("%PDF-1.4\nthis is corrupted"), nodePdfJs)
    ).rejects.toThrow(/couldn’t be read/)
  })

  it("rejects a PDF over the size limit before reading it", async () => {
    await expect(
      extractDocument(fileOf("big.pdf", new Uint8Array(MAX_PDF_BYTES + 1)))
    ).rejects.toThrow(/too large/)
  })

  it("reports a password-protected PDF clearly", async () => {
    const load = async () =>
      ({
        getDocument: () => ({
          promise: Promise.reject(
            Object.assign(new Error("x"), { name: "PasswordException" })
          ),
        }),
      }) as never
    await expect(readPdf(encoder.encode("%PDF-1.4"), load)).rejects.toThrow(
      /password-protected/
    )
  })

  it("rejects too many pages, and never claims a partial read succeeded", async () => {
    const pages = async () =>
      ({
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 500,
            getPage: async () => ({}),
          }),
        }),
      }) as never
    await expect(readPdf(encoder.encode("%PDF-1.4"), pages)).rejects.toThrow(
      /500 pages/
    )

    const failing = async () =>
      ({
        getDocument: () => ({
          promise: Promise.resolve({
            numPages: 2,
            getPage: async () => {
              throw new Error("bad page")
            },
          }),
        }),
      }) as never
    await expect(readPdf(encoder.encode("%PDF-1.4"), failing)).rejects.toThrow(
      /couldn’t be fully extracted/
    )
  })
})
