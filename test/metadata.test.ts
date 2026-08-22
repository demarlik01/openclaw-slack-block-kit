import { readFileSync } from "node:fs";
import type {
  OpenClawPluginApi,
  OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { getToolPluginMetadata } from "openclaw/plugin-sdk/tool-plugin";
import { describe, expect, it, vi } from "vitest";
import plugin from "../src/index.js";
import { SlackSendBlocksSchema } from "../src/schema.js";
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
      }),
    ]);
    expect(metadata?.tools[0]).not.toHaveProperty("optional");
    expect(metadata?.tools.map((tool) => tool.name)).not.toContain("slack_blocks_send");
    expect(plugin.register).toBeTypeOf("function");
  });

  it("registers as default-visible and gates the runtime factory to Slack", () => {
    const registerTool = vi.fn();
    const api = {
      registerTool,
      on: vi.fn(),
      lifecycle: { registerRuntimeLifecycle: vi.fn() },
    } as unknown as OpenClawPluginApi;

    plugin.register(api);

    expect(registerTool).toHaveBeenCalledOnce();
    const [factory, options] = registerTool.mock.calls[0] as unknown as [
      (context: OpenClawPluginToolContext) => unknown,
      Record<string, unknown>,
    ];
    expect(options).toEqual({ name: SLACK_SEND_BLOCKS_NAME });
    expect(options).not.toHaveProperty("optional");

    const baseContext = {
      config: {},
      sessionKey: "agent:claw:slack:channel:C123",
      agentId: "claw",
    } as unknown as OpenClawPluginToolContext;
    expect(
      factory({
        ...baseContext,
        messageChannel: "slack",
        deliveryContext: { channel: "telegram", to: "chat:123" },
      }),
    ).toBeNull();

    const messageChannelSlackTool = factory({
      ...baseContext,
      messageChannel: "slack",
    });
    expect(messageChannelSlackTool).toEqual(
      expect.objectContaining({ name: SLACK_SEND_BLOCKS_NAME }),
    );

    const slackTool = factory({
      ...baseContext,
      messageChannel: "slack",
      deliveryContext: { channel: "slack", to: "channel:C123" },
    });
    expect(slackTool).toEqual(
      expect.objectContaining({
        name: SLACK_SEND_BLOCKS_NAME,
        label: SLACK_SEND_BLOCKS_LABEL,
        description: SLACK_SEND_BLOCKS_DESCRIPTION,
        parameters: SlackSendBlocksSchema,
        execute: expect.any(Function),
      }),
    );
    expect((slackTool as { parameters: unknown }).parameters).toBe(SlackSendBlocksSchema);
  });

  it("keeps the generated manifest aligned with required runtime registration", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;

    const metadata = getToolPluginMetadata(plugin);
    expect(metadata).toBeDefined();
    expect(manifest).not.toHaveProperty("toolMetadata");
    expect(manifest).toEqual(
      expect.objectContaining({
        contracts: { tools: metadata?.tools.map((tool) => tool.name) },
      }),
    );
  });
});
