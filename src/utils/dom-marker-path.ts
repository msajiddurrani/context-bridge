/**
 * Context Bridge - DOM Marker Path & Chat Structure Investigator
 *
 * Invariants:
 * 1. ZERO innerHTML, dangerouslySetInnerHTML, or eval.
 * 2. ZERO text content, input values, or URLs.
 * 3. Inspects:
 *    - Ancestor chain for text nodes matching marker
 *    - Sibling counts and previous/next siblings for nearest 3 ancestors
 *    - Ancestor chain for the prompt input element
 *    - Elements containing data-message*, data-turn*, or data-testid*="turn"|"message"
 */

import { sanitizeAttrValue } from "./dom-skeleton"

export interface ElementFormatSummary {
  tag: string
  attrStr: string
  fullTag: string
}

/**
 * Formats an element into a sanitized tag representation:
 * <tag id="..." class="..." role="..." aria-label="..." data-*>
 * Never includes textContent, input values, or URLs.
 */
export function formatSanitizedElement(el: Element | null): string {
  if (!el) return "(none)"
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
  return `<${tag}${attrStr}>`
}

/**
 * Formats an ancestor chain from starting element up to root.
 */
export function buildAncestorChain(
  targetEl: Element,
  root: Element,
  options: { includeSiblings?: boolean } = {}
): string[] {
  const lines: string[] = []
  const chain: Element[] = []
  let curr: Element | null = targetEl

  while (curr && curr !== root.parentElement) {
    chain.push(curr)
    if (curr === root) break
    curr = curr.parentElement
  }

  lines.push(`Ancestor depth: ${chain.length} levels from <${targetEl.tagName.toLowerCase()}> to <${root.tagName.toLowerCase()}>`)

  chain.forEach((node, index) => {
    const indent = "  ".repeat(index)
    const formatted = formatSanitizedElement(node)
    lines.push(`${indent}[Level ${index}] ${formatted}`)

    // For nearest 3 ancestors, output sibling count and prev/next sibling details
    if (options.includeSiblings && index < 3 && node.parentElement) {
      const parent = node.parentElement
      const siblings = Array.from(parent.children)
      const siblingCount = Math.max(0, siblings.length - 1)
      const prev = node.previousElementSibling
      const next = node.nextElementSibling

      lines.push(`${indent}    -> Siblings total: ${siblingCount}`)
      lines.push(`${indent}    -> Prev sibling: ${formatSanitizedElement(prev)}`)
      lines.push(`${indent}    -> Next sibling: ${formatSanitizedElement(next)}`)
    }
  })

  return lines
}

/**
 * Main investigator function: Finds marker paths, prompt input chain, and candidate turn elements.
 */
export function findMarkerPathReport(
  marker: string,
  root: Element | null
): string {
  if (!root) {
    return "=== CONTEXT BRIDGE DOM INVESTIGATOR ===\nError: No <main> or container element found in document."
  }

  const cleanMarker = (marker || "").trim()
  const reportLines: string[] = [
    "=== CONTEXT BRIDGE DOM INVESTIGATOR REPORT ===",
    `Root Container: ${formatSanitizedElement(root)}`,
    `Search Marker: "${cleanMarker}"\n`
  ]

  // ----------------------------------------------------
  // SECTION 1: Search for Text Nodes Containing Marker
  // ----------------------------------------------------
  reportLines.push("--- SECTION 1: MARKER ANCESTOR PATHS ---")
  if (!cleanMarker) {
    reportLines.push("No marker specified. Please enter a marker word like 'zzmarker1'.\n")
  } else {
    const doc = root.ownerDocument || document
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
    let node: Node | null
    const matchedElements: Element[] = []

    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes(cleanMarker)) {
        const parent = node.parentElement
        if (parent && !matchedElements.includes(parent)) {
          matchedElements.push(parent)
        }
      }
    }

    if (matchedElements.length === 0) {
      reportLines.push(
        `No text nodes found containing marker "${cleanMarker}".`
      )
      reportLines.push(
        `Tip: Type a prompt in ChatGPT containing "${cleanMarker}" so it appears in the chat DOM, then click Find Marker Path again.\n`
      )
    } else {
      reportLines.push(`Found ${matchedElements.length} element(s) matching marker "${cleanMarker}":\n`)
      matchedElements.slice(0, 5).forEach((el, idx) => {
        reportLines.push(`[Match #${idx + 1}]`)
        const chainLines = buildAncestorChain(el, root, { includeSiblings: true })
        reportLines.push(...chainLines)
        reportLines.push("")
      })
    }
  }

  // ----------------------------------------------------
  // SECTION 2: Prompt Input Box Ancestor Chain
  // ----------------------------------------------------
  reportLines.push("--- SECTION 2: PROMPT INPUT BOX ANCESTOR CHAIN ---")
  const doc = root.ownerDocument || document
  const inputEl =
    root.querySelector("#prompt-textarea") ||
    root.querySelector('[contenteditable="true"]') ||
    root.querySelector("textarea") ||
    root.querySelector('[data-testid*="prompt"]') ||
    doc.querySelector("#prompt-textarea") ||
    doc.querySelector('[contenteditable="true"]') ||
    doc.querySelector('textarea[data-id]') ||
    doc.querySelector("textarea") ||
    doc.querySelector('[data-testid*="prompt"]')

  if (!inputEl) {
    reportLines.push("No prompt textarea or contenteditable element detected.\n")
  } else {
    reportLines.push(`Prompt Input Element: ${formatSanitizedElement(inputEl)}`)
    const inputChain = buildAncestorChain(inputEl, root, { includeSiblings: true })
    reportLines.push(...inputChain)
    reportLines.push("")
  }

  // ----------------------------------------------------
  // SECTION 3: Elements with data-message*, data-turn*, or data-testid containing 'turn'/'message'
  // ----------------------------------------------------
  reportLines.push("--- SECTION 3: TURN & MESSAGE ATTRIBUTE CANDIDATES (MAX 40) ---")
  const candidates: { el: Element; reason: string }[] = []
  const allDescendants = root.querySelectorAll("*")

  for (let i = 0; i < allDescendants.length; i++) {
    const el = allDescendants[i]
    let matchedReason = ""

    for (let j = 0; j < el.attributes.length; j++) {
      const aName = el.attributes[j].name.toLowerCase()
      const aVal = el.attributes[j].value.toLowerCase()

      if (aName.startsWith("data-message") || aName.startsWith("data-turn")) {
        matchedReason = `${aName}="${sanitizeAttrValue(aVal)}"`
        break
      }
      if (aName === "data-testid" && (aVal.includes("turn") || aVal.includes("message"))) {
        matchedReason = `data-testid="${sanitizeAttrValue(aVal)}"`
        break
      }
      if (aName.startsWith("data-app-shell") && aVal.includes("turn")) {
        matchedReason = `${aName}="${sanitizeAttrValue(aVal)}"`
        break
      }
    }

    if (matchedReason) {
      candidates.push({ el, reason: matchedReason })
      if (candidates.length >= 40) break
    }
  }

  if (candidates.length === 0) {
    reportLines.push("No elements found matching data-message*, data-turn*, or data-testid*='turn'|'message'.")
    reportLines.push("Listing top 5 child elements of <main> for layout structural reference:")
    Array.from(root.children).slice(0, 5).forEach((child, i) => {
      reportLines.push(`  [Child ${i}] ${formatSanitizedElement(child)}`)
    })
  } else {
    reportLines.push(`Found ${candidates.length} candidate element(s):`)
    candidates.forEach((c, idx) => {
      const parentTag = c.el.parentElement ? formatSanitizedElement(c.el.parentElement) : "(none)"
      reportLines.push(
        `  ${idx + 1}. ${formatSanitizedElement(c.el)} [Matched: ${c.reason}] (Parent: ${parentTag})`
      )
    })
  }

  reportLines.push("\n=== END OF INVESTIGATOR REPORT ===")
  return reportLines.join("\n")
}

/**
 * Self-contained runner that can be passed directly to chrome.scripting.executeScript.
 * Has zero external dependencies and runs directly inside the host browser page.
 */
export function findMarkerPathDirectlyInTab(markerWord: string): string {
  const root =
    document.querySelector("main") ||
    document.querySelector('[role="main"]') ||
    document.querySelector("#main") ||
    document.body

  if (!root) {
    return "=== CONTEXT BRIDGE DOM INVESTIGATOR ===\nError: No <main> or container element found."
  }

  function sanitize(val: string): string {
    if (!val) return ""
    const noUrls = val
      .replace(/(?:https?|ftp):\/\/[^\s"'>]+/gi, "[URL]")
      .replace(/(?:data|blob):[^\s"'>]+/gi, "[URL]")
    const escaped = noUrls.replace(/"/g, "'").trim()
    return escaped.length > 80 ? escaped.slice(0, 80) + "..." : escaped
  }

  function formatEl(el: Element | null): string {
    if (!el) return "(none)"
    const tag = el.tagName.toLowerCase()
    const attrs: string[] = []

    if (el.id) attrs.push(`id="${sanitize(el.id)}"`)
    const classAttr = el.getAttribute("class")
    if (classAttr) {
      const classes = classAttr.trim().split(/\s+/).filter(Boolean).slice(0, 2)
      if (classes.length > 0) attrs.push(`class="${sanitize(classes.join(" "))}"`)
    }
    const role = el.getAttribute("role")
    if (role) attrs.push(`role="${sanitize(role)}"`)
    const aria = el.getAttribute("aria-label")
    if (aria) attrs.push(`aria-label="${sanitize(aria)}"`)

    for (let i = 0; i < el.attributes.length; i++) {
      const a = el.attributes[i]
      if (a.name.startsWith("data-")) {
        attrs.push(`${a.name}="${sanitize(a.value)}"`)
      }
    }
    return `<${tag}${attrs.length > 0 ? " " + attrs.join(" ") : ""}>`
  }

  const cleanMarker = (markerWord || "zzmarker1").trim()
  const lines: string[] = [
    "=== CONTEXT BRIDGE DOM INVESTIGATOR REPORT ===",
    `Root Container: ${formatEl(root)}`,
    `Search Marker: "${cleanMarker}"\n`,
    "--- SECTION 1: MARKER ANCESTOR PATHS ---"
  ]

  // Search text nodes
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  let node: Node | null
  const matchedEls: Element[] = []

  while ((node = walker.nextNode())) {
    if (node.nodeValue && node.nodeValue.includes(cleanMarker)) {
      const p = node.parentElement
      if (p && !matchedEls.includes(p)) {
        matchedEls.push(p)
      }
    }
  }

  if (matchedEls.length === 0) {
    lines.push(`No text nodes found containing marker "${cleanMarker}".`)
    lines.push(`Tip: Send a chat message with "${cleanMarker}" in ChatGPT, then run Find Marker Path again.\n`)
  } else {
    lines.push(`Found ${matchedEls.length} element(s) matching marker "${cleanMarker}":\n`)
    matchedEls.slice(0, 5).forEach((el, idx) => {
      lines.push(`[Match #${idx + 1}]`)
      const chain: Element[] = []
      let curr: Element | null = el
      while (curr && curr !== root.parentElement) {
        chain.push(curr)
        if (curr === root) break
        curr = curr.parentElement
      }
      lines.push(`Ancestor depth: ${chain.length} levels from <${el.tagName.toLowerCase()}> to <${root.tagName.toLowerCase()}>`)
      chain.forEach((n, level) => {
        const indent = "  ".repeat(level)
        lines.push(`${indent}[Level ${level}] ${formatEl(n)}`)
        if (level < 3 && n.parentElement) {
          const siblings = Array.from(n.parentElement.children)
          lines.push(`${indent}    -> Siblings total: ${Math.max(0, siblings.length - 1)}`)
          lines.push(`${indent}    -> Prev sibling: ${formatEl(n.previousElementSibling)}`)
          lines.push(`${indent}    -> Next sibling: ${formatEl(n.nextElementSibling)}`)
        }
      })
      lines.push("")
    })
  }

  // Section 2: Input box
  lines.push("--- SECTION 2: PROMPT INPUT BOX ANCESTOR CHAIN ---")
  const inputEl =
    document.querySelector("#prompt-textarea") ||
    document.querySelector('[contenteditable="true"]') ||
    document.querySelector("textarea") ||
    document.querySelector('[data-testid*="prompt"]')

  if (!inputEl) {
    lines.push("No prompt textarea or contenteditable element detected.\n")
  } else {
    lines.push(`Prompt Input Element: ${formatEl(inputEl)}`)
    const chain: Element[] = []
    let curr: Element | null = inputEl
    while (curr && curr !== root.parentElement) {
      chain.push(curr)
      if (curr === root) break
      curr = curr.parentElement
    }
    lines.push(`Ancestor depth: ${chain.length} levels from <${inputEl.tagName.toLowerCase()}> to <${root.tagName.toLowerCase()}>`)
    chain.forEach((n, level) => {
      const indent = "  ".repeat(level)
      lines.push(`${indent}[Level ${level}] ${formatEl(n)}`)
      if (level < 3 && n.parentElement) {
        const siblings = Array.from(n.parentElement.children)
        lines.push(`${indent}    -> Siblings total: ${Math.max(0, siblings.length - 1)}`)
        lines.push(`${indent}    -> Prev sibling: ${formatEl(n.previousElementSibling)}`)
        lines.push(`${indent}    -> Next sibling: ${formatEl(n.nextElementSibling)}`)
      }
    })
    lines.push("")
  }

  // Section 3: Attributes
  lines.push("--- SECTION 3: TURN & MESSAGE ATTRIBUTE CANDIDATES (MAX 40) ---")
  const candidates: { el: Element; reason: string }[] = []
  const allDescendants = root.querySelectorAll("*")

  for (let i = 0; i < allDescendants.length; i++) {
    const el = allDescendants[i]
    let matchedReason = ""
    for (let j = 0; j < el.attributes.length; j++) {
      const aName = el.attributes[j].name.toLowerCase()
      const aVal = el.attributes[j].value.toLowerCase()
      if (aName.startsWith("data-message") || aName.startsWith("data-turn")) {
        matchedReason = `${aName}="${sanitize(aVal)}"`
        break
      }
      if (aName === "data-testid" && (aVal.includes("turn") || aVal.includes("message"))) {
        matchedReason = `data-testid="${sanitize(aVal)}"`
        break
      }
      if (aName.startsWith("data-app-shell") && (aVal.includes("turn") || aVal.includes("conversation") || aVal.includes("chat"))) {
        matchedReason = `${aName}="${sanitize(aVal)}"`
        break
      }
    }
    if (matchedReason) {
      candidates.push({ el, reason: matchedReason })
      if (candidates.length >= 40) break
    }
  }

  if (candidates.length === 0) {
    lines.push("No elements found matching data-message*, data-turn*, or data-testid*='turn'|'message'.")
    lines.push("Top 5 children of <main>:")
    Array.from(root.children).slice(0, 5).forEach((child, i) => {
      lines.push(`  [Child ${i}] ${formatEl(child)}`)
    })
  } else {
    lines.push(`Found ${candidates.length} candidate element(s):`)
    candidates.forEach((c, idx) => {
      const parentTag = c.el.parentElement ? formatEl(c.el.parentElement) : "(none)"
      lines.push(`  ${idx + 1}. ${formatEl(c.el)} [Matched: ${c.reason}] (Parent: ${parentTag})`)
    })
  }

  lines.push("\n=== END OF INVESTIGATOR REPORT ===")
  return lines.join("\n")
}
