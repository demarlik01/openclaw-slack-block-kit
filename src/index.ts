import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { SlackBlocksSendSchema } from "./schema.js";
import { createSlackBlocksSendTool } from "./tool.js";

export default defineToolPlugin({
  id: "slack-block-kit",
  name: "Slack Block Kit",
  description: "Send current-route Slack message-surface Block Kit through OpenClaw",
  tools: (tool) => [
    tool({
      name: "slack_blocks_send",
      label: "Slack Block Kit send",
      description:
        "Send one or more display-only raw Slack Block Kit messages to the current Slack conversation and thread. Prefer the core message tool with presentation for portable text/context/divider/buttons/select cards. Use this optional tool only for Slack-only message layouts such as image accessories, precise fields, rich_text, table, or data_visualization. Call it as the final standalone tool when possible because a successful send terminates the turn.",
      parameters: SlackBlocksSendSchema,
      optional: true,
      factory({ api, toolContext }) {
        const channel = toolContext.deliveryContext?.channel ?? toolContext.messageChannel;
        if (channel !== "slack") {
          return null;
        }
        return createSlackBlocksSendTool(api, toolContext);
      },
    }),
  ],
});
