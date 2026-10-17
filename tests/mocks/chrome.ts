/**
 * In-memory Mock of the Chrome Extension Manifest V3 APIs for Vitest.
 */

export function setupChromeMock() {
  const store: Record<string, any> = {}

  const chromeMock = {
    runtime: {
      id: "mock-context-bridge-id",
      sendMessage: (msg: any, cb?: (res: any) => void) => {
        if (cb) cb({ success: true })
      },
      onMessage: {
        addListener: () => {}
      },
      lastError: null
    },
    storage: {
      local: {
        get: (keys: string | string[] | Record<string, any> | null, cb?: (res: any) => void) => {
          let result: Record<string, any> = {}
          if (typeof keys === "string") {
            result[keys] = store[keys]
          } else if (Array.isArray(keys)) {
            keys.forEach((k) => (result[k] = store[k]))
          } else if (keys === null) {
            result = { ...store }
          }
          if (cb) cb(result)
          return Promise.resolve(result)
        },
        set: (items: Record<string, any>, cb?: () => void) => {
          Object.assign(store, items)
          if (cb) cb()
          return Promise.resolve()
        },
        remove: (keys: string | string[], cb?: () => void) => {
          if (typeof keys === "string") delete store[keys]
          else keys.forEach((k) => delete store[k])
          if (cb) cb()
          return Promise.resolve()
        },
        clear: (cb?: () => void) => {
          for (const key of Object.keys(store)) delete store[key]
          if (cb) cb()
          return Promise.resolve()
        }
      }
    },
    action: {
      setBadgeText: () => {},
      setBadgeBackgroundColor: () => {}
    },
    tabs: {
      query: (_query: any, cb: (tabs: any[]) => void) => {
        cb([{ id: 1, url: "https://claude.ai/chat/test-uuid" }])
      },
      sendMessage: (_tabId: number, _msg: any, cb?: (res: any) => void) => {
        if (cb) cb({ success: true })
      }
    }
  }

  ;(globalThis as any).chrome = chromeMock
  return { store }
}
