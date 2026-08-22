import { describe, expect, it } from "vitest";
import { SlackSendBlocksSchema } from "../src/schema.js";
import { SLACK_BLOCK_KIT_REFERENCE_URL } from "../src/tool-copy.js";

describe("model-facing schema copy", () => {
  it("describes every public input field and links the official block reference", () => {
    const schema = SlackSendBlocksSchema as unknown as {
      properties: {
        messages: {
          description?: string;
          items: {
            properties: {
              text: { description?: string };
              blocks: { description?: string };
            };
          };
        };
        validateOnly: { description?: string };
      };
    };
    const messages = schema.properties.messages;
    const message = messages.items;

    expect(messages.description).toBeTruthy();
    expect(message.properties.text.description).toBeTruthy();
    expect(message.properties.blocks.description).toContain(SLACK_BLOCK_KIT_REFERENCE_URL);
    expect(schema.properties.validateOnly.description).toBeTruthy();
  });
});
