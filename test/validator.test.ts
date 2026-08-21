import { describe, expect, it } from "vitest";
import {
  MAX_BLOCKS_PER_MESSAGE,
  MAX_SERIALIZED_BLOCK_BYTES,
  validateSlackMessages,
} from "../src/validator.js";

describe("validateSlackMessages", () => {
  it("rejects a missing or malformed message collection without throwing", () => {
    for (const value of [undefined, null, "messages", {}, 1]) {
      const result = validateSlackMessages(value);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues).toContainEqual({
          path: "messages",
          message: "must be an array",
        });
      }
    }
  });

  it("rejects non-object messages and unsupported envelope fields", () => {
    const result = validateSlackMessages([
      null,
      "message",
      { text: "Ready", blocks: [{ type: "divider" }], fallbackText: "legacy" },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          { path: "messages[0]", message: "must be an object" },
          { path: "messages[1]", message: "must be an object" },
          { path: "messages[2].fallbackText", message: "is not supported" },
        ]),
      );
    }
  });

  it("accepts display-only blocks and passes unknown future blocks with a warning", () => {
    const result = validateSlackMessages([
      {
        text: "Candidates",
        blocks: [
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: "*Status*\nReady" },
              { type: "mrkdwn", text: "*Owner*\nClaw" },
            ],
            accessory: {
              type: "image",
              image_url: "https://example.com/item.png",
              alt_text: "Item",
            },
          },
          { type: "future_display_block", value: 1 },
        ],
      },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toContainEqual({
        path: "messages[0].blocks[1].type",
        message: "unknown block type future_display_block will be passed through to Slack",
      });
    }
  });

  it("rejects interactive blocks and elements in display-only v1", () => {
    const result = validateSlackMessages([
      {
        text: "Approve",
        blocks: [
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Approve" },
                action_id: "approve",
              },
            ],
          },
        ],
      },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.path.endsWith("action_id"))).toBe(true);
      expect(result.issues.some((issue) => issue.path.endsWith("blocks[0].type"))).toBe(true);
    }
  });

  it("rejects duplicate block ids", () => {
    const result = validateSlackMessages([
      {
        text: "Duplicate",
        blocks: [
          { type: "divider", block_id: "same" },
          { type: "divider", block_id: "same" },
        ],
      },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: "messages[0].blocks[1].block_id",
        message: "must be unique within a message",
      });
    }
  });

  it("rejects excessive nesting", () => {
    let nested: Record<string, unknown> = { value: "leaf" };
    for (let index = 0; index < 25; index += 1) {
      nested = { child: nested };
    }

    const result = validateSlackMessages([
      {
        text: "Deep",
        blocks: [{ type: "future_display_block", nested }],
      },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes("nesting depth"))).toBe(true);
    }
  });

  it("requires https for URL-bearing fields", () => {
    const result = validateSlackMessages([
      {
        text: "Image",
        blocks: [
          {
            type: "image",
            image_url: "http://example.com/image.png",
            alt_text: "Image",
          },
        ],
      },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: "messages[0].blocks[0].image_url",
        message: "must use https",
      });
    }
  });

  it("rejects non-string URL-bearing fields", () => {
    const result = validateSlackMessages([
      {
        text: "Image",
        blocks: [
          {
            type: "image",
            image_url: 123,
            alt_text: "Image",
          },
        ],
      },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toContainEqual({
        path: "messages[0].blocks[0].image_url",
        message: "must be a non-empty https URL string",
      });
    }
  });

  it("rejects null, collection, blank, and nested non-string URL-bearing fields", () => {
    const invalidValues = [null, [], {}, "   "];

    for (const [index, invalidValue] of invalidValues.entries()) {
      const result = validateSlackMessages([
        {
          text: "Image",
          blocks: [
            {
              type: "future_display_block",
              nested: { image_url: invalidValue },
            },
          ],
        },
      ]);

      expect(result.ok, `invalid value at index ${index}`).toBe(false);
      if (!result.ok) {
        expect(result.issues).toContainEqual({
          path: "messages[0].blocks[0].nested.image_url",
          message: "must be a non-empty https URL string",
        });
      }
    }
  });

  it("rejects more than 50 blocks", () => {
    const result = validateSlackMessages([
      {
        text: "Too many",
        blocks: Array.from({ length: MAX_BLOCKS_PER_MESSAGE + 1 }, () => ({ type: "divider" })),
      },
    ]);

    expect(result.ok).toBe(false);
  });

  it("rejects oversized serialized block payloads", () => {
    const result = validateSlackMessages([
      {
        text: "Large",
        blocks: [{ type: "future_display_block", data: "x".repeat(MAX_SERIALIZED_BLOCK_BYTES) }],
      },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes("serialized blocks"))).toBe(true);
    }
  });
});
