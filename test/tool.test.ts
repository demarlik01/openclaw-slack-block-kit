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
  it.each([
    ["missing input", undefined],
    ["null input", null],
    ["array input", []],
    ["missing messages", {}],
    ["non-array messages", { messages: "Ready" }],
    ["non-boolean validateOnly", { messages, validateOnly: "yes" }],
    ["null message", { messages: [null] }],
    ["primitive message", { messages: ["Ready"] }],
    ["empty message", { messages: [{}] }],
    ["missing blocks", { messages: [{ text: "Ready" }] }],
    ["primitive block", { messages: [{ text: "Ready", blocks: [null] }] }],
    ["empty batch", { messages: [] }],
    ["oversized batch", { messages: Array.from({ length: 11 }, () => messages[0]) }],
    [
      "oversized block batch",
      {
        messages: [
          {
            text: "Ready",
            blocks: Array.from({ length: 51 }, () => ({ type: "divider" })),
          },
        ],
      },
    ],
  ])("returns INVALID_ARGUMENT for %s without sending", async (_label, rawInput) => {
    const sendBatch = vi.fn();
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-invalid-input", rawInput);

    expect(sendBatch).not.toHaveBeenCalled();
    expect(result.terminate).toBe(false);
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: false,
        status: "failed",
        error: expect.objectContaining({ code: "INVALID_ARGUMENT" }),
      }),
    );
  });

  it("returns actionable issues for the malformed live flattened shape", async () => {
    const sendBatch = vi.fn();
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-flat-live-shape", {
      fallbackText: "Ready",
      blocks: [{ type: "divider" }],
      validateOnly: false,
    });

    expect(sendBatch).not.toHaveBeenCalled();
    expect(result.details).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({
          code: "INVALID_ARGUMENT",
          issues: expect.arrayContaining([
            { path: "messages", message: "is required" },
            { path: "fallbackText", message: "is not supported" },
            { path: "blocks", message: "is not supported" },
          ]),
        }),
      }),
    );
  });

  it("caps schema validation issues before returning them", async () => {
    const sendBatch = vi.fn();
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);
    const rawInput = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`unexpected${index}`, index]),
    );

    const result = await tool.execute("call-many-schema-issues", rawInput);
    const details = result.details as {
      error: { code: string; issues: unknown[] };
    };

    expect(sendBatch).not.toHaveBeenCalled();
    expect(details.error.code).toBe("INVALID_ARGUMENT");
    expect(details.error.issues).toHaveLength(50);
  });

  it("returns INVALID_BLOCK_KIT for a JSON-unsafe block value without sending", async () => {
    const sendBatch = vi.fn();
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-json-unsafe", {
      messages: [
        {
          text: "Ready",
          blocks: [{ type: "future_display_block", value: 1n }],
        },
      ],
    });

    expect(sendBatch).not.toHaveBeenCalled();
    expect(result.terminate).toBe(false);
    expect(result.details).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "INVALID_BLOCK_KIT" }),
      }),
    );
  });

  it("returns INVALID_BLOCK_KIT for a circular block without sending", async () => {
    const sendBatch = vi.fn();
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);
    const circularBlock: Record<string, unknown> = { type: "future_display_block" };
    circularBlock.self = circularBlock;

    const result = await tool.execute("call-circular-block", {
      messages: [{ text: "Ready", blocks: [circularBlock] }],
    });

    expect(sendBatch).not.toHaveBeenCalled();
    expect(result.terminate).toBe(false);
    expect(result.details).toEqual(
      expect.objectContaining({
        error: expect.objectContaining({ code: "INVALID_BLOCK_KIT" }),
      }),
    );
  });

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
    expect(result.terminate).toBe(false);
    expect(result.details).toEqual(
      expect.objectContaining({
        ok: true,
        status: "sent",
        complete: true,
        sent: [{ index: 0, messageId: "1.23", channelId: "C123" }],
        nextAction: expect.objectContaining({
          type: "silent_final",
          token: "NO_REPLY",
        }),
      }),
    );
  });

  it("treats an empty payloadOutcomes array as the legacy flat-results shape", async () => {
    const platformResult = {
      channel: "slack",
      messageId: "1.24",
      channelId: "C123",
    };
    const sendBatch = vi.fn(async () => ({
      status: "sent",
      results: [platformResult],
      receipt: { id: "receipt-empty-outcomes", parts: [] },
      payloadOutcomes: [],
    }));
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-empty-outcomes", { messages });

    expect(result.details).toEqual(
      expect.objectContaining({
        ok: true,
        status: "sent",
        complete: true,
        sent: [{ index: 0, messageId: "1.24", channelId: "C123" }],
        nextAction: expect.objectContaining({ token: "NO_REPLY" }),
      }),
    );
  });

  it("does not request a silent final when a sent outcome is incomplete", async () => {
    const sendBatch = vi.fn(async () => ({
      status: "sent",
      results: [],
      receipt: { id: "receipt-incomplete", parts: [] },
      payloadOutcomes: [],
    }));
    const tool = createSlackBlocksSendTool(createApi(), createContext(), sendBatch as never);

    const result = await tool.execute("call-incomplete", { messages });

    expect(result.details).toEqual(
      expect.objectContaining({
        ok: false,
        status: "incomplete_sent",
        complete: false,
      }),
    );
    expect(result.details).not.toHaveProperty("nextAction");
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
