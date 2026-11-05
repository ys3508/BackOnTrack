import { Mark, mergeAttributes } from "@tiptap/core"
import type { JSONContent } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"

/**
 * Highlights text that came from a suggestion and was accepted, so the writer can
 * still see what's theirs. It stays until they clear it from the toolbar.
 */
export const SuggestionMark = Mark.create({
  name: "suggestion",
  // Typing next to suggested text stays the writer's own, unhighlighted.
  inclusive: false,
  parseHTML: () => [{ tag: "span[data-suggested]" }],
  // Anything typed is the writer's own, even in the middle of suggested text or
  // over a selected placeholder, so it never reads as if the AI wrote it.
  addProseMirrorPlugins() {
    const type = this.type
    return [
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            const { state } = view
            const inSuggestion =
              state.doc.rangeHasMark(from, to, type) ||
              type.isInSet(state.doc.resolve(from).marks())
            if (!inSuggestion) return false
            view.dispatch(
              state.tr
                .insertText(text, from, to)
                .removeMark(from, from + text.length, type)
            )
            return true
          },
        },
      }),
    ]
  },
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
  // Code blocks can't hold marks, and their monospace already sets them apart.
  if (content.type === "codeBlock") return content
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
