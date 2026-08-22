import { describe, expect, it } from "vitest";
import { SLACK_SEND_BLOCKS_DESCRIPTION } from "../src/tool-copy.js";

describe("tool selection and completion copy", () => {
  it("preserves the proactive selection and exact completion contract", () => {
    expect(SLACK_SEND_BLOCKS_DESCRIPTION).toContain("Choose it proactively");
    expect(SLACK_SEND_BLOCKS_DESCRIPTION).toContain("length alone is not a reason");
    expect(SLACK_SEND_BLOCKS_DESCRIPTION).toContain(
      '{"messages":[{"text":"<one-line summary>","blocks":[...]}]}',
    );
    expect(SLACK_SEND_BLOCKS_DESCRIPTION).toContain("validateOnly is optional");
    expect(SLACK_SEND_BLOCKS_DESCRIPTION).toContain(
      "once, alone, as the last tool call of the turn",
    );
    expect(SLACK_SEND_BLOCKS_DESCRIPTION).toContain("exactly NO_REPLY");
  });
});
