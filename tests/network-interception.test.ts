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

  // 1b. ChatGPT with Object Parts & Nested Data Wrapper
  it("parses ChatGPT payload with multimodal object parts and nested mapping wrapper", () => {
    const wrappedPayload = {
      conversation: {
        id: "chat-gpt-wrapped-1",
        title: "Object Parts Test",
        create_time: 1710000000,
        mapping: {
          "n-1": {
            id: "n-1",
            parent: null,
            children: ["n-2"],
            message: {
              id: "m-1",
              author: { role: "user" },
              create_time: 1710000001,
              content: {
                content_type: "multimodal_text",
                parts: [
                  { type: "text", text: "Look at this architecture." }
                ]
              }
            }
          },
          "n-2": {
            id: "n-2",
            parent: "n-1",
            children: [],
            message: {
              id: "m-2",
              author: { role: "assistant" },
              create_time: 1710000005,
              content: {
                content_type: "text",
                parts: [
                  { text: "Here is the response code:\n\n```python\nprint('hello')\n```" }
                ]
              }
            }
          }
        }
      }
    }

    const result = parseInterceptedPayload(wrappedPayload, "chatgpt", "chat-gpt-wrapped-1")
    expect(result.success).toBe(true)
    expect(result.turns).toHaveLength(2)
    expect(result.turns[0].text).toBe("Look at this architecture.")
    expect(result.turns[1].codeBlocks).toHaveLength(1)
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

  // 2b. Gemini batchexecute RPC parsing
  it("parses Gemini batchexecute RPC payload and extracts turns", () => {
    const rawGeminiRpc = `)]}'\n[["wrb.fr","hPsd8e","[[\\\"rc_user_1\\\",[\\\"Gemini user question\\\"]],[\\\"rc_asst_1\\\",[\\\"Gemini assistant answer with code:\\\\n\\\\n\`\`\`js\\\\nconst x = 10;\\\\n\`\`\`\\\"]]]",null,null,null,"generic"]]`

    const result = parseInterceptedPayload({ rawRpcText: rawGeminiRpc }, "gemini", "gemini-chat-456")
    expect(result.success).toBe(true)
    expect(result.platform).toBe("gemini")
    expect(result.turns.length).toBeGreaterThan(0)
    expect(result.storedContext?.completeness).toBe("complete")
  })

  // 2c. Gemini batchexecute RPC parsing with chunk byte length numbers (live Google format)
  it("parses chunked Gemini batchexecute RPC payload with byte-length line prefixes", () => {
    const rawChunkedGeminiRpc = `)]}'\n\n142\n[["wrb.fr","hPsd8e","[[\\\"rc_u1\\\",[\\\"How do WebSockets work?\\\"]],[\\\"rc_a1\\\",[\\\"WebSockets provide a full-duplex communication channel.\\\"]]]",null,null,null,"generic"]]\n38\n[["di",12345]]`

    const result = parseInterceptedPayload({ rawRpcText: rawChunkedGeminiRpc }, "gemini", "gemini-chat-chunked")
    expect(result.success).toBe(true)
    expect(result.platform).toBe("gemini")
    expect(result.turns).toHaveLength(2)
    expect(result.turns[0].text).toBe("How do WebSockets work?")
    expect(result.turns[1].text).toContain("full-duplex")
  })

  // 2d. ChatGPT Next.js RSC Flight Streaming Hydration Extraction
  it("parses Next.js RSC Flight streaming chunk containing ChatGPT conversation on initial reload", () => {
    const rscChunk = `14:["$","$L15",null,{"conversation":{"id":"c-rsc-reload-99","title":"Next.js SSR Reload Test","create_time":1710000000,"mapping":{"node-1":{"id":"node-1","message":{"id":"msg-u1","author":{"role":"user"},"content":{"parts":["Explain Next.js RSC Hydration"]}}},"node-2":{"id":"node-2","message":{"id":"msg-a1","author":{"role":"assistant"},"content":{"parts":["Next.js App Router serializes server data into self.__next_f chunks."]}}}},"current_node":"node-2"}}]\n`

    const result = parseInterceptedPayload({ rawRscText: rscChunk }, "chatgpt", "c-rsc-reload-99")
    expect(result.success).toBe(true)
    expect(result.platform).toBe("chatgpt")
    expect(result.chatId).toBe("c-rsc-reload-99")
    expect(result.turns).toHaveLength(2)
    expect(result.turns[0].text).toBe("Explain Next.js RSC Hydration")
    expect(result.turns[1].text).toContain("App Router serializes")
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

  // 4b. ChatGPT in-memory React Fiber / TanStack Query cache extraction (without explicit conversation_id in mapping)
  it("parses ChatGPT mapping extracted from React Fiber cache using hintChatId", () => {
    const fiberMappingPayload = {
      mapping: {
        "turn-node-1": {
          id: "turn-node-1",
          message: {
            id: "msg-fiber-1",
            author: { role: "user" },
            content: { parts: ["What is the difference between RSC and SSR?"] },
            create_time: 1710000000
          }
        },
        "turn-node-2": {
          id: "turn-node-2",
          parent: "turn-node-1",
          message: {
            id: "msg-fiber-2",
            author: { role: "assistant" },
            content: { parts: ["RSC components execute strictly on the server and do not bundle into client JS."] },
            create_time: 1710000010
          }
        }
      },
      current_node: "turn-node-2"
    }

    const result = parseInterceptedPayload(fiberMappingPayload, "chatgpt", "6ad52b1c-chat-react-fiber")
    expect(result.success).toBe(true)
    expect(result.platform).toBe("chatgpt")
    expect(result.chatId).toBe("6ad52b1c-chat-react-fiber")
    expect(result.turns).toHaveLength(2)
    expect(result.turns[0].text).toBe("What is the difference between RSC and SSR?")
    expect(result.turns[1].text).toContain("strictly on the server")
  })

  // 4c. Claude wrapped conversation responses (data.chat_messages or conversation.chat_messages)
  it("parses Claude response wrapped in conversation object", () => {
    const wrappedClaudePayload = {
      conversation: {
        uuid: "claude-wrapped-uuid-88",
        name: "Wrapped Claude Session",
        chat_messages: [
          {
            uuid: "cmsg-w-1",
            sender: "human",
            text: "Hello Claude from wrapped structure"
          },
          {
            uuid: "cmsg-w-2",
            sender: "assistant",
            text: "Hello! Ready to assist."
          }
        ]
      }
    }

    const result = parseInterceptedPayload(wrappedClaudePayload, "claude", "claude-wrapped-uuid-88")
    expect(result.success).toBe(true)
    expect(result.platform).toBe("claude")
    expect(result.chatId).toBe("claude-wrapped-uuid-88")
    expect(result.turns).toHaveLength(2)
    expect(result.turns[0].text).toBe("Hello Claude from wrapped structure")
  })

  // 5. Missing / Invalid payloads
  it("gracefully returns failure for empty or unrecognized objects", () => {
    expect(parseInterceptedPayload(null).success).toBe(false)
    expect(parseInterceptedPayload(undefined).success).toBe(false)
    expect(parseInterceptedPayload({ randomKey: 123 }).success).toBe(false)
  })
})
