import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { describe, expect, it, vi } from "vitest";
import {
  CompletedRunStore,
  MAX_TOOL_CALLS_PER_RUN,
  isCompletedSlackSendBlocksResult,
  isSuppressiblePlainTextFinal,
  registerCompletionHooks,
} from "../src/completion.js";

type HookHandler = (...args: any[]) => any;

function createHookApi() {
  const handlers = new Map<string, HookHandler>();
  const hookOptions = new Map<string, { priority?: number; timeoutMs?: number } | undefined>();
  let lifecycleCleanup:
    | ((context: { runId?: string; sessionKey?: string }) => void | Promise<void>)
    | undefined;

  const api = {
    on: vi.fn((
      name: string,
      handler: HookHandler,
      options?: { priority?: number; timeoutMs?: number },
    ) => {
      handlers.set(name, handler);
      hookOptions.set(name, options);
    }),
    lifecycle: {
      registerRuntimeLifecycle: vi.fn(
        (registration: {
          cleanup?: (context: { runId?: string; sessionKey?: string }) => void | Promise<void>;
        }) => {
          lifecycleCleanup = registration.cleanup;
        },
      ),
    },
  } as unknown as OpenClawPluginApi;

  const handler = (name: string) => {
    const registered = handlers.get(name);
    if (!registered) {
      throw new Error(`missing hook ${name}`);
    }
    return registered;
  };

  return {
    api,
    handler,
    hookOptions,
    lifecycleCleanup: () => lifecycleCleanup,
  };
}

const sentToolResult = {
  content: [{ type: "text", text: "sent" }],
  details: {
    ok: true,
    status: "sent",
    complete: true,
  },
  terminate: false,
};

describe("Block Kit completion hooks", () => {
  it("marks an exclusive completed send and suppresses every plain final payload for the exact run", () => {
    const fixture = createHookApi();
    const store = registerCompletionHooks(fixture.api);

    fixture.handler("after_tool_call")(
      {
        toolName: "slack_send_blocks",
        runId: "run-1",
        toolCallId: "call-1",
        result: sentToolResult,
      },
      {
        toolName: "slack_send_blocks",
        runId: "run-1",
        sessionKey: "session-1",
        toolCallId: "call-1",
      },
    );

    const replyHook = fixture.handler("reply_payload_sending");
    const event = {
      kind: "final",
      runId: "run-1",
      sessionKey: "session-1",
      payload: {
        text: "duplicate",
        replyToTag: false,
        audioAsVoice: false,
      },
    };
    const context = {
      channelId: "slack",
      runId: "run-1",
      sessionKey: "session-1",
    };

    expect(replyHook(event, context)).toEqual(
      expect.objectContaining({ cancel: true }),
    );
    expect(replyHook(event, context)).toEqual(
      expect.objectContaining({ cancel: true }),
    );
    expect(store.size).toBe(1);
    expect(fixture.hookOptions.get("reply_payload_sending")).toEqual({
      priority: -1_000,
    });
  });

  it("never falls back to session correlation or suppresses non-final payloads", () => {
    const fixture = createHookApi();
    registerCompletionHooks(fixture.api);

    fixture.handler("after_tool_call")(
      {
        toolName: "slack_send_blocks",
        runId: "run-1",
        result: sentToolResult,
      },
      {
        toolName: "slack_send_blocks",
        runId: "run-1",
        sessionKey: "shared-session",
      },
    );

    const replyHook = fixture.handler("reply_payload_sending");
    expect(
      replyHook(
        {
          kind: "final",
          sessionKey: "shared-session",
          payload: { text: "no run id" },
        },
        { channelId: "slack", sessionKey: "shared-session" },
      ),
    ).toBeUndefined();
    expect(
      replyHook(
        {
          kind: "final",
          channel: "telegram",
          runId: "run-1",
          sessionKey: "shared-session",
          payload: { text: "cross-channel final" },
        },
        {
          channelId: "telegram",
          runId: "run-1",
          sessionKey: "shared-session",
        },
      ),
    ).toBeUndefined();
    expect(
      replyHook(
        {
          kind: "final",
          channel: "slack",
          runId: "run-1",
          sessionKey: "shared-session",
          payload: { text: "channel mismatch" },
        },
        {
          channelId: "telegram",
          runId: "run-1",
          sessionKey: "shared-session",
        },
      ),
    ).toBeUndefined();
    expect(
      replyHook(
        { kind: "final", runId: "run-2", payload: { text: "other run" } },
        { channelId: "slack", runId: "run-2", sessionKey: "shared-session" },
      ),
    ).toBeUndefined();
    expect(
      replyHook(
        { kind: "tool", runId: "run-1", payload: { text: "tool result" } },
        { channelId: "slack", runId: "run-1", sessionKey: "shared-session" },
      ),
    ).toBeUndefined();
    expect(
      replyHook(
        {
          kind: "final",
          runId: "run-1",
          sessionKey: "different-session",
          payload: { text: "session mismatch" },
        },
        { channelId: "slack", runId: "run-1", sessionKey: "shared-session" },
      ),
    ).toBeUndefined();
  });

  it("does not accept the pre-release tool name as completion evidence", () => {
    const fixture = createHookApi();
    const store = registerCompletionHooks(fixture.api);

    fixture.handler("after_tool_call")(
      {
        toolName: "slack_blocks_send",
        runId: "run-legacy-name",
        result: sentToolResult,
      },
      {
        toolName: "slack_blocks_send",
        runId: "run-legacy-name",
        sessionKey: "session-1",
      },
    );

    expect(store.matches({ runId: "run-legacy-name", sessionKey: "session-1" })).toBe(false);
    expect(
      fixture.handler("reply_payload_sending")(
        {
          kind: "final",
          runId: "run-legacy-name",
          sessionKey: "session-1",
          payload: { text: "must remain visible" },
        },
        { channelId: "slack", runId: "run-legacy-name", sessionKey: "session-1" },
      ),
    ).toBeUndefined();
  });

  it("never suppresses an error final after a completed send", () => {
    const fixture = createHookApi();
    registerCompletionHooks(fixture.api);

    fixture.handler("after_tool_call")(
      {
        toolName: "slack_send_blocks",
        runId: "run-1",
        result: sentToolResult,
      },
      {
        toolName: "slack_send_blocks",
        runId: "run-1",
        sessionKey: "session-1",
      },
    );

    expect(
      fixture.handler("reply_payload_sending")(
        {
          kind: "final",
          runId: "run-1",
          sessionKey: "session-1",
          payload: { text: "provider failure", isError: true },
        },
        { channelId: "slack", runId: "run-1", sessionKey: "session-1" },
      ),
    ).toBeUndefined();
  });

  it("fails open for notices, reasoning, rich content, blank text, and unknown payload fields", () => {
    const fixture = createHookApi();
    registerCompletionHooks(fixture.api);

    fixture.handler("after_tool_call")(
      {
        toolName: "slack_send_blocks",
        runId: "run-1",
        result: sentToolResult,
      },
      {
        toolName: "slack_send_blocks",
        runId: "run-1",
        sessionKey: "session-1",
      },
    );

    const replyHook = fixture.handler("reply_payload_sending");
    const context = { channelId: "slack", runId: "run-1", sessionKey: "session-1" };
    const payloads = [
      { text: "fallback", isFallbackNotice: true },
      { text: "compacting", isCompactionNotice: true },
      { text: "status", isStatusNotice: true },
      { text: "reasoning", isReasoning: true },
      { text: "commentary", isCommentary: true },
      { text: "image", mediaUrl: "https://example.com/image.png" },
      { text: "images", mediaUrls: ["https://example.com/image.png"] },
      { text: "card", presentation: {} },
      { text: "interactive", interactive: {} },
      { text: "channel", channelData: {} },
      { text: "" },
      { text: "   " },
      { text: 123 },
      { text: "future host payload", futureField: true },
    ];

    for (const payload of payloads) {
      expect(
        replyHook(
          { kind: "final", runId: "run-1", sessionKey: "session-1", payload },
          context,
        ),
      ).toBeUndefined();
    }
  });

  it("recognizes empty fields added by OpenClaw text-final normalization", () => {
    expect(
      isSuppressiblePlainTextFinal({
        text: "duplicate",
        mediaUrls: undefined,
        mediaUrl: undefined,
        replyToId: undefined,
        replyToTag: false,
        replyToCurrent: undefined,
        audioAsVoice: false,
      }),
    ).toBe(true);
    expect(
      isSuppressiblePlainTextFinal({
        text: "duplicate",
        mediaUrl: null,
        mediaUrls: [],
      }),
    ).toBe(true);
    expect(
      isSuppressiblePlainTextFinal({
        text: "voice",
        audioAsVoice: true,
      }),
    ).toBe(false);
  });

  it("keeps ineligibility sticky when any other or unsuccessful tool completes in the run", () => {
    const fixture = createHookApi();
    registerCompletionHooks(fixture.api);
    const afterToolCall = fixture.handler("after_tool_call");
    const replyHook = fixture.handler("reply_payload_sending");
    const finalFor = (runId: string) =>
      replyHook(
        { kind: "final", runId, payload: { text: "must remain visible" } },
        { channelId: "slack", runId },
      );

    // A later tool invalidates an otherwise eligible send.
    afterToolCall(
      { toolName: "slack_send_blocks", runId: "run-after", result: sentToolResult },
      { toolName: "slack_send_blocks", runId: "run-after" },
    );
    afterToolCall(
      { toolName: "other_tool", runId: "run-after", result: { ok: true } },
      { toolName: "other_tool", runId: "run-after" },
    );
    expect(finalFor("run-after")).toBeUndefined();

    // A later Slack success cannot re-enable a run that already used another tool.
    afterToolCall(
      { toolName: "other_tool", runId: "run-before", result: { ok: true } },
      { toolName: "other_tool", runId: "run-before" },
    );
    afterToolCall(
      { toolName: "slack_send_blocks", runId: "run-before", result: sentToolResult },
      { toolName: "slack_send_blocks", runId: "run-before" },
    );
    expect(finalFor("run-before")).toBeUndefined();

    // Failed/validate-only Slack calls also permanently invalidate the run.
    afterToolCall(
      {
        toolName: "slack_send_blocks",
        runId: "run-failed",
        result: { details: { ok: true, status: "validated" } },
      },
      { toolName: "slack_send_blocks", runId: "run-failed" },
    );
    afterToolCall(
      { toolName: "slack_send_blocks", runId: "run-failed", result: sentToolResult },
      { toolName: "slack_send_blocks", runId: "run-failed" },
    );
    expect(finalFor("run-failed")).toBeUndefined();

    // Multiple complete Slack sends remain eligible.
    for (let index = 0; index < 2; index += 1) {
      afterToolCall(
        {
          toolName: "slack_send_blocks",
          runId: "run-exclusive",
          toolCallId: `call-${index}`,
          result: sentToolResult,
        },
        { toolName: "slack_send_blocks", runId: "run-exclusive" },
      );
    }
    expect(finalFor("run-exclusive")).toEqual(expect.objectContaining({ cancel: true }));
  });

  it("deduplicates host relay observations by exact toolCallId", () => {
    const fixture = createHookApi();
    registerCompletionHooks(fixture.api);
    const afterToolCall = fixture.handler("after_tool_call");
    const replyHook = fixture.handler("reply_payload_sending");
    const finalFor = (runId: string) =>
      replyHook(
        { kind: "final", runId, payload: { text: "duplicate" } },
        { channelId: "slack", runId },
      );

    afterToolCall(
      {
        toolName: "slack_send_blocks",
        runId: "run-relayed",
        toolCallId: "call-1",
        result: sentToolResult,
      },
      {
        toolName: "slack_send_blocks",
        runId: "run-relayed",
        toolCallId: "call-1",
      },
    );
    afterToolCall(
      {
        toolName: "openclawslack_send_blocks",
        runId: "run-relayed",
        toolCallId: "call-1",
        result: { content: [{ type: "text", text: "relayed" }] },
      },
      {
        toolName: "openclawslack_send_blocks",
        runId: "run-relayed",
        toolCallId: "call-1",
      },
    );
    expect(finalFor("run-relayed")).toEqual(expect.objectContaining({ cancel: true }));

    // Relay order is not part of the contract. A later authoritative success
    // may upgrade the same exact call, but never a distinct call.
    afterToolCall(
      {
        toolName: "openclawslack_send_blocks",
        runId: "run-reversed",
        toolCallId: "call-1",
        result: { content: [{ type: "text", text: "relayed" }] },
      },
      {
        toolName: "openclawslack_send_blocks",
        runId: "run-reversed",
        toolCallId: "call-1",
      },
    );
    afterToolCall(
      {
        toolName: "slack_send_blocks",
        runId: "run-reversed",
        toolCallId: "call-1",
        result: sentToolResult,
      },
      {
        toolName: "slack_send_blocks",
        runId: "run-reversed",
        toolCallId: "call-1",
      },
    );
    expect(finalFor("run-reversed")).toEqual(expect.objectContaining({ cancel: true }));

    afterToolCall(
      {
        toolName: "other_tool",
        runId: "run-relayed",
        toolCallId: "call-2",
        result: { ok: true },
      },
      { toolName: "other_tool", runId: "run-relayed", toolCallId: "call-2" },
    );
    expect(finalFor("run-relayed")).toBeUndefined();
  });

  it("records failed or mismatched tool calls as ineligible and ignores uncorrelated calls", () => {
    const fixture = createHookApi();
    const store = registerCompletionHooks(fixture.api);
    const afterToolCall = fixture.handler("after_tool_call");

    afterToolCall(
      {
        toolName: "slack_send_blocks",
        runId: "run-failed",
        result: {
          details: { ok: false, status: "partial_failed", complete: false },
        },
      },
      { toolName: "slack_send_blocks", runId: "run-failed" },
    );
    afterToolCall(
      {
        toolName: "other_tool",
        runId: "run-other",
        result: sentToolResult,
      },
      { toolName: "other_tool", runId: "run-other" },
    );
    afterToolCall(
      {
        toolName: "slack_send_blocks",
        runId: "run-context-mismatch",
        result: sentToolResult,
      },
      { toolName: "other_tool", runId: "run-context-mismatch" },
    );
    afterToolCall(
      {
        toolName: "slack_send_blocks",
        runId: "run-a",
        result: sentToolResult,
      },
      { toolName: "slack_send_blocks", runId: "run-b" },
    );
    afterToolCall(
      {
        toolName: "slack_send_blocks",
        runId: "run-call-id-mismatch",
        toolCallId: "call-a",
        result: sentToolResult,
      },
      {
        toolName: "slack_send_blocks",
        runId: "run-call-id-mismatch",
        toolCallId: "call-b",
      },
    );
    afterToolCall(
      { toolName: "slack_send_blocks", result: sentToolResult },
      { toolName: "slack_send_blocks" },
    );

    expect(store.size).toBe(4);
    expect(store.matches({ runId: "run-failed" })).toBe(false);
    expect(store.matches({ runId: "run-other" })).toBe(false);
    expect(store.matches({ runId: "run-context-mismatch" })).toBe(false);
    expect(store.matches({ runId: "run-a" })).toBe(false);
    expect(store.matches({ runId: "run-call-id-mismatch" })).toBe(false);
  });

  it("bounds markers by TTL and entry count", () => {
    let now = 1_000;
    const store = new CompletedRunStore({
      ttlMs: 100,
      maxEntries: 2,
      now: () => now,
    });

    store.observe({ runId: "run-1", completedSlackSend: true });
    store.observe({ runId: "run-2", completedSlackSend: true });
    store.observe({ runId: "run-3", completedSlackSend: true });

    expect(store.size).toBe(2);
    expect(store.matches({ runId: "run-1" })).toBe(false);
    expect(store.matches({ runId: "run-2" })).toBe(true);

    now += 100;
    expect(store.size).toBe(0);
  });

  it("fails open when one run exceeds the bounded tool-call observation set", () => {
    const store = new CompletedRunStore();
    for (let index = 0; index <= MAX_TOOL_CALLS_PER_RUN; index += 1) {
      store.observe({
        runId: "run-overflow",
        toolCallId: `call-${index}`,
        completedSlackSend: true,
      });
    }

    expect(store.matches({ runId: "run-overflow" })).toBe(false);
  });

  it("clears markers on lifecycle cleanup and gateway stop", async () => {
    const fixture = createHookApi();
    const store = registerCompletionHooks(fixture.api);
    store.observe({
      runId: "run-1",
      sessionKey: "session-1",
      completedSlackSend: true,
    });
    store.observe({
      runId: "run-2",
      sessionKey: "session-2",
      completedSlackSend: true,
    });

    await fixture.lifecycleCleanup()?.({ sessionKey: "session-1" });
    expect(store.matches({ runId: "run-1" })).toBe(false);
    expect(store.matches({ runId: "run-2" })).toBe(true);

    fixture.handler("gateway_stop")({}, {});
    expect(store.size).toBe(0);
  });
});

describe("isCompletedSlackSendBlocksResult", () => {
  it("requires an explicit complete sent receipt", () => {
    expect(isCompletedSlackSendBlocksResult(sentToolResult)).toBe(true);
    expect(
      isCompletedSlackSendBlocksResult({
        details: { ok: true, status: "sent", complete: false },
      }),
    ).toBe(false);
    expect(isCompletedSlackSendBlocksResult("sent")).toBe(false);
  });
});

describe("isSuppressiblePlainTextFinal", () => {
  it("only accepts non-empty plain text with safe reply metadata", () => {
    expect(isSuppressiblePlainTextFinal({ text: "duplicate" })).toBe(true);
    expect(
      isSuppressiblePlainTextFinal({ text: "normalized duplicate", mediaUrl: null }),
    ).toBe(true);
    expect(
      isSuppressiblePlainTextFinal({
        text: "duplicate",
        replyToId: "123",
        replyToTag: true,
        replyToCurrent: false,
      }),
    ).toBe(true);
    expect(isSuppressiblePlainTextFinal({ text: "", channelData: {} })).toBe(false);
    expect(
      isSuppressiblePlainTextFinal({
        text: "real media",
        mediaUrl: "https://example.com/image.png",
      }),
    ).toBe(false);
  });
});
