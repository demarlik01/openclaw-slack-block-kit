import type {
  OpenClawPluginApi,
  OpenClawPluginToolContext,
} from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { Check, Errors } from "typebox/value";
import {
  buildOutboundSessionContext,
  sendDurableMessageBatch,
  type DurableMessageBatchSendResult,
} from "openclaw/plugin-sdk/channel-outbound";
import { normalizeSlackError } from "./errors.js";
import { SlackSendBlocksSchema } from "./schema.js";
import type { SlackSendBlocksInput, ValidationIssue } from "./types.js";
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

function parseToolInput(rawInput: unknown):
  | { ok: true; input: SlackSendBlocksInput }
  | { ok: false; issues: ValidationIssue[] } {
  if (Check(SlackSendBlocksSchema, rawInput)) {
    return { ok: true, input: rawInput };
  }

  const issues: ValidationIssue[] = [];
  for (const error of Errors(SlackSendBlocksSchema, rawInput)) {
    if (issues.length >= 50) {
      break;
    }

    const basePath = error.instancePath
      .split("/")
      .slice(1)
      .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
      .reduce(
        (path, segment) =>
          /^\d+$/.test(segment)
            ? `${path}[${segment}]`
            : path.length > 0
              ? `${path}.${segment}`
              : segment,
        "",
      );

    if (error.keyword === "required") {
      for (const property of error.params.requiredProperties) {
        if (issues.length >= 50) {
          break;
        }
        issues.push({
          path: basePath.length > 0 ? `${basePath}.${property}` : property,
          message: "is required",
        });
      }
      continue;
    }

    if (error.keyword === "additionalProperties") {
      for (const property of error.params.additionalProperties) {
        if (issues.length >= 50) {
          break;
        }
        issues.push({
          path: basePath.length > 0 ? `${basePath}.${property}` : property,
          message: "is not supported",
        });
      }
      continue;
    }

    issues.push({
      path: basePath.length > 0 ? basePath : "$",
      message: error.message,
    });
  }

  return { ok: false, issues };
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

function inputFailure(issues: ValidationIssue[]) {
  return jsonResult({
    ok: false,
    status: "failed",
    error: {
      code: "INVALID_ARGUMENT",
      message: "Tool input validation failed",
      issues: issues.slice(0, 50),
    },
    warnings: [],
  });
}

export function createSlackSendBlocksTool(
  api: OpenClawPluginApi,
  context: OpenClawPluginToolContext,
  sendBatch: DurableSender = sendDurableMessageBatch,
) {
  return {
    name: "slack_send_blocks",
    label: "Send Slack Block Kit",
    description:
      'Send display-only raw Slack Block Kit to the current Slack conversation. Use {"messages":[{"text":"fallback","blocks":[...]}],"validateOnly":false}; text and blocks are never top-level fields.',
    parameters: SlackSendBlocksSchema,
    async execute(_id: string, rawInput: unknown, signal?: AbortSignal) {
      const parsedInput = parseToolInput(rawInput);
      if (!parsedInput.ok) {
        return inputFailure(parsedInput.issues);
      }

      const input = parsedInput.input;
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
