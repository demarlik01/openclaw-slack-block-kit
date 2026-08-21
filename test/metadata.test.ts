import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, it } from "vitest";
import plugin from "../src/index.js";

describe("tool plugin metadata", () => {
  it("declares the optional slack_blocks_send tool", () => {
    const metadata = getToolPluginMetadata(plugin);

    expect(metadata).toBeDefined();
    expect(metadata?.tools).toEqual([
      expect.objectContaining({
        name: "slack_blocks_send",
        optional: true,
      }),
    ]);
  });
});
