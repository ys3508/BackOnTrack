/**
 * Reads task instructions from a file, entirely in the browser. Files are never
 * uploaded to a server, and only the extracted text is kept.
 */

export const MAX_TEXT_FILE_BYTES = 1024 * 1024
export const MAX_PDF_BYTES = 10 * 1024 * 1024
export const MAX_PDF_PAGES = 100
export const MAX_STORED_CHARS = 30_000
/** Fewer characters per page than this usually means a scanned image. */
const MIN_CHARS_PER_PAGE = 20

export class DocumentError extends Error {}

export type ExtractedDocument = {
  text: string
  truncated: boolean
  pageCount: number | null
}

function fileKind(name: string) {
  const extension = name.toLowerCase().split(".").pop()
  if (extension === "pdf") return "pdf"
  if (extension === "txt" || extension === "md" || extension === "markdown") {
    return "text"
  }
  return null
}

function finish(text: string, pageCount: number | null): ExtractedDocument {
  const trimmed = text.trim()
  return {
    text: trimmed.slice(0, MAX_STORED_CHARS),
    truncated: trimmed.length > MAX_STORED_CHARS,
    pageCount,
  }
}

export function readText(bytes: Uint8Array): ExtractedDocument {
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    throw new DocumentError(
      "This file isn’t readable text. Please paste the relevant part instead."
    )
  }
  if (text.includes("\u0000")) {
    throw new DocumentError(
      "This file isn’t readable text. Please paste the relevant part instead."
    )
  }
  if (!text.trim()) throw new DocumentError("This file is empty.")
  return finish(text, null)
}

type PdfJs = {
  getDocument: (options: { data: Uint8Array; isEvalSupported?: boolean }) => {
    promise: Promise<{
      numPages: number
      getPage: (page: number) => Promise<{
        getTextContent: () => Promise<{
          items: { str?: string; hasEOL?: boolean }[]
        }>
      }>
    }>
    destroy?: () => Promise<void>
  }
}

async function loadPdfJs(): Promise<PdfJs> {
  const pdfjs = await import("pdfjs-dist")
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString()
  return pdfjs as unknown as PdfJs
}

export async function readPdf(
  bytes: Uint8Array,
  load: () => Promise<PdfJs> = loadPdfJs
): Promise<ExtractedDocument> {
  const header = new TextDecoder().decode(bytes.slice(0, 1024))
  if (!header.includes("%PDF-")) {
    throw new DocumentError(
      "This doesn’t look like a valid PDF. Please paste the relevant part instead."
    )
  }

  const pdfjs = await load()
  const loading = pdfjs.getDocument({ data: bytes, isEvalSupported: false })
  let document
  try {
    document = await loading.promise
  } catch (cause) {
    throw new DocumentError(
      (cause as { name?: string })?.name === "PasswordException"
        ? "This PDF is password-protected. Please paste the relevant part instead."
        : "This PDF couldn’t be read. Please paste the relevant part instead."
    )
  }

  try {
    if (document.numPages > MAX_PDF_PAGES) {
      throw new DocumentError(
        `This PDF has ${document.numPages} pages, and the limit is ${MAX_PDF_PAGES}. Please paste the relevant part instead.`
      )
    }
    const pages: string[] = []
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number)
      const { items } = await page.getTextContent()
      pages.push(
        items
          .map((item) => `${item.str ?? ""}${item.hasEOL ? "\n" : ""}`)
          .join(" ")
          .replace(/ *\n */g, "\n")
          .replace(/[ \t]+/g, " ")
          .trim()
      )
    }
    const text = pages.join("\n\n").trim()
    if (text.length < MIN_CHARS_PER_PAGE * document.numPages) {
      throw new DocumentError(
        "This PDF has little or no text, so it may be a scan. BackOnTrack can’t read images. Please paste the relevant part instead."
      )
    }
    return finish(text, document.numPages)
  } catch (cause) {
    if (cause instanceof DocumentError) throw cause
    throw new DocumentError(
      "Text couldn’t be fully extracted from this PDF. Please paste the relevant part instead."
    )
  } finally {
    await loading.destroy?.().catch(() => {})
  }
}

/** Checks the file's type and size, then extracts its text. */
export async function extractDocument(file: File): Promise<ExtractedDocument> {
  const kind = fileKind(file.name)
  if (!kind) {
    throw new DocumentError(
      "That file type isn’t supported. Use a PDF, .txt, or .md file, or paste the text."
    )
  }
  const limit = kind === "pdf" ? MAX_PDF_BYTES : MAX_TEXT_FILE_BYTES
  if (file.size > limit) {
    throw new DocumentError(
      `That file is too large. The limit for this type is ${limit / 1024 / 1024} MB. Please paste the relevant part instead.`
    )
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  return kind === "pdf" ? readPdf(bytes) : readText(bytes)
}
