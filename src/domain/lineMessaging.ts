export const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
export const LINE_TEXT_MAX_LENGTH = 5000;

type FetchLike = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

export type LineMessagingConfig = {
  channelAccessToken: string;
  recipients: string[];
  dryRun: boolean;
  endpoint?: string;
};

export type LineMessagingConfigResult =
  | { enabled: true; config: LineMessagingConfig }
  | { enabled: false; reason: string; dryRun: boolean; recipients: string[] };

export function splitLineRecipients(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const recipients: string[] = [];
  for (const raw of (value ?? "").split(",")) {
    const recipient = raw.trim();
    if (!recipient || seen.has(recipient)) continue;
    seen.add(recipient);
    recipients.push(recipient);
  }
  return recipients;
}

export function truncateLineText(text: string, maxLength = LINE_TEXT_MAX_LENGTH): string {
  if (text.length <= maxLength) return text;
  if (maxLength <= 1) return "…".slice(0, maxLength);
  return `${text.slice(0, maxLength - 1)}…`;
}

export function buildLineText(title: string, body?: string, url?: string): string {
  const parts = [
    title.trim(),
    body?.trim(),
    url?.trim() ? `公式: ${url.trim()}` : null,
  ].filter((part): part is string => Boolean(part));
  return truncateLineText(parts.join("\n\n"));
}

export function buildLinePushRequest(to: string, text: string) {
  return {
    to,
    messages: [
      {
        type: "text" as const,
        text: truncateLineText(text),
      },
    ],
  };
}

export function lineMessagingConfigFromEnv(env: NodeJS.ProcessEnv): LineMessagingConfigResult {
  const dryRun = env.BOAT_PON_LINE_DRY_RUN === "1" || env.BOAT_PON_LINE_DRY_RUN === "true";
  const channelAccessToken = env.BOAT_PON_LINE_CHANNEL_ACCESS_TOKEN?.trim() ?? "";
  const recipients = splitLineRecipients(env.BOAT_PON_LINE_TO);
  const endpoint = env.BOAT_PON_LINE_ENDPOINT?.trim() || undefined;

  if (!channelAccessToken) {
    return { enabled: false, reason: "BOAT_PON_LINE_CHANNEL_ACCESS_TOKEN is not set", dryRun, recipients };
  }
  if (recipients.length === 0) {
    return { enabled: false, reason: "BOAT_PON_LINE_TO is not set", dryRun, recipients };
  }
  return {
    enabled: true,
    config: {
      channelAccessToken,
      recipients,
      dryRun,
      endpoint,
    },
  };
}

export async function sendLinePushText(args: {
  channelAccessToken: string;
  to: string;
  text: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
}) {
  const endpoint = args.endpoint ?? LINE_PUSH_ENDPOINT;
  const fetchImpl = args.fetchImpl ?? fetch;
  const request = buildLinePushRequest(args.to, args.text);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.channelAccessToken}`,
    },
    body: JSON.stringify(request),
  });

  const responseText = await response.text();
  if (!response.ok) {
    const detail = responseText ? ` ${responseText}` : "";
    throw new Error(`LINE push failed: ${response.status} ${response.statusText}${detail}`);
  }

  return { status: response.status, body: responseText };
}

export async function sendLinePushTextToRecipients(args: {
  channelAccessToken: string;
  recipients: string[];
  text: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
}) {
  const results: Array<{ to: string; status: number; body: string }> = [];
  for (const to of args.recipients) {
    const result = await sendLinePushText({
      channelAccessToken: args.channelAccessToken,
      to,
      text: args.text,
      endpoint: args.endpoint,
      fetchImpl: args.fetchImpl,
    });
    results.push({ to, ...result });
  }
  return results;
}
