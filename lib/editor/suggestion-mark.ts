import { Mark, mergeAttributes } from "@tiptap/core"
import type { JSONContent } from "@tiptap/core"

/**
 * Highlights text that came from a suggestion and was accepted, so the writer can
 * still see what's theirs. It stays until they clear it from the toolbar.
 */
export const SuggestionMark = Mark.create({
  name: "suggestion",
  // Typing next to suggested text stays the writer's own, unhighlighted.
  inclusive: false,
  parseHTML: () => [{ tag: "span[data-suggested]" }],
  renderHTML: ({ HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, {
      "data-suggested": "true",
      title: "Suggested text. Edit it to make it yours.",
    }),
    0,
  ],
})

/** Adds the mark to every piece of text in a block of content. */
export function markAsSuggested(content: JSONContent): JSONContent {
  if (content.type === "text") {
    return {
      ...content,
      marks: [...(content.marks ?? []), { type: "suggestion" }],
    }
  }
  return content.content
    ? { ...content, content: content.content.map(markAsSuggested) }
    : content
}
