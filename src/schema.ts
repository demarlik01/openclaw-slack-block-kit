import { Type } from "typebox";

const SlackMessageSchema = Type.Object(
  {
    text: Type.String({
      minLength: 1,
      maxLength: 4000,
      description: "Fallback text used for notifications and accessibility",
    }),
    blocks: Type.Array(Type.Record(Type.String(), Type.Unknown()), {
      minItems: 1,
      maxItems: 50,
      description: "Raw Slack Block Kit blocks",
    }),
  },
  { additionalProperties: false },
);

export const SlackSendBlocksSchema = Type.Object(
  {
    messages: Type.Array(SlackMessageSchema, {
      minItems: 1,
      maxItems: 10,
      description: "Ordered Slack messages sent to the current conversation and thread",
    }),
    validateOnly: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
