/**
 * Context Bridge - Structured Message Text Extraction Engine (F7)
 *
 * Traverses DOM nodes of conversation turns without fragile platform class selectors:
 * 1. Preserves paragraph structure (\n\n) between block elements (p, div, li, h1-h6, tr).
 * 2. Formats list items with bullets ("- ") or list numbers.
 * 3. Preserves whitespace and newlines inside <pre> and <code>.
 * 4. Replaces <img> with "[image]" and drops alt text completely.
 * 5. Drops UI noise (buttons, copy controls, citations, timestamps, screen-reader text).
 * 6. Completely preserves non-ASCII Unicode (Urdu, Hindi, Arabic, CJK, etc.).
 * 7. Enforces at most two consecutive newlines (\n\n).
 */

const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "TR",
  "BLOCKQUOTE",
  "SECTION",
  "ARTICLE"
])

const NOISE_TAGS = new Set(["BUTTON", "SVG", "MAT-ICON", "CTX", "STYLE", "SCRIPT", "NOSCRIPT"])

export function extractStructuredMessageText(container: HTMLElement): string {
  if (!container) return ""

  const clone = container.cloneNode(true) as HTMLElement

  // 1. Remove known UI noise elements and screen-reader elements
  const noiseElements = Array.from(
    clone.querySelectorAll(
      'button, svg, mat-icon, ctx, style, script, noscript, ' +
      '.sr-only, [class*="sr-only"], .visually-hidden, [class*="visually-hidden"], ' +
      '[aria-hidden="true"], ' +
      '[data-testid*="citation"], .citation, [class*="citation"], ' +
      '[data-testid*="timestamp"], .timestamp, [class*="timestamp"], ' +
      '[aria-label*="Copy" i], [aria-label*="copy" i], [aria-label*="Feedback" i], ' +
      '.edit-query, edit-query, .action-buttons, .response-footer'
    )
  )
  for (const el of noiseElements) {
    el.remove()
  }

  // 2. Recursive DOM tree walk
  const buffer: string[] = []

  function walk(node: Node, _parentBlock: boolean) {
    if (node.nodeType === 3) {
      // Text node
      const val = node.nodeValue || ""
      if (val.length > 0) {
        buffer.push(val)
      }
      return
    }

    if (node.nodeType !== 1) {
      return
    }

    const el = node as HTMLElement
    const tag = el.tagName.toUpperCase()

    if (NOISE_TAGS.has(tag)) {
      return
    }

    if (tag === "BR") {
      buffer.push("\n")
      return
    }

    if (tag === "IMG") {
      // Images become "[image]" and alt text is dropped (Directive F7)
      buffer.push(" [image] ")
      return
    }

    // Inside <pre> or <code>, preserve verbatim text
    if (tag === "PRE" || tag === "CODE") {
      const codeText = el.textContent || ""
      buffer.push(codeText)
      return
    }

    const isBlock = BLOCK_TAGS.has(tag)
    const isLi = tag === "LI"

    if (isBlock && buffer.length > 0) {
      const last = buffer[buffer.length - 1]
      if (!last.endsWith("\n")) {
        buffer.push(last.endsWith("\n\n") ? "" : "\n")
      }
    }

    if (isLi) {
      const parentTag = el.parentElement?.tagName.toUpperCase()
      if (parentTag === "OL") {
        const index = Array.from(el.parentElement?.children || []).indexOf(el) + 1
        buffer.push(`${index}. `)
      } else {
        buffer.push("- ")
      }
    }

    for (let child = el.firstChild; child; child = child.nextSibling) {
      walk(child, isBlock)
    }

    if (isBlock && buffer.length > 0) {
      const last = buffer[buffer.length - 1]
      if (!last.endsWith("\n")) {
        buffer.push("\n")
      }
    }
  }

  walk(clone, false)

  let result = buffer.join("")

  // Clean up whitespace formatting:
  // Normalize carriage returns
  result = result.replace(/\r\n/g, "\n")
  // Strip trailing whitespace on each line
  result = result.replace(/[ \t]+$/gm, "")
  // Normalize paragraph breaks: at most two consecutive newlines
  result = result.replace(/\n{3,}/g, "\n\n")

  return result.trim()
}
