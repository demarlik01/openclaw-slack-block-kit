import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { registerCompletionHooks } from "./completion.js";
import { SlackSendBlocksSchema } from "./schema.js";
import { createSlackSendBlocksTool } from "./tool.js";

const plugin = defineToolPlugin({
  id: "slack-block-kit",
  name: "Slack Block Kit",
  description: "Send current-route Slack message-surface Block Kit through OpenClaw",
  tools: (tool) => [
    tool({
      name: "slack_send_blocks",
      label: "Send Slack Block Kit",
      description:
        'Send one or more display-only raw Slack Block Kit messages to the current Slack conversation and thread. Arguments must use {"messages":[{"text":"fallback","blocks":[...]}],"validateOnly":false}; never put text or blocks at the top level. Prefer the core message tool with presentation for portable text/context/divider/buttons/select cards. Use this optional tool only for Slack-only message layouts such as image accessories, precise fields, rich_text, table, or data_visualization. Call it as the final standalone tool. After a complete send, return exactly NO_REPLY with no other text because the visible response was already delivered.',
      parameters: SlackSendBlocksSchema,
      optional: true,
      factory({ api, toolContext }) {
        const channel = toolContext.deliveryContext?.channel ?? toolContext.messageChannel;
        if (channel !== "slack") {
          return null;
        }
        return createSlackSendBlocksTool(api, toolContext);
      },
    }),
  ],
});

const registerTools = plugin.register.bind(plugin);
plugin.register = (api) => {
  registerTools(api);
  registerCompletionHooks(api);
};

export default plugin;
