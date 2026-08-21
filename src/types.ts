export type SlackBlock = Record<string, unknown>;

export type ValidationIssue = {
  path: string;
  message: string;
};

export type ValidationResult =
  | { ok: true; warnings: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[]; warnings: ValidationIssue[] };

export type SlackBlockSendInput = {
  target: string;
  text: string;
  blocks: SlackBlock[];
  accountId?: string;
  threadTs?: string;
  validateOnly?: boolean;
};
