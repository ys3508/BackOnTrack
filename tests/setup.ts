import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

afterEach(() => {
  if (typeof document !== "undefined") cleanup()
})

// ProseMirror measures text, which jsdom can't do.
if (typeof document !== "undefined") {
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
  }
  const list = Object.assign([] as DOMRect[], {
    item: () => null,
  }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () => list
  Element.prototype.scrollIntoView ??= () => {}
  document.elementFromPoint ??= () => null
}
