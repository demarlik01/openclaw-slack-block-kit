export type NormalizedToolError = {
  code: "SLACK_RATE_LIMITED" | "SLACK_API_ERROR";
  message: string;
  retryAfter?: number;
};

type SlackLikeError = Error & {
  statusCode?: number;
  retryAfter?: number;
  data?: {
    error?: string;
    retry_after?: number;
  };
  headers?: Record<string, string | number | undefined>;
};

const NESTED_ERROR_KEYS = ["cause", "original", "error"] as const;
const MAX_ERROR_GRAPH_NODES = 12;

function asSlackLikeError(error: unknown): SlackLikeError | undefined {
  if (error instanceof Error) {
    return error as SlackLikeError;
  }
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const record = error as Record<string, unknown>;
  const candidate = new Error(typeof record.message === "string" ? record.message : "");
  Object.assign(candidate, record);
  return candidate as SlackLikeError;
}

function readProperty(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function collectErrorCandidates(error: unknown): SlackLikeError[] {
  const candidates: SlackLikeError[] = [];
  const queue: unknown[] = [error];
  const seen = new Set<object>();

  while (queue.length > 0 && candidates.length < MAX_ERROR_GRAPH_NODES) {
    const current = queue.shift();
    if (typeof current !== "object" || current === null || seen.has(current)) {
      continue;
    }
    seen.add(current);

    const candidate = asSlackLikeError(current);
    if (candidate) {
      candidates.push(candidate);
    }

    for (const key of NESTED_ERROR_KEYS) {
      const nested = readProperty(current, key);
      if (typeof nested === "object" && nested !== null && !seen.has(nested)) {
        queue.push(nested);
      }
    }
  }

  return candidates;
}

function hasSlackMetadata(error: SlackLikeError): boolean {
  return (
    typeof error.statusCode === "number" ||
    typeof error.retryAfter === "number" ||
    typeof error.data?.error === "string" ||
    error.data?.retry_after !== undefined ||
    error.headers?.["retry-after"] !== undefined ||
    error.headers?.["Retry-After"] !== undefined
  );
}

function safeMessage(value: string | undefined): string {
  const message = (value?.trim() || "Slack message delivery failed")
    .replace(/xox[baprs]-[a-z0-9-]+/gi, "[REDACTED]")
    .replace(/bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(token|secret|password)=\S+/gi, "$1=[REDACTED]");
  return message.slice(0, 500);
}

function readRetryAfter(error: SlackLikeError | undefined): number | undefined {
  const value =
    error?.retryAfter ??
    error?.data?.retry_after ??
    error?.headers?.["retry-after"] ??
    error?.headers?.["Retry-After"];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export function normalizeSlackError(error: unknown): NormalizedToolError {
  const candidates = collectErrorCandidates(error);
  const candidate = candidates.find(hasSlackMetadata) ?? candidates[0];
  const slackCode = candidate?.data?.error?.toLowerCase();
  const isRateLimited =
    candidate?.statusCode === 429 || slackCode === "ratelimited" || slackCode === "rate_limited";

  if (isRateLimited) {
    return {
      code: "SLACK_RATE_LIMITED",
      message: "Slack rate limit exceeded",
      retryAfter: readRetryAfter(candidate),
    };
  }

  return {
    code: "SLACK_API_ERROR",
    message: safeMessage(slackCode ?? candidate?.message),
  };
}
