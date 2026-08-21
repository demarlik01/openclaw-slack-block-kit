import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { SlackBlockSendSchema } from "./schema.js";
import type { SlackBlockSendInput } from "./types.js";
import { validateSlackBlocks } from "./validator.js";

type ToolContext = {
  config?: Record<string, unknown>;
  agentAccountId?: string;
  messageChannel?: string;
};

function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

export function createSlackBlockSendTool(api: OpenClawPluginApi, context: ToolContext) {
  return {
    name: "slack_block_send",
    label: "Slack Block Kit send",
    description:
      "Send a Slack-specific Block Kit message. Use the core message tool with presentation for simple text/context/divider/buttons/select cards; use this tool only for raw Slack-only blocks such as fields, accessory, image, rich_text, overflow, or datepicker.",
    parameters: SlackBlockSendSchema,
    async execute(_id: string, rawInput: unknown) {
      const input = rawInput as SlackBlockSendInput;
      const validation = validateSlackBlocks(input.blocks);
      if (!validation.ok) {
        return jsonResult({
          ok: false,
          error: {
            code: "INVALID_BLOCK_KIT",
            message: "Block Kit validation failed",
            issues: validation.issues.slice(0, 50),
          },
        });
      }

      if (input.validateOnly) {
        return jsonResult({
          ok: true,
          valid: true,
          blockCount: input.blocks.length,
          warnings: validation.warnings,
        });
      }

      const adapter = await api.runtime.channel.outbound.loadAdapter("slack");
      if (!adapter?.sendPayload) {
        return jsonResult({
          ok: false,
          error: {
            code: "SLACK_NOT_CONFIGURED",
            message: "Slack outbound adapter is unavailable",
          },
        });
      }

      const cfg = (context.config ?? api.runtime.config.current()) as Parameters<
        NonNullable<typeof adapter.sendPayload>
      >[0]["cfg"];
      const accountId = input.accountId ?? context.agentAccountId;
      const result = await adapter.sendPayload({
        cfg,
        to: input.target,
        text: input.text,
        accountId,
        threadId: input.threadTs,
        payload: {
          text: input.text,
          channelData: {
            slack: {
              blocks: input.blocks,
            },
          },
        },
      });

      return jsonResult({
        ok: true,
        messageId: result.messageId,
        channelId: result.channelId ?? result.chatId,
        blockCount: input.blocks.length,
        warnings: validation.warnings,
      });
    },
  };
}
