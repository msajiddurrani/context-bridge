import type { PlatformId, StoredContext } from "../types"

/**
 * Checks whether a chatId represents a new, uninitialized, or generic conversation.
 */
export function isGenericOrNewChatId(chatId: string): boolean {
  if (!chatId) return true
  const clean = chatId.trim().toLowerCase()
  return (
    clean === "" ||
    clean === "new" ||
    clean === "/" ||
    clean === "default" ||
    clean.startsWith("default-") ||
    clean.startsWith("session-") ||
    clean.endsWith("-session") ||
    clean === "chatgpt-session" ||
    clean === "claude-session"
  )
}

/**
 * Filters and sorts stored contexts for the UI injection panel.
 * Invariants:
 * 1. Any-to-Any: Contexts from a different platform must ALWAYS be shown (e.g. ChatGPT on Claude and Claude on ChatGPT).
 * 2. New / Empty Chats: When on /new or an empty chat, do NOT hide or filter out any saved contexts.
 * 3. Loop Prevention: Only exclude a context if it is from the EXACT same platform AND the exact same chatId.
 * 4. Sorted by updatedAt descending (most recent first).
 */
export function filterEligibleContexts(
  contexts: StoredContext[],
  currentPlatform: PlatformId,
  currentChatId: string,
  isNewChat: boolean
): StoredContext[] {
  const isCurrentNew = isNewChat || isGenericOrNewChatId(currentChatId)

  return contexts
    .filter((c) => {
      // 1. A context from a different platform is ALWAYS eligible (ChatGPT <-> Claude etc.)
      if (c.sourcePlatform !== currentPlatform) {
        return true
      }

      // 2. On a new or empty chat, show all contexts (never hide past sessions on /new)
      if (isCurrentNew) {
        return true
      }

      // 3. Loop prevention on an active existing chat: exclude only if exact same chatId
      const isSameChat = c.chatId === currentChatId
      return !isSameChat
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
