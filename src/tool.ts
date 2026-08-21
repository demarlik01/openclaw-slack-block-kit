import type {
  OpenClawPluginApi,
  OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  buildOutboundSessionContext,
  sendDurableMessageBatch,
  type DurableMessageBatchSendResult,
} from "openclaw/plugin-sdk/channel-outbound";
import { normalizeSlackError } from "./errors.js";
import { SlackBlocksSendSchema } from "./schema.js";
import type { SlackBlocksSendInput, ValidationIssue } from "./types.js";
import { validateSlackMessages } from "./validator.js";

type DurableSender = typeof sendDurableMessageBatch;

type DeliveryResult = {
  messageId: string;
  channelId?: string;
  chatId?: string;
};

type PayloadOutcome =
  | { index: number; status: "sent"; results: DeliveryResult[] }
  | {
      index: number;
      status: "suppressed";
      reason: string;
      hookEffect?: { cancelReason?: string; metadata?: Record<string, unknown> };
    }
  | {
      index: number;
      status: "failed";
      error: unknown;
      sentBeforeError: boolean;
      stage: string;
    };

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
    terminate: false,
  };
}

function summarizeOutcomes(
  outcome: DurableMessageBatchSendResult,
  expectedMessageCount: number,
) {
  const sent: Array<{ index: number; messageId: string; channelId?: string }> = [];
  const suppressed: Array<{
    index: number;
    reason: string;
  }> = [];
  const failed: Array<{
    index: number;
    stage: string;
    sentBeforeError: boolean;
    error: ReturnType<typeof normalizeSlackError>;
  }> = [];

  const payloadOutcomes = outcome.payloadOutcomes as PayloadOutcome[] | undefined;
  if (payloadOutcomes && payloadOutcomes.length > 0) {
    for (const item of payloadOutcomes) {
      if (item.status === "sent") {
        for (const result of item.results) {
          sent.push({
            index: item.index,
            messageId: result.messageId,
            channelId: result.channelId ?? result.chatId,
          });
        }
      } else if (item.status === "suppressed") {
        suppressed.push({
          index: item.index,
          reason: item.reason,
        });
      } else {
        failed.push({
          index: item.index,
          stage: item.stage,
          sentBeforeError: item.sentBeforeError,
          error: normalizeSlackError(item.error),
        });
      }
    }
  } else if ("results" in outcome) {
    outcome.results.forEach((result, index) => {
      sent.push({
        index: Math.min(index, Math.max(expectedMessageCount - 1, 0)),
        messageId: result.messageId,
        channelId: result.channelId ?? result.chatId,
      });
    });
  }

  return { sent, suppressed, failed };
}

function isCompleteSend(params: {
  outcome: DurableMessageBatchSendResult;
  expectedMessageCount: number;
  sent: Array<{ index: number }>;
  suppressed: unknown[];
  failed: unknown[];
}) {
  if (params.outcome.status !== "sent") {
    return false;
  }
  if (params.suppressed.length > 0 || params.failed.length > 0) {
    return false;
  }
  if (!params.outcome.payloadOutcomes || params.outcome.payloadOutcomes.length === 0) {
    return params.sent.length >= params.expectedMessageCount;
  }
  const sentIndices = new Set(params.sent.map((item) => item.index));
  return sentIndices.size === params.expectedMessageCount;
}

function validationFailure(issues: ValidationIssue[], warnings: ValidationIssue[]) {
  return jsonResult({
    ok: false,
    status: "failed",
    error: {
      code: "INVALID_BLOCK_KIT",
      message: "Block Kit validation failed",
      issues: issues.slice(0, 50),
    },
    warnings,
  });
}

export function createSlackBlocksSendTool(
  api: OpenClawPluginApi,
  context: OpenClawPluginToolContext,
  sendBatch: DurableSender = sendDurableMessageBatch,
) {
  return {
    name: "slack_blocks_send",
    label: "Slack Block Kit send",
    description:
      "Send one or more display-only raw Slack Block Kit messages to the current Slack conversation and thread. Prefer core presentation for portable cards.",
    parameters: SlackBlocksSendSchema,
    async execute(_id: string, rawInput: unknown, signal?: AbortSignal) {
      const input = rawInput as SlackBlocksSendInput;
      const validation = validateSlackMessages(input.messages);
      if (!validation.ok) {
        return validationFailure(validation.issues, validation.warnings);
      }

      if (input.validateOnly) {
        return jsonResult({
          ok: true,
          status: "validated",
          messageCount: input.messages.length,
          blockCounts: input.messages.map((message) => message.blocks.length),
          warnings: validation.warnings,
        });
      }

      const route = context.deliveryContext;
      if (route?.channel !== "slack" || typeof route.to !== "string" || route.to.trim() === "") {
        return jsonResult({
          ok: false,
          status: "failed",
          error: {
            code: "INVALID_ROUTE",
            message: "A current Slack delivery route is required",
          },
          warnings: validation.warnings,
        });
      }

      const runtimeConfig =
        context.getRuntimeConfig?.() ??
        context.runtimeConfig ??
        context.config ??
        api.runtime.config.current();

      if (!runtimeConfig) {
        return jsonResult({
          ok: false,
          status: "failed",
          error: {
            code: "RUNTIME_CONFIG_UNAVAILABLE",
            message: "OpenClaw runtime configuration is unavailable",
          },
          warnings: validation.warnings,
        });
      }

      // Tool contexts expose an immutable runtime snapshot while channel
      // delivery helpers accept the equivalent mutable config surface.
      const cfg = runtimeConfig as OpenClawConfig;

      const accountId = route.accountId ?? context.agentAccountId;
      const session = buildOutboundSessionContext({
        cfg,
        sessionKey: context.sessionKey,
        policySessionKey: context.sessionKey,
        agentId: context.agentId,
        requesterAccountId: accountId,
        requesterSenderId: context.requesterSenderId,
      });

      try {
        const outcome = await sendBatch({
          cfg,
          channel: "slack",
          to: route.to,
          accountId,
          threadId: route.threadId,
          payloads: input.messages.map((message) => ({
            text: message.text,
            channelData: {
              slack: {
                blocks: message.blocks,
              },
            },
          })),
          durability: "required",
          signal,
          session,
        });

        const summary = summarizeOutcomes(outcome, input.messages.length);
        const complete = isCompleteSend({
          outcome,
          expectedMessageCount: input.messages.length,
          ...summary,
        });

        if (outcome.status === "sent") {
          const status = complete
            ? "sent"
            : summary.suppressed.length > 0
              ? "partial_suppressed"
              : "incomplete_sent";
          return jsonResult({
            ok: complete,
            status,
            complete,
            ...summary,
            warnings: validation.warnings,
            ...(complete
              ? {
                  nextAction: {
                    type: "silent_final",
                    token: "NO_REPLY",
                    instruction:
                      "The Block Kit message is already visible. Return exactly NO_REPLY with no other text.",
                  },
                }
              : {}),
          });
        }

        if (outcome.status === "suppressed") {
          return jsonResult({
            ok: false,
            status: "suppressed",
            reason: outcome.reason,
            ...summary,
            warnings: validation.warnings,
          });
        }

        if (outcome.status === "partial_failed") {
          return jsonResult({
            ok: false,
            status: "partial_failed",
            ...summary,
            error: normalizeSlackError(outcome.error),
            warnings: validation.warnings,
          });
        }

        return jsonResult({
          ok: false,
          status: "failed",
          stage: outcome.stage,
          ...summary,
          error: normalizeSlackError(outcome.error),
          warnings: validation.warnings,
        });
      } catch (error) {
        return jsonResult({
          ok: false,
          status: "failed",
          error: normalizeSlackError(error),
          warnings: validation.warnings,
        });
      }
    },
  };
}
