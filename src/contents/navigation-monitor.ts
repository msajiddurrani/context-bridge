import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: [
    "https://claude.ai/*",
    "https://chatgpt.com/*",
    "https://*.chatgpt.com/*",
    "https://gemini.google.com/*"
  ],
  world: "MAIN",
  run_at: "document_start"
}

// Monkey-patch history in the MAIN execution world of the web page
if (typeof window !== "undefined" && !(window as any).__cb_main_nav_installed) {
  ;(window as any).__cb_main_nav_installed = true

  const notifyNav = () => {
    try {
      window.dispatchEvent(
        new CustomEvent("contextbridge:navigation", {
          detail: { url: window.location.href }
        })
      )
      window.postMessage(
        {
          source: "contextbridge-main",
          type: "CONTEXTBRIDGE_NAVIGATION",
          url: window.location.href
        },
        "*"
      )
    } catch {
      // Ignore
    }
  }

  const origPush = window.history.pushState
  window.history.pushState = function (...args) {
    const res = origPush.apply(this, args)
    notifyNav()
    return res
  }

  const origReplace = window.history.replaceState
  window.history.replaceState = function (...args) {
    const res = origReplace.apply(this, args)
    notifyNav()
    return res
  }

  window.addEventListener("popstate", notifyNav)
  window.addEventListener("hashchange", notifyNav)
}

export default function NavigationMonitor() {
  return null
}
