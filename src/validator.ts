import type { SlackBlock, ValidationIssue, ValidationResult } from "./types.js";

const SUPPORTED_BLOCK_TYPES = new Set([
  "actions",
  "call",
  "context",
  "divider",
  "file",
  "header",
  "image",
  "input",
  "rich_text",
  "section",
  "table",
  "video",
]);

const MAX_BLOCKS = 50;
const MAX_BLOCK_ID_LENGTH = 255;
const MAX_ACTION_ID_LENGTH = 255;
const MAX_TEXT_LENGTH = 3000;
const MAX_NESTING_DEPTH = 20;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pushTextIssue(value: unknown, path: string, issues: ValidationIssue[]) {
  if (!isObject(value)) {
    issues.push({ path, message: "must be a Slack text object" });
    return;
  }
  if (value.type !== "plain_text" && value.type !== "mrkdwn") {
    issues.push({ path: `${path}.type`, message: "must be plain_text or mrkdwn" });
  }
  if (typeof value.text !== "string" || value.text.length === 0) {
    issues.push({ path: `${path}.text`, message: "must be a non-empty string" });
  } else if (value.text.length > MAX_TEXT_LENGTH) {
    issues.push({ path: `${path}.text`, message: `must be at most ${MAX_TEXT_LENGTH} characters` });
  }
}

function inspectNode(
  value: unknown,
  path: string,
  actionIds: Set<string>,
  issues: ValidationIssue[],
  depth = 0,
) {
  if (depth > MAX_NESTING_DEPTH) {
    issues.push({ path, message: `nesting depth must not exceed ${MAX_NESTING_DEPTH}` });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectNode(entry, `${path}[${index}]`, actionIds, issues, depth + 1),
    );
    return;
  }
  if (!isObject(value)) return;

  if ("action_id" in value) {
    if (typeof value.action_id !== "string" || value.action_id.length === 0) {
      issues.push({ path: `${path}.action_id`, message: "must be a non-empty string" });
    } else if (value.action_id.length > MAX_ACTION_ID_LENGTH) {
      issues.push({
        path: `${path}.action_id`,
        message: `must be at most ${MAX_ACTION_ID_LENGTH} characters`,
      });
    } else if (actionIds.has(value.action_id)) {
      issues.push({ path: `${path}.action_id`, message: "must be unique within a message" });
    } else {
      actionIds.add(value.action_id);
    }
  }

  for (const [key, nested] of Object.entries(value)) {
    if (key === "action_id") continue;
    inspectNode(nested, `${path}.${key}`, actionIds, issues, depth + 1);
  }
}

export function validateSlackBlocks(blocks: SlackBlock[]): ValidationResult {
  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const blockIds = new Set<string>();
  const actionIds = new Set<string>();

  if (blocks.length === 0) {
    issues.push({ path: "blocks", message: "must contain at least one block" });
  }
  if (blocks.length > MAX_BLOCKS) {
    issues.push({ path: "blocks", message: `must contain at most ${MAX_BLOCKS} blocks` });
  }

  blocks.forEach((block, index) => {
    const path = `blocks[${index}]`;
    if (!isObject(block)) {
      issues.push({ path, message: "must be an object" });
      return;
    }
    if (typeof block.type !== "string" || block.type.length === 0) {
      issues.push({ path: `${path}.type`, message: "must be a non-empty string" });
      return;
    }
    if (!SUPPORTED_BLOCK_TYPES.has(block.type)) {
      issues.push({ path: `${path}.type`, message: `unsupported block type: ${block.type}` });
    }

    if (block.block_id !== undefined) {
      if (typeof block.block_id !== "string" || block.block_id.length === 0) {
        issues.push({ path: `${path}.block_id`, message: "must be a non-empty string" });
      } else if (block.block_id.length > MAX_BLOCK_ID_LENGTH) {
        issues.push({
          path: `${path}.block_id`,
          message: `must be at most ${MAX_BLOCK_ID_LENGTH} characters`,
        });
      } else if (blockIds.has(block.block_id)) {
        issues.push({ path: `${path}.block_id`, message: "must be unique within a message" });
      } else {
        blockIds.add(block.block_id);
      }
    }

    if (block.type === "section") {
      if (block.text === undefined && block.fields === undefined) {
        issues.push({ path, message: "section requires text or fields" });
      }
      if (block.text !== undefined) pushTextIssue(block.text, `${path}.text`, issues);
      if (block.fields !== undefined) {
        if (!Array.isArray(block.fields) || block.fields.length === 0 || block.fields.length > 10) {
          issues.push({ path: `${path}.fields`, message: "must contain between 1 and 10 text objects" });
        } else {
          block.fields.forEach((field, fieldIndex) =>
            pushTextIssue(field, `${path}.fields[${fieldIndex}]`, issues),
          );
        }
      }
    }

    if (block.type === "header") {
      pushTextIssue(block.text, `${path}.text`, issues);
      if (isObject(block.text) && block.text.type !== "plain_text") {
        issues.push({ path: `${path}.text.type`, message: "header text must be plain_text" });
      }
    }

    if (block.type === "actions") {
      if (!Array.isArray(block.elements) || block.elements.length === 0 || block.elements.length > 25) {
        issues.push({ path: `${path}.elements`, message: "must contain between 1 and 25 elements" });
      }
    }

    if (block.type === "context") {
      if (!Array.isArray(block.elements) || block.elements.length === 0 || block.elements.length > 10) {
        issues.push({ path: `${path}.elements`, message: "must contain between 1 and 10 elements" });
      }
    }

    inspectNode(block, path, actionIds, issues);
  });

  return issues.length > 0 ? { ok: false, issues, warnings } : { ok: true, warnings };
}
