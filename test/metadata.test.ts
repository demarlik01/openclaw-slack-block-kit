import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, it } from "vitest";
import plugin from "../src/index.js";
import {
  SLACK_SEND_BLOCKS_DESCRIPTION,
  SLACK_SEND_BLOCKS_LABEL,
  SLACK_SEND_BLOCKS_NAME,
} from "../src/tool-copy.js";

describe("tool plugin metadata", () => {
  it("preserves defineToolPlugin metadata after decorating register", () => {
    const metadata = getToolPluginMetadata(plugin);

    expect(metadata).toBeDefined();
    expect(metadata?.id).toBe("slack-block-kit");
    expect(metadata?.tools).toEqual([
      expect.objectContaining({
        name: SLACK_SEND_BLOCKS_NAME,
        label: SLACK_SEND_BLOCKS_LABEL,
        description: SLACK_SEND_BLOCKS_DESCRIPTION,
        optional: true,
      }),
    ]);
    expect(metadata?.tools.map((tool) => tool.name)).not.toContain("slack_blocks_send");
    expect(plugin.register).toBeTypeOf("function");
  });
});
