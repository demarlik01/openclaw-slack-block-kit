import { Type } from "typebox";
import { SLACK_BLOCK_KIT_REFERENCE_URL } from "./tool-copy.js";

const SlackMessageSchema = Type.Object(
  {
    text: Type.String({
      minLength: 1,
      maxLength: 4000,
      description:
        'Plain-text fallback for notifications, screen readers, and clients that cannot render blocks. Write a self-contained one-line summary of what this message says, not a placeholder like "Update"—for some recipients this is the only text they see.',
    }),
    blocks: Type.Array(Type.Record(Type.String(), Type.Unknown()), {
      minItems: 1,
      maxItems: 50,
      description: `Raw Slack Block Kit blocks for this message, in Slack's message-surface JSON (official reference: ${SLACK_BLOCK_KIT_REFERENCE_URL}). Display-only blocks are allowed: section (including fields and an image accessory), header, context, divider, image, rich_text, table, and data_visualization. Rejected: actions, input, file, video, and call blocks, plus any interactive element or action_id. Unknown block types pass through and are validated by Slack.`,
    }),
  },
  { additionalProperties: false },
);

export const SlackSendBlocksSchema = Type.Object(
  {
    messages: Type.Array(SlackMessageSchema, {
      minItems: 1,
      maxItems: 10,
      description:
        "Slack messages posted to the current conversation and thread in array order. Prefer one message with multiple blocks for a single coherent answer; add messages only for genuinely separate items.",
    }),
    validateOnly: Type.Optional(
      Type.Boolean({
        description:
          "When true, run local structure, size, and URL checks and return the result without posting to Slack. Leave unset or false to send. Use true only when explicitly asked to validate or preview; local validation does not guarantee Slack accepts every block combination.",
      }),
    ),
  },
  { additionalProperties: false },
);
