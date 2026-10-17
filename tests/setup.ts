/**
 * Vitest Global Test Setup
 * Pre-populates globalThis.chrome and DOM APIs before any module is evaluated.
 */

const inMemoryStore: Record<string, any> = {}

export function getMockStore() {
  return inMemoryStore
}

export function resetMockStore() {
  for (const k of Object.keys(inMemoryStore)) {
    delete inMemoryStore[k]
  }
}

const mockStorageArea = {
  get: (keys: any, cb?: (res: any) => void) => {
    let res: Record<string, any> = {}
    if (typeof keys === "string") {
      res[keys] = inMemoryStore[keys]
    } else if (Array.isArray(keys)) {
      keys.forEach((k) => (res[k] = inMemoryStore[k]))
    } else if (!keys) {
      res = { ...inMemoryStore }
    } else if (typeof keys === "object") {
      for (const [k, defaultVal] of Object.entries(keys)) {
        res[k] = inMemoryStore[k] !== undefined ? inMemoryStore[k] : defaultVal
      }
    }
    if (typeof cb === "function") cb(res)
    return Promise.resolve(res)
  },
  set: (items: Record<string, any>, cb?: () => void) => {
    Object.assign(inMemoryStore, items)
    if (typeof cb === "function") cb()
    return Promise.resolve()
  },
  remove: (keys: string | string[], cb?: () => void) => {
    if (typeof keys === "string") delete inMemoryStore[keys]
    else if (Array.isArray(keys)) keys.forEach((k) => delete inMemoryStore[k])
    if (typeof cb === "function") cb()
    return Promise.resolve()
  },
  clear: (cb?: () => void) => {
    resetMockStore()
    if (typeof cb === "function") cb()
    return Promise.resolve()
  }
}

;(globalThis as any).chrome = {
  runtime: {
    id: "mock-context-bridge-id",
    sendMessage: (_msg: any, cb?: (res: any) => void) => {
      if (cb) cb({ success: true })
      return Promise.resolve({ success: true })
    },
    onMessage: {
      addListener: () => {},
      removeListener: () => {}
    },
    lastError: null
  },
  storage: {
    local: mockStorageArea,
    sync: mockStorageArea,
    onChanged: {
      addListener: () => {},
      removeListener: () => {}
    }
  },
  action: {
    setBadgeText: () => {},
    setBadgeBackgroundColor: () => {}
  },
  tabs: {
    query: (_query: any, cb: (tabs: any[]) => void) => {
      cb([{ id: 1, url: "https://claude.ai/chat/mock-uuid" }])
    },
    sendMessage: (_tabId: number, _msg: any, cb?: (res: any) => void) => {
      if (cb) cb({ success: true })
    }
  }
}
