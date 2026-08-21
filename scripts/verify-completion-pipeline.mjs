import assert from "node:assert/strict";
import {
  initializeGlobalHookRunner,
  resetGlobalHookRunner,
} from "openclaw/plugin-sdk/hook-runtime";
import { deliverOutboundPayloads } from "openclaw/plugin-sdk/outbound-runtime";
import { registerCompletionHooks } from "../dist/completion.js";

const PROBE_PLUGIN_ID = `slack-block-kit-completion-probe-${process.pid}`;
const RUN_ID = `completion-pipeline-run-${process.pid}`;
const SESSION_KEY = `completion-pipeline-session-${process.pid}`;
const TOOL_CALL_ID = `completion-pipeline-call-${process.pid}`;
const WARMUP_ERROR = "completion pipeline adapter warmup";

const baseDelivery = {
  cfg: {},
  channel: "slack",
  to: "C_COMPLETION_PIPELINE_PROBE",
  payloads: [],
  skipQueue: true,
  queuePolicy: "best_effort",
};

async function warmChannelRuntime() {
  let adapterCalls = 0;
  const results = await deliverOutboundPayloads({
    ...baseDelivery,
    deps: {
      slack: async () => {
        adapterCalls += 1;
        throw new Error(WARMUP_ERROR);
      },
    },
  });
  assert.deepEqual(results, []);
  assert.equal(adapterCalls, 0);
}

function createProbeApi(typedHooks, probeState) {
  return {
    on(hookName, handler, options) {
      typedHooks.push({
        pluginId: PROBE_PLUGIN_ID,
        hookName,
        async handler(...args) {
          const result = await handler(...args);
          if (hookName === "reply_payload_sending") {
            probeState.replyHookCalls += 1;
            if (result?.cancel === true) {
              probeState.replyHookCancellations += 1;
            }
          }
          return result;
        },
        priority: options?.priority,
        timeoutMs: options?.timeoutMs,
        source: import.meta.url,
      });
    },
    lifecycle: {
      registerRuntimeLifecycle() {},
    },
  };
}

try {
  // Loading a channel runtime can activate the installed plugin registry.
  // Warm it first, then install this fresh-process probe as the last registry.
  // An empty payload list loads the runtime with a zero-iteration send loop.
  await warmChannelRuntime();

  const typedHooks = [];
  const probeState = {
    replyHookCalls: 0,
    replyHookCancellations: 0,
  };
  const store = registerCompletionHooks(createProbeApi(typedHooks, probeState));
  initializeGlobalHookRunner({
    plugins: [{ id: PROBE_PLUGIN_ID, status: "loaded" }],
    hooks: [],
    typedHooks,
  });

  const afterToolCall = typedHooks.find(
    (registration) => registration.hookName === "after_tool_call",
  )?.handler;
  assert.equal(typeof afterToolCall, "function");

  const sentResult = {
    details: { ok: true, status: "sent", complete: true },
  };
  const toolContext = {
    toolName: "slack_blocks_send",
    runId: RUN_ID,
    sessionKey: SESSION_KEY,
    toolCallId: TOOL_CALL_ID,
  };

  await afterToolCall(
    {
      toolName: "slack_blocks_send",
      runId: RUN_ID,
      toolCallId: TOOL_CALL_ID,
      result: sentResult,
    },
    toolContext,
  );
  await afterToolCall(
    {
      toolName: "openclawslack_blocks_send",
      runId: RUN_ID,
      toolCallId: TOOL_CALL_ID,
      result: { content: [{ type: "text", text: "relayed" }] },
    },
    { ...toolContext, toolName: "openclawslack_blocks_send" },
  );
  assert.equal(store.matches({ runId: RUN_ID, sessionKey: SESSION_KEY }), true);

  let adapterCalls = 0;
  const outcomes = [];
  const results = await deliverOutboundPayloads({
    ...baseDelivery,
    payloads: [{ text: "duplicate final" }],
    replyPayloadSendingHook: {
      kind: "final",
      channel: "slack",
      sessionKey: SESSION_KEY,
      runId: RUN_ID,
      context: {
        channelId: "slack",
        conversationId: baseDelivery.to,
        sessionKey: SESSION_KEY,
        runId: RUN_ID,
      },
    },
    onPayloadDeliveryOutcome(outcome) {
      outcomes.push(outcome);
    },
    deps: {
      slack: async () => {
        adapterCalls += 1;
        throw new Error(
          "suppressed final reached the injected platform adapter tripwire",
        );
      },
    },
  });

  assert.equal(adapterCalls, 0);
  assert.equal(probeState.replyHookCalls, 1);
  assert.equal(probeState.replyHookCancellations, 1);
  assert.deepEqual(results, []);
  assert.deepEqual(outcomes, [
    {
      index: 0,
      status: "suppressed",
      reason: "cancelled_by_reply_payload_sending_hook",
    },
  ]);

  console.log(
    JSON.stringify({
      ok: true,
      adapterCalls,
      replyHookCalls: probeState.replyHookCalls,
      replyHookCancellations: probeState.replyHookCancellations,
      outcome: outcomes[0],
    }),
  );
} finally {
  resetGlobalHookRunner();
}
