import type { ValidationIssue, ValidationResult } from "./types.js";

const KNOWN_DISPLAY_BLOCK_TYPES = new Set([
  "context",
  "data_visualization",
  "divider",
  "header",
  "image",
  "rich_text",
  "section",
  "table",
]);

const INTERACTIVE_ELEMENT_TYPES = new Set([
  "button",
  "checkboxes",
  "datepicker",
  "datetimepicker",
  "email_text_input",
  "multi_conversations_select",
  "multi_external_select",
  "multi_static_select",
  "multi_users_select",
  "number_input",
  "overflow",
  "plain_text_input",
  "radio_buttons",
  "rich_text_input",
  "static_select",
  "timepicker",
  "url_text_input",
]);

const V1_UNSUPPORTED_BLOCK_TYPES = new Map([
  ["actions", "interactive actions are deferred to v2; use presentation when possible"],
  ["call", "call blocks require a separate Slack application lifecycle"],
  ["file", "file blocks require a separate remote-file lifecycle"],
  ["input", "input blocks are view-only and cannot be sent as message blocks"],
  ["video", "video blocks require separate permissions and unfurl configuration"],
]);

const URL_KEYS = new Set(["image_url", "thumb_url", "url"]);

export const MAX_MESSAGES = 10;
export const MAX_BLOCKS_PER_MESSAGE = 50;
export const MAX_SERIALIZED_BLOCK_BYTES = 200 * 1024;
export const MAX_TOTAL_SERIALIZED_BLOCK_BYTES = 1024 * 1024;
export const MAX_NESTING_DEPTH = 20;

const MAX_BLOCK_ID_LENGTH = 255;
const MAX_ACTION_ID_LENGTH = 255;
const MAX_FALLBACK_TEXT_LENGTH = 4000;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function inspectNode(params: {
  value: unknown;
  path: string;
  actionIds: Set<string>;
  issues: ValidationIssue[];
  depth?: number;
}) {
  const { value, path, actionIds, issues, depth = 0 } = params;

  if (depth > MAX_NESTING_DEPTH) {
    issues.push({ path, message: `nesting depth must not exceed ${MAX_NESTING_DEPTH}` });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      inspectNode({
        value: entry,
        path: `${path}[${index}]`,
        actionIds,
        issues,
        depth: depth + 1,
      }),
    );
    return;
  }

  if (!isObject(value)) {
    return;
  }

  if (typeof value.type === "string" && INTERACTIVE_ELEMENT_TYPES.has(value.type)) {
    issues.push({
      path: `${path}.type`,
      message: `interactive element ${value.type} is not supported in display-only v1`,
    });
  }

  if ("action_id" in value) {
    if (typeof value.action_id !== "string" || value.action_id.trim().length === 0) {
      issues.push({ path: `${path}.action_id`, message: "must be a non-empty string" });
    } else {
      if (value.action_id.length > MAX_ACTION_ID_LENGTH) {
        issues.push({
          path: `${path}.action_id`,
          message: `must be at most ${MAX_ACTION_ID_LENGTH} characters`,
        });
      }
      if (actionIds.has(value.action_id)) {
        issues.push({ path: `${path}.action_id`, message: "must be unique within a message" });
      } else {
        actionIds.add(value.action_id);
      }
    }
    issues.push({
      path: `${path}.action_id`,
      message: "interactive action_id is not supported in display-only v1",
    });
  }

  for (const [key, nested] of Object.entries(value)) {
    if (URL_KEYS.has(key)) {
      if (typeof nested !== "string" || nested.trim().length === 0) {
        issues.push({ path: `${path}.${key}`, message: "must be a non-empty https URL string" });
      } else {
        try {
          const url = new URL(nested);
          if (url.protocol !== "https:") {
            issues.push({ path: `${path}.${key}`, message: "must use https" });
          }
        } catch {
          issues.push({ path: `${path}.${key}`, message: "must be a valid https URL" });
        }
      }
    }

    if (key === "action_id") {
      continue;
    }
    inspectNode({
      value: nested,
      path: `${path}.${key}`,
      actionIds,
      issues,
      depth: depth + 1,
    });
  }
}

export function validateSlackMessages(messages: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  let totalSerializedBytes = 0;

  if (!Array.isArray(messages)) {
    return {
      ok: false,
      issues: [{ path: "messages", message: "must be an array" }],
      warnings,
    };
  }

  if (messages.length === 0) {
    issues.push({ path: "messages", message: "must contain at least one message" });
  }
  if (messages.length > MAX_MESSAGES) {
    issues.push({ path: "messages", message: `must contain at most ${MAX_MESSAGES} messages` });
  }

  messages.forEach((message, messageIndex) => {
    const messagePath = `messages[${messageIndex}]`;

    if (!isObject(message)) {
      issues.push({ path: messagePath, message: "must be an object" });
      return;
    }

    for (const key of Object.keys(message)) {
      if (key !== "text" && key !== "blocks") {
        issues.push({ path: `${messagePath}.${key}`, message: "is not supported" });
      }
    }

    if (typeof message.text !== "string" || message.text.trim().length === 0) {
      issues.push({ path: `${messagePath}.text`, message: "must be a non-empty string" });
    } else if (message.text.length > MAX_FALLBACK_TEXT_LENGTH) {
      issues.push({
        path: `${messagePath}.text`,
        message: `must be at most ${MAX_FALLBACK_TEXT_LENGTH} characters`,
      });
    }

    if (!Array.isArray(message.blocks)) {
      issues.push({ path: `${messagePath}.blocks`, message: "must be an array" });
      return;
    }
    if (message.blocks.length === 0) {
      issues.push({ path: `${messagePath}.blocks`, message: "must contain at least one block" });
    }
    if (message.blocks.length > MAX_BLOCKS_PER_MESSAGE) {
      issues.push({
        path: `${messagePath}.blocks`,
        message: `must contain at most ${MAX_BLOCKS_PER_MESSAGE} blocks`,
      });
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(message.blocks);
    } catch {
      issues.push({
        path: `${messagePath}.blocks`,
        message: "must be JSON serializable without circular references",
      });
      return;
    }

    const serializedBytes = utf8Bytes(serialized);
    totalSerializedBytes += serializedBytes;
    if (serializedBytes > MAX_SERIALIZED_BLOCK_BYTES) {
      issues.push({
        path: `${messagePath}.blocks`,
        message: `serialized blocks must be at most ${MAX_SERIALIZED_BLOCK_BYTES} bytes`,
      });
    }

    const blockIds = new Set<string>();
    const actionIds = new Set<string>();

    message.blocks.forEach((block, blockIndex) => {
      const blockPath = `${messagePath}.blocks[${blockIndex}]`;
      if (!isObject(block)) {
        issues.push({ path: blockPath, message: "must be an object" });
        return;
      }
      if (typeof block.type !== "string" || block.type.trim().length === 0) {
        issues.push({ path: `${blockPath}.type`, message: "must be a non-empty string" });
        return;
      }

      const unsupportedReason = V1_UNSUPPORTED_BLOCK_TYPES.get(block.type);
      if (unsupportedReason) {
        issues.push({ path: `${blockPath}.type`, message: unsupportedReason });
      } else if (!KNOWN_DISPLAY_BLOCK_TYPES.has(block.type)) {
        warnings.push({
          path: `${blockPath}.type`,
          message: `unknown block type ${block.type} will be passed through to Slack`,
        });
      }

      if (block.type === "section" && block.accessory !== undefined) {
        if (!isObject(block.accessory) || block.accessory.type !== "image") {
          issues.push({
            path: `${blockPath}.accessory`,
            message: "display-only v1 only supports image section accessories",
          });
        }
      }

      if (block.block_id !== undefined) {
        if (typeof block.block_id !== "string" || block.block_id.trim().length === 0) {
          issues.push({ path: `${blockPath}.block_id`, message: "must be a non-empty string" });
        } else if (block.block_id.length > MAX_BLOCK_ID_LENGTH) {
          issues.push({
            path: `${blockPath}.block_id`,
            message: `must be at most ${MAX_BLOCK_ID_LENGTH} characters`,
          });
        } else if (blockIds.has(block.block_id)) {
          issues.push({ path: `${blockPath}.block_id`, message: "must be unique within a message" });
        } else {
          blockIds.add(block.block_id);
        }
      }

      inspectNode({ value: block, path: blockPath, actionIds, issues });
    });
  });

  if (totalSerializedBytes > MAX_TOTAL_SERIALIZED_BLOCK_BYTES) {
    issues.push({
      path: "messages",
      message: `total serialized blocks must be at most ${MAX_TOTAL_SERIALIZED_BLOCK_BYTES} bytes`,
    });
  }

  return issues.length > 0 ? { ok: false, issues, warnings } : { ok: true, warnings };
}
