import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";

export const COMPLETED_RUN_TTL_MS = 5 * 60_000;
export const MAX_COMPLETED_RUNS = 1_024;
export const MAX_TOOL_CALLS_PER_RUN = 256;

const TOOL_NAME = "slack_blocks_send";

type RunRef = {
  runId?: string;
  sessionKey?: string;
};

type CompletedRun = {
  eligible: boolean;
  correlationEligible: boolean;
  unkeyedEligible: boolean;
  capacityEligible: boolean;
  expiresAt: number;
  sessionKey?: string;
  toolCalls: Map<string, boolean>;
};

type CompletionStoreOptions = {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
};

function normalizedId(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function resolveExactId(first: string | undefined, second: string | undefined) {
  const normalizedFirst = normalizedId(first);
  const normalizedSecond = normalizedId(second);
  if (normalizedFirst && normalizedSecond && normalizedFirst !== normalizedSecond) {
    return undefined;
  }
  return normalizedFirst ?? normalizedSecond;
}

function idsConflict(first: string | undefined, second: string | undefined) {
  const normalizedFirst = normalizedId(first);
  const normalizedSecond = normalizedId(second);
  return Boolean(
    normalizedFirst && normalizedSecond && normalizedFirst !== normalizedSecond,
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PLAIN_TEXT_PAYLOAD_KEYS = new Set([
  "text",
  "replyToId",
  "replyToTag",
  "replyToCurrent",
]);

function isPlainTextEnvelopeEntry(key: string, value: unknown) {
  if (PLAIN_TEXT_PAYLOAD_KEYS.has(key)) {
    return true;
  }

  // OpenClaw normalizes text-only finals to `{ text, mediaUrl: null }` on the
  // CLI projection path, and to `{ text, replyToTag: false,
  // audioAsVoice: false }` before durable delivery. These empty/default slots
  // are transport metadata, not rich content.
  if (key === "mediaUrl") {
    return value === null || value === undefined;
  }
  if (key === "mediaUrls") {
    return value === undefined || (Array.isArray(value) && value.length === 0);
  }
  return key === "audioAsVoice" && (value === false || value === undefined);
}

/**
 * The hook is deliberately narrower than ReplyPayload. Unknown, rich, notice,
 * reasoning, and operator-owned payloads fail open so the plugin cannot hide
 * host diagnostics as OpenClaw evolves.
 */
export function isSuppressiblePlainTextFinal(payload: unknown): boolean {
  if (!isObject(payload) || typeof payload.text !== "string" || payload.text.trim() === "") {
    return false;
  }

  return Object.entries(payload).every(([key, value]) =>
    isPlainTextEnvelopeEntry(key, value),
  );
}

export function isCompletedSlackBlocksSendResult(result: unknown): boolean {
  if (!isObject(result) || !isObject(result.details)) {
    return false;
  }
  return (
    result.details.ok === true &&
    result.details.status === "sent" &&
    result.details.complete === true
  );
}

/**
 * Keeps completion evidence past the host's terminal run-context cleanup,
 * which can happen before the outer final reply reaches delivery hooks.
 */
export class CompletedRunStore {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly runs = new Map<string, CompletedRun>();

  constructor(options: CompletionStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? COMPLETED_RUN_TTL_MS;
    this.maxEntries = options.maxEntries ?? MAX_COMPLETED_RUNS;
    this.now = options.now ?? Date.now;
  }

  observe(params: {
    runId: string;
    sessionKey?: string;
    toolCallId?: string;
    completedSlackSend: boolean;
  }) {
    this.prune();
    const runId = normalizedId(params.runId);
    if (!runId) {
      return;
    }

    const existing = this.runs.get(runId);
    const sessionKey = normalizedId(params.sessionKey);
    const sessionConflict = Boolean(
      existing?.sessionKey && sessionKey && existing.sessionKey !== sessionKey,
    );
    const toolCallId = normalizedId(params.toolCallId);
    const toolCalls = existing?.toolCalls ?? new Map<string, boolean>();
    let correlationEligible =
      existing?.correlationEligible !== false && !sessionConflict;
    let unkeyedEligible = existing?.unkeyedEligible ?? true;
    let capacityEligible = existing?.capacityEligible ?? true;

    if (toolCallId) {
      const prior = toolCalls.get(toolCallId);
      if (prior !== undefined) {
        // One host tool invocation can be relayed through multiple harness
        // observers under different normalized names. Exact toolCallId is the
        // idempotency key; a confirmed complete send wins for that one call.
        toolCalls.set(toolCallId, prior || params.completedSlackSend);
      } else if (toolCalls.size >= MAX_TOOL_CALLS_PER_RUN) {
        capacityEligible = false;
      } else {
        toolCalls.set(toolCallId, params.completedSlackSend);
      }
    } else {
      // Without an exact call id, observations cannot be deduplicated safely.
      // Keep the conservative sticky fail-open behavior.
      unkeyedEligible = unkeyedEligible && params.completedSlackSend;
    }

    const eligible =
      correlationEligible &&
      unkeyedEligible &&
      capacityEligible &&
      [...toolCalls.values()].every(Boolean);

    this.runs.delete(runId);
    this.runs.set(runId, {
      // Distinct tool calls remain sticky: every exact call id must resolve to
      // a completed Slack send before a final can be suppressed.
      eligible,
      correlationEligible,
      unkeyedEligible,
      capacityEligible,
      expiresAt: this.now() + this.ttlMs,
      sessionKey: existing?.sessionKey ?? sessionKey,
      toolCalls,
    });

    while (this.runs.size > this.maxEntries) {
      const oldestRunId = this.runs.keys().next().value as string | undefined;
      if (!oldestRunId) {
        break;
      }
      this.runs.delete(oldestRunId);
    }
  }

  matches(params: { runId: string; sessionKey?: string }): boolean {
    this.prune();
    const runId = normalizedId(params.runId);
    if (!runId) {
      return false;
    }
    const completed = this.runs.get(runId);
    if (!completed?.eligible) {
      return false;
    }

    const sessionKey = normalizedId(params.sessionKey);
    return !completed.sessionKey || !sessionKey || completed.sessionKey === sessionKey;
  }

  clear(params: RunRef = {}) {
    const runId = normalizedId(params.runId);
    if (runId) {
      this.runs.delete(runId);
      return;
    }

    const sessionKey = normalizedId(params.sessionKey);
    if (sessionKey) {
      for (const [storedRunId, completed] of this.runs) {
        if (completed.sessionKey === sessionKey) {
          this.runs.delete(storedRunId);
        }
      }
      return;
    }

    this.runs.clear();
  }

  get size() {
    this.prune();
    return this.runs.size;
  }

  private prune() {
    const now = this.now();
    for (const [runId, completed] of this.runs) {
      if (completed.expiresAt <= now) {
        this.runs.delete(runId);
      }
    }
  }
}

export function registerCompletionHooks(
  api: OpenClawPluginApi,
  store = new CompletedRunStore(),
) {
  api.on("after_tool_call", (event, context) => {
    const runId = resolveExactId(event.runId, context.runId);
    if (!runId) {
      return;
    }

    const toolCallId = resolveExactId(event.toolCallId, context.toolCallId);
    const toolCallIdConflict = idsConflict(event.toolCallId, context.toolCallId);

    store.observe({
      runId,
      sessionKey: context.sessionKey,
      toolCallId,
      completedSlackSend:
        !toolCallIdConflict &&
        event.toolName === TOOL_NAME &&
        context.toolName === TOOL_NAME &&
        event.error === undefined &&
        isCompletedSlackBlocksSendResult(event.result),
    });
  });

  api.on(
    "reply_payload_sending",
    (event, context) => {
      if (
        event.kind !== "final" ||
        !isSuppressiblePlainTextFinal(event.payload) ||
        idsConflict(event.sessionKey, context.sessionKey)
      ) {
        return;
      }

      const channelId = resolveExactId(event.channel, context.channelId);
      const runId = resolveExactId(event.runId, context.runId);
      const sessionKey = resolveExactId(event.sessionKey, context.sessionKey);
      if (channelId !== "slack" || !runId || !store.matches({ runId, sessionKey })) {
        return;
      }

      // Do not consume the marker: a single final answer may be chunked into
      // multiple payloads, and every final chunk must remain suppressed.
      return {
        cancel: true,
        reason: "slack_blocks_send already delivered the visible final response",
      };
    },
    // Run after transforms and audit hooks. This is only a final duplicate
    // delivery safety net, never a first-line response mechanism.
    { priority: -1_000 },
  );

  api.on("gateway_stop", () => {
    store.clear();
  });

  api.lifecycle.registerRuntimeLifecycle({
    id: "slack-block-kit-completion-store",
    description: "Clear bounded run completion markers during plugin lifecycle cleanup.",
    cleanup: ({ runId, sessionKey }) => {
      store.clear({ runId, sessionKey });
    },
  });

  return store;
}
