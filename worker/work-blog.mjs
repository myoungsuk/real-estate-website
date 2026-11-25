// 업무 도구 단계 P3 AI 블로그 글 초안 API(설계서 22.9·22.11절, 지시서 D-1 ~ D-7, 운영자 결정 2026-11-20).
// work-public-tools.mjs가 켜기 값·구조 번호·(쓰기면) Origin·CSRF·본문 읽기를 끝낸 뒤 routeBlog()를 부른다.
// - 고를 자료는 번들에 들어간 공개 JSON뿐이다(손님 자료 없음).
// - 소재지(지번·동)는 매번 화면에서 받아 명시사항이 다 찼는지만 보고 D1·OpenAI·로그에 넣지 않는다(운영자 결정 2026-11-20 "저장 안 함").
// - 명시사항이 비면 만들기 전에 막는다(같은 날 "만들기부터 막음"). 명시사항 블록은 화면이 같은 함수로 붙인다(AI가 쓰지 않음).
// - 한도: 만들기 전에 하루 횟수·최대 예상 비용을 한 문장으로 미리 더하고, 결과를 받으면 실제 값으로 한 번 바로잡는다(D-3).
// - OpenAI: background + store:false, 생성 재시도 0회. 키·요청 본문·응답 본문·글 본문은 로그·감사·오류에 넣지 않는다.
import complexes from "../src/data/complexes.json" with { type: "json" };
import listings from "../src/data/listings.json" with { type: "json" };
import naverListings from "../src/data/naver-listings.json" with { type: "json" };
import office from "../src/data/office.json" with { type: "json" };
import disclosureRules from "../src/data/work/ad-disclosure-rules.json" with { type: "json" };
import { buildDisclosure } from "../src/lib/work/ad-disclosure.mjs";
import {
  BLOG_STYLES,
  EMPHASIS_MAX,
  allowedStyles,
  checkBlogDraft,
  extractAllMoney,
  extractAreas,
  extractDates,
  extractFloors,
  isBlogStyle,
  validateBlogInputs,
  validateBlogResult,
  validateEmphasis,
} from "../src/lib/work/blog-checks.mjs";
import { BLOG_SOURCE_TYPES, findBlogSource, listBlogSources, matchesBlogSourceQuery } from "../src/lib/work/blog-sources.mjs";
import { WorkAiError, cancelResponse, createBackgroundResponse, readResponseOutput, retrieveResponse } from "./openai-client.mjs";
import { estimateCostMicroUsd, readModelPrices, readOpenAiTaskConfig } from "./work-ai-config.mjs";
import {
  AI_LIMIT_DEFAULTS,
  AI_LIMIT_RANGES,
  REFUND_UNCONDITIONAL_SQL,
  parseLimitsBody,
  readAiLimits,
  readAiUsage,
  refundManyStatement,
  refundStatement,
  reserveAiBudget,
  reserveAiBudgetMany,
  saveLimitsStatements,
  settleUsageStatement,
} from "./work-ai-budget.mjs";
import { createBlogBackgrounds } from "./work-blog-backgrounds.mjs";
import { auditStatement, runBatch } from "./work-audit.mjs";
import { invalid, isUuid } from "./work-input.mjs";
import { WorkApiError } from "./work-security.mjs";

export const BLOG_DRAFT_LIST_LIMIT = 20;
export const BLOG_SOURCE_QUERY_MAX = 30;
export const BLOG_RESULT_KEEP_MS = 10 * 60 * 1000; // OpenAI background 결과 임시 보관(약 10분, 14.5절). 지나서 404면 expired
export const BLOG_RETENTION_DAYS = 30; // DEC-WT-24
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = new Set(["queued", "in_progress"]);
const SOURCES = listBlogSources({ naverListings, listings, complexes, rules: disclosureRules });
// 시험만 쓰는 자리: context.blogNaverListings(naver-listings.json과 같은 꼴 { items })가 있으면 그 네이버 매물로 고를 자료를 만든다
// (손님 매물·단지는 번들 그대로). 매일 동기화로 바뀌는 공개 매물에 시험이 기대지 않게 하려는 것이다. 요청으로는 바꿀 수 없고
// 운영(worker/index.mjs)은 이 값을 넘기지 않으므로 늘 SOURCES다.
const injectedSources = new WeakMap();
export function blogSourcesFor(naverListingsOverride) {
  if (naverListingsOverride === undefined || naverListingsOverride === null) return SOURCES;
  if (typeof naverListingsOverride !== "object") throw new TypeError("blogNaverListings must be an object");
  let built = injectedSources.get(naverListingsOverride);
  if (!built) {
    built = listBlogSources({ naverListings: naverListingsOverride, listings, complexes, rules: disclosureRules });
    injectedSources.set(naverListingsOverride, built);
  }
  return built;
}
const sourcesOf = (context) => blogSourcesFor(context.blogNaverListings);
const OFFICE_PHONE = office.mobile;

const iso = (ms) => new Date(ms).toISOString();
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const notFound = () => new WorkApiError("NOT_FOUND", "요청한 업무 자료를 찾지 못했습니다.", 404);
const methodNotAllowed = (allow) => Object.assign(new WorkApiError("METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다.", 405), { allow });
const draftConflict = () => new WorkApiError("DRAFT_STATE_CONFLICT", "초안 상태가 바뀌었습니다. 다시 불러와 주세요.", 409);

// ── 자료 ──

export function blogSources() {
  return SOURCES;
}

// GET /work/blog/sources?type=&q=
export function listSourcesView(params, sources = SOURCES) {
  const type = params.get("type");
  if (type !== null && type !== "" && !BLOG_SOURCE_TYPES.includes(type)) throw invalid(["type"]);
  const q = (params.get("q") ?? "").normalize("NFKC").trim();
  if (q.length > BLOG_SOURCE_QUERY_MAX || /[\u0000-\u001f\u007f]/u.test(q)) throw invalid(["q"]);
  const items = sources.filter((source) => (!type || source.type === type) && matchesBlogSourceQuery(source, q));
  return { items, styles: BLOG_STYLES.map(({ id, label, note }) => ({ id, label, note })) };
}

// ── OpenAI로 보내는 것(D-1: 지번·동·관리비 비목은 보내지 않음) ──

const stripDong = (title) => String(title).replace(/\s*\d{1,4}\s*동$/u, "").trim();

// 공개 자료 사실 + 화면 입력(소재지 없음) + 강조점 + 글 성격. 사무소 연락처·명시사항은 넣지 않는다(코드가 붙임).
export function buildBlogPromptPayload({ source, inputs, emphasis, style }) {
  const styleInfo = BLOG_STYLES.find((entry) => entry.id === style);
  const base = { style: { label: styleInfo.label, instruction: styleInfo.instruction }, emphasis: emphasis || null };
  if (source.type === "complex") {
    // details: 단지 자료 7개 항목(blog-sources.mjs readComplexDetails, 이미 상한 안으로 줄인 값). 숫자 검사도 같은 값을 본다.
    return { ...base, kind: "complex", complex: { name: source.title, areaName: source.facts.areaName, summary: source.facts.summary, facts: source.facts.items, details: source.facts.details ?? {} } };
  }
  const facts = source.facts;
  const floorBand = inputs.floorMode === "band";
  const fee = inputs.managementFee && inputs.managementFee.type !== "omit"
    ? { type: inputs.managementFee.type, monthlyWon: inputs.managementFee.monthlyWon }
    : null;
  const listing = {
    title: stripDong(source.title),
    propertyType: facts.propertyType,
    tradeType: facts.tradeType,
    priceWon: facts.priceWon,
    depositWon: facts.depositWon,
    monthlyRentWon: facts.monthlyRentWon,
    exclusiveM2: facts.exclusiveM2 ?? inputs.areaM2 ?? null,
    landM2: facts.landM2,
    floor: floorBand ? null : (inputs.floorNumber ?? facts.floor ?? null),
    floorBand: floorBand ? (inputs.floorBand ?? facts.floorBand ?? null) : null,
    totalFloors: inputs.totalFloors ?? facts.totalFloors ?? null,
    direction: inputs.direction ?? facts.direction ?? null,
    directionBasis: inputs.directionBasis ?? null,
    summary: facts.summary,
    kind: inputs.kind ?? null,
    violation: inputs.violation ?? null,
    rooms: inputs.rooms ?? null,
    bathrooms: inputs.bathrooms ?? null,
    approvalDate: inputs.approvalDate ?? null,
    moveIn: inputs.moveIn ?? null,
    parking: inputs.parking ?? null,
    managementFee: fee,
  };
  return { ...base, kind: "listing", listing: Object.fromEntries(Object.entries(listing).filter(([, value]) => value !== null && value !== undefined && value !== "")) };
}

// 2026-11-24 사용자 결정("AI 호출할 때 제약을 많이 걸수록 성능이 나빠진다", "어 그렇게 해"): 지시문은 할 일과 꼭 지킬 뜻만 둔다.
// 글자 수·개수 상한, '평' 표기, 과장·후기·거리 표현, 단지 글의 매물 숫자, 입력과 다른 숫자는 받은 뒤 코드가 잡는다
// (src/lib/work/blog-checks.mjs validateBlogResult()는 넘친 칸을 잘라서 받고, checkBlogDraft()는 복사를 막거나 경고한다).
export const BLOG_INSTRUCTIONS = [
  "너는 대전 동구 공인중개사무소의 블로그 글 초안을 쓰는 도우미다. 사람이 읽고 고친 뒤 올린다. kind가 complex이면 단지 소개 글, 아니면 매물 글이다.",
  "입력 JSON에 있는 사실만 쓰고, 자료에 붙은 조건(확인 필요 같은 말)은 빼지 않는다.",
  "사무소 이름·연락처와 명시사항은 따로 붙으니 쓰지 않는다.",
  "style.instruction의 글 성격을 따르고, emphasis(중개사가 직접 본 현장 메모)가 있으면 살린다.",
  "글은 sections의 소제목 몇 개로 나누고, checklist에는 글 끝에 붙는 '현장에서 확인할 점'을 쓴다.",
  "instagram에는 같은 내용으로 인스타그램에 올릴 글을, threads에는 스레드에 올릴 두세 문장을 쓴다. 해시태그는 hashtags에만 쓴다.",
].join("\n");

export const BLOG_RESULT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["title", "sections", "checklist", "hashtags", "instagram", "threads", "factsUsed"],
  properties: {
    title: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "paragraphs"],
        properties: { heading: { type: "string" }, paragraphs: { type: "array", items: { type: "string" } } },
      },
    },
    checklist: { type: "array", items: { type: "string" } },
    hashtags: { type: "array", items: { type: "string" } },
    instagram: { type: "string" },
    threads: { type: "string" },
    factsUsed: { type: "array", items: { type: "string" } },
  },
});

// 같은 자료로 3편을 같이 만들 때(2026-11-25 사용자 결정 "전부 추천대로" 4·5: 처음 값 3편, 첫 문장·짜임만 다르게) 편마다 지시문 끝에 붙이는 한 줄.
// 1편만 만들 때는 붙이지 않는다(지시문이 그 전과 글자까지 같음). 사실·숫자 검사는 편마다 받은 뒤 코드가 그대로 한다.
export const BLOG_SET_SIZES = Object.freeze([1, 3]);
export const BLOG_SET_LINES = Object.freeze([
  "같은 자료로 쓰는 3편 중 1편이다. 사실·숫자는 다른 편과 같게 두고, 첫 문장은 가장 중요한 사실로 바로 시작한다.",
  "같은 자료로 쓰는 3편 중 2편이다. 사실·숫자는 다른 편과 같게 두고, 첫 문장은 읽는 사람이 궁금해할 물음으로 시작해 묻고 답하듯 짠다.",
  "같은 자료로 쓰는 3편 중 3편이다. 사실·숫자는 다른 편과 같게 두고, 첫 문장은 한 줄 요약으로 시작해 좋은 점 다음에 따져 볼 점을 둔다.",
]);

export function buildOpenAiRequest(config, payload, setNo = null) {
  return {
    model: config.model,
    reasoning: { effort: config.effort },
    max_output_tokens: config.maxOutputTokens,
    background: true,
    store: false,
    instructions: setNo ? `${BLOG_INSTRUCTIONS}\n${BLOG_SET_LINES[setNo - 1]}` : BLOG_INSTRUCTIONS,
    input: [{ role: "user", content: [{ type: "input_text", text: JSON.stringify(payload) }] }],
    text: { format: { type: "json_schema", name: "blog_draft", strict: true, schema: BLOG_RESULT_SCHEMA } },
  };
}

// 입력 토큰 추정(최대 쪽으로): 글자 1개를 토큰 1개로 센다. 한국어는 보통 이보다 적다.
export function estimateInputTokens(body) {
  return (body.instructions?.length ?? 0) + JSON.stringify(body.input).length + 200;
}

// 강조점 글은 저장하지 않고, 다시 열었을 때 숫자 대조가 강조점의 숫자를 막지 않게 숫자 표기만 남긴다.
export function emphasisNumbersOf(emphasis) {
  if (!emphasis) return "";
  const dates = extractDates(emphasis);
  return [...extractAllMoney(emphasis), ...extractAreas(emphasis), ...extractFloors(emphasis), ...dates.full, ...dates.months]
    .map((item) => item.text).join(" ").slice(0, EMPHASIS_MAX);
}

// ── 초안 행 ──

const DRAFT_COLUMNS = `id, source_type, source_id, source_title, status, closed, openai_response_id, model, reasoning_effort, disclosure_json, result_json, check_json,
  error_code, usage_day, reserved_cost_micro_usd, actual_cost_micro_usd, input_tokens, output_tokens, created_at, updated_at, closed_at`;
const DRAFT_INSERT_SQL = `INSERT INTO blog_drafts (id, source_type, source_id, source_title, status, model, reasoning_effort, disclosure_json, usage_day,
  reserved_cost_micro_usd, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?6, ?7, ?8, ?9, ?10, ?10)`;
const DRAFT_GET_SQL = `SELECT ${DRAFT_COLUMNS} FROM blog_drafts WHERE id = ?1`;
const DRAFT_LIST_SQL = `SELECT ${DRAFT_COLUMNS} FROM blog_drafts ORDER BY created_at DESC, id DESC LIMIT ?1`;

const parseJson = (text) => {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// 3편 묶음 표시. 새 표 없이 disclosure_json의 set에 { n, of, ids }(같이 만든 편의 초안 ID, 편 순서)를 둔다. 1편이면 null.
function setOf(stored) {
  const set = stored?.set;
  if (!isPlainObject(set) || !Number.isInteger(set.n) || !Number.isInteger(set.of) || !Array.isArray(set.ids)) return null;
  if (set.of !== set.ids.length || set.n < 1 || set.n > set.of || !set.ids.every(isUuid)) return null;
  return { n: set.n, of: set.of, ids: [...set.ids] };
}

export function draftView(row, sources = SOURCES) {
  const stored = parseJson(row.disclosure_json) ?? {};
  const source = findBlogSource(sources, row.source_type, row.source_id);
  return {
    id: row.id,
    source: { type: row.source_type, id: row.source_id, title: row.source_title },
    sourcePublic: Boolean(source && !source.blockedReason),
    currentSource: source,
    status: row.status,
    closed: row.closed,
    errorCode: row.error_code,
    inputs: stored.inputs ?? {},
    emphasisNumbers: stored.emphasisNumbers ?? "",
    set: setOf(stored),
    needsLocation: row.source_type !== "complex",
    result: parseJson(row.result_json),
    checks: parseJson(row.check_json),
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    reservedCostMicroUsd: row.reserved_cost_micro_usd,
    actualCostMicroUsd: row.actual_cost_micro_usd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
  };
}

function listItemView(row) {
  const result = parseJson(row.result_json);
  return {
    id: row.id,
    source: { type: row.source_type, id: row.source_id, title: row.source_title },
    status: row.status,
    closed: row.closed,
    errorCode: row.error_code,
    title: typeof result?.title === "string" ? result.title : null,
    set: setOf(parseJson(row.disclosure_json)),
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

async function readDraftRow(db, id) {
  if (!isUuid(id)) throw notFound();
  const row = await db.prepare(DRAFT_GET_SQL).bind(id).first();
  if (!row) throw notFound();
  return row;
}

// ── 만들기 본문 검사(D1·감사·OpenAI 0회) ──

export function parseDraftCreate(body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !["source", "style", "inputs", "emphasis", "count"].includes(key))) throw invalid(["body"]);
  // count는 1 또는 3(없으면 1, 그 전 화면과 같음).
  if (body.count !== undefined && !BLOG_SET_SIZES.includes(body.count)) throw invalid(["count"]);
  const { source: ref } = body;
  if (!isPlainObject(ref) || Object.keys(ref).some((key) => key !== "type" && key !== "id")
    || !BLOG_SOURCE_TYPES.includes(ref.type) || typeof ref.id !== "string" || ref.id.length < 1 || ref.id.length > 80) throw invalid(["source"]);
  const checked = validateBlogInputs(body.inputs, { officePhone: OFFICE_PHONE });
  const emphasis = validateEmphasis(body.emphasis, { officePhone: OFFICE_PHONE });
  const errors = [...checked.errors, ...(emphasis.error ? ["emphasis"] : [])];
  if (!isBlogStyle(body.style)) errors.push("style");
  if (errors.length > 0) throw invalid(errors);
  const personal = [...checked.personal, ...(emphasis.personal ? ["emphasis"] : [])];
  if (personal.length > 0) {
    throw new WorkApiError("PERSONAL_DATA_PATTERN", "주민등록번호·전화번호·이메일·호수처럼 보이는 글자는 넣을 수 없습니다.", 400, false, personal);
  }
  return { ref, style: body.style, inputs: checked.inputs, emphasis: emphasis.emphasis, count: body.count ?? 1 };
}

// 공개 자료 확인 → 성격 → 명시사항. 돌려주는 값: { source, disclosure }.
export function checkDraftReady({ ref, style, inputs }, sources = SOURCES) {
  const source = findBlogSource(sources, ref.type, ref.id);
  if (!source) throw new WorkApiError("SOURCE_NOT_PUBLIC", "고른 매물·단지가 지금 공개 자료에 없습니다.", 409);
  if (source.blockedReason) throw invalid(["source"]);
  if (!allowedStyles(source).includes(style)) throw invalid(["style"]);
  const disclosure = buildDisclosure({ source, inputs, office, rules: disclosureRules });
  if (disclosure.missing.length > 0) {
    throw new WorkApiError("DISCLOSURE_INCOMPLETE", "명시사항 빈 칸을 먼저 채워 주세요.", 400, false, disclosure.missing);
  }
  return { source, disclosure };
}

const configMissing = () => new WorkApiError("BLOG_CONFIG_MISSING", "글 초안 도구 설정이 완료되지 않았습니다.", 503);

function aiErrorResponse(code) {
  const table = {
    AI_RATE_LIMITED: ["AI 요청이 잠시 많습니다. 잠시 뒤 다시 만들어 주세요.", 429, true],
    AI_CONFIG_INVALID: ["AI 설정(키·모델)을 확인해야 합니다.", 503, false],
    AI_REQUEST_INVALID: ["AI 요청이 받아들여지지 않았습니다.", 502, false],
    AI_NOT_FOUND: ["AI 요청이 받아들여지지 않았습니다.", 502, false],
    AI_STATE_UNKNOWN: ["AI 요청이 만들어졌는지 확인하지 못했습니다. 초안 목록에서 상태를 확인해 주세요.", 502, false],
    AI_UPSTREAM_FAILED: ["AI 서비스가 응답하지 않았습니다.", 502, true],
  };
  const [message, status, retryable] = table[code] ?? table.AI_UPSTREAM_FAILED;
  return new WorkApiError(code in table ? code : "AI_UPSTREAM_FAILED", message, status, retryable);
}

function logOpenAi(auditLog, entry) {
  try {
    auditLog({ event: "blog_openai", ...entry });
  } catch {
    // Worker 로그 장애는 무시한다.
  }
}

// POST /work/blog/drafts
// count 3(2026-11-25 사용자 결정 4: 처음 값 3편)은 같은 자료로 초안 행 3개를 만들고 OpenAI 요청 3개를 같이 보낸다.
// 한도는 판 1 시안 추천 4("3편은 한도 3편 몫과 예상 비용을 단추 위에 보임")대로 하루 편수 3편 몫 + 3편 예상 비용 합계를 한 번에 예약한다(전부 아니면 0).
// 편마다 OpenAI가 확실히 받지 않았으면(4xx) 그 편 몫만 되돌리고, 하나라도 만들어지면 201로 그 편들을 준다(셋 다 안 되면 첫 오류).
export async function createBlogDraft(context, body) {
  const { db, env, actor, requestId, now, randomUUID } = context;
  const parsed = parseDraftCreate(body);
  const { source } = checkDraftReady(parsed, sourcesOf(context));
  const config = readOpenAiTaskConfig(env, "blog");
  if (!config) throw configMissing();

  const { count } = parsed;
  const payload = buildBlogPromptPayload({ source, inputs: parsed.inputs, emphasis: parsed.emphasis, style: parsed.style });
  const requests = Array.from({ length: count }, (_, index) => buildOpenAiRequest(config, payload, count === 1 ? null : index + 1));
  const costs = requests.map((request) => estimateCostMicroUsd(config.prices, estimateInputTokens(request), config.maxOutputTokens));
  const totalCostMicroUsd = costs.reduce((sum, cost) => sum + cost, 0);
  const { day } = count === 1
    ? await reserveAiBudget(db, { nowMs: now, reservedCostMicroUsd: totalCostMicroUsd })
    : await reserveAiBudgetMany(db, { nowMs: now, count, reservedCostMicroUsd: totalCostMicroUsd });

  const ids = requests.map(() => randomUUID());
  const at = iso(now);
  // 소재지는 넣지 않는다. 강조점은 숫자 표기만.
  const { location: _location, ...storedInputs } = parsed.inputs;
  const stored = { inputs: storedInputs, emphasisNumbers: emphasisNumbersOf(parsed.emphasis) };
  const disclosureJsonOf = (index) => JSON.stringify(count === 1 ? stored : { ...stored, set: { n: index + 1, of: count, ids } });
  try {
    await runBatch(db, ids.flatMap((id, index) => [
      db.prepare(DRAFT_INSERT_SQL).bind(id, source.type, source.id, source.title.slice(0, 120), config.model, config.effort, disclosureJsonOf(index), day, costs[index], at),
      auditStatement(db, { at, actorEmail: actor.email, action: "blog.create", targetType: "blog_draft", targetId: id, requestId, outcome: "ok",
        reason: count === 1 ? `source_type=${source.type}` : `source_type=${source.type};set=${index + 1}/${count}` }),
    ]));
  } catch (error) {
    // 초안을 넣지 못했으면 OpenAI를 부르지 않고 미리 더한 것을 되돌린다(초안 행이 없으므로 조건 없이 1번).
    try {
      if (count === 1) await db.prepare(REFUND_UNCONDITIONAL_SQL).bind(day, totalCostMicroUsd).run();
      else await refundManyStatement(db, { day, count, reservedCostMicroUsd: totalCostMicroUsd }).run();
    } catch {
      // 되돌리기 실패는 한도를 실제보다 많이 센 쪽이라 그대로 둔다.
    }
    throw error;
  }

  const sources = sourcesOf(context);
  if (count === 1) {
    const code = await startDraftResponse(context, { id: ids[0], day, request: requests[0], reservedCostMicroUsd: costs[0], config });
    if (code) throw aiErrorResponse(code);
    return { status: 201, data: { draft: draftView(await readDraftRow(db, ids[0]), sources) } };
  }
  // 응답 ID를 적다가 실패한 편은 queued로 남고 다음 조회 때 unknown으로 보인다(1편과 같음).
  const settled = await Promise.allSettled(ids.map((id, index) => startDraftResponse(context, { id, day, request: requests[index], reservedCostMicroUsd: costs[index], config })));
  const codes = settled.map((item) => (item.status === "fulfilled" ? item.value : "AI_STATE_UNKNOWN"));
  const firstMade = codes.findIndex((code) => code === null);
  if (firstMade < 0) throw aiErrorResponse(codes[0]);
  const drafts = [];
  for (const id of ids) drafts.push(draftView(await readDraftRow(db, id), sources));
  return { status: 201, data: { draft: drafts[firstMade], drafts } };
}

// OpenAI 백그라운드 요청 1개를 보내고 그 초안 행을 고친다. 돌려주는 값: null(만들어짐) 또는 화면에 줄 오류 코드.
async function startDraftResponse(context, { id, day, request, reservedCostMicroUsd, config }) {
  const { db, env, requestId, now, auditLog, openaiFetch } = context;
  const started = Date.now();
  let created;
  try {
    created = await createBackgroundResponse(request, env, openaiFetch);
  } catch (error) {
    const aiError = error instanceof WorkAiError ? error : new WorkAiError("AI_NETWORK");
    const definitelyNotCreated = Number.isInteger(aiError.status) && aiError.status >= 400 && aiError.status < 500;
    logOpenAi(auditLog, { requestId, upstreamRequestId: aiError.upstreamRequestId, model: config.model, effort: config.effort, status: aiError.status, code: aiError.code, upstreamError: aiError.upstreamError ?? undefined, ms: Date.now() - started });
    const code = definitelyNotCreated ? aiError.code : "AI_STATE_UNKNOWN";
    const updatedAt = iso(now);
    const statements = definitelyNotCreated
      ? [refundStatement(db, { draftId: id, day, reservedCostMicroUsd }),
        db.prepare("UPDATE blog_drafts SET status = 'failed', error_code = ?2, actual_cost_micro_usd = 0, updated_at = ?3 WHERE id = ?1 AND status = 'queued'").bind(id, code, updatedAt)]
      : [db.prepare("UPDATE blog_drafts SET status = 'unknown', error_code = ?2, updated_at = ?3 WHERE id = ?1 AND status = 'queued'").bind(id, code, updatedAt)];
    try {
      await runBatch(db, statements);
    } catch {
      // 상태 기록 실패: 초안은 queued로 남고 다음 조회 때 응답 ID가 없어 unknown으로 보인다.
    }
    return code;
  }
  logOpenAi(auditLog, { requestId, upstreamRequestId: created.upstreamRequestId, model: config.model, effort: config.effort, status: created.status, ms: Date.now() - started });
  const status = created.status === "in_progress" ? "in_progress" : "queued";
  await runBatch(db, [
    db.prepare("UPDATE blog_drafts SET openai_response_id = ?2, status = ?3, updated_at = ?4 WHERE id = ?1 AND status = 'queued'").bind(id, created.id, status, iso(now)),
  ]);
  return null;
}

// ── 결과 받기 ──

function parseResultText(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// 서버가 기다리는 끝(2026-11-25 사용자 결정 "30분"). 만든 지 이 시간이 지나도 끝나지 않은 초안은 실패로 닫는다(끝없는 조회 방지).
// 토큰 수를 모르므로 미리 더한 최대 예상 비용을 실제 비용으로 남긴다(예산을 적게 세지 않게). OpenAI 쪽 요청은 취소하지 않는다.
export const BLOG_WAIT_MAX_MS = 30 * 60 * 1000;
// 조회가 실패하는 동안(네트워크·5xx·429처럼 404가 아닌 실패)은 글이 끝났는지 모르므로, 기다리는 끝 뒤에도 OpenAI가 결과를 맡아 두는 시간만큼은
// 닫지 않고 다음 조회에서 다시 본다(30분 바로 뒤 한 번의 조회 오류로 다 된 글을 버리지 않게). 그 뒤에도 조회가 실패하면 닫는다.
export const BLOG_WAIT_LOOKUP_FAIL_MAX_MS = BLOG_WAIT_MAX_MS + BLOG_RESULT_KEEP_MS;
// 1분 예약(work-blog-cron.mjs)이 한 번에 보는 열린 초안 수와, 만든 지 얼마 안 된 초안만 보는 범위.
// 열린 초안은 30분(조회가 실패하는 동안은 40분)이면 닫히므로 최근 24시간만 본다(created_at 색인으로 그 범위 행만 읽음. 예약이 하루 넘게 멈춘 뒤 남은 초안은 화면에서 열 때 닫힌다).
export const BLOG_POLL_MAX_ROWS = 10;
export const BLOG_POLL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const OPEN_DRAFTS_SQL = `SELECT ${DRAFT_COLUMNS} FROM blog_drafts
  WHERE created_at >= ?1 AND status IN ('queued','in_progress') AND closed IS NULL ORDER BY created_at, id LIMIT ?2`;

// 진행 중인 초안의 OpenAI 상태를 1번 본다. 돌려주는 값: 바뀌었으면 batch 문장들, 아니면 [].
// 화면 조회(getBlogDraft)와 1분 예약이 같이 쓴다. 그 사이 다른 쪽이 먼저 닫았으면 guard 때문에 아무것도 바뀌지 않는다.
export async function pollDraft(context, row) {
  const { db, env, requestId, now, auditLog, openaiFetch } = context;
  const at = iso(now);
  const waitOver = now - Date.parse(row.created_at) > BLOG_WAIT_MAX_MS;
  const lookupFailOver = now - Date.parse(row.created_at) > BLOG_WAIT_LOOKUP_FAIL_MAX_MS;
  const stmtsFor = (status, fields) => {
    const { resultJson = null, checkJson = null, errorCode = null, tokens = null } = fields;
    const settle = [];
    if (tokens) {
      const prices = readModelPrices(env, row.model);
      const actual = prices && tokens.known !== false ? estimateCostMicroUsd(prices, tokens.input, tokens.output) : row.reserved_cost_micro_usd;
      settle.push(settleUsageStatement(db, { draftId: row.id, day: row.usage_day, reservedCostMicroUsd: row.reserved_cost_micro_usd, actualCostMicroUsd: actual, inputTokens: tokens.input, outputTokens: tokens.output }));
      settle.push(db.prepare(`UPDATE blog_drafts SET status = ?2, result_json = ?3, check_json = ?4, error_code = ?5, actual_cost_micro_usd = ?6, input_tokens = ?7, output_tokens = ?8, updated_at = ?9
        WHERE id = ?1 AND status IN ('queued','in_progress') AND actual_cost_micro_usd IS NULL`).bind(row.id, status, resultJson, checkJson, errorCode, actual, tokens.input, tokens.output, at));
      return settle;
    }
    return [db.prepare("UPDATE blog_drafts SET status = ?2, error_code = ?3, updated_at = ?4 WHERE id = ?1 AND status IN ('queued','in_progress')").bind(row.id, status, errorCode, at)];
  };

  if (!row.openai_response_id) {
    // 생성 요청을 보낸 뒤 응답 ID를 적지 못한 초안(만들어졌는지 모름).
    return now - Date.parse(row.created_at) > BLOG_RESULT_KEEP_MS ? stmtsFor("unknown", { errorCode: "AI_STATE_UNKNOWN" }) : [];
  }
  const started = Date.now();
  let json;
  try {
    json = await retrieveResponse(row.openai_response_id, env, openaiFetch);
  } catch (error) {
    const code = error instanceof WorkAiError ? error.code : "AI_NETWORK";
    logOpenAi(auditLog, { requestId, model: row.model, effort: row.reasoning_effort, code, ms: Date.now() - started });
    if (code === "AI_NOT_FOUND") {
      return now - Date.parse(row.created_at) > BLOG_RESULT_KEEP_MS ? stmtsFor("expired", { errorCode: "AI_RESULT_EXPIRED" }) : stmtsFor("unknown", { errorCode: "AI_STATE_UNKNOWN" });
    }
    // 네트워크·5xx·429: 그대로 두고 다음 조회에서 다시 본다. 다만 기다리는 끝에 결과 보관 시간을 더한 때가 지났으면 닫는다.
    return lookupFailOver ? stmtsFor("failed", { errorCode: "AI_WAIT_TIMEOUT", tokens: { input: 0, output: 0, known: false } }) : [];
  }
  const output = readResponseOutput(json);
  logOpenAi(auditLog, { requestId, model: row.model, effort: row.reasoning_effort, status: output.status, inputTokens: output.inputTokens, outputTokens: output.outputTokens, ms: Date.now() - started });
  const tokens = { input: output.inputTokens, output: output.outputTokens, known: output.usageKnown };
  if (output.status === "queued" || output.status === "in_progress") {
    if (waitOver) return stmtsFor("failed", { errorCode: "AI_WAIT_TIMEOUT", tokens: { input: 0, output: 0, known: false } });
    return output.status !== row.status ? stmtsFor(output.status, {}) : [];
  }
  if (output.status === "completed") {
    const parsed = output.refusal ? null : parseResultText(output.text);
    const checked = parsed ? validateBlogResult(parsed) : { ok: false };
    if (!checked.ok) return stmtsFor("failed", { errorCode: "AI_RESULT_INVALID", tokens });
    const source = findBlogSource(sourcesOf(context), row.source_type, row.source_id);
    const stored = parseJson(row.disclosure_json) ?? {};
    const checks = source ? checkBlogDraft(checked.result, { source, inputs: stored.inputs ?? {}, emphasis: stored.emphasisNumbers ?? "", officePhone: OFFICE_PHONE }) : null;
    const checkJson = checks ? JSON.stringify({ blocks: checks.blocks.slice(0, 50), warnings: checks.warnings.slice(0, 50) }).slice(0, 8000) : null;
    return stmtsFor("completed", { resultJson: JSON.stringify(checked.result), checkJson: checkJson && parseJson(checkJson) ? checkJson : null, tokens });
  }
  if (output.status === "incomplete") return stmtsFor("failed", { errorCode: "AI_RESULT_INCOMPLETE", tokens });
  return stmtsFor("failed", { errorCode: "AI_UPSTREAM_FAILED", tokens });
}

// GET /work/blog/drafts/:id
export async function getBlogDraft(context, id) {
  const { db } = context;
  const row = await readDraftRow(db, id);
  if (OPEN_STATUSES.has(row.status) && row.closed === null) {
    const statements = await pollDraft(context, row);
    if (statements.length > 0) await runBatch(db, statements);
    return { data: { draft: draftView(await readDraftRow(db, id), sourcesOf(context)) } };
  }
  return { data: { draft: draftView(row, sourcesOf(context)) } };
}

export async function listBlogDrafts(context) {
  const { results } = await context.db.prepare(DRAFT_LIST_SQL).bind(BLOG_DRAFT_LIST_LIMIT).all();
  return { data: { items: (results ?? []).map(listItemView) } };
}

const CLOSE_GUARD_SQL = {
  confirm: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM blog_drafts WHERE id = ?1 AND closed IS NULL AND status = 'completed') THEN json('guard') ELSE 1 END AS ok",
  cancel: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM blog_drafts WHERE id = ?1 AND closed IS NULL) THEN json('guard') ELSE 1 END AS ok",
};

// POST /work/blog/drafts/:id/confirm|cancel. 본문은 {}만. 감사 blog.confirm·blog.cancel을 같은 batch에 넣는다.
export async function closeBlogDraft(context, id, action, body) {
  const { db, env, actor, requestId, now, openaiFetch } = context;
  if (!isPlainObject(body) || Object.keys(body).length > 0) throw invalid(["body"]);
  const row = await readDraftRow(db, id);
  if (row.closed !== null || (action === "confirm" && row.status !== "completed")) throw draftConflict();
  if (action === "cancel" && OPEN_STATUSES.has(row.status) && row.openai_response_id) {
    try {
      await cancelResponse(row.openai_response_id, env, openaiFetch);
    } catch (error) {
      throw aiErrorResponse(error instanceof WorkAiError && error.code === "AI_RATE_LIMITED" ? "AI_RATE_LIMITED" : "AI_UPSTREAM_FAILED");
    }
  }
  const at = iso(now);
  const closed = action === "confirm" ? "confirmed" : "cancelled";
  try {
    await runBatch(db, [
      db.prepare(CLOSE_GUARD_SQL[action]).bind(id),
      db.prepare("UPDATE blog_drafts SET closed = ?2, closed_at = ?3, updated_at = ?3 WHERE id = ?1 AND closed IS NULL").bind(id, closed, at),
      auditStatement(db, { at, actorEmail: actor.email, action: `blog.${action}`, targetType: "blog_draft", targetId: id, requestId, outcome: "ok", reason: `status=${row.status}` }),
    ]);
  } catch (error) {
    const latest = await db.prepare(DRAFT_GET_SQL).bind(id).first().catch(() => null);
    if (latest && (latest.closed !== null || latest.status !== row.status)) throw draftConflict();
    throw error;
  }
  return { data: { draft: draftView(await readDraftRow(db, id), sourcesOf(context)) } };
}

// ── 한도(DEC-WT-35) ──

async function limitsView(db, now) {
  const limits = await readAiLimits(db);
  const usage = await readAiUsage(db, now);
  return {
    version: limits.version,
    dailyCreateLimit: limits.dailyCreateLimit,
    monthlyCostLimitMicroUsd: limits.monthlyCostLimitMicroUsd,
    defaults: { ...AI_LIMIT_DEFAULTS },
    ranges: { daily: [...AI_LIMIT_RANGES.daily], monthly: [...AI_LIMIT_RANGES.monthly] },
    usage: { day: usage.day, todayCreates: usage.todayCreates, monthCostMicroUsd: usage.monthCostMicroUsd },
  };
}

export async function saveBlogLimits(context, body) {
  const { db, actor, requestId, now } = context;
  const parsed = parseLimitsBody(body);
  if (parsed.fields) throw invalid(parsed.fields);
  const at = iso(now);
  try {
    await runBatch(db, [
      ...saveLimitsStatements(db, parsed.value, at),
      auditStatement(db, { at, actorEmail: actor.email, action: "settings.update", targetType: "settings", targetId: "ai_limits", requestId, outcome: "ok",
        reason: `daily=${parsed.value.dailyCreateLimit};monthly_micro_usd=${parsed.value.monthlyCostLimitMicroUsd}` }),
    ]);
  } catch (error) {
    const latest = await readAiLimits(db).catch(() => null);
    if (latest && latest.version !== parsed.value.version) throw new WorkApiError("VERSION_CONFLICT", "다른 화면에서 먼저 고쳤습니다. 다시 불러온 뒤 저장해 주세요.", 409);
    throw error;
  }
  return { data: await limitsView(db, now) };
}

// ── 경로 ──

// context: { db, env, actor, requestId, now, auditLog, method, route, url, body, randomUUID, openaiFetch, blogNaverListings(시험만) }
export async function routeBlog(context) {
  const { method, route, url, body, db, now } = context;
  if (route === "/blog/sources") {
    if (method !== "GET") throw methodNotAllowed("GET");
    return { data: listSourcesView(url.searchParams, sourcesOf(context)) };
  }
  if (route === "/blog/limits") {
    if (method === "GET") return { data: await limitsView(db, now) };
    if (method !== "PUT") throw methodNotAllowed("GET, PUT");
    return saveBlogLimits(context, body);
  }
  if (route === "/blog/drafts") {
    if (method === "GET") return listBlogDrafts(context);
    if (method !== "POST") throw methodNotAllowed("GET, POST");
    return createBlogDraft(context, body);
  }
  const match = route.match(/^\/blog\/drafts\/([^/]+)(?:\/(confirm|cancel))?$/u);
  if (match) {
    const [, id, action] = match;
    if (!action) {
      if (method !== "GET") throw methodNotAllowed("GET");
      return getBlogDraft(context, id);
    }
    if (method !== "POST") throw methodNotAllowed("POST");
    return closeBlogDraft(context, id, action, body);
  }
  if (route === "/blog/backgrounds") {
    if (method !== "POST") throw methodNotAllowed("POST");
    return createBlogBackgrounds(context, body);
  }
  throw notFound();
}

// ── 보관 정리(DEC-WT-24, Cron 03:00 차례) ──
// 다 씀·취소 뒤 30일 → 지움 / 닫지 않고 만든 지 30일 → closed='auto' / auto 뒤 30일 → 지움. 돌려주는 값: { deleted, autoClosed }.
export async function cleanupBlogDrafts(db, nowMs) {
  const cutoff = iso(nowMs - BLOG_RETENTION_DAYS * DAY_MS);
  const at = iso(nowMs);
  const results = await db.batch([
    db.prepare("DELETE FROM blog_drafts WHERE closed IS NOT NULL AND closed_at IS NOT NULL AND closed_at <= ?1").bind(cutoff),
    db.prepare("UPDATE blog_drafts SET closed = 'auto', closed_at = ?2, updated_at = ?2 WHERE closed IS NULL AND created_at <= ?1").bind(cutoff, at),
  ]);
  const changes = (result) => Number(result?.meta?.changes ?? result?.changes ?? 0);
  return { deleted: changes(results[0]), autoClosed: changes(results[1]) };
}
