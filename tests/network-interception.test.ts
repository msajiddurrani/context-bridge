import { describe, expect, it } from "vitest"
import {
  parseInterceptedPayload,
  type InterceptedPayloadParseResult
} from "../src/utils/network-interceptor"
import { mergeTurnsForSameChat } from "../src/utils/local-mode"
import type { MessageTurn } from "../src/types"

describe("Passive Network Interception & Full-Conversation Capture", () => {
  // 1. ChatGPT Intercepted Response Parsing
  it("parses ChatGPT internal GET /backend-api/conversation/<id> response into 100% complete turns", () => {
    const chatGptPayload = {
      title: "Building Microservices in Go",
      create_time: 1710000000,
      update_time: 1710000500,
      conversation_id: "c-chatgpt-8899",
      current_node: "node-4",
      mapping: {
        "node-root": {
          id: "node-root",
          parent: null,
          children: ["node-1"],
          message: null
        },
        "node-1": {
          id: "node-1",
          parent: "node-root",
          children: ["node-2"],
          message: {
            id: "msg-user-1",
            author: { role: "user" },
            create_time: 1710000010,
            content: {
              content_type: "text",
              parts: ["How do I design gRPC services in Go?"]
            }
          }
        },
        "node-2": {
          id: "node-2",
          parent: "node-1",
          children: ["node-3"],
          message: {
            id: "msg-asst-1",
            author: { role: "assistant" },
            create_time: 1710000025,
            content: {
              content_type: "text",
              parts: [
                "Here is an example protobuf definition:\n\n```protobuf\nsyntax = \"proto3\";\nservice Greeter {\n  rpc SayHello (HelloRequest) returns (HelloReply);\n}\n```\n\nAnd implement it in Go."
              ]
            }
          }
        },
        "node-3": {
          id: "node-3",
          parent: "node-2",
          children: ["node-4"],
          message: {
            id: "msg-user-2",
            author: { role: "user" },
            create_time: 1710000060,
            content: {
              content_type: "text",
              parts: ["Now add middleware authentication."]
            }
          }
        },
        "node-4": {
          id: "node-4",
          parent: "node-3",
          children: [],
          message: {
            id: "msg-asst-2",
            author: { role: "assistant" },
            create_time: 1710000090,
            content: {
              content_type: "text",
              parts: [
                "You can use unary server interceptors:\n\n```go\nfunc authInterceptor(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {\n  return handler(ctx, req)\n}\n```"
              ]
            }
          }
        }
      }
    }

    const result = parseInterceptedPayload(chatGptPayload, "chatgpt", "c-chatgpt-8899")
    expect(result.success).toBe(true)
    expect(result.platform).toBe("chatgpt")
    expect(result.chatId).toBe("c-chatgpt-8899")
    expect(result.chatTitle).toBe("Building Microservices in Go")
    expect(result.turns).toHaveLength(4)

    // Verify chronological order
    expect(result.turns[0].role).toBe("user")
    expect(result.turns[0].text).toBe("How do I design gRPC services in Go?")
    expect(result.turns[1].role).toBe("assistant")
    expect(result.turns[1].codeBlocks).toHaveLength(1)
    expect(result.turns[1].codeBlocks![0].language).toBe("protobuf")
    expect(result.turns[1].codeBlocks![0].code).toContain("service Greeter")

    expect(result.turns[2].role).toBe("user")
    expect(result.turns[2].text).toBe("Now add middleware authentication.")
    expect(result.turns[3].role).toBe("assistant")
    expect(result.turns[3].codeBlocks).toHaveLength(1)
    expect(result.turns[3].codeBlocks![0].language).toBe("go")

    // Completeness is guaranteed complete
    expect(result.storedContext?.completeness).toBe("complete")
    expect(result.storedContext?.statistics?.messageCount).toBe(4)
    expect(result.storedContext?.statistics?.exchangeCount).toBe(2)
    expect(result.storedContext?.statistics?.codeBlockCount).toBe(2)
  })

  // 2. Claude Intercepted Response Parsing
  it("parses Claude internal GET /api/organizations/.../chat_conversations/<id> into complete turns", () => {
    const claudePayload = {
      uuid: "claude-uuid-7711",
      name: "React 19 Concurrency",
      created_at: "2024-03-10T10:00:00.000Z",
      updated_at: "2024-03-10T10:15:00.000Z",
      chat_messages: [
        {
          uuid: "cmsg-1",
          sender: "human",
          created_at: "2024-03-10T10:00:00.000Z",
          text: "Explain useActionState in React 19"
        },
        {
          uuid: "cmsg-2",
          sender: "assistant",
          created_at: "2024-03-10T10:00:15.000Z",
          text: "useActionState manages asynchronous form actions:\n\n```tsx\nconst [state, formAction, isPending] = useActionState(async (prev, formData) => {\n  return await updateName(formData.get('name'));\n}, null);\n```"
        }
      ]
    }

    const result = parseInterceptedPayload(claudePayload, "claude", "claude-uuid-7711")
    expect(result.success).toBe(true)
    expect(result.platform).toBe("claude")
    expect(result.chatId).toBe("claude-uuid-7711")
    expect(result.chatTitle).toBe("React 19 Concurrency")
    expect(result.turns).toHaveLength(2)

    expect(result.turns[0].role).toBe("user")
    expect(result.turns[0].id).toBe("cmsg-1")
    expect(result.turns[1].role).toBe("assistant")
    expect(result.turns[1].codeBlocks).toHaveLength(1)
    expect(result.turns[1].codeBlocks![0].language).toBe("tsx")
    expect(result.storedContext?.completeness).toBe("complete")
  })

  // 3. Security: Prototype Pollution Rejection
  it("safely rejects payloads containing prototype pollution keys", () => {
    const maliciousPayload = JSON.parse(`{
      "__proto__": { "polluted": "yes" },
      "mapping": {}
    }`)

    const result = parseInterceptedPayload(maliciousPayload, "chatgpt")
    expect(result.success).toBe(false)
    expect(result.error).toContain("prototype pollution")
  })

  // 4. Merging Intercepted History with Live Observed Turns
  it("merges 100 historical turns from intercepted network payload with a new 101st turn observed via DOM", () => {
    const historicalTurns: MessageTurn[] = Array.from({ length: 100 }, (_, i) => ({
      id: `msg-${i + 1}`,
      role: i % 2 === 0 ? "user" : "assistant",
      text: `Historical message ${i + 1}`,
      codeBlocks: [],
      sequence: i + 1,
      chatId: "c-long-chat"
    }))

    // User types turn 101 in the active DOM session
    const incomingDomTurns: MessageTurn[] = [
      historicalTurns[98], // visible turn 99
      historicalTurns[99], // visible turn 100
      {
        id: "msg-101",
        role: "user",
        text: "New live user question 101",
        codeBlocks: [],
        sequence: 101,
        chatId: "c-long-chat"
      }
    ]

    const merged = mergeTurnsForSameChat(historicalTurns, incomingDomTurns)
    expect(merged).toHaveLength(101)
    expect(merged[0].text).toBe("Historical message 1")
    expect(merged[99].text).toBe("Historical message 100")
    expect(merged[100].text).toBe("New live user question 101")
  })

  // 5. Missing / Invalid payloads
  it("gracefully returns failure for empty or unrecognized objects", () => {
    expect(parseInterceptedPayload(null).success).toBe(false)
    expect(parseInterceptedPayload(undefined).success).toBe(false)
    expect(parseInterceptedPayload({ randomKey: 123 }).success).toBe(false)
  })
})
