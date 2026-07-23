import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLinePushRequest,
  buildLineText,
  lineMessagingConfigFromEnv,
  sendLinePushText,
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
