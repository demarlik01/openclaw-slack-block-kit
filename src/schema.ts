import { Type } from "@sinclair/typebox";

export const SlackBlockSendSchema = Type.Object(
  {
    target: Type.String({ minLength: 1, description: "Slack target, preferably channel:C… or user:U…" }),
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
    accountId: Type.Optional(Type.String({ minLength: 1 })),
    threadTs: Type.Optional(Type.String({ pattern: "^[0-9]+\\.[0-9]+$" })),
    validateOnly: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
