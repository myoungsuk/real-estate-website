// 글 초안(P3) 카드 배경 그림 3장 만들기(설계서 22.22절, 2026-11-25 사용자 결정 "그냥 API 호출 기능으로", 대장 지시 범위 1).
// POST /work/blog/backgrounds 하나뿐이고 새 표·새 Secret·새 켜기 값·마이그레이션이 없다(글 초안 켜기 값·OpenAI 키·한도 행을 그대로 씀).
// - AI는 글자 없는 분위기 그림만 그린다. 숫자·이름·명시사항은 다음 PR의 화면 코드가 그림 위에 얹는다.
// - OpenAI Images API(POST /v1/images/generations)를 한 번 동기로 부른다(n = 3). 상태를 남기지 않으므로 조회 주소가 없다.
// - 그림 설명·만든 그림은 D1·R2·로그·감사 reason 어디에도 넣지 않고 이번 응답에만 싣는다.
// - 한도: 품질과 상관없이 하루 편수 1편 몫 + 최대 예상 비용을 미리 더하고, 받은 usage로 실제 비용을 한 번 바로잡는다.
// - 단가를 모르면(코드 표·OPENAI_PRICES_JSON 둘 다 없음) 만들지 않는다. 그림 속 글자는 자동으로 잡지 못한다(사람이 봄).
import office from "../src/data/office.json" with { type: "json" };
import { findPersonalPatterns } from "../src/lib/work/blog-checks.mjs";
import { WorkAiError, openaiRequest } from "./openai-client.mjs";
import { estimateCostMicroUsd, readModelPrices } from "./work-ai-config.mjs";
import { REFUND_UNCONDITIONAL_SQL, reserveAiBudget, settleUnconditionalStatement } from "./work-ai-budget.mjs";
import { auditStatement, runBatch } from "./work-audit.mjs";
import { invalid } from "./work-input.mjs";
import { WorkApiError } from "./work-security.mjs";

// 모델은 코드 상수이고, Worker 변수 OPENAI_MODEL_IMAGE가 있으면 그것을 쓴다(없어도 됨).
// 공식 안내(Image generation 가이드 'Earlier GPT Image models' 절, 2026-11-25 확인): "For new integrations, use GPT-Image-2.6 Sunburst or Flare".
export const BLOG_IMAGE_MODEL = "gpt-image-2.6-flare";
export const BLOG_IMAGE_COUNT = 3;
export const BLOG_IMAGE_SIZE = Object.freeze({ width: 1024, height: 1280 });
export const BLOG_IMAGE_QUALITIES = Object.freeze(["medium", "high"]);
export const BLOG_IMAGE_DESCRIPTION_MAX = 200;
const OUTPUT_COMPRESSION = 90;
const IMAGE_TIMEOUT_MS = 240_000; // 공식 안내 "Complex prompts may take up to 2 minutes"의 두 배
const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

// 100만 토큰당 마이크로달러. 공식 가격 페이지 Standard 표(2026-11-25 확인): GPT-Image-2.6 Sunburst·Flare
// 그림 입력 8달러·그림 출력 30달러·글자 입력 5달러. 2.5는 Standard 값을 안내 문서 문장에서 읽었다(가격 페이지 Batch 표의 두 배와 같음).
// OPENAI_PRICES_JSON에 같은 모델 항목({ input, output })이 있으면 그것을 먼저 쓴다(input = 글자·그림 입력, output = 그림 출력).
export const BLOG_IMAGE_PRICES_CHECKED_ON = "2026-11-25";
const STANDARD_IMAGE_PRICE = Object.freeze({ textInput: 5_000_000, imageInput: 8_000_000, imageOutput: 30_000_000 });
export const BLOG_IMAGE_PRICES = Object.freeze({
  "gpt-image-2.6-flare": STANDARD_IMAGE_PRICE,
  "gpt-image-2.6-sunburst": STANDARD_IMAGE_PRICE,
  "gpt-image-2.5-flare": STANDARD_IMAGE_PRICE,
  "gpt-image-2.5-sunburst": STANDARD_IMAGE_PRICE,
});
// 한 장의 출력 토큰 상한 추정(예약 비용 계산용, 받은 뒤 실제 값으로 바로잡음). 공식 비용 계산기에서 2.6의 1024×1280 값을 읽지 못해
// 가이드의 gpt-image-2 한 장 값 가운데 가장 큰 1024×1024(보통 0.053달러 ≈ 1,767토큰·높음 0.211달러 ≈ 7,034토큰)에 여유를 더한 추정이다.
export const BLOG_IMAGE_OUTPUT_TOKENS_MAX = Object.freeze({ medium: 2_500, high: 9_000 });
const PROMPT_TOKEN_MARGIN = 200;

export const BLOG_IMAGE_STYLES = Object.freeze({
  watercolor: "수채화. 부드러운 번짐과 맑은 색.",
  photo: "사진처럼 사실적인 자연 풍경. 사람과 건물은 넣지 않음.",
  pastel: "파스텔 톤 일러스트. 단순한 모양과 부드러운 색.",
  pencil: "색연필 스케치. 종이 결이 보이는 손그림.",
});
export const BLOG_IMAGE_DEFAULT_DESCRIPTION = "햇살이 드는 조용한 동네 산책로와 나무";
export const BLOG_IMAGE_FIXED_TEXT = "그림 안에 글자·숫자·로고 없이. 카드 배경으로 쓸 차분한 세로 그림.";

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const BODY_KEYS = new Set(["description", "style", "quality"]);

// 본문 검사(D1·감사·OpenAI 0회). 돌려주는 값: { description(빈 값이면 기본안), defaultUsed, style, quality }.
export function parseBackgroundsBody(body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !BODY_KEYS.has(key))) throw invalid(["body"]);
  const errors = [];
  const raw = body.description ?? "";
  if (typeof raw !== "string" || raw.length > BLOG_IMAGE_DESCRIPTION_MAX * 2 || /[\u0000-\u001f\u007f]/u.test(raw)) errors.push("description");
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length > BLOG_IMAGE_DESCRIPTION_MAX) errors.push("description");
  if (!Object.hasOwn(BLOG_IMAGE_STYLES, body.style)) errors.push("style");
  if (!BLOG_IMAGE_QUALITIES.includes(body.quality)) errors.push("quality");
  if (errors.length > 0) throw invalid([...new Set(errors)]);
  if (findPersonalPatterns(trimmed, { officePhone: office.mobile, checkUnit: true }).length > 0) {
    throw new WorkApiError("PERSONAL_DATA_PATTERN", "주민등록번호·전화번호·이메일·호수처럼 보이는 글자는 넣을 수 없습니다.", 400, false, ["description"]);
  }
  return { description: trimmed || BLOG_IMAGE_DEFAULT_DESCRIPTION, defaultUsed: trimmed === "", style: body.style, quality: body.quality };
}

export function buildImagePrompt({ description, style }) {
  return `${description}. ${BLOG_IMAGE_STYLES[style]} ${BLOG_IMAGE_FIXED_TEXT}`;
}

// 모델·단가. 하나라도 없으면 null(만들지 않음).
export function readImageConfig(env) {
  const override = typeof env?.OPENAI_MODEL_IMAGE === "string" ? env.OPENAI_MODEL_IMAGE.trim() : "";
  const model = override || BLOG_IMAGE_MODEL;
  if (!MODEL_PATTERN.test(model)) return null;
  const secretPrices = readModelPrices(env, model);
  if (secretPrices) return { model, prices: { textInput: secretPrices.input, imageInput: secretPrices.input, imageOutput: secretPrices.output } };
  const prices = BLOG_IMAGE_PRICES[model];
  return prices ? { model, prices: { ...prices } } : null;
}

export function buildImageRequest(config, { prompt, quality }) {
  return {
    model: config.model,
    prompt,
    n: BLOG_IMAGE_COUNT,
    size: `${BLOG_IMAGE_SIZE.width}x${BLOG_IMAGE_SIZE.height}`,
    quality,
    output_format: "jpeg",
    output_compression: OUTPUT_COMPRESSION,
  };
}

// 최대 예상 비용(마이크로달러, 올림): 프롬프트 글자 수 + 여유를 글자 입력 토큰으로, 장당 출력 상한 × 3을 그림 출력 토큰으로 본다.
export function reservedImageCost(config, { prompt, quality }) {
  const inputTokens = prompt.length + PROMPT_TOKEN_MARGIN;
  const outputTokens = BLOG_IMAGE_OUTPUT_TOKENS_MAX[quality] * BLOG_IMAGE_COUNT;
  return estimateCostMicroUsd({ input: config.prices.textInput, output: config.prices.imageOutput }, inputTokens, outputTokens);
}

// 받은 usage → { inputTokens, outputTokens, costMicroUsd }. 꼴이 틀리면 null(예약 값을 그대로 둠 = 많이 세는 쪽).
const tokenCount = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : null);
export function actualImageCost(prices, usage) {
  if (!isPlainObject(usage)) return null;
  const inputTokens = tokenCount(usage.input_tokens);
  const outputTokens = tokenCount(usage.output_tokens);
  if (inputTokens === null || outputTokens === null) return null;
  const details = isPlainObject(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const imageInput = Math.min(tokenCount(details.image_tokens) ?? 0, inputTokens);
  const textInput = inputTokens - imageInput;
  const costMicroUsd = Math.ceil((textInput * prices.textInput + imageInput * prices.imageInput + outputTokens * prices.imageOutput) / 1_000_000);
  return { inputTokens, outputTokens, costMicroUsd };
}

// ── 받은 그림 검사(꼴·크기·장수). 그림 속 글자는 보지 못한다. ──

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const BASE64_MAX_CHARS = 16 * 1024 * 1024;
const HEAD_CHARS = 64 * 1024; // 앞 48KB 안에서 SOF 조각을 찾는다

function decodeBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

// JPEG 머리에서 가로·세로를 읽는다(SOF0 ~ SOF15, DHT·JPG·DAC 제외). 못 읽으면 null.
export function readJpegSize(head) {
  if (head.length < 4 || head[0] !== 0xff || head[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < head.length) {
    if (head[offset] !== 0xff) return null;
    const marker = head[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = (head[offset + 2] << 8) | head[offset + 3];
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: (head[offset + 5] << 8) | head[offset + 6], width: (head[offset + 7] << 8) | head[offset + 8] };
    }
    offset += 2 + length;
  }
  return null;
}

// 돌려주는 값: 그림 목록 또는 null(장수·꼴·크기 가운데 하나라도 다름).
export function checkGeneratedImages(json) {
  const data = json?.data;
  if (!Array.isArray(data) || data.length !== BLOG_IMAGE_COUNT) return null;
  if (json.output_format !== undefined && json.output_format !== "jpeg") return null;
  const images = [];
  for (const item of data) {
    const base64 = item?.b64_json;
    if (typeof base64 !== "string" || base64.length < 8 || base64.length > BASE64_MAX_CHARS || base64.length % 4 !== 0 || !BASE64.test(base64)) return null;
    let size;
    let tail;
    try {
      size = readJpegSize(decodeBase64(base64.slice(0, Math.min(HEAD_CHARS, base64.length))));
      tail = decodeBase64(base64.slice(-8));
    } catch {
      return null;
    }
    if (!size || size.width !== BLOG_IMAGE_SIZE.width || size.height !== BLOG_IMAGE_SIZE.height) return null;
    const end = tail.length;
    if (end < 2 || tail[end - 2] !== 0xff || tail[end - 1] !== 0xd9) return null;
    images.push({ format: "jpeg", width: size.width, height: size.height, base64 });
  }
  return images;
}

// ── 오류 ──

const configMissing = () => new WorkApiError("IMAGE_CONFIG_MISSING", "그림 모델이나 단가를 알 수 없어 만들지 않았습니다.", 503);

function imageErrorResponse(code) {
  const table = {
    AI_IMAGE_REFUSED: ["그림 설명이 OpenAI 안전 기준에 걸려 만들지 않았습니다. 설명을 바꿔 주세요.", 422, false],
    AI_RATE_LIMITED: ["AI 요청이 잠시 많습니다. 잠시 뒤 다시 만들어 주세요.", 429, true],
    AI_CONFIG_INVALID: ["AI 설정(키·모델)을 확인해야 합니다.", 503, false],
    AI_REQUEST_INVALID: ["AI 요청이 받아들여지지 않았습니다.", 502, false],
    AI_NOT_FOUND: ["AI 요청이 받아들여지지 않았습니다.", 502, false],
    AI_STATE_UNKNOWN: ["AI가 그림을 만들었는지 확인하지 못했습니다. 비용은 만든 것으로 셉니다.", 502, false],
    AI_RESULT_INVALID: ["AI가 보낸 그림이 3장·JPEG·1024×1280이 아니어서 보이지 않습니다.", 502, false],
    AI_UPSTREAM_FAILED: ["AI 서비스가 응답하지 않았습니다.", 502, true],
  };
  const [message, status, retryable] = table[code] ?? table.AI_UPSTREAM_FAILED;
  return new WorkApiError(code in table ? code : "AI_UPSTREAM_FAILED", message, status, retryable);
}

function logImageOpenAi(auditLog, entry) {
  try {
    auditLog({ event: "blog_image_openai", ...entry });
  } catch {
    // Worker 로그 장애는 무시한다.
  }
}

// POST /work/blog/backgrounds
// context: { db, env, actor, requestId, now, auditLog, randomUUID, openaiFetch }
export async function createBlogBackgrounds(context, body) {
  const { db, env, actor, requestId, now, auditLog, randomUUID, openaiFetch } = context;
  const parsed = parseBackgroundsBody(body);
  const config = readImageConfig(env);
  if (!config) throw configMissing();

  const prompt = buildImagePrompt(parsed);
  const request = buildImageRequest(config, { prompt, quality: parsed.quality });
  const reservedCostMicroUsd = reservedImageCost(config, { prompt, quality: parsed.quality });
  const { day } = await reserveAiBudget(db, { nowMs: now, reservedCostMicroUsd });

  const refund = async () => {
    try {
      await db.prepare(REFUND_UNCONDITIONAL_SQL).bind(day, reservedCostMicroUsd).run();
    } catch {
      // 되돌리기 실패는 한도를 실제보다 많이 센 쪽이라 그대로 둔다.
    }
  };
  try {
    await runBatch(db, [
      auditStatement(db, { at: new Date(now).toISOString(), actorEmail: actor.email, action: "blog.background.create", targetType: "blog_background",
        targetId: randomUUID(), requestId, outcome: "ok", reason: `style=${parsed.style};quality=${parsed.quality}` }),
    ]);
  } catch (error) {
    await refund();
    throw error;
  }

  const started = Date.now();
  const logBase = { requestId, model: config.model, quality: parsed.quality, style: parsed.style };
  let result;
  try {
    result = await openaiRequest("/images/generations", { method: "POST", body: request, timeoutMs: IMAGE_TIMEOUT_MS }, env, openaiFetch);
  } catch (error) {
    const aiError = error instanceof WorkAiError ? error : new WorkAiError("AI_NETWORK");
    // 4xx(안전 기준 거절 포함)는 그림을 만들지 않은 것이 확실하므로 되돌린다. 5xx·끊김·시간 초과는 만들었을 수 있어 그대로 센다.
    const definitelyNotCreated = Number.isInteger(aiError.status) && aiError.status >= 400 && aiError.status < 500;
    logImageOpenAi(auditLog, { ...logBase, upstreamRequestId: aiError.upstreamRequestId, status: aiError.status, code: aiError.code, upstreamError: aiError.upstreamError ?? undefined, ms: Date.now() - started });
    if (definitelyNotCreated) await refund();
    const refused = aiError.upstreamError?.code === "moderation_blocked";
    throw imageErrorResponse(!definitelyNotCreated ? "AI_STATE_UNKNOWN" : refused ? "AI_IMAGE_REFUSED" : aiError.code);
  }

  const actual = actualImageCost(config.prices, result.json?.usage);
  if (actual) {
    try {
      await runBatch(db, [settleUnconditionalStatement(db, { day, reservedCostMicroUsd, actualCostMicroUsd: actual.costMicroUsd, inputTokens: actual.inputTokens, outputTokens: actual.outputTokens })]);
    } catch {
      // 바로잡기 실패는 예약 값(최대 예상)이 남는 쪽이라 그대로 둔다.
    }
  }
  const images = checkGeneratedImages(result.json);
  logImageOpenAi(auditLog, { ...logBase, upstreamRequestId: result.upstreamRequestId, status: 200, code: images ? undefined : "AI_RESULT_INVALID",
    inputTokens: actual?.inputTokens, outputTokens: actual?.outputTokens, ms: Date.now() - started });
  if (!images) throw imageErrorResponse("AI_RESULT_INVALID");
  return {
    data: {
      images,
      model: config.model,
      style: parsed.style,
      quality: parsed.quality,
      defaultDescriptionUsed: parsed.defaultUsed,
      costMicroUsd: actual ? actual.costMicroUsd : reservedCostMicroUsd,
      costIsEstimate: !actual,
      usage: actual ? { inputTokens: actual.inputTokens, outputTokens: actual.outputTokens } : null,
    },
  };
}
