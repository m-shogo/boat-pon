import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLinePushRequest,
  buildLineText,
  lineMessagingConfigFromEnv,
  lineRetryKey,
  sendLinePushText,
  sendLinePushTextToRecipients,
  splitLineRecipients,
  truncateLineText,
} from "./lineMessaging";

test("LINE recipients are comma-separated, trimmed, and deduplicated", () => {
  assert.deepEqual(splitLineRecipients(" U111 , C222, U111 ,, R333 "), ["U111", "C222", "R333"]);
});

test("LINE text joins title, body, and official URL", () => {
  assert.equal(
    buildLineText("🎯 BUY候補", "蒲郡 8R\n候補: 1-3-4", "https://example.com/race"),
    "🎯 BUY候補\n\n蒲郡 8R\n候補: 1-3-4\n\n公式: https://example.com/race",
  );
});

test("LINE text is capped to the Messaging API text limit", () => {
  const text = truncateLineText("a".repeat(5005));
  assert.equal(text.length, 5000);
  assert.equal(text.at(-1), "…");
});

test("LINE push request uses a single text message", () => {
  assert.deepEqual(buildLinePushRequest("U123", "hello"), {
    to: "U123",
    messages: [{ type: "text", text: "hello" }],
  });
});

test("LINE config requires token and recipient", () => {
  assert.deepEqual(lineMessagingConfigFromEnv({}), {
    enabled: false,
    reason: "BOAT_PON_LINE_CHANNEL_ACCESS_TOKEN is not set",
    dryRun: false,
    recipients: [],
  });

  assert.deepEqual(lineMessagingConfigFromEnv({ BOAT_PON_LINE_CHANNEL_ACCESS_TOKEN: "token" }), {
    enabled: false,
    reason: "BOAT_PON_LINE_TO is not set",
    dryRun: false,
    recipients: [],
  });
});

test("LINE config supports dry-run and custom endpoint", () => {
  assert.deepEqual(lineMessagingConfigFromEnv({
    BOAT_PON_LINE_CHANNEL_ACCESS_TOKEN: " token ",
    BOAT_PON_LINE_TO: "U111,C222",
    BOAT_PON_LINE_DRY_RUN: "1",
    BOAT_PON_LINE_ENDPOINT: "https://example.test/push",
  }), {
    enabled: true,
    config: {
      channelAccessToken: "token",
      recipients: ["U111", "C222"],
      dryRun: true,
      endpoint: "https://example.test/push",
    },
  });
});

test("LINE push sends the expected request", async () => {
  const calls: Array<{ input: string; body: unknown; headers: Record<string, string> }> = [];
  await sendLinePushText({
    channelAccessToken: "test-token",
    to: "U123",
    text: "hello",
    endpoint: "https://example.test/push",
    fetchImpl: async (input, init) => {
      calls.push({
        input,
        body: JSON.parse(init.body),
        headers: init.headers,
      });
      return { ok: true, status: 200, statusText: "OK", text: async () => "{}" };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, "https://example.test/push");
  assert.equal(calls[0].headers.Authorization, "Bearer test-token");
  assert.deepEqual(calls[0].body, {
    to: "U123",
    messages: [{ type: "text", text: "hello" }],
  });
});

test("LINE push exposes API error details", async () => {
  await assert.rejects(
    sendLinePushText({
      channelAccessToken: "test-token",
      to: "U123",
      text: "hello",
      endpoint: "https://example.test/push",
      fetchImpl: async () => ({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "bad token" }),
    }),
    /LINE push failed: 401 Unauthorized bad token/,
  );
});

test("LINE push retries temporary DNS failures", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const result = await sendLinePushText({
    channelAccessToken: "test-token",
    to: "U123",
    text: "hello",
    endpoint: "https://example.test/push",
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) {
        const cause = Object.assign(new Error("dns lookup failed"), { code: attempts === 1 ? "ENOTFOUND" : "EAI_AGAIN" });
        throw new TypeError("fetch failed", { cause });
      }
      return { ok: true, status: 200, statusText: "OK", text: async () => "{}" };
    },
    sleepImpl: async (delayMs) => {
      delays.push(delayMs);
    },
  });

  assert.equal(result.status, 200);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [5_000, 15_000]);
});

test("LINE push does not retry ambiguous network failures", async () => {
  let attempts = 0;
  await assert.rejects(
    sendLinePushText({
      channelAccessToken: "test-token",
      to: "U123",
      text: "hello",
      endpoint: "https://example.test/push",
      fetchImpl: async () => {
        attempts += 1;
        throw new TypeError("fetch failed");
      },
      sleepImpl: async () => {
        assert.fail("unexpected retry");
      },
    }),
    /fetch failed/,
  );
  assert.equal(attempts, 1);
});

test("再試行キーは通知と宛先ごとに決まった UUID 形式で、ヘッダーに付く", async () => {
  const key = lineRetryKey("line-daily-2026-10-15", "U123");
  assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(lineRetryKey("line-daily-2026-10-15", "U123"), key);
  assert.notEqual(lineRetryKey("line-daily-2026-10-15", "U999"), key);
  assert.notEqual(lineRetryKey("line-daily-2026-10-16", "U123"), key);
  const seen: string[] = [];
  await sendLinePushTextToRecipients({
    channelAccessToken: "t", recipients: ["U123"], text: "hi", endpoint: "https://example.test/push", retryKeyBase: "line-daily-2026-10-15",
    fetchImpl: async (_input, init) => { seen.push(init.headers["X-Line-Retry-Key"]); return { ok: true, status: 200, statusText: "OK", text: async () => "{}" }; },
  });
  assert.deepEqual(seen, [key]);
});

test("再試行キーがあれば、届いたかわからない失敗と 5xx を同じキーで送り直し、409（受け付け済み）は成功として扱う", async () => {
  const keys: string[] = [];
  let attempts = 0;
  const result = await sendLinePushText({
    channelAccessToken: "t", to: "U123", text: "hi", endpoint: "https://example.test/push", retryKey: "k-1",
    fetchImpl: async (_input, init) => {
      attempts += 1;
      keys.push(init.headers["X-Line-Retry-Key"]);
      if (attempts === 1) throw new TypeError("fetch failed");
      if (attempts === 2) return { ok: false, status: 503, statusText: "Unavailable", text: async () => "" };
      return { ok: false, status: 409, statusText: "Conflict", text: async () => '{"message":"The retry key is already accepted"}' };
    },
    sleepImpl: async () => {},
  });
  assert.equal(result.status, 409);
  assert.equal((result as { alreadyAccepted?: boolean }).alreadyAccepted, true);
  assert.deepEqual(keys, ["k-1", "k-1", "k-1"]);
});

test("応答が返らない送信は期限で打ち切る（キーが無ければ送り直さない）", async () => {
  await assert.rejects(
    sendLinePushText({
      channelAccessToken: "t", to: "U123", text: "hi", endpoint: "https://example.test/push", timeoutMs: 20,
      fetchImpl: (_input, init) => new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
      sleepImpl: async () => assert.fail("unexpected retry"),
    }),
    /timeout|aborted/i,
  );
});

test("409 は再試行キーが無ければ失敗のまま", async () => {
  await assert.rejects(
    sendLinePushText({
      channelAccessToken: "t", to: "U123", text: "hi", endpoint: "https://example.test/push",
      fetchImpl: async () => ({ ok: false, status: 409, statusText: "Conflict", text: async () => "" }),
    }),
    /LINE push failed: 409/,
  );
});

test("締め切りを過ぎたら、送り直しを含めて新しい送信を始めない", async () => {
  let attempts = 0;
  await assert.rejects(
    sendLinePushText({
      channelAccessToken: "t", to: "U123", text: "hi", endpoint: "https://example.test/push", retryKey: "k-2",
      deadlineMs: Date.now() + 50,
      fetchImpl: async () => { attempts += 1; throw new TypeError("fetch failed"); },
      sleepImpl: (ms) => new Promise((resolve) => setTimeout(resolve, ms > 100 ? 100 : ms)),
    }),
    /past deadline/,
  );
  assert.equal(attempts, 1);
});
