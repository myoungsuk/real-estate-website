// 글 초안(P3) 시험의 가짜 OpenAI(시험 파일이 아니라 npm test가 직접 돌리지 않음). 실제 OpenAI는 부르지 않는다.
// - scriptedOpenAi(steps): 정해 둔 순서대로만 답하는 가짜 fetch. 허용 경로 3개(생성·조회·취소) 밖이거나 정하지 않은 호출이면 바로 실패로 기록한다.
//   Authorization은 값 대신 "가짜 표식과 같은지"만 남긴다.
// - installNetworkTrap(t): 전역 fetch를 "주소만 기록하고 바로 실패"로 바꾸고, 시험이 끝나면 되돌리며 기록 0건을 확인한다(TK-29와 같은 방식).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { workEnv } from "./work-test-kit.mjs";

export const FAKE_OPENAI_KEY = "ZZOPENAI-7F3A-0000000000000000";
export const FAKE_MODEL = "gpt-test-blog";
// 100만 토큰당 마이크로달러: 입력 2달러·출력 10달러(설계서 22.11의 gpt-6.1-sol 단가와 같은 크기, 시험용 이름).
export const FAKE_PRICES = { [FAKE_MODEL]: { input: 2_000_000, output: 10_000_000 } };
export const FAKE_MAX_OUTPUT = 20_000;
const API = "https://api.openai.com/v1";

export const blogEnv = (db, extra = {}) => workEnv(db, {
  WORK_TOOLS_ENABLED: undefined,
  WORK_BLOG_ENABLED: "true",
  OPENAI_API_KEY: FAKE_OPENAI_KEY,
  OPENAI_MODEL: FAKE_MODEL,
  OPENAI_REASONING_EFFORT: "xhigh",
  OPENAI_MAX_OUTPUT_TOKENS: String(FAKE_MAX_OUTPUT),
  OPENAI_PRICES_JSON: JSON.stringify(FAKE_PRICES),
  ...extra,
});

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/openai-blog/${name}`, import.meta.url), "utf8"));

const jsonResponse = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "x-request-id": "req_fake_0001", ...headers } });

// ── 응답 만들기 ──
export const created = (id, status = "queued") => () => jsonResponse(200, { id, object: "response", status, background: true, model: FAKE_MODEL, output: [] });
export const pending = (id, status = "in_progress") => () => jsonResponse(200, { id, object: "response", status, background: true, model: FAKE_MODEL, output: [] });
export function completed(id, result, usage = { input_tokens: 4000, output_tokens: 5000 }) {
  return () => {
    const body = fixture("response-completed.json");
    body.id = id;
    body.output[1].content[0].text = typeof result === "string" ? result : JSON.stringify(result);
    body.usage = { ...body.usage, ...usage };
    return jsonResponse(200, body);
  };
}
export const incomplete = (id) => () => jsonResponse(200, { ...fixture("response-incomplete.json"), id });
export const refusal = (id) => () => jsonResponse(200, { ...fixture("response-refusal.json"), id });
export const failedResponse = (id) => () => jsonResponse(200, { id, object: "response", status: "failed", output: [], usage: { input_tokens: 4000, output_tokens: 0 } });
export const httpError = (status, headers = {}) => () => jsonResponse(status, { error: { message: "fake upstream error", type: "fake" } }, headers);
export const networkError = () => () => {
  throw new TypeError("fetch failed");
};
export const timeoutError = () => () => {
  throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
};

// 정상 결과 하나(입력 사실 숫자만 씀). 시험마다 덮어쓴다.
export const sampleResult = (overrides = {}) => ({
  title: "리더스시티 5블록 단지 소개",
  paragraphs: ["리더스시티 5블록 단지를 소개합니다.", "자세한 조건은 사무소로 문의해 주세요."],
  hashtags: ["대전동구", "#리더스시티"],
  snsShort: "리더스시티 5블록 단지 소개 글입니다.",
  factsUsed: ["단지 이름"],
  ...overrides,
});

// steps: [{ kind: "create"|"retrieve"|"cancel", respond }] 순서대로.
export function scriptedOpenAi(steps = []) {
  const queue = [...steps];
  const calls = [];
  const violations = [];
  const fetcher = async (url, init = {}) => {
    const href = String(url);
    const method = (init.method ?? "GET").toUpperCase();
    const path = href.startsWith(API) ? href.slice(API.length) : href;
    let kind = null;
    if (method === "POST" && path === "/responses") kind = "create";
    else if (method === "GET" && /^\/responses\/[A-Za-z0-9_-]+$/u.test(path)) kind = "retrieve";
    else if (method === "POST" && /^\/responses\/[A-Za-z0-9_-]+\/cancel$/u.test(path)) kind = "cancel";
    const auth = init.headers?.Authorization ?? init.headers?.authorization ?? null;
    const call = { kind, method, path, authIsFakeKey: auth === `Bearer ${FAKE_OPENAI_KEY}`, body: typeof init.body === "string" ? JSON.parse(init.body) : null, hasSignal: Boolean(init.signal) };
    calls.push(call);
    if (!kind) {
      violations.push(`허용하지 않은 경로 ${method} ${path}`);
      throw new Error("허용하지 않은 OpenAI 경로");
    }
    const step = queue.shift();
    if (!step || step.kind !== kind) {
      violations.push(`정하지 않은 호출 ${kind}`);
      throw new Error("정하지 않은 OpenAI 호출");
    }
    return step.respond(call);
  };
  return { fetcher, calls, violations, remaining: () => queue.length };
}

export function installNetworkTrap(t) {
  const original = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = async (...args) => {
    outbound.push(String(args[0]?.url ?? args[0]));
    throw new Error("시험 중 실제 외부 요청 금지");
  };
  t.after(() => {
    globalThis.fetch = original;
    assert.deepEqual(outbound, [], "실제 외부 요청 0번");
  });
  return outbound;
}
