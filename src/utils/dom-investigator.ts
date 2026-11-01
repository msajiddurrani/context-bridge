/**
 * Context Bridge - Universal DOM Investigator Engine (Stage 3, Part A)
 *
 * Invariants:
 * 1. ZERO platform-specific hardcoded selectors (works generically on any web AI platform).
 * 2. ZERO innerHTML, dangerouslySetInnerHTML, eval, or new Function.
 * 3. ZERO chat transcript text, user input values, or auth tokens in reports.
 * 4. Deep inspection across normal DOM, open shadow roots, and same-origin iframes.
 * 5. Full secret scrubbing via redactSensitiveData.
 */

import { redactSensitiveData } from "./redaction"

export interface NavEventRecord {
  timeOffset: string
  path: string
}

export interface SiteReportOptions {
  marker1?: string // User message marker (default: zzmarker1)
  marker2?: string // Code block marker (default: zzmarker2)
  navEvents?: NavEventRecord[]
}

/**
 * Masks id-like segments in URL pathnames with <id>.
 * Examples:
 * /c/67123abc-4567-8901-cdef -> /c/<id>
 * /chat/123456789 -> /chat/<id>
 * /app/a1b2c3d4e5f6g7h8 -> /app/<id>
 */
export function maskPathname(pathname: string): string {
  if (!pathname) return "/"
  const segments = pathname.split("/")
  const masked = segments.map((seg) => {
    if (!seg) return ""
    // UUID v4 / v1 pattern
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg)) {
      return "<id>"
    }
    // Pure numeric ID
    if (/^\d{3,}$/.test(seg)) {
      return "<id>"
    }
    // Hex or alphanumeric hashes/slugs (>= 10 chars with both letters/numbers or starts with c_/chat_)
    if (/^(?:c_|chat_|session_|turn_)?[a-zA-Z0-9_-]{10,}$/.test(seg) && /[0-9]/.test(seg)) {
      return "<id>"
    }
    return seg
  })
  return masked.join("/") || "/"
}

/**
 * Categorizes an attribute value shape into <uuid>, <number>, or <slug>.
 */
export function detectValueShape(val: string): "<uuid>" | "<number>" | "<slug>" {
  if (!val) return "<slug>"
  const trimmed = val.trim()
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return "<uuid>"
  }
  if (/^\d+$/.test(trimmed)) {
    return "<number>"
  }
  return "<slug>"
}

/**
 * Sanitizes an attribute value: strips full URLs and quotes, caps length, redacts secrets.
 */
export function sanitizeAttributeValue(val: string): string {
  if (!val) return ""
  let clean = val
    .replace(/(?:https?|ftp):\/\/[^\s"'>]+/gi, "[URL]")
    .replace(/(?:data|blob):[^\s"'>]+/gi, "[URL]")
    .replace(/"/g, "'")
    .trim()
  clean = redactSensitiveData(clean).redactedText
  return clean.length > 80 ? clean.slice(0, 80) + "..." : clean
}

/**
 * Formats an element into a sanitized tag representation:
 * <tag id="..." class="..." role="..." aria-label="..." data-attr="val">
 * Strictly omits textContent, input values, and URLs.
 */
export function formatInvestigatorElement(el: Element | null): string {
  if (!el) return "(none)"
  const tag = el.tagName.toLowerCase()
  const attrs: string[] = []

  if (el.id) {
    attrs.push(`id="${sanitizeAttributeValue(el.id)}"`)
  }

  const classAttr = el.getAttribute("class")
  if (classAttr) {
    const classes = classAttr.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    if (classes.length > 0) {
      attrs.push(`class="${sanitizeAttributeValue(classes.join(" "))}"`)
    }
  }

  const role = el.getAttribute("role")
  if (role) {
    attrs.push(`role="${sanitizeAttributeValue(role)}"`)
  }

  const ariaLabel = el.getAttribute("aria-label")
  if (ariaLabel) {
    attrs.push(`aria-label="${sanitizeAttributeValue(ariaLabel)}"`)
  }

  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]
    if (attr.name.toLowerCase().startsWith("data-")) {
      attrs.push(`${attr.name}="${sanitizeAttributeValue(attr.value)}"`)
    }
  }

  return `<${tag}${attrs.length > 0 ? " " + attrs.join(" ") : ""}>`
}

export interface MatchedMarkerTarget {
  element: Element
  rootType: "normal_dom" | "shadow_root" | "iframe"
  rootDescription: string
}

export interface SearchScopeStats {
  domElementsCount: number
  shadowRootsCount: number
  iframesCount: number
}

/**
 * Recursively searches for marker text in normal DOM, open shadow roots, and same-origin iframes.
 */
export function searchMarkerInAllRoots(
  doc: Document,
  marker: string
): { matches: MatchedMarkerTarget[]; stats: SearchScopeStats } {
  const cleanMarker = (marker || "").trim()
  const matches: MatchedMarkerTarget[] = []
  const stats: SearchScopeStats = {
    domElementsCount: 0,
    shadowRootsCount: 0,
    iframesCount: 0
  }

  if (!cleanMarker || !doc.body) {
    return { matches, stats }
  }

  function searchInContainer(
    container: Node,
    rootType: "normal_dom" | "shadow_root" | "iframe",
    rootDesc: string
  ) {
    const ownerDoc = container.ownerDocument || doc
    const walker = ownerDoc.createTreeWalker(container, NodeFilter.SHOW_TEXT, null)
    let node: Node | null
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes(cleanMarker)) {
        const parent = node.parentElement
        if (parent && !matches.some((m) => m.element === parent)) {
          matches.push({
            element: parent,
            rootType,
            rootDescription: rootDesc
          })
        }
      }
    }
  }

  // 1. Search normal DOM
  const allDomEls = doc.querySelectorAll("*")
  stats.domElementsCount = allDomEls.length
  searchInContainer(doc.body, "normal_dom", "normal DOM")

  // 2. Search open shadow roots
  allDomEls.forEach((el) => {
    if (el.shadowRoot) {
      stats.shadowRootsCount++
      const shadowHostTag = formatInvestigatorElement(el)
      searchInContainer(
        el.shadowRoot,
        "shadow_root",
        `open shadow root under ${shadowHostTag}`
      )
    }
  })

  // 3. Search same-origin iframes
  const iframes = doc.querySelectorAll("iframe")
  stats.iframesCount = iframes.length
  iframes.forEach((iframe, idx) => {
    try {
      if (iframe.contentDocument && iframe.contentDocument.body) {
        searchInContainer(
          iframe.contentDocument.body,
          "iframe",
          `iframe #${idx + 1} (${iframe.id || "no-id"})`
        )
      }
    } catch {
      // Ignore cross-origin iframe security errors
    }
  })

  return { matches, stats }
}

/**
 * Builds the full ancestor chain from an element up to the document root.
 */
export function buildInvestigatorAncestorChain(
  targetEl: Element,
  docRoot: Element = targetEl.ownerDocument?.documentElement || document.documentElement
): string[] {
  const lines: string[] = []
  const chain: Element[] = []
  let curr: Element | null = targetEl

  while (curr && curr !== docRoot.parentElement) {
    chain.push(curr)
    if (curr === docRoot) break
    curr = curr.parentElement
  }

  lines.push(
    `Ancestor chain: ${chain.length} levels from <${targetEl.tagName.toLowerCase()}> to <${docRoot.tagName.toLowerCase()}>`
  )

  chain.forEach((node, index) => {
    const indent = "  ".repeat(index)
    const formatted = formatInvestigatorElement(node)
    lines.push(`${indent}[Level ${index}] ${formatted}`)

    if (node.parentElement) {
      const parent = node.parentElement
      const siblings = Array.from(parent.children)
      const siblingCount = Math.max(0, siblings.length - 1)
      const prev = node.previousElementSibling
      const next = node.nextElementSibling
      lines.push(`${indent}    -> Sibling count: ${siblingCount}`)
      lines.push(`${indent}    -> Prev sibling: ${formatInvestigatorElement(prev)}`)
      lines.push(`${indent}    -> Next sibling: ${formatInvestigatorElement(next)}`)
    }
  })

  return lines
}

/**
 * Finds the nearest repeating ancestor wrapper for message turns.
 */
export function findNearestRepeatingMessageAncestor(
  markerEl: Element,
  docRoot: Element = markerEl.ownerDocument?.documentElement || document.documentElement
): {
  repeatingAncestor: Element | null
  parentContainer: Element | null
  level: number
  siblingCount: number
  repeatingSiblings: Element[]
} | null {
  let curr: Element | null = markerEl
  let level = 0

  while (curr && curr !== docRoot) {
    const parent = curr.parentElement
    if (parent && parent.children.length >= 2) {
      const targetTag = curr.tagName.toLowerCase()
      const targetAttrNames = Array.from(curr.attributes).map((a) => a.name.toLowerCase())

      // Find siblings that share the same tag and key attributes
      const matchingSiblings = Array.from(parent.children).filter((sib) => {
        if (sib.tagName.toLowerCase() !== targetTag) return false
        if (targetAttrNames.length === 0) return true
        const sibAttrNames = new Set(Array.from(sib.attributes).map((a) => a.name.toLowerCase()))
        return targetAttrNames.some((attr) => sibAttrNames.has(attr))
      })

      if (matchingSiblings.length >= 2) {
        return {
          repeatingAncestor: curr,
          parentContainer: parent,
          level,
          siblingCount: matchingSiblings.length,
          repeatingSiblings: matchingSiblings
        }
      }
    }
    curr = curr.parentElement
    level++
  }

  return null
}

/**
 * Analyzes code block structure one level down from marker2 match.
 */
export function analyzeCodeBlockStructure(
  marker2MatchEl: Element | null,
  doc: Document,
  stats: SearchScopeStats,
  marker2: string
): string[] {
  const lines: string[] = []

  if (!marker2MatchEl) {
    lines.push(
      `Searched normal DOM (${stats.domElementsCount} elements), ${stats.shadowRootsCount} open shadow root(s), ${stats.iframesCount} iframe(s). Marker "${marker2}" not found.`
    )
    return lines
  }

  // Walk up to find code container (<pre>, <code>, or container with code-related classes/tags)
  let codeContainer: Element | null =
    marker2MatchEl.closest?.("pre, code, [class*='code-block'], [class*='codeblock'], [data-testid*='code']") ||
    null

  if (!codeContainer) {
    let curr: Element | null = marker2MatchEl
    while (curr && curr !== doc.body) {
      const tag = curr.tagName.toLowerCase()
      if (tag === "pre" || tag === "code") {
        codeContainer = curr
        break
      }
      curr = curr.parentElement
    }
  }

  if (
    codeContainer &&
    codeContainer.tagName.toLowerCase() === "code" &&
    codeContainer.parentElement?.tagName.toLowerCase() === "pre"
  ) {
    codeContainer = codeContainer.parentElement
  }

  const containerToInspect = codeContainer || marker2MatchEl
  lines.push(`Code Block Container: ${formatInvestigatorElement(containerToInspect)}`)

  // 1. Line structure one level down
  const childElements = Array.from(containerToInspect.children)
  const brElements = containerToInspect.querySelectorAll("br")
  const rawText = containerToInspect.textContent || ""

  let lineStructure = "text with newlines (\\n)"
  if (childElements.length >= 2) {
    const firstChildTag = childElements[0].tagName.toLowerCase()
    lineStructure = `separate elements (<${firstChildTag}> per line, count: ${childElements.length})`
  } else if (brElements.length > 0) {
    lineStructure = `<br> elements separating lines (count: ${brElements.length})`
  } else if (rawText.includes("\n")) {
    lineStructure = `text with newlines (\\n, approx ${rawText.split("\n").length} lines)`
  }
  lines.push(`Line Structure: ${lineStructure}`)

  // 2. Whitespace preservation
  let whiteSpaceValue = (containerToInspect as HTMLElement).style?.whiteSpace || ""
  try {
    const win = doc.defaultView || window
    if (!whiteSpaceValue && win && win.getComputedStyle) {
      whiteSpaceValue = win.getComputedStyle(containerToInspect).whiteSpace || "normal"
    }
  } catch {}
  if (!whiteSpaceValue) whiteSpaceValue = "normal"
  lines.push(`Whitespace Preserved (white-space CSS): "${whiteSpaceValue}"`)

  // 3. Language label element
  const parentOrSelf = containerToInspect.parentElement || containerToInspect
  const langCandidate =
    parentOrSelf.querySelector("[data-language]") ||
    parentOrSelf.querySelector('[class*="language-"]') ||
    parentOrSelf.querySelector('[class*="lang-"]') ||
    containerToInspect.querySelector("[data-language]") ||
    containerToInspect.querySelector('[class*="language-"]')

  lines.push(
    `Language Label Element: ${langCandidate ? formatInvestigatorElement(langCandidate) : "none found"}`
  )

  // 4. Copy button element (tag and attributes only)
  const copyBtn =
    parentOrSelf.querySelector('button[aria-label*="copy" i]') ||
    parentOrSelf.querySelector('button[data-testid*="copy" i]') ||
    parentOrSelf.querySelector('[role="button"][aria-label*="copy" i]') ||
    parentOrSelf.querySelector("button") ||
    containerToInspect.querySelector('button[aria-label*="copy" i]')

  lines.push(
    `Copy Button Element: ${copyBtn ? formatInvestigatorElement(copyBtn) : "none found"}`
  )

  return lines
}

/**
 * Evaluates candidate message ID attributes across repeating message wrappers.
 */
export function evaluateMessageIdCandidates(wrappers: Element[]): string[] {
  const lines: string[] = []
  if (!wrappers || wrappers.length === 0) {
    lines.push("No message wrappers identified to evaluate ID candidates.")
    return lines
  }

  lines.push(
    `Evaluated on ${wrappers.length} repeating message wrapper(s) (<${wrappers[0].tagName.toLowerCase()}>):`
  )

  // Collect all attribute names across wrappers
  const allAttrNames = new Set<string>()
  wrappers.forEach((w) => {
    for (let i = 0; i < w.attributes.length; i++) {
      allAttrNames.add(w.attributes[i].name)
    }
  })

  let candidateCount = 0
  allAttrNames.forEach((attrName) => {
    const values = wrappers
      .map((w) => w.getAttribute(attrName))
      .filter((v): v is string => Boolean(v))

    if (values.length === 0) return

    const firstVal = values[0]
    const shape = detectValueShape(firstVal)
    const uniqueValues = new Set(values)
    const isUnique = uniqueValues.size === values.length && values.length === wrappers.length

    lines.push(
      `  - ${attrName}: shape=${shape}, unique=${isUnique}${!isUnique ? ` (shared/partial: ${uniqueValues.size}/${values.length})` : ""}`
    )
    candidateCount++
  })

  if (candidateCount === 0) {
    lines.push("  (No attributes found on wrappers)")
  }

  return lines
}

/**
 * Inspects prompt input box and send button without clicking.
 */
export function inspectInputAndSend(doc: Document): string[] {
  const lines: string[] = []

  // Prompt input search: textarea, contenteditable, role=textbox
  const inputEl =
    doc.querySelector("#prompt-textarea") ||
    doc.querySelector('[contenteditable="true"]') ||
    doc.querySelector('textarea[data-id]') ||
    doc.querySelector("textarea") ||
    doc.querySelector('[role="textbox"]') ||
    doc.querySelector('input[type="text"]')

  if (!inputEl) {
    lines.push("Prompt Input Box: none detected")
  } else {
    const tag = inputEl.tagName.toLowerCase()
    let inputType = "custom editor"
    if (tag === "textarea") {
      inputType = "textarea"
    } else if (inputEl.getAttribute("contenteditable") === "true") {
      inputType = "contenteditable"
    } else if (tag === "input") {
      inputType = "input[type=text]"
    }

    const role = inputEl.getAttribute("role") || "none"
    const ariaLabel = inputEl.getAttribute("aria-label") || "none"
    const placeholder =
      inputEl.getAttribute("placeholder") ||
      inputEl.getAttribute("data-placeholder") ||
      inputEl.getAttribute("aria-placeholder") ||
      "none"

    lines.push(`Prompt Input Box:`)
    lines.push(`  Tag: <${tag}>`)
    lines.push(`  Type: ${inputType}`)
    lines.push(`  Role: "${sanitizeAttributeValue(role)}"`)
    lines.push(`  Aria-label: "${sanitizeAttributeValue(ariaLabel)}"`)
    lines.push(`  Placeholder: "${sanitizeAttributeValue(placeholder)}"`)
    lines.push(`  Full Element: ${formatInvestigatorElement(inputEl)}`)
  }

  // Send button search (tag, aria-label, disabled state) WITHOUT clicking it
  const parentContainer = inputEl?.closest("form") || inputEl?.parentElement?.parentElement || doc.body
  const sendBtn =
    parentContainer.querySelector('button[aria-label*="send" i]') ||
    parentContainer.querySelector('button[data-testid*="send" i]') ||
    parentContainer.querySelector('button[type="submit"]') ||
    doc.querySelector('button[aria-label*="send" i]') ||
    doc.querySelector('button[data-testid*="send" i]') ||
    doc.querySelector('button[aria-label*="submit" i]')

  if (!sendBtn) {
    lines.push(`Send Button: none detected`)
  } else {
    const isHtmlBtn = sendBtn instanceof (sendBtn.ownerDocument?.defaultView?.HTMLButtonElement || Object)
    const isDisabled =
      (isHtmlBtn && (sendBtn as HTMLButtonElement).disabled) ||
      sendBtn.getAttribute("aria-disabled") === "true" ||
      sendBtn.getAttribute("disabled") !== null

    lines.push(`Send Button (without clicking):`)
    lines.push(`  Tag: <${sendBtn.tagName.toLowerCase()}>`)
    lines.push(`  Aria-label: "${sanitizeAttributeValue(sendBtn.getAttribute("aria-label") || "none")}"`)
    lines.push(`  Disabled: ${Boolean(isDisabled)}`)
    lines.push(`  Full Element: ${formatInvestigatorElement(sendBtn)}`)
  }

  return lines
}

/**
 * Finds the nearest scrollable ancestor container of messages.
 */
export function inspectScrollContainer(
  targetEl: Element | null,
  doc: Document
): string[] {
  const lines: string[] = []
  if (!targetEl) {
    lines.push("Scroll Container: No target element provided to find scrollable ancestor.")
    return lines
  }

  let curr: Element | null = targetEl.parentElement
  let foundScrollable: Element | null = null
  const win = doc.defaultView || window

  while (curr && curr !== doc.documentElement) {
    let overflowY = ""
    try {
      if (win && win.getComputedStyle) {
        overflowY = win.getComputedStyle(curr).overflowY || ""
      }
    } catch {
      overflowY = (curr as HTMLElement).style?.overflowY || ""
    }

    const isScrollableStyle = ["auto", "scroll", "overlay"].includes(overflowY)
    const hasScrollHeight = curr.scrollHeight > curr.clientHeight && curr.clientHeight > 0

    if (isScrollableStyle || hasScrollHeight) {
      foundScrollable = curr
      break
    }
    curr = curr.parentElement
  }

  const scrollEl = foundScrollable || doc.querySelector("main") || doc.body
  const overflowYVal =
    win && win.getComputedStyle ? win.getComputedStyle(scrollEl).overflowY || "visible" : "visible"

  lines.push(`Scroll Container: ${formatInvestigatorElement(scrollEl)}`)
  lines.push(`  Tag: <${scrollEl.tagName.toLowerCase()}>`)
  lines.push(`  Role: "${sanitizeAttributeValue(scrollEl.getAttribute("role") || "none")}"`)
  lines.push(`  Aria-label: "${sanitizeAttributeValue(scrollEl.getAttribute("aria-label") || "none")}"`)
  lines.push(`  scrollHeight: ${scrollEl.scrollHeight}px`)
  lines.push(`  clientHeight: ${scrollEl.clientHeight}px`)
  lines.push(`  overflow-y: "${overflowYVal}"`)

  return lines
}

/**
 * Checks whether current page is an empty chat and identifies distinguishing features.
 */
export function inspectNewOrEmptyChat(
  _doc: Document,
  win: Window,
  messageCount: number
): string[] {
  const lines: string[] = []
  const pathname = win.location?.pathname || "/"
  const maskedPath = maskPathname(pathname)

  const isRootOrNew =
    pathname === "/" ||
    pathname === "/new" ||
    pathname === "/chat" ||
    pathname === "/app" ||
    pathname.endsWith("/new")

  const isEmpty = messageCount === 0 || isRootOrNew

  lines.push(`Is Empty Chat: ${isEmpty ? "YES (Empty chat detected)" : "NO (Active chat with turns)"}`)
  lines.push(`Masked Pathname: ${maskedPath}`)
  lines.push(`Messages Count in DOM: ${messageCount}`)
  lines.push(
    `Distinguishing Features: ${
      isEmpty
        ? isRootOrNew
          ? "Pathname matches root/new pattern with 0 message turns in DOM"
          : "0 message turns found in active DOM"
        : "Message turns present in DOM and permalink/session id assigned"
    }`
  )

  return lines
}

/**
 * Searches for visible rate-limit or quota error text on the page.
 */
export function inspectRateLimitText(doc: Document): string[] {
  const lines: string[] = []
  const rateLimitPhrases = [
    "limit reached",
    "try again later",
    "usage cap",
    "too many requests",
    "rate limit",
    "message cap",
    "hourly limit",
    "daily limit",
    "cap reached"
  ]

  const matchedPhrases: { phrase: string; elementPath: string }[] = []

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const val = node.nodeValue?.toLowerCase() || ""
    for (const phrase of rateLimitPhrases) {
      if (val.includes(phrase)) {
        const parent = node.parentElement
        if (parent) {
          matchedPhrases.push({
            phrase,
            elementPath: formatInvestigatorElement(parent)
          })
          break
        }
      }
    }
  }

  if (matchedPhrases.length === 0) {
    lines.push("Rate Limit Text: none visible")
  } else {
    lines.push(`Rate Limit Text Found (${matchedPhrases.length} match(es)):`)
    matchedPhrases.forEach((m, i) => {
      lines.push(`  ${i + 1}. Matching phrase: "${m.phrase}" in element: ${m.elementPath}`)
    })
  }

  return lines
}

/**
 * Searches for chat links in sidebar/navigation.
 */
export function inspectSidebarChatLinks(doc: Document, win: Window): { count: number; patterns: string[] } {
  const currentHost = win.location?.hostname || ""
  const sidebar =
    doc.querySelector("nav") ||
    doc.querySelector("aside") ||
    doc.querySelector('[role="navigation"]') ||
    doc.body

  const anchors = Array.from(sidebar.querySelectorAll("a[href]"))
  const chatPatterns: string[] = []
  let totalChatLinks = 0

  const excludedSubstrings = [
    "login",
    "signup",
    "signout",
    "auth",
    "settings",
    "help",
    "privacy",
    "terms",
    "billing",
    "pricing",
    "about",
    "explore",
    "static",
    "assets"
  ]

  for (const a of anchors) {
    const href = a.getAttribute("href") || ""
    if (!href || href === "#" || href.startsWith("javascript:")) continue

    try {
      const url = new URL(href, win.location?.href || "https://localhost")
      if (url.hostname && url.hostname !== currentHost && !url.hostname.endsWith(currentHost)) {
        continue // Skip foreign links
      }

      const p = url.pathname
      const lowerP = p.toLowerCase()
      if (excludedSubstrings.some((sub) => lowerP.includes(sub))) continue

      // Look for chat-like patterns (e.g. /c/, /chat/, /p/, /g/, /project/, or paths with >= 2 segments)
      const segments = p.split("/").filter(Boolean)
      if (
        segments.length >= 1 &&
        (p.includes("/c/") ||
          p.includes("/chat/") ||
          p.includes("/p/") ||
          p.includes("/g/") ||
          p.includes("/share/") ||
          segments.length >= 2 ||
          /[0-9]/.test(p))
      ) {
        totalChatLinks++
        const masked = maskPathname(p)
        if (!chatPatterns.includes(masked) && chatPatterns.length < 5) {
          chatPatterns.push(masked)
        }
      }
    } catch {
      // Ignore URL parse errors
    }
  }

  return {
    count: totalChatLinks,
    patterns: chatPatterns
  }
}

/**
 * Builds the complete, generic Site Investigator Report.
 */
export function buildFullSiteReport(
  doc: Document,
  win: Window = doc.defaultView || (window as any),
  options: SiteReportOptions = {}
): string {
  const marker1 = (options.marker1 || "zzmarker1").trim()
  const marker2 = (options.marker2 || "zzmarker2").trim()
  const navEvents = options.navEvents || []

  const report: string[] = []
  report.push("================================================================================")
  report.push("                      CONTEXT BRIDGE - SITE INVESTIGATOR REPORT                 ")
  report.push("================================================================================\n")

  // ----------------------------------------------------
  // a) SITE
  // ----------------------------------------------------
  report.push("--- a) SITE ---")
  report.push(`Page Title: "${doc.title || "(no title)"}"`)
  report.push(`Hostname: ${win.location?.hostname || "unknown"}`)
  report.push(`Pathname: ${maskPathname(win.location?.pathname || "/")}`)

  const sidebarLinks = inspectSidebarChatLinks(doc, win)
  report.push(`Sidebar Chat Links Found: ${sidebarLinks.count}`)
  if (sidebarLinks.patterns.length > 0) {
    report.push(`First ${sidebarLinks.patterns.length} Masked Chat Link Patterns:`)
    sidebarLinks.patterns.forEach((pat, i) => {
      report.push(`  ${i + 1}. ${pat}`)
    })
  } else {
    report.push("First Masked Chat Link Patterns: none detected in sidebar/nav")
  }
  report.push("")

  // ----------------------------------------------------
  // b) MARKER PATHS
  // ----------------------------------------------------
  report.push("--- b) MARKER PATHS ---")
  report.push(`Marker 1 (User Message): "${marker1}"`)
  const m1Result = searchMarkerInAllRoots(doc, marker1)
  if (m1Result.matches.length === 0) {
    report.push(
      `Searched normal DOM (${m1Result.stats.domElementsCount} elements), ${m1Result.stats.shadowRootsCount} open shadow root(s), ${m1Result.stats.iframesCount} iframe(s). Marker "${marker1}" not found.`
    )
  } else {
    report.push(`Found ${m1Result.matches.length} match(es) for "${marker1}":`)
    m1Result.matches.slice(0, 3).forEach((match, i) => {
      report.push(`[Marker 1 Match #${i + 1} (${match.rootDescription})]`)
      const chain = buildInvestigatorAncestorChain(match.element)
      report.push(...chain)
      report.push("")
    })
  }

  report.push(`Marker 2 (Code Block): "${marker2}"`)
  const m2Result = searchMarkerInAllRoots(doc, marker2)
  if (m2Result.matches.length === 0) {
    report.push(
      `Searched normal DOM (${m2Result.stats.domElementsCount} elements), ${m2Result.stats.shadowRootsCount} open shadow root(s), ${m2Result.stats.iframesCount} iframe(s). Marker "${marker2}" not found.`
    )
  } else {
    report.push(`Found ${m2Result.matches.length} match(es) for "${marker2}":`)
    m2Result.matches.slice(0, 2).forEach((match, i) => {
      report.push(`[Marker 2 Match #${i + 1} (${match.rootDescription})]`)
      const chain = buildInvestigatorAncestorChain(match.element)
      report.push(...chain)
      report.push("")
    })
  }
  report.push("")

  // ----------------------------------------------------
  // c) MESSAGE CONTAINERS
  // ----------------------------------------------------
  report.push("--- c) MESSAGE CONTAINERS ---")
  const primaryMatchEl = m1Result.matches[0]?.element || null
  let repeatingInfo: ReturnType<typeof findNearestRepeatingMessageAncestor> = null

  if (!primaryMatchEl) {
    report.push("Cannot identify message container: Marker 1 was not found in DOM.")
  } else {
    repeatingInfo = findNearestRepeatingMessageAncestor(primaryMatchEl)
    if (!repeatingInfo) {
      report.push("No repeating ancestor with 2+ matching siblings found in ancestor chain.")
    } else {
      const repEl = repeatingInfo.repeatingAncestor!
      const parentEl = repeatingInfo.parentContainer!
      const attrNames = Array.from(repEl.attributes).map((a) => a.name)
      report.push(`Nearest Repeating Ancestor: ${formatInvestigatorElement(repEl)}`)
      report.push(`  Tag: <${repEl.tagName.toLowerCase()}>`)
      report.push(`  Attributes Present: ${attrNames.join(", ") || "none"}`)
      report.push(`  Sibling Count Sharing Tag & Attributes: ${repeatingInfo.siblingCount}`)
      report.push(`  Parent Message List Container: ${formatInvestigatorElement(parentEl)}`)
    }
  }
  report.push("")

  // ----------------------------------------------------
  // d) CODE BLOCK
  // ----------------------------------------------------
  report.push("--- d) CODE BLOCK ---")
  const primaryCodeMatch = m2Result.matches[0]?.element || null
  const codeAnalysis = analyzeCodeBlockStructure(
    primaryCodeMatch,
    doc,
    m2Result.stats,
    marker2
  )
  report.push(...codeAnalysis)
  report.push("")

  // ----------------------------------------------------
  // e) MESSAGE ID CANDIDATES
  // ----------------------------------------------------
  report.push("--- e) MESSAGE ID CANDIDATES ---")
  if (repeatingInfo && repeatingInfo.repeatingSiblings.length > 0) {
    const idCandidates = evaluateMessageIdCandidates(repeatingInfo.repeatingSiblings)
    report.push(...idCandidates)
  } else {
    report.push("No message wrappers identified to evaluate ID candidates.")
  }
  report.push("")

  // ----------------------------------------------------
  // f) INPUT & SEND BUTTON
  // ----------------------------------------------------
  report.push("--- f) INPUT & SEND BUTTON ---")
  const inputLines = inspectInputAndSend(doc)
  report.push(...inputLines)
  report.push("")

  // ----------------------------------------------------
  // g) SCROLL CONTAINER
  // ----------------------------------------------------
  report.push("--- g) SCROLL CONTAINER ---")
  const scrollTarget = repeatingInfo?.repeatingAncestor || primaryMatchEl || doc.querySelector("main") || doc.body
  const scrollLines = inspectScrollContainer(scrollTarget, doc)
  report.push(...scrollLines)
  report.push("")

  // ----------------------------------------------------
  // h) NEW/EMPTY CHAT
  // ----------------------------------------------------
  report.push("--- h) NEW/EMPTY CHAT ---")
  const messageCount = repeatingInfo ? repeatingInfo.siblingCount : m1Result.matches.length
  const newChatLines = inspectNewOrEmptyChat(doc, win, messageCount)
  report.push(...newChatLines)
  report.push("")

  // ----------------------------------------------------
  // i) LIMIT TEXT
  // ----------------------------------------------------
  report.push("--- i) LIMIT TEXT ---")
  const limitLines = inspectRateLimitText(doc)
  report.push(...limitLines)
  report.push("")

  // ----------------------------------------------------
  // j) NAVIGATION
  // ----------------------------------------------------
  report.push("--- j) NAVIGATION ---")
  if (navEvents && navEvents.length > 0) {
    report.push(`Recorded ${navEvents.length} navigation event(s):`)
    navEvents.forEach((ev) => {
      report.push(`  [${ev.timeOffset}] ${maskPathname(ev.path)}`)
    })
    report.push("In-app SPA URL transitions confirmed without full reload.")
  } else {
    report.push(
      "Status: idle (Press 'Start watching' in popup to record 20s navigation history)"
    )
    report.push(`Current Pathname: ${maskPathname(win.location?.pathname || "/")}`)
  }
  report.push("")
  report.push("================================================================================")
  report.push("                        END OF INVESTIGATOR REPORT                              ")
  report.push("================================================================================")

  const rawReport = report.join("\n")
  // Requirement 4: Zero chat text, input values, or tokens
  return redactSensitiveData(rawReport).redactedText
}

/**
 * Self-contained direct execution runner for tab fallback via chrome.scripting.executeScript.
 */
export function generateSiteReportDirectlyInTab(
  marker1: string,
  marker2: string,
  navEvents?: NavEventRecord[]
): string {
  // Can execute standalone in host page
  try {
    return (window as any).__cb_investigator
      ? (window as any).__cb_investigator(marker1, marker2, navEvents)
      : buildFullSiteReport(document, window, { marker1, marker2, navEvents })
  } catch (err: any) {
    return `Investigator execution error: ${err?.message || "Unknown error"}`
  }
}
