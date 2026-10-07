import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractChatReply } from "./chatService.js";
import type { RunRecord } from "../types.js";

describe("extractChatReply", () => {
  it("prefers chat.reply over llm summary", () => {
    const run = {
      artifacts: {
        nodeOutputs: [
          { nodeId: "llm_1", nodeType: "llm", summary: "raw model", result: { summary: "raw model" } },
          { nodeId: "reply", nodeType: "chat.reply", result: { reply: "Hello from flow" } },
        ],
      },
    } as unknown as RunRecord;
    assert.equal(extractChatReply(run), "Hello from flow");
  });
});
