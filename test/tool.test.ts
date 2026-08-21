import type {
  OpenClawPluginApi,
  OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { describe, expect, it, vi } from "vitest";
import { createSlackBlocksSendTool } from "../src/tool.js";

function createApi() {
  return {
    runtime: {
      config: { current: () => ({}) },
    },
  } as unknown as OpenClawPluginApi;
}

function createContext(
  overrides: Partial<OpenClawPluginToolContext> = {},
): OpenClawPluginToolContext {
  return {
    config: {},
    sessionKey: "agent:claw:slack:channel:C123",
    agentId: "claw",
    requesterSenderId: "UOWNER",
    deliveryContext: {
      channel: "slack",
      to: "channel:C123",
      accountId: "work",
      threadId: "123.456",
    },
    ...overrides,
  };
}

const messages = [
  {
    text: "Ready",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Ready*" },
        accessory: {
          type: "image",
          image_url: "https://example.com/ready.png",
          alt_text: "Ready",
        },
      },
    ],
  },
];

describe("slack_blocks_send", () => {
  it("inherits the current Slack route and uses durable batch delivery", async () => {
    const platformResult = {
      channel: "slack",
      messageId: "1.23",
      channelId: "C123",
    };
    const sendBatch = vi.fn(async () => ({
      status: "sent",
      results: [platformResult],
      receipt: { id: "receipt-1", parts: [] },
      payloadOutcomes: [{ index: 0, status: "sent", results: [platformResult] }],
    }));
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-1", { messages });

    expect(sendBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "slack",
        to: "channel:C123",
        accountId: "work",
        threadId: "123.456",
        durability: "required",
        payloads: [
          {
            text: "Ready",
            channelData: { slack: { blocks: messages[0].blocks } },
          },
        ],
        session: expect.objectContaining({
          key: "agent:claw:slack:channel:C123",
          agentId: "claw",
          requesterSenderId: "UOWNER",
        }),
      }),
    );
    expect(result.terminate).toBe(true);
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: true,
        status: "sent",
        complete: true,
        sent: [{ index: 0, messageId: "1.23", channelId: "C123" }],
      }),
    );
  });

  it("does not send in validate-only mode", async () => {
    const sendBatch = vi.fn();
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-2", { messages, validateOnly: true });

    expect(sendBatch).not.toHaveBeenCalled();
    expect(result.terminate).toBe(false);
    expect(result.details).toEqual(
      expect.objectContaining({ ok: true, status: "validated", messageCount: 1 }),
    );
  });

  it("rejects a missing current Slack route", async () => {
    const sendBatch = vi.fn();
    const tool = createSlackBlocksSendTool(
      createApi(),
      createContext({ deliveryContext: { channel: "telegram", to: "chat:123" } }),
      sendBatch as never,
    );

    const result = await tool.execute("call-3", { messages });

    expect(sendBatch).not.toHaveBeenCalled();
    expect(result.terminate).toBe(false);
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_ROUTE" }),
      }),
    );
  });

  it("prevalidates the full batch before sending", async () => {
    const sendBatch = vi.fn();
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-4", {
      messages: [
        ...messages,
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
      ],
    });

    expect(sendBatch).not.toHaveBeenCalled();
    expect(result.terminate).toBe(false);
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({ code: "INVALID_BLOCK_KIT" }),
      }),
    );
  });

  it("returns successful indices without terminating on partial failure", async () => {
    const platformResult = {
      channel: "slack",
      messageId: "1.23",
      channelId: "C123",
    };
    const slackError = Object.assign(new Error("request failed"), {
      statusCode: 429,
      headers: { "retry-after": "12" },
    });
    const error = new Error("Outbound delivery failed", { cause: slackError });
    const sendBatch = vi.fn(async () => ({
      status: "partial_failed",
      results: [platformResult],
      receipt: { id: "receipt-2", parts: [] },
      error,
      sentBeforeError: true,
      payloadOutcomes: [
        { index: 0, status: "sent", results: [platformResult] },
        {
          index: 1,
          status: "failed",
          error,
          sentBeforeError: true,
          stage: "platform_send",
        },
      ],
    }));
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-5", { messages: [...messages, ...messages] });

    expect(result.terminate).toBe(false);
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: false,
        status: "partial_failed",
        sent: [{ index: 0, messageId: "1.23", channelId: "C123" }],
        failed: [
          expect.objectContaining({
            index: 1,
            stage: "platform_send",
            error: {
              code: "SLACK_RATE_LIMITED",
              message: "Slack rate limit exceeded",
              retryAfter: 12,
            },
          }),
        ],
      }),
    );
  });

  it("does not terminate when a hook suppresses a payload", async () => {
    const sendBatch = vi.fn(async () => ({
      status: "suppressed",
      results: [],
      receipt: { id: "receipt-3", parts: [] },
      reason: "cancelled_by_message_sending_hook",
      payloadOutcomes: [
        {
          index: 0,
          status: "suppressed",
          reason: "cancelled_by_message_sending_hook",
        },
      ],
    }));
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-6", { messages });

    expect(result.terminate).toBe(false);
    expect(result.details).toEqual(
      expect.objectContaining({ ok: false, status: "suppressed" }),
    );
  });

  it("reports mixed sent and suppressed payloads without exposing hook diagnostics", async () => {
    const platformResult = {
      channel: "slack",
      messageId: "1.23",
      channelId: "C123",
    };
    const fakeCredential = ["xoxb", "hook", "private"].join("-");
    const sendBatch = vi.fn(async () => ({
      status: "sent",
      results: [platformResult],
      receipt: { id: "receipt-mixed", parts: [] },
      payloadOutcomes: [
        { index: 0, status: "sent", results: [platformResult] },
        {
          index: 1,
          status: "suppressed",
          reason: "cancelled_by_message_sending_hook",
          hookEffect: { cancelReason: `diagnostic ${fakeCredential}` },
        },
      ],
    }));
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-mixed", { messages: [...messages, ...messages] });
    const serialized = JSON.stringify(result.details);

    expect(result.terminate).toBe(false);
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: false,
        status: "partial_suppressed",
        complete: false,
        sent: [{ index: 0, messageId: "1.23", channelId: "C123" }],
        suppressed: [{ index: 1, reason: "cancelled_by_message_sending_hook" }],
      }),
    );
    expect(serialized).not.toContain(fakeCredential);
    expect(serialized).not.toContain("diagnostic");
  });

  it("redacts token-like values from thrown delivery errors", async () => {
    const fakeCredential = ["xoxb", "test", "placeholder"].join("-");
    const fakeAssignment = ["token", "private-value"].join("=");
    const sendBatch = vi.fn(async () => {
      throw new Error(`Slack failed with ${fakeCredential} ${fakeAssignment}`);
    });
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-7", { messages });
    const serialized = JSON.stringify(result.details);

    expect(result.terminate).toBe(false);
    expect(serialized).not.toContain(fakeCredential);
    expect(serialized).not.toContain("private-value");
    expect(serialized).toContain("[REDACTED]");
  });

  it("maps a durable failed outcome without terminating", async () => {
    const deliveryError = {
      message: "Slack rejected blocks",
      data: { error: "invalid_blocks" },
    };
    const sendBatch = vi.fn(async () => ({
      status: "failed",
      stage: "platform_send",
      error: deliveryError,
      payloadOutcomes: [
        {
          index: 0,
          status: "failed",
          error: deliveryError,
          sentBeforeError: false,
          stage: "platform_send",
        },
      ],
    }));
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-8", { messages });

    expect(result.terminate).toBe(false);
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: false,
        status: "failed",
        stage: "platform_send",
        error: { code: "SLACK_API_ERROR", message: "invalid_blocks" },
      }),
    );
  });
});
