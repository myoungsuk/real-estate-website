// OpenAI 설정 검사(설계서 14.2·22.2절). 모델 이름·단가는 코드에 박지 않고 Worker Secret 값만 읽는다.
// 단계 4의 isWorkAiEnabled()는 아직 없어서 P3가 이 부품을 먼저 만들고, 단계 4가 그 위에 쌓는다(R2·단계 2 켜기 값은 여기서 보지 않음).
// 값 자체는 돌려주지 않는다(키는 어디에도 내보내지 않음).

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const EFFORT_PATTERN = /^[a-z]{2,16}$/u;
const TASK_MODEL_KEYS = { blog: "OPENAI_MODEL_BLOG" };
const MIN_KEY_LENGTH = 20;
const MAX_OUTPUT_RANGE = [1_000, 200_000];
const PRICE_MAX = 1_000_000_000; // 100만 토큰당 1,000달러(마이크로달러)보다 크면 잘못 넣은 값으로 본다

// 모델 단가(100만 토큰당 마이크로달러). 초안을 만든 모델이 지금 설정 모델과 달라도 단가표에 있으면 그 값으로 바로잡는다.
export function readModelPrices(env, model) {
  if (typeof env?.OPENAI_PRICES_JSON !== "string") return null;
  let table;
  try {
    table = JSON.parse(env.OPENAI_PRICES_JSON);
  } catch {
    return null;
  }
  const price = table?.[model];
  const ok = (value) => Number.isSafeInteger(value) && value >= 0 && value <= PRICE_MAX;
  return price && ok(price.input) && ok(price.output) ? { input: price.input, output: price.output } : null;
}

// 작업별 설정(모델은 작업별 값이 비면 OPENAI_MODEL). 하나라도 빠지거나 틀리면 null.
export function readOpenAiTaskConfig(env, task) {
  if (typeof env?.OPENAI_API_KEY !== "string" || env.OPENAI_API_KEY.trim().length < MIN_KEY_LENGTH) return null;
  const taskModel = typeof env[TASK_MODEL_KEYS[task]] === "string" ? env[TASK_MODEL_KEYS[task]].trim() : "";
  const model = taskModel || (typeof env.OPENAI_MODEL === "string" ? env.OPENAI_MODEL.trim() : "");
  if (!MODEL_PATTERN.test(model)) return null;
  const effort = typeof env.OPENAI_REASONING_EFFORT === "string" ? env.OPENAI_REASONING_EFFORT.trim() : "";
  if (!EFFORT_PATTERN.test(effort)) return null;
  const maxOutputTokens = Number(env.OPENAI_MAX_OUTPUT_TOKENS);
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < MAX_OUTPUT_RANGE[0] || maxOutputTokens > MAX_OUTPUT_RANGE[1]) return null;
  const prices = readModelPrices(env, model);
  if (!prices) return null;
  return { model, effort, maxOutputTokens, prices };
}

export function hasOpenAiConfig(env, task) {
  return readOpenAiTaskConfig(env, task) !== null;
}

// 토큰 수 × 단가(100만 토큰당 마이크로달러) → 마이크로달러(올림).
export function estimateCostMicroUsd(prices, inputTokens, outputTokens) {
  return Math.ceil((inputTokens * prices.input + outputTokens * prices.output) / 1_000_000);
}
