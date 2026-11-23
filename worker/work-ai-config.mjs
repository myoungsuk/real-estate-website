// OpenAI 설정 검사(설계서 14.2·22.2절). 모델 이름·단가는 코드에 박지 않고 Worker Secret 값만 읽는다.
// 단계 4의 isWorkAiEnabled()는 아직 없어서 P3가 이 부품을 먼저 만들고, 단계 4가 그 위에 쌓는다(R2·단계 2 켜기 값은 여기서 보지 않음).
// 값 자체는 돌려주지 않는다(키는 어디에도 내보내지 않음).
import { isWorkFilesEnabled } from "./work-security.mjs";

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;
const EFFORT_PATTERN = /^[a-z]{2,16}$/u;
const TASK_MODEL_KEYS = { blog: "OPENAI_MODEL_BLOG", contractA: "OPENAI_MODEL_CONTRACT_A", contractB: "OPENAI_MODEL_CONTRACT_B" };
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

// ── 단계 4: 계약서 두 번 읽기 설정(설계서 14.2절) ──

// 사진 세부도. 코드에 기본값을 두지 않는다(켜는 사람이 비용을 보고 정함, 2026-11-23 대장 결정). high·original만 받는다.
export const IMAGE_DETAILS = Object.freeze(["high", "original"]);
// 사진 한 장의 입력 토큰 상한 추정(예약 비용 계산용, 실제 값은 결과를 받은 뒤 바로잡는다).
// 공식 문서 Images and vision(2026-11-23 확인): high는 모델에 따라 2,500 ~ 6,144조각, original은 30,000조각을 넘으면 거부, 조각당 1.2토큰.
// gpt-6.1-sol의 조각 규칙은 문서 표에 없어(확인 못 함) high는 표의 가장 큰 값으로 잡는다.
export const IMAGE_TOKENS_MAX = Object.freeze({ high: 7_500, original: 36_000 });

export function readImageDetail(env) {
  const detail = typeof env?.OPENAI_IMAGE_DETAIL === "string" ? env.OPENAI_IMAGE_DETAIL.trim() : "";
  return IMAGE_DETAILS.includes(detail) ? detail : null;
}

// 돌려주는 값: { a, b, detail, sameModel } 또는 { error }.
// - error "disabled": 키·기본 모델·추론·출력 상한·사진 세부도가 없거나 꼴이 틀림(AI를 켜지 않은 것과 같은 갈래).
// - error "invalid": 설정된 모델이 단가표에 없음(비용을 계산하지 못한 채 보내지 않음, 14.2절).
// a·b는 { model, effort, maxOutputTokens, prices }. OPENAI_MODEL_CONTRACT_B가 비면 b는 기본 모델이다. 두 모델 이름이 같으면 sameModel이 참이다(교차 아님).
export function readContractAiConfig(env) {
  if (typeof env?.OPENAI_API_KEY !== "string" || env.OPENAI_API_KEY.trim().length < MIN_KEY_LENGTH) return { error: "disabled" };
  const read = (key) => (typeof env[key] === "string" ? env[key].trim() : "");
  const base = read("OPENAI_MODEL");
  const modelA = read(TASK_MODEL_KEYS.contractA) || base;
  const modelB = read(TASK_MODEL_KEYS.contractB) || base;
  if (!MODEL_PATTERN.test(base) || !MODEL_PATTERN.test(modelA) || !MODEL_PATTERN.test(modelB)) return { error: "disabled" };
  const effort = read("OPENAI_REASONING_EFFORT");
  if (!EFFORT_PATTERN.test(effort)) return { error: "disabled" };
  const maxOutputTokens = Number(env.OPENAI_MAX_OUTPUT_TOKENS);
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < MAX_OUTPUT_RANGE[0] || maxOutputTokens > MAX_OUTPUT_RANGE[1]) return { error: "disabled" };
  const detail = readImageDetail(env);
  if (!detail) return { error: "disabled" };
  const pricesA = readModelPrices(env, modelA);
  const pricesB = readModelPrices(env, modelB);
  if (!pricesA || !pricesB) return { error: "invalid" };
  return {
    a: { model: modelA, effort, maxOutputTokens, prices: pricesA },
    b: { model: modelB, effort, maxOutputTokens, prices: pricesB },
    detail,
    sameModel: modelA === modelB,
  };
}

// AI 경로(/work/ai/*)와 1분 예약의 켜기 판정. 업무 도구 켜기 값(WORK_TOOLS_ENABLED)은 부르는 쪽이 먼저 본다.
// "disabled": WORK_AI_ENABLED가 정확히 "true"가 아니거나, 파일 기능이 꺼졌거나, 설정이 빠짐 / "config_invalid": 모델이 단가표에 없음 / "enabled"
export function getWorkAiState(env, files = env?.WORK_FILES) {
  if (env?.WORK_AI_ENABLED !== "true") return "disabled";
  if (!isWorkFilesEnabled(env, files)) return "disabled";
  const config = readContractAiConfig(env);
  if (config.error) return config.error === "invalid" ? "config_invalid" : "disabled";
  return "enabled";
}
