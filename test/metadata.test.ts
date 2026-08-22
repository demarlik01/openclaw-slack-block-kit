import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, it } from "vitest";
import plugin from "../src/index.js";

describe("tool plugin metadata", () => {
  it("preserves defineToolPlugin metadata after decorating register", () => {
    const metadata = getToolPluginMetadata(plugin);

    expect(metadata).toBeDefined();
    expect(metadata?.id).toBe("slack-block-kit");
    expect(metadata?.tools).toEqual([
      expect.objectContaining({
        name: "slack_send_blocks",
        optional: true,
      }),
    ]);
    expect(metadata?.tools.map((tool) => tool.name)).not.toContain("slack_blocks_send");
    expect(plugin.register).toBeTypeOf("function");
  });
});
