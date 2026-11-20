// 글 초안 화면(P3, /admin/work/blog/)의 문장·숫자 처리. 화면 스크립트가 쓰고 시험이 직접 부른다.
// 서버 요청·브라우저 저장·주소 변경을 하지 않는다. 입력값과 글 본문을 기록하지 않는다.
import { DISCLOSURE_FIELD_LABELS } from "./ad-disclosure.mjs";
import { CHECK_KIND_LABELS } from "./blog-checks.mjs";
import { kstShort } from "./realprice-view.mjs";

// 결과 확인 간격(설계서 22.11절): 처음 1분은 5초마다, 그 뒤 15초마다.
export const BLOG_POLL_FAST_MS = 5_000;
export const BLOG_POLL_SLOW_MS = 15_000;
export const BLOG_POLL_FAST_FOR_MS = 60_000;
// OpenAI가 결과를 잠시 맡아 두는 시간(worker/work-blog.mjs BLOG_RESULT_KEEP_MS와 같은 값).
export const BLOG_RESULT_KEEP_MINUTES = 10;
export const BLOG_RETENTION_DAYS = 30;
export const BLOG_SOURCE_PAGE_SIZE = 10;

export function pollDelayMs(elapsedMs) {
  return elapsedMs < BLOG_POLL_FAST_FOR_MS ? BLOG_POLL_FAST_MS : BLOG_POLL_SLOW_MS;
}

// ── 숫자 칸 ──

const cleanNumber = (text) => String(text ?? "").normalize("NFKC").replace(/[\s,]/gu, "");

// 빈 칸이면 null, 형식 밖이면 NaN, 맞으면 정수.
export function intFrom(text) {
  const value = cleanNumber(text);
  if (value === "") return null;
  return /^-?\d{1,10}$/u.test(value) ? Number(value) : Number.NaN;
}

// 소수 places자리까지. 빈 칸 null, 형식 밖 NaN.
export function decimalFrom(text, places = 2) {
  const value = cleanNumber(text);
  if (value === "") return null;
  return new RegExp(`^\\d{1,9}(?:\\.\\d{1,${places}})?$`, "u").test(value) ? Number(value) : Number.NaN;
}

// 마이크로달러 → "0.42"(소수 둘째 자리, 올림하지 않음).
export function usdText(microUsd) {
  if (!Number.isFinite(microUsd)) return "";
  return (Math.floor(microUsd / 10_000) / 100).toFixed(2);
}

// "10" · "10.5" · "10.50" → 마이크로달러 정수. 형식 밖이면 null.
export function usdToMicro(text) {
  const value = cleanNumber(text).replace(/^\$/u, "");
  const match = value.match(/^(\d{1,4})(?:\.(\d{1,2}))?$/u);
  if (!match) return null;
  return Number(match[1]) * 1_000_000 + Number((match[2] ?? "").padEnd(2, "0")) * 10_000;
}

// ── 한도·사용량(GET /work/blog/limits) ──

// 돌려주는 값: { saved, line, reason }. reason이 있으면 만들기를 막는다(서버가 최종 판단).
export function limitsView(limits) {
  if (!limits) return { saved: false, line: "", reason: "AI 사용 한도를 불러오지 못했습니다." };
  const saved = Number.isSafeInteger(limits.dailyCreateLimit) && Number.isSafeInteger(limits.monthlyCostLimitMicroUsd);
  const usage = limits.usage ?? { todayCreates: 0, monthCostMicroUsd: 0 };
  if (!saved) return { saved, line: "AI 사용 한도가 아직 없습니다", reason: "AI 사용 한도를 저장하면 만들 수 있습니다." };
  const line = `오늘 ${usage.todayCreates} / ${limits.dailyCreateLimit}편 · 이번 달 ${usdText(usage.monthCostMicroUsd)} / ${usdText(limits.monthlyCostLimitMicroUsd)}달러(추정)`;
  if (usage.todayCreates >= limits.dailyCreateLimit) return { saved, line, reason: `오늘 ${limits.dailyCreateLimit}편을 다 써서 만들 수 없습니다. 내일 0시(한국 시각)부터 다시 만들 수 있습니다.` };
  if (usage.monthCostMicroUsd >= limits.monthlyCostLimitMicroUsd) return { saved, line, reason: "이번 달 비용 상한에 닿아 만들 수 없습니다. 다음 달 1일(한국 시각)부터 다시 만들 수 있습니다." };
  return { saved, line, reason: null };
}

// ── 명시사항 빈 칸 ──

export function missingText(keys) {
  return [...new Set(keys)].map((key) => DISCLOSURE_FIELD_LABELS[key] ?? key).join("·");
}

// ── 글 검사 결과 ──

export function whereLabel(where) {
  if (where === "title") return "제목";
  if (where === "sns") return "SNS 짧은 글";
  const match = String(where).match(/^p(\d+)$/u);
  return match ? `문단 ${match[1]}` : String(where);
}

// checks: blog-checks.mjs checkBlogDraft()의 { blocks, warnings }. 같은 자리·같은 종류는 한 줄로 묶는다.
export function checkView(checks) {
  const group = (items) => {
    const map = new Map();
    for (const item of items) {
      const key = `${item.kind}|${item.where}`;
      if (!map.has(key)) map.set(key, { kind: item.kind, label: CHECK_KIND_LABELS[item.kind] ?? item.kind, where: item.where, whereLabel: whereLabel(item.where), texts: [] });
      const entry = map.get(key);
      if (!entry.texts.includes(item.text)) entry.texts.push(item.text);
    }
    return [...map.values()].map((entry) => ({ ...entry, text: entry.texts.map((text) => `'${text}'`).join(", ") }));
  };
  const blocks = group(checks?.blocks ?? []);
  const warnings = group(checks?.warnings ?? []);
  return { blocks, warnings, canCopy: blocks.length === 0 };
}

// ── 복사할 글 ──

export function normalizeHashtags(text) {
  const tags = String(text ?? "").normalize("NFKC").split(/[\s,]+/u).map((tag) => tag.replace(/^#+/u, "")).filter(Boolean);
  return [...new Set(tags)].map((tag) => `#${tag}`);
}

const DISCLOSURE_RULE = "──────────";

// 블로그 글: 제목 → 문단 → 해시태그 → 명시사항(코드가 붙임).
export function blogCopyText({ title, paragraphs, hashtags, disclosureText }) {
  const body = [String(title ?? "").trim(), ...paragraphs.map((text) => String(text ?? "").trim()).filter(Boolean)];
  const tags = hashtags.join(" ");
  return [...body, ...(tags ? [tags] : []), `${DISCLOSURE_RULE}\n${disclosureText}`].join("\n\n");
}

// SNS 글: 짧은 글 → 해시태그 → 명시사항(SNS 광고에도 같은 명시사항을 붙인다).
export function snsCopyText({ snsShort, hashtags, disclosureText }) {
  const tags = hashtags.join(" ");
  return [String(snsShort ?? "").trim(), ...(tags ? [tags] : []), `${DISCLOSURE_RULE}\n${disclosureText}`].join("\n\n");
}

// ── 초안 상태 ──

const CLOSED_TEXT = { confirmed: "다 씀", cancelled: "버림", auto: "30일 지나 닫힘" };
const STATUS_TEXT = {
  queued: "만드는 중",
  in_progress: "만드는 중",
  completed: "다 만듦",
  failed: "만들지 못함",
  expired: "시간 지남(결과 못 받음)",
  unknown: "결과 모름",
};

const addDays = (iso, days) => new Date(Date.parse(iso) + days * 86_400_000).toISOString();
const shortDate = (iso) => kstShort(iso).split(" ").slice(0, 2).join(" ");

// 보관 목록 한 줄의 상태 글. 닫힌 초안은 지울 날, 열린 초안은 자동으로 닫힐 날을 붙인다.
export function draftStatusText(item) {
  const made = kstShort(item.createdAt);
  if (item.closed) {
    const removeAt = item.closedAt ? ` · ${shortDate(addDays(item.closedAt, BLOG_RETENTION_DAYS))} 지움` : "";
    return `${CLOSED_TEXT[item.closed] ?? "닫힘"} · ${made}${removeAt}`;
  }
  return `${STATUS_TEXT[item.status] ?? item.status} · ${made}`;
}

export const isOpenStatus = (status) => status === "queued" || status === "in_progress";

// 초안이 끝났는데 글이 없을 때 보여 줄 판(제목·설명·다시 만들기 단추를 보일지).
export function failView(draft) {
  const cost = "비용은 들었을 수 있습니다(추정). 다시 만들면 새 비용이 듭니다.";
  const table = {
    AI_RESULT_EXPIRED: ["결과를 받지 못했습니다(10분 지남)", `화면을 닫은 사이 ${BLOG_RESULT_KEEP_MINUTES}분이 지나 AI 쪽에 잠시 맡겨 둔 결과가 사라졌습니다. ${cost}`],
    AI_STATE_UNKNOWN: ["AI 요청이 만들어졌는지 확인하지 못했습니다", `보낸 뒤 답을 받지 못했습니다. 이 초안은 결과를 받을 수 없습니다. ${cost}`],
    AI_RESULT_INVALID: ["AI 답이 정해진 모양이 아니었습니다", `글을 쓸 수 없어 버렸습니다(원문은 저장하지 않음). ${cost}`],
    AI_RESULT_INCOMPLETE: ["AI 답이 중간에 끊겼습니다", `글이 다 나오지 않아 버렸습니다. ${cost}`],
    AI_UPSTREAM_FAILED: ["AI 서비스가 글을 만들지 못했습니다", `잠시 뒤 다시 만들어 주세요. ${cost}`],
    AI_RATE_LIMITED: ["AI 요청이 잠시 많습니다", "만들지 않았고 비용도 들지 않았습니다. 1 ~ 2분 뒤 다시 만들어 주세요."],
    AI_CONFIG_INVALID: ["AI 설정(키·모델)을 확인해야 합니다", "만들지 않았고 비용도 들지 않았습니다. 개발 담당에게 'AI 설정 확인'이라고 알려 주세요."],
    AI_REQUEST_INVALID: ["AI 요청이 받아들여지지 않았습니다", "만들지 않았고 비용도 들지 않았습니다. 개발 담당에게 알려 주세요."],
  };
  const code = draft.errorCode ?? (draft.status === "expired" ? "AI_RESULT_EXPIRED" : draft.status === "unknown" ? "AI_STATE_UNKNOWN" : "AI_UPSTREAM_FAILED");
  const [title, body] = table[code] ?? table.AI_UPSTREAM_FAILED;
  return { title, body, retry: code !== "AI_CONFIG_INVALID" && code !== "AI_REQUEST_INVALID" };
}

// ── 오류 문구(만들기·한도 저장·닫기) ──

export function apiErrorText(code, details = []) {
  if (code === "DISCLOSURE_INCOMPLETE") return `명시사항 빈 칸을 먼저 채워 주세요: ${missingText(details)}.`;
  if (code === "PERSONAL_DATA_PATTERN") return "주민등록번호·전화번호·이메일·호수처럼 보이는 글자는 넣을 수 없습니다. 표시한 칸을 고쳐 주세요.";
  if (code === "AI_BUDGET_EXCEEDED") {
    return details.includes("monthly")
      ? "이번 달 AI 비용 상한에 닿았습니다. 다음 달 1일(한국 시각)부터 다시 만들 수 있습니다. 급하면 'AI 사용 한도'에서 상한을 올리세요."
      : "오늘 만들 수 있는 편수를 다 썼습니다. 내일 0시(한국 시각)부터 다시 만들 수 있습니다.";
  }
  const texts = {
    VALIDATION_FAILED: "입력 형식이 맞지 않는 칸이 있습니다. 표시한 칸을 고쳐 주세요.",
    SOURCE_NOT_PUBLIC: "고른 매물·단지가 지금 공개 자료에 없습니다. 자료를 다시 골라 주세요.",
    AI_LIMITS_MISSING: "AI 사용 한도를 먼저 저장해 주세요.",
    AI_RATE_LIMITED: "AI 요청이 잠시 많습니다. 1 ~ 2분 뒤 다시 해 주세요. 비용은 들지 않았습니다.",
    AI_CONFIG_INVALID: "AI 설정(키·모델)을 확인해야 합니다. 개발 담당에게 'AI 설정 확인'이라고 알려 주세요.",
    AI_STATE_UNKNOWN: "AI 요청이 만들어졌는지 확인하지 못했습니다. 아래 '보관 중인 초안'에서 상태를 확인해 주세요. 바로 다시 만들면 비용이 두 번 들 수 있습니다.",
    AI_UPSTREAM_FAILED: "AI 서비스가 응답하지 않았습니다. 잠시 뒤 다시 해 주세요.",
    AI_REQUEST_INVALID: "AI 요청이 받아들여지지 않았습니다. 개발 담당에게 알려 주세요.",
    AI_NOT_FOUND: "AI 요청이 받아들여지지 않았습니다. 개발 담당에게 알려 주세요.",
    BLOG_CONFIG_MISSING: "글 초안 설정이 빠져 있습니다. 개발 담당에게 '글 초안 설정 누락'이라고 알려 주세요.",
    BLOG_DISABLED: "글 초안 도구가 아직 켜지지 않았습니다.",
    REALPRICE_CONFIG_MISSING: "업무 도구 설정(실거래가) 가운데 빠진 것이 있어 불러오지 못했습니다. 개발 담당에게 '실거래가 설정 누락'이라고 알려 주세요.",
    DRAFT_STATE_CONFLICT: "초안 상태가 다른 곳에서 바뀌었습니다. 초안을 다시 열어 주세요.",
    VERSION_CONFLICT: "다른 화면에서 한도를 먼저 바꿨습니다. 아래는 새로 불러온 값입니다. 확인한 뒤 다시 저장해 주세요.",
    NOT_FOUND: "초안을 찾지 못했습니다. 30일이 지나 지워졌을 수 있습니다.",
    WORK_SCHEMA_OUTDATED: "업무 자료 구조가 아직 준비되지 않았습니다. 개발 담당에게 알려 주세요.",
    WORK_SCHEMA_AHEAD: "업무 자료 구조가 프로그램보다 새것입니다. 잠시 뒤 새로고침해 주세요.",
    STORAGE_UNAVAILABLE: "업무 자료 저장소에 연결하지 못했습니다. 잠시 뒤 다시 해 주세요.",
    CSRF_INVALID: "보안 확인이 만료되었습니다. 화면을 새로고침한 뒤 다시 해 주세요.",
    ORIGIN_DENIED: "허용되지 않은 주소에서 저장하려고 했습니다. 운영 주소에서 다시 해 주세요.",
    AUTH_REQUIRED: "관리자 로그인이 만료되었습니다. 화면을 새로고침해 다시 로그인해 주세요.",
  };
  return texts[code] ?? "요청을 처리하지 못했습니다. 잠시 뒤 다시 해 주세요.";
}
