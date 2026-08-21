import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createSlackBlockSendTool } from "./tool.js";

const plugin = {
  id: "slack-block-kit",
  name: "Slack Block Kit",
  description: "Send validated Slack Block Kit messages through OpenClaw",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      validationMode: { type: "string", enum: ["strict"], default: "strict" },
    },
  },
  register(api: OpenClawPluginApi) {
    api.registerTool(
      (context) =>
        createSlackBlockSendTool(api, {
          config: context.config,
          agentAccountId: context.agentAccountId,
          messageChannel: context.messageChannel,
        }),
      { optional: true },
    );
  },
};

export default plugin;
