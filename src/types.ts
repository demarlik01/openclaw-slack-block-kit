export type SlackBlock = Record<string, unknown>;

export type SlackMessageInput = {
  text: string;
  blocks: SlackBlock[];
};

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationResult =
  | { ok: true; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[]; warnings: ValidationIssue[] };

export type SlackSendBlocksInput = {
  messages: SlackMessageInput[];
  validateOnly?: boolean;
};
