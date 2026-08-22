import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { registerCompletionHooks } from "./completion.js";
import { SlackSendBlocksSchema } from "./schema.js";
import {
  SLACK_SEND_BLOCKS_DESCRIPTION,
  SLACK_SEND_BLOCKS_LABEL,
  SLACK_SEND_BLOCKS_NAME,
} from "./tool-copy.js";
import { createSlackSendBlocksTool } from "./tool.js";

const plugin = defineToolPlugin({
  id: "slack-block-kit",
  name: "Slack Block Kit",
  description: "Send rich Slack Block Kit messages to the current Slack conversation",
  tools: (tool) => [
    tool({
      name: SLACK_SEND_BLOCKS_NAME,
      label: SLACK_SEND_BLOCKS_LABEL,
      description: SLACK_SEND_BLOCKS_DESCRIPTION,
      parameters: SlackSendBlocksSchema,
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
