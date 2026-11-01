/**
 * Context Bridge - Sanitized DOM Skeleton Generator
 *
 * Invariants:
 * 1. ZERO innerHTML, dangerouslySetInnerHTML, or eval.
 * 2. ZERO text content, input values, or URLs.
 * 3. Extracts only: tag name, data-* attributes, role, aria-label, id, and first 2 class names.
 * 4. Limits recursion to depth <= 12 and max ~400 elements.
 */

export interface SkeletonOptions {
  maxDepth?: number
  maxElements?: number
}

/**
 * Sanitizes an attribute value to remove any URLs and restrict length.
 */
export function sanitizeAttrValue(val: string): string {
  if (!val) return ""
  const noUrls = val
    .replace(/(?:https?|ftp):\/\/[^\s"'>]+/gi, "[URL]")
    .replace(/(?:data|blob):[^\s"'>]+/gi, "[URL]")
  const singleQuoted = noUrls.replace(/"/g, "'").trim()
  if (singleQuoted.length > 100) {
    return singleQuoted.slice(0, 100) + "..."
  }
  return singleQuoted
}

/**
 * Recursively builds an indented, sanitized skeleton of a DOM subtree.
 */
export function generateDomSkeleton(
  root: Element | null,
  options: SkeletonOptions = {}
): string {
  if (!root) {
    return "<!-- No element found -->"
  }

  const maxDepth = options.maxDepth ?? 12
  const maxElements = options.maxElements ?? 400

  const lines: string[] = []
  let elementCount = 0
  let truncated = false

  function traverse(el: Element, depth: number) {
    if (truncated) return

    elementCount++
    if (elementCount > maxElements) {
      lines.push("  ".repeat(depth) + `<!-- [Truncated: reached ${maxElements} element limit] -->`)
      truncated = true
      return
    }

    const indent = "  ".repeat(depth)
    const tag = el.tagName.toLowerCase()
    const attrs: string[] = []

    // 1. id
    if (el.id) {
      attrs.push(`id="${sanitizeAttrValue(el.id)}"`)
    }

    // 2. first 2 class names
    const classAttr = el.getAttribute("class")
    if (classAttr) {
      const classes = classAttr.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      if (classes.length > 0) {
        attrs.push(`class="${sanitizeAttrValue(classes.join(" "))}"`)
      }
    }

    // 3. role
    const role = el.getAttribute("role")
    if (role) {
      attrs.push(`role="${sanitizeAttrValue(role)}"`)
    }

    // 4. aria-label
    const ariaLabel = el.getAttribute("aria-label")
    if (ariaLabel) {
      attrs.push(`aria-label="${sanitizeAttrValue(ariaLabel)}"`)
    }

    // 5. data-* attributes
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i]
      if (attr.name.startsWith("data-")) {
        attrs.push(`${attr.name}="${sanitizeAttrValue(attr.value)}"`)
      }
    }

    const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : ""
    const childElements = Array.from(el.children)

    if (childElements.length === 0) {
      lines.push(`${indent}<${tag}${attrStr} />`)
      return
    }

    if (depth >= maxDepth) {
      lines.push(
        `${indent}<${tag}${attrStr}><!-- [Max depth ${maxDepth} reached: ${childElements.length} children omitted] --></${tag}>`
      )
      return
    }

    lines.push(`${indent}<${tag}${attrStr}>`)
    for (const child of childElements) {
      if (truncated) break
      traverse(child, depth + 1)
    }
    lines.push(`${indent}</${tag}>`)
  }

  traverse(root, 0)
  return lines.join("\n")
}

/**
 * Self-contained DOM skeleton extractor function that can be passed directly to
 * chrome.scripting.executeScript({ target: { tabId }, func: extractDomSkeletonDirectlyInTab }).
 * It contains zero outer-scope dependencies and adheres strictly to all security & skeleton rules.
 */
export function extractDomSkeletonDirectlyInTab(): {
  skeleton: string
  tag: string
  elementCount: number
} {
  const root =
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    document.querySelector("#main") ||
    document.body

  if (!root) {
    return {
      skeleton: "<!-- No container element found in document -->",
      tag: "none",
      elementCount: 0
    }
  }

  const maxDepth = 12
  const maxElements = 400
  const lines: string[] = []
  let elementCount = 0
  let truncated = false

  function sanitize(val: string): string {
    if (!val) return ""
    const noUrls = val
      .replace(/(?:https?|ftp):\/\/[^\s"'>]+/gi, "[URL]")
      .replace(/(?:data|blob):[^\s"'>]+/gi, "[URL]")
    const escaped = noUrls.replace(/"/g, "'").trim()
    return escaped.length > 100 ? escaped.slice(0, 100) + "..." : escaped
  }

  function traverse(el: Element, depth: number) {
    if (truncated) return
    elementCount++
    if (elementCount > maxElements) {
      lines.push("  ".repeat(depth) + `<!-- [Truncated: reached ${maxElements} element limit] -->`)
      truncated = true
      return
    }

    const indent = "  ".repeat(depth)
    const tag = el.tagName.toLowerCase()
    const attrs: string[] = []

    if (el.id) {
      attrs.push(`id="${sanitize(el.id)}"`)
    }

    const classAttr = el.getAttribute("class")
    if (classAttr) {
      const classes = classAttr.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      if (classes.length > 0) {
        attrs.push(`class="${sanitize(classes.join(" "))}"`)
      }
    }

    const role = el.getAttribute("role")
    if (role) {
      attrs.push(`role="${sanitize(role)}"`)
    }

    const ariaLabel = el.getAttribute("aria-label")
    if (ariaLabel) {
      attrs.push(`aria-label="${sanitize(ariaLabel)}"`)
    }

    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes[i]
      if (attr.name.startsWith("data-")) {
        attrs.push(`${attr.name}="${sanitize(attr.value)}"`)
      }
    }

    const attrStr = attrs.length > 0 ? " " + attrs.join(" ") : ""
    const childElements = Array.from(el.children)

    if (childElements.length === 0) {
      lines.push(`${indent}<${tag}${attrStr} />`)
      return
    }

    if (depth >= maxDepth) {
      lines.push(
        `${indent}<${tag}${attrStr}><!-- [Max depth ${maxDepth} reached: ${childElements.length} children omitted] --></${tag}>`
      )
      return
    }

    lines.push(`${indent}<${tag}${attrStr}>`)
    for (const child of childElements) {
      if (truncated) break
      traverse(child, depth + 1)
    }
    lines.push(`${indent}</${tag}>`)
  }

  traverse(root, 0)
  return {
    skeleton: lines.join("\n"),
    tag: root.tagName.toLowerCase(),
    elementCount
  }
}

