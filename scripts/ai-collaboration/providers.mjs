const MAX_RESPONSE_BYTES = 1_000_000;

// No shell, tools, filesystem access, or automatic HTTP retries are exposed to models.
export async function postJson(url, body, headers = {}, fetcher = fetch) {
  const response = await fetcher(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180_000),
    headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`PROVIDER_HTTP_${response.status}`);
  if (!response.body) throw new Error('PROVIDER_EMPTY_RESPONSE');
  let text = '';
  let bytes = 0;
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) throw new Error('PROVIDER_RESPONSE_TOO_LARGE');
    text += decoder.decode(chunk, { stream: true });
  }
  return JSON.parse(text + decoder.decode());
}

export function providers(env, fetcher = fetch) {
  const required = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'BOAT_CODEX_MODEL', 'BOAT_CLAUDE_MODEL'];
  const missing = required.filter((name) => !env[name]?.trim());
  if (missing.length) throw new Error(`MISSING_CONFIGURATION:${missing.join(',')}`);
  return {
    writer: async (input) => {
      const response = await postJson('https://api.openai.com/v1/responses', {
        model: env.BOAT_CODEX_MODEL,
        instructions: `${input.rules}\nReturn only JSON: {"summary":"変更理由","files":[{"path":"許可パス","content":"変更後の全文"}]}. Include only changed files. Do not use Markdown fences.`,
        input: JSON.stringify(input), max_output_tokens: 16000, store: false,
      }, { authorization: `Bearer ${env.OPENAI_API_KEY}` }, fetcher);
      if (response.status !== 'completed') throw new Error('WRITER_INCOMPLETE');
      const text = (response.output ?? []).filter((item) => item.type === 'message')
        .flatMap((item) => item.content ?? []).filter((item) => item.type === 'output_text').map((item) => item.text).join('');
      return JSON.parse(text);
    },
    reviewer: async (input) => {
      const response = await postJson('https://api.anthropic.com/v1/messages', {
        model: env.BOAT_CLAUDE_MODEL, max_tokens: 6000,
        system: `${input.rules}\nReview correctness, regression risk, tests, and wallet boundaries against the original. Return only JSON: {"candidateDigest":"the exact supplied digest","verdict":"approve|revise|blocked","issues":["具体的な指摘"]}. Approve requires no issues. A request outside the allowed scope must be blocked. Do not use Markdown fences.`,
        messages: [{ role: 'user', content: JSON.stringify(input) }],
      }, { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' }, fetcher);
      if (response.stop_reason !== 'end_turn') throw new Error('REVIEWER_INCOMPLETE');
      return JSON.parse((response.content ?? []).filter((item) => item.type === 'text').map((item) => item.text).join(''));
    },
  };
}
