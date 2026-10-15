import { createHash } from "node:crypto";

export const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";
export const LINE_TEXT_MAX_LENGTH = 5000;

type FetchLike = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

type SleepLike = (delayMs: number) => Promise<void>;

const LINE_DNS_RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;

function errorCode(error: unknown): string | null {
  let current = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = Reflect.get(current, "code");
    if (typeof code === "string") return code;
    current = Reflect.get(current, "cause");
  }
  return null;
}

function isRetryableDnsError(error: unknown): boolean {
  return ["ENOTFOUND", "EAI_AGAIN"].includes(errorCode(error) ?? "");
}

/** 1回の送信（応答の本文を読むまで）の期限。応答が返らないまま処理が止まらないように（2026-10-15 の監査）。 */
export const LINE_PUSH_TIMEOUT_MS = 20_000;

/**
 * LINE の再試行キー（X-Line-Retry-Key、16進の UUID 形式・24時間有効）。同じキーで送り直すと、受け付け済みなら 409 が返り、二重には届かない。
 * 通知ごと・宛先ごとに決まった値にして、タイムアウトや別のプロセスからの送り直しでも重複しないようにする。
 */
export function lineRetryKey(base: string, to: string): string {
  const hex = createHash("sha256").update(`boat-pon:${base}:${to}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4"; // version 4 の形
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16); // variant
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

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
  sleepImpl?: SleepLike;
  /** 再試行キー。あれば、通信の失敗・タイムアウト・5xx でも同じキーで送り直す（二重には届かない）。 */
  retryKey?: string;
  timeoutMs?: number;
  /** この時刻（エポックミリ秒）を過ぎたら、送り直しを含めて新しい送信を始めない（BUY 通知の締め切り）。 */
  deadlineMs?: number;
}) {
  const endpoint = args.endpoint ?? LINE_PUSH_ENDPOINT;
  const fetchImpl = args.fetchImpl ?? fetch;
  const sleepImpl = args.sleepImpl ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const request = buildLinePushRequest(args.to, args.text);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${args.channelAccessToken}`,
  };
  if (args.retryKey) headers["X-Line-Retry-Key"] = args.retryKey;
  for (let attempt = 0; ; attempt += 1) {
    if (args.deadlineMs != null && Date.now() > args.deadlineMs) throw new Error("LINE push skipped: past deadline");
    const delayMs = LINE_DNS_RETRY_DELAYS_MS[attempt];
    let response: Awaited<ReturnType<FetchLike>>;
    let responseText: string;
    try {
      const signal = AbortSignal.timeout(args.timeoutMs ?? LINE_PUSH_TIMEOUT_MS);
      response = await fetchImpl(endpoint, { method: "POST", headers, body: JSON.stringify(request), signal });
      responseText = await response.text();
    } catch (error) {
      // キーが無いときは、届いたかどうかわからない失敗を送り直さない（二重送信になりうる）。DNS の失敗だけは届いていないので送り直す。
      if (delayMs == null || !(isRetryableDnsError(error) || args.retryKey)) throw error;
      await sleepImpl(delayMs);
      continue;
    }
    if (response.ok) return { status: response.status, body: responseText };
    // 同じキーの送信が受け付け済み（前の回で届いていた）。成功として扱う。
    if (response.status === 409 && args.retryKey) return { status: response.status, body: responseText, alreadyAccepted: true };
    if (response.status >= 500 && args.retryKey && delayMs != null) {
      await sleepImpl(delayMs);
      continue;
    }
    const detail = responseText ? ` ${responseText}` : "";
    throw new Error(`LINE push failed: ${response.status} ${response.statusText}${detail}`);
  }
}

export async function sendLinePushTextToRecipients(args: {
  channelAccessToken: string;
  recipients: string[];
  text: string;
  endpoint?: string;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
  /** 通知ごとに決まった文字列（例: notification_log の race_id）。宛先ごとの再試行キーを作る。 */
  retryKeyBase?: string;
  deadlineMs?: number;
}) {
  const results: Array<{ to: string; status: number; body: string }> = [];
  for (const to of args.recipients) {
    const result = await sendLinePushText({
      channelAccessToken: args.channelAccessToken,
      to,
      text: args.text,
      endpoint: args.endpoint,
      fetchImpl: args.fetchImpl,
      sleepImpl: args.sleepImpl,
      retryKey: args.retryKeyBase ? lineRetryKey(args.retryKeyBase, to) : undefined,
      deadlineMs: args.deadlineMs,
    });
    results.push({ to, ...result });
  }
  return results;
}
