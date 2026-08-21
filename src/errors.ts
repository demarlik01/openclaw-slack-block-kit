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
  const candidate = error instanceof Error ? (error as SlackLikeError) : undefined;
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
    message: candidate?.message || "Slack message delivery failed",
  };
}
