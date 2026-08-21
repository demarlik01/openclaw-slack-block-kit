import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { createSlackBlockSendTool } from "../src/tool.js";

function createApi(sendPayload = vi.fn()) {
  return {
    runtime: {
      config: { current: () => ({}) },
      channel: {
        outbound: {
          loadAdapter: vi.fn(async () => ({ sendPayload })),
        },
      },
    },
  } as unknown as OpenClawPluginApi;
}

describe("slack_block_send", () => {
  it("sends raw blocks through the Slack outbound adapter", async () => {
    const sendPayload = vi.fn(async () => ({
      channel: "slack",
      messageId: "1.23",
      channelId: "C123",
    }));
    const api = createApi(sendPayload);
    const tool = createSlackBlockSendTool(api, {
      config: {},
      agentAccountId: "work",
      messageChannel: "slack",
    });
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: "*Ready*" } }];

    await tool.execute("call-1", {
      target: "channel:C123",
      text: "Ready",
      blocks,
      threadTs: "123.456",
    });

    expect(sendPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "channel:C123",
        text: "Ready",
        accountId: "work",
        threadId: "123.456",
        payload: {
          text: "Ready",
          channelData: { slack: { blocks } },
        },
      }),
    );
  });

  it("does not send in validate-only mode", async () => {
    const sendPayload = vi.fn();
    const tool = createSlackBlockSendTool(createApi(sendPayload), { config: {} });

    await tool.execute("call-2", {
      target: "channel:C123",
      text: "Ready",
      blocks: [{ type: "divider" }],
      validateOnly: true,
    });

    expect(sendPayload).not.toHaveBeenCalled();
  });

  it("normalizes Slack rate-limit errors", async () => {
    const error = Object.assign(new Error("request failed"), {
      statusCode: 429,
      headers: { "retry-after": "12" },
    });
    const sendPayload = vi.fn(async () => {
      throw error;
    });
    const tool = createSlackBlockSendTool(createApi(sendPayload), { config: {} });

    const result = await tool.execute("call-3", {
      target: "channel:C123",
      text: "Ready",
      blocks: [{ type: "divider" }],
    });

    expect(result.details).toEqual({
      ok: false,
      error: {
        code: "SLACK_RATE_LIMITED",
        message: "Slack rate limit exceeded",
        retryAfter: 12,
      },
    });
  });

  it("returns a structured error when the Slack adapter is unavailable", async () => {
    const api = {
      runtime: {
        config: { current: () => ({}) },
        channel: { outbound: { loadAdapter: vi.fn(async () => undefined) } },
      },
    } as unknown as OpenClawPluginApi;
    const tool = createSlackBlockSendTool(api, { config: {} });

    const result = await tool.execute("call-4", {
      target: "channel:C123",
      text: "Ready",
      blocks: [{ type: "divider" }],
    });

    expect(result.details).toEqual({
      ok: false,
      error: {
        code: "SLACK_NOT_CONFIGURED",
        message: "Slack outbound adapter is unavailable",
      },
    });
  });
});
