import { describe, expect, it } from "vitest";
import { validateSlackBlocks } from "../src/validator.js";

describe("validateSlackBlocks", () => {
  it("accepts a section with fields and actions", () => {
    const result = validateSlackBlocks([
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: "*Status*\nReady" },
          { type: "mrkdwn", text: "*Owner*\nClaw" },
        ],
      },
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: "Open" }, action_id: "open" },
        ],
      },
    ]);

    expect(result.ok).toBe(true);
  });

  it("rejects duplicate action ids", () => {
    const result = validateSlackBlocks([
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: "A" }, action_id: "same" },
          { type: "button", text: { type: "plain_text", text: "B" }, action_id: "same" },
        ],
      },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: "blocks[0].elements[1].action_id",
        message: "must be unique within a message",
      });
    }
  });

  it("rejects unsupported block types", () => {
    const result = validateSlackBlocks([{ type: "future_block" }]);
    expect(result.ok).toBe(false);
  });

  it("rejects excessive nesting", () => {
    let nested: Record<string, unknown> = { type: "button", action_id: "deep" };
    for (let index = 0; index < 25; index += 1) {
      nested = { child: nested };
    }

    const result = validateSlackBlocks([{ type: "section", text: { type: "mrkdwn", text: "x" }, accessory: nested }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes("nesting depth"))).toBe(true);
    }
  });
});
