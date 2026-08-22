export const SLACK_SEND_BLOCKS_NAME = "slack_send_blocks";
export const SLACK_SEND_BLOCKS_LABEL = "Send Slack Block Kit";
export const SLACK_BLOCK_KIT_REFERENCE_URL =
  "https://docs.slack.dev/reference/block-kit/blocks/";

export const SLACK_SEND_BLOCKS_DESCRIPTION = [
  "Send Slack Block Kit messages to the current Slack conversation and thread.",
  "Choose it proactively when the answer has structure worth rendering—comparisons, ranked or scored results, multi-field records, status rollups, tables, data visualizations, image-supported items, or grouped sections a reader would scan rather than read straight through.",
  "Use it whenever the user asks for Block Kit or names slack_send_blocks.",
  "Otherwise answer normally: short replies, follow-up questions, narrative explanations, and code are clearer as plain text, and length alone is not a reason to use this tool.",
  "Display-only: buttons, selects, inputs, and any action_id are rejected.",
  'Arguments are {"messages":[{"text":"<one-line summary>","blocks":[...]}]}; validateOnly is optional, and text and blocks are never top-level fields.',
  "Call it once, alone, as the last tool call of the turn.",
  "When the result is ok=true, status=sent, complete=true, reply with exactly NO_REPLY and no other text—the message is already visible to the user.",
].join(" ");
