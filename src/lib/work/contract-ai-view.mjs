// 계약서 AI 일정 뽑기 화면의 순수 부품(단계 4, 사용자 선택 2026-11-23 "B안 별도 화면"·"다섯 다 추천대로"·비용 표시 "넣음").
// 손님 카드 거래 칸의 'AI로 일정 뽑기' 상자(work-ai-section.ts)와 결과 고르기 화면(work-ai-review.ts)이 같이 쓴다.
// - 비교·확정 규칙은 서버와 같은 contract-compare.mjs를 그대로 쓰고, 여기에는 화면 글·조회 간격·확정 본문·일정 미리 보기만 둔다.
// - 일정 미리 보기는 서버(worker/work-events.mjs planDealSchedule)와 같은 계산 함수(buildContractSchedule)·같은 법령 데이터로 만든다.
//   거래 칸 → 계산 입력 옮기기(dealScheduleInput)는 서버 scheduleInput과 같아야 한다(시험이 대조한다).
// - 계약서 글·금액·날짜는 화면 메모리에만 두고 주소·브라우저 저장소·제목에 넣지 않는다(부르는 쪽 몫).
import { buildContractSchedule, describeCalendarDate } from "./legal-dates.mjs";
import { CONFIRM_MIDDLE_PAYMENTS_MAX, NEEDS_DECISION, compareContractResults, compareGroupResults } from "./contract-compare.mjs";
import { formatWon } from "./work-format.mjs";

export const AI_PICK_MAX = 5;
export const AI_POLL_FAST_MS = 5_000;
export const AI_POLL_SLOW_MS = 15_000;
export const AI_POLL_FAST_FOR_MS = 60_000;

// 조회 간격: 지켜보기 시작한 뒤 1분은 5초, 그 뒤 15초(S-02).
export const aiPollDelay = (watchedMs) => (watchedMs < AI_POLL_FAST_FOR_MS ? AI_POLL_FAST_MS : AI_POLL_SLOW_MS);

// 80000 → "1분 20초 지남", 40000 → "40초 지남"
export function aiElapsedText(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}초 지남`;
  return rest === 0 ? `${minutes}분 지남` : `${minutes}분 ${rest}초 지남`;
}

// 마이크로달러 → "1.40달러"(0.01달러 미만이면 "0.01달러 미만")
export function aiDollarText(microUsd) {
  const value = Number(microUsd) / 1_000_000;
  if (value > 0 && value < 0.01) return "0.01달러 미만";
  return `${value.toFixed(2)}달러`;
}

// 미리 보기 응답(GET /ai/estimate) → 시작 칸의 비용·한도 글과 막힌 까닭.
export function aiEstimateLines(estimate) {
  const cost = `최대 약 ${aiDollarText(estimate.estimatedCostMicroUsd)}`;
  const limit = estimate.remainingCostMicroUsd === null
    ? "한도를 아직 정하지 않았습니다"
    : `이번 달 ${aiDollarText(estimate.remainingCostMicroUsd)} · 오늘 ${estimate.remainingCreates}회(이번에 ${estimate.requests}회 씀)`;
  const blocked = {
    limits_missing: "AI 사용 한도(하루 횟수·월 비용)를 아직 정하지 않아 보낼 수 없습니다. 글 초안 화면에서 정한 뒤 다시 해 주세요.",
    daily: `오늘 쓸 수 있는 횟수가 모자랍니다(남은 ${estimate.remainingCreates ?? 0}회, 이번에 ${estimate.requests}회 필요). 보내지 않았습니다.`,
    monthly: `이번 달 비용 한도에 닿습니다(남은 ${aiDollarText(estimate.remainingCostMicroUsd ?? 0)}, 이번 묶음은 ${cost}를 잡아 둬야 함). 보내지 않았습니다.`,
  }[estimate.blockedBy] ?? null;
  return { cost, limit, blocked };
}

// WORK_AI_ENABLED가 없을 때(503 AI_DISABLED) 화면 어디서나 쓰는 한 줄. 켜는 것은 따로 승인을 받은 뒤 한다.
export const AI_DISABLED_TEXT = "AI 일정 뽑기가 아직 켜지지 않았습니다.";

// 만들기·미리 보기·취소가 실패했을 때 한 줄(S-01). 모르는 코드는 손님 화면 공통 문장(fallback)으로.
/** @param {string | null} code @param {(code: string | null) => string} [fallback] */
export function aiCreateErrorText(code, fallback = () => "요청을 처리하지 못했습니다. 잠시 뒤 다시 해 주세요.") {
  const texts = {
    AI_DISABLED: AI_DISABLED_TEXT,
    AI_CONFIG_INVALID: "AI 설정(키·모델)을 확인해야 합니다. 개발 담당에게 알려 주세요.",
    AI_INPUT_TOO_LARGE: `한 번에 사진 ${AI_PICK_MAX}장, 합계 12MB까지 읽을 수 있습니다. 고른 사본을 줄여 주세요.`,
    AI_LIMITS_MISSING: "AI 사용 한도(하루 횟수·월 비용)를 아직 정하지 않아 보낼 수 없습니다. 글 초안 화면에서 정한 뒤 다시 해 주세요.",
    AI_BUDGET_EXCEEDED: "AI 사용 한도에 닿아 보내지 않았습니다. 내일 다시 하거나 글 초안 화면에서 한도를 바꿔 주세요.",
    AI_RATE_LIMITED: "AI 요청이 잠시 많습니다. 잠시 뒤 다시 해 주세요.",
    AI_UPSTREAM_FAILED: "AI 서비스가 응답하지 않았습니다. 잠시 뒤 다시 해 주세요.",
    AI_REQUEST_INVALID: "AI 요청이 받아들여지지 않았습니다. 개발 담당에게 알려 주세요.",
    AI_NOT_FOUND: "AI 요청이 받아들여지지 않았습니다. 개발 담당에게 알려 주세요.",
    AI_STATE_UNKNOWN: "요청이 만들어졌는지 확인하지 못했습니다. 비용이 들었을 수 있으니 OpenAI 사용량 화면에서 확인한 뒤 다시 뽑으세요.",
    AI_JOB_STATE_CONFLICT: "작업 상태가 바뀌었습니다. 다시 불러와 주세요.",
    FILE_STORAGE_FAILED: "계약서 사본을 읽지 못했습니다. 잠시 뒤 다시 해 주세요.",
    NOT_FOUND: "고른 계약서 사본을 찾지 못했습니다(지웠거나 휴지통에 있음). 손님 카드를 다시 불러와 주세요.",
  };
  return texts[code] ?? fallback(code);
}

// 작업 하나가 실패한 까닭(jobs[].errorCode, S-12). 결과를 못 받은 것(출력 상한·기한 지남)은 다시 하면 새 비용이 든다고 밝힌다. 자동으로 다시 하지 않는다.
export function aiJobErrorText(code) {
  const texts = {
    AI_RESULT_INVALID: "읽은 결과가 정해진 꼴이 아니라 쓰지 않았습니다.",
    AI_RESULT_INCOMPLETE: "출력 상한에 걸려 결과를 다 받지 못했습니다. 다시 실행하면 새 비용이 듭니다.",
    AI_RESULT_EXPIRED: "결과를 받을 수 있는 시간이 지나 받지 못했습니다. 다시 실행하면 새 비용이 듭니다.",
    AI_STATE_UNKNOWN: "요청이 만들어졌는지 확인하지 못했습니다. 비용이 들었을 수 있으니 OpenAI 사용량 화면에서 확인한 뒤 다시 뽑으세요.",
    AI_LEASE_EXPIRED: "1시간 안에 끝나지 않아 기다리기를 멈췄습니다. 다시 뽑으면 새 비용이 들 수 있습니다.",
  };
  return texts[code] ?? "결과를 받지 못했습니다. 다시 뽑으면 새 비용이 들 수 있습니다.";
}

export const AI_JOB_STATUS_LABELS = Object.freeze({
  queued: "기다리는 중", in_progress: "읽는 중", completed: "끝남", failed: "실패", cancelled: "그만둠", incomplete: "다 받지 못함", unknown: "확인 못 함",
});

// 한 번 읽기 묶음(작업 1개, 2026-11-24부터 만든 것)인지. 아니면 옛 두 번 읽기 묶음이다.
export const aiSingleRead = (jobs) => jobs.length === 1;

// 묶음 조회 응답의 작업들(runIndex 순서) → 비교 결과. 한 번 읽기면 칸마다 read·unread, 옛 묶음이면 같음·다름·한쪽만·둘 다 없음.
export function aiCompareJobs(jobs, dealType) {
  const sorted = [...jobs].sort((a, b) => a.runIndex - b.runIndex);
  return compareGroupResults(sorted.map((job) => job.result ?? null), dealType);
}

// 옛 두 번 읽기 묶음의 작업이 하나만 결과가 있을 때 위 알림(S-07). 한 번 읽기 묶음에는 없다.
export function aiHalfText(jobs) {
  if (aiSingleRead(jobs)) return null;
  const done = jobs.filter((job) => job.result);
  if (done.length !== 1) return null;
  const missing = jobs.find((job) => !job.result);
  return `${missing?.runIndex ?? 2}회째가 실패해 ${done[0].runIndex}회째 결과만 있습니다. 모든 칸을 직접 골라 주세요.`;
}

// ── 비교표 ──

export const AI_FIELD_LABELS = Object.freeze({
  contractDate: "계약일", middlePayments: "중도금 날짜", balanceDate: "잔금 날짜",
  priceWon: "거래금액", depositWon: "보증금", monthlyRentWon: "월세",
  documentKind: "계약서 종류", dealType: "거래 종류", downPaymentDate: "계약금 날짜", downPaymentWon: "계약금",
  middlePaymentWons: "중도금 금액", balanceWon: "잔금", propertyText: "물건 표시",
});
const DATE_FIELDS = new Set(["contractDate", "balanceDate", "downPaymentDate"]);
const MONEY_FIELDS = new Set(["priceWon", "depositWon", "monthlyRentWon", "downPaymentWon", "balanceWon"]);
const DOCUMENT_KIND_LABELS = Object.freeze({ sale_contract: "매매 계약서", lease_contract: "임대차 계약서", unknown: "알 수 없음" });
const DEAL_TYPE_TEXT = Object.freeze({ sale: "매매", exchange: "교환", jeonse: "전세", monthly_rent: "월세" });
// read·unread는 한 번 읽기 묶음의 칸 상태다(read는 사람이 사진과 견줘 골라야 함).
export const AI_STATUS_TEXT = Object.freeze({ same: "✓ 같음", different: "≠ 다름", one_side: "◐ 한쪽만", both_empty: "– 둘 다 없음", read: "확인할 칸", unread: "– 못 읽음" });
// 칸 상태 가운데 값이 없어 화면에서 접어 두는 것(보기만 하는 칸 목록에서도 뺌).
export const aiEmptyStatus = (status) => status === "both_empty" || status === "unread";

// "2026-11-20" → "2026-11-20 (금)"
export const aiDateText = (value) => {
  try {
    return `${value} (${describeCalendarDate(value).weekday})`;
  } catch {
    return String(value);
  }
};

// 칸 값 → 화면 글. 값이 없으면 null(부르는 쪽이 '못 읽음'으로 그림).
export function aiValueText(field, value) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return null;
  if (field === "middlePayments") return value.map((date, index) => `${index + 1}차 ${date === null ? "못 읽음" : aiDateText(date)}`).join(" · ");
  if (field === "middlePaymentWons") return value.map((won, index) => `${index + 1}차 ${won === null ? "못 읽음" : formatWon(won)}`).join(" · ");
  if (DATE_FIELDS.has(field)) return aiDateText(value);
  if (MONEY_FIELDS.has(field)) return formatWon(value);
  if (field === "documentKind") return DOCUMENT_KIND_LABELS[value] ?? String(value);
  if (field === "dealType") return DEAL_TYPE_TEXT[value] ?? String(value);
  return String(value);
}

// 결과의 칸 → 근거(원문 글·쪽·위치 상자). 근거는 참고이고 원문 글이 먼저다(S-08).
export function aiEvidenceOf(result, field) {
  if (!result) return null;
  const pick = {
    contractDate: result.contract_date, balanceDate: result.balance?.date, priceWon: result.price_won, depositWon: result.deposit_won,
    monthlyRentWon: result.monthly_rent_won, middlePayments: result.middle_payments?.find((payment) => payment.date.value !== null)?.date,
  }[field];
  if (!pick || pick.value === null || pick.value === undefined) return null;
  return pick.evidence?.quote ? pick.evidence : null;
}

// 비교 결과 → 개수 요약(같음·다름·한쪽만, 한 번 읽기면 확인할 칸·못 읽음, 그리고 보기만). both_empty는 세지 않는다.
export function aiSummary(comparison) {
  const count = (status) => comparison.fields.filter((item) => item.status === status).length;
  return {
    same: count("same"), different: count("different"), oneSide: count("one_side"), read: count("read"), unread: count("unread"),
    reference: comparison.reference.filter((item) => !aiEmptyStatus(item.status)).length,
  };
}

// 비교를 처음 열 때의 고르기: 같음 칸은 그 값을 넣고(apply), 둘 다 없는 칸은 건드리지 않고, 다름·한쪽만 칸은 비워 둔다(사람이 골라야 함).
// 한 번 읽기 묶음은 같음 칸이 없어 처음에는 아무것도 골라 두지 않는다(AI 값도 사람이 사진과 견준 뒤 고름).
// 고르기 하나: { kind: "first" | "second" | "keep" | "manual" | "same", value }
// AI 값을 그대로 거래에 넣을 수 있는지: 값이 있고, 중도금이면 모든 차의 날짜를 읽었을 때만(못 읽은 차가 있으면 직접 넣기).
export function aiCanApply(field, value) {
  if (value === null || value === undefined) return false;
  if (field === "middlePayments") return Array.isArray(value) && value.length > 0 && value.length <= CONFIRM_MIDDLE_PAYMENTS_MAX && value.every((date) => typeof date === "string");
  return true;
}

export function aiInitialChoices(comparison) {
  const choices = {};
  for (const item of comparison.fields) {
    if (item.status === "same" && aiCanApply(item.field, item.first)) choices[item.field] = { kind: "same", value: item.first };
  }
  return choices;
}

// '모두 AI 값으로'(한 번 읽기 묶음, 사용자 승인 2026-11-24 "넣어"): AI가 읽어 그대로 넣을 수 있는 칸(read이고 aiCanApply)만 'AI 값'(first)으로 고른다.
// - 못 읽은 칸(unread)과 못 읽은 차가 있는 중도금처럼 그대로 넣을 수 없는 칸은 건드리지 않는다(사람이 고를 때까지 남음).
// - 이미 '지금 값 그대로'·'직접 넣기'로 고른 칸도 누른 뜻대로 AI 값으로 바꾼다. 직접 넣던 값은 drafts로 돌려주어
//   화면이 그 칸의 '직접 넣기'를 다시 누를 때 되살린다(지우지 않음).
// - 옛 두 번 읽기 묶음에는 'AI 값'이 하나가 아니어서(read 칸이 없음) 바꾸는 칸이 없다.
/** @returns {{ choices: Record<string, any>, picked: string[], drafts: Record<string, any> }} */
export function aiPickAllAi(comparison, choices) {
  const next = { ...choices };
  const picked = [];
  const drafts = {};
  for (const item of comparison.fields) {
    if (item.status !== "read" || !aiCanApply(item.field, item.first)) continue;
    const before = choices[item.field];
    if (before?.kind === "manual") drafts[item.field] = before.value;
    next[item.field] = { kind: "first", value: item.first };
    picked.push(item.field);
  }
  return { choices: next, picked, drafts };
}

// '모두 AI 값으로'를 누른 뒤 상태 한 줄. pending은 누른 뒤에도 고를 칸(aiPendingFields).
/** @param {{ picked: string[], drafts: Record<string, any> }} outcome @param {string[]} pending */
export function aiPickAllText(outcome, pending) {
  if (outcome.picked.length === 0) return "AI 값으로 고를 칸이 없습니다.";
  let text = `${outcome.picked.length}칸을 AI 값으로 골랐습니다. 사진과 다른 칸만 고쳐 주세요.`;
  if (pending.length > 0) text += ` 남은 ${pending.length}칸은 AI 값을 그대로 넣을 수 없어 직접 골라 주세요.`;
  if (Object.keys(outcome.drafts).length > 0) text += " 직접 넣던 값은 '직접 넣기'를 다시 누르면 돌아옵니다.";
  return text;
}

// 아직 고르지 않은 칸(다름·한쪽만인데 고르기가 없거나, 직접 넣기가 빈 칸). 서버 missingDecisions와 같은 뜻 + 직접 넣기 형식 확인.
export function aiPendingFields(comparison, choices) {
  return comparison.fields
    .filter((item) => NEEDS_DECISION.includes(item.status))
    .filter((item) => {
      const choice = choices[item.field];
      if (!choice) return true;
      if (choice.kind !== "manual") return false;
      return aiManualProblem(item.field, choice.value) !== null;
    })
    .map((item) => item.field);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
// 직접 넣은 값이 틀렸으면 까닭 한 줄, 맞으면 null. 날짜는 'YYYY-MM-DD', 금액은 원 단위 정수, 중도금은 날짜 1 ~ 4개(빈 칸 없음).
export function aiManualProblem(field, value) {
  if (field === "middlePayments") {
    if (!Array.isArray(value) || value.length === 0 || value.length > CONFIRM_MIDDLE_PAYMENTS_MAX) return `중도금 날짜를 1 ~ ${CONFIRM_MIDDLE_PAYMENTS_MAX}개 넣어 주세요.`;
    if (value.some((date) => !DATE_RE.test(date ?? ""))) return "중도금 날짜 칸이 비었거나 형식이 맞지 않습니다.";
    return null;
  }
  if (DATE_FIELDS.has(field)) return DATE_RE.test(value ?? "") ? null : "날짜를 골라 주세요.";
  if (MONEY_FIELDS.has(field)) return Number.isSafeInteger(value) && value >= 0 && value < 1_000_000_000_000 ? null : "금액을 원 단위 숫자로 넣어 주세요.";
  return "넣을 수 없는 칸입니다.";
}

// 고르기 → 확정 본문 { dealVersion, apply, keep } (G18). 같음 칸도 apply에 넣는다(지금 거래 값과 같으면 바뀌지 않음).
/** @returns {{ dealVersion: number, apply: Record<string, any>, keep: string[] }} */
export function aiConfirmBody(comparison, choices, dealVersion) {
  const apply = {};
  const keep = [];
  for (const item of comparison.fields) {
    const choice = choices[item.field];
    if (!choice) continue;
    if (choice.kind === "keep") keep.push(item.field);
    else apply[item.field] = choice.value;
  }
  return { dealVersion, apply, keep };
}

// ── 거래에 넣기 전 확인(G10) ──

const DEAL_COLUMN = Object.freeze({ contractDate: "contractOn", balanceDate: "balanceOn", priceWon: "priceWon", depositWon: "depositWon", monthlyRentWon: "monthlyRentWon" });
export const AI_INTO_LABELS = Object.freeze({ contractDate: "계약일", middlePayments: "중도금일", balanceDate: "잔금일", priceWon: "거래금액", depositWon: "보증금", monthlyRentWon: "월세" });
export const AI_CHANGE_TEXT = Object.freeze({ same: "그대로", new: "＋ 새로", overwrite: "↺ 덮어씀", clear: "– 비움" });

// 거래(DealDetail.deal, camelCase)와 확정 본문 → 칸마다 { field, before, after, change }. 중도금은 거래 칸(첫째)만 견주고 둘째부터는 일정으로 보인다.
export function aiIntoRows(deal, body) {
  return Object.entries(body.apply).map(([field, value]) => {
    const before = field === "middlePayments" ? deal.middlePaymentOn : deal[DEAL_COLUMN[field]];
    const after = field === "middlePayments" ? (value[0] ?? null) : value;
    const change = before === after ? "same" : after === null ? "clear" : before === null || before === undefined ? "new" : "overwrite";
    return { field, before: before ?? null, after, change };
  });
}

// 거래 칸 → 일정 계산 입력(worker/work-events.mjs scheduleInput과 같은 뜻, 거래 응답의 camelCase 칸).
export function dealScheduleInput(deal) {
  return {
    dealKind: deal.dealType === "sale" ? (deal.saleKind ?? "sale") : deal.dealType,
    target: deal.propertyKind === "officetel" ? deal.scheduleTarget : deal.propertyKind,
    regulation: deal.regulation,
    contractDate: deal.contractOn,
    middlePaymentDate: deal.middlePaymentOn,
    balanceDate: deal.balanceOn,
    propertyLabel: deal.propertyLabel,
    priceWon: deal.priceWon,
    depositWon: deal.depositWon,
    monthlyRentWon: deal.monthlyRentWon,
    buyerType: deal.buyerIsCorporation ? "corporation" : "individual",
    landPermitArea: Boolean(deal.landPermitArea),
    capitalAreaEtc: Boolean(deal.metroArea),
    landShare: Boolean(deal.landShare),
    separateFundingSubmission: Boolean(deal.separateFundingSubmission),
    reportingRegion: Boolean(deal.leaseReportingRegion),
    renewalWithoutChange: Boolean(deal.leaseRenewalWithoutChange),
  };
}

const SCHEDULE_KIND_TO_EVENT = Object.freeze({
  contract: "contract", middlePayment: "middle_payment", balance: "balance", transactionReport: "transaction_report",
  fundingPlanDelivery: "funding_plan_to_agent", fundingPlanSeparate: "funding_plan_submit", leaseReport: "lease_report",
});

// 확정한 뒤의 거래 칸으로 일정을 미리 계산한다. 돌려주는 값: { ok: true, events: [{ kind, date, title, source: "calculated" | "ai", kept, keptReason }] } 또는 { ok: false }.
// kept: 같은 종류에 사람이 고친 일정·완료한 자동 일정이 있어 서버가 그대로 둘 일정(서버 scheduleOutcome과 같은 판정, 그때 남는 날짜).
// keptReason: "manual"(직접 고침) | "done"(완료한 자동 일정) | null — 서버 kept[].reason과 같은 뜻.
// 둘째부터의 중도금은 금액 없는 따로 넣는 일정(서버 custom·ai_confirmed, 화면 이름 'AI로 넣음')이고, 같은 차를 이미 완료로 표시했으면 넣지 않는다(서버와 같은 규칙).
// previous: 앞 AI 결과로 넣은 일정이 이번에 어떻게 되는지(aiPreviousMiddles).
// twins: 끝나지 않은 직접 일정 가운데 이번에 넣을 AI 중도금과 같은 차인 것(aiManualTwins). 서버는 그대로 두고 AI 일정을 또 넣어 두 줄이 된다.
/** @returns {{ ok: true, events: { kind: string, date: string, title: string, source: string, kept: string | null, keptReason: "manual" | "done" | null }[], previous: { date: string, title: string, status: "changed" | "removed" | "done" | "kept", next: string | null }[], twins: { date: string, title: string, aiDate: string }[] } | { ok: false, events?: undefined, previous?: undefined, twins?: undefined }} */
export function aiSchedulePreview(deal, body, events, legalRules) {
  const next = { ...deal };
  for (const [field, value] of Object.entries(body.apply)) {
    if (field === "middlePayments") next.middlePaymentOn = value[0] ?? null;
    else next[DEAL_COLUMN[field]] = value;
  }
  if (!next.contractOn) return { ok: false };
  let schedule;
  try {
    schedule = buildContractSchedule(dealScheduleInput(next), legalRules);
  } catch {
    return { ok: false };
  }
  if (!schedule.ok) return { ok: false };
  const list = schedule.events.map((event) => {
    const kind = SCHEDULE_KIND_TO_EVENT[event.kind];
    const own = events.find((item) => item.kind === kind && item.source !== "calculated")
      ?? events.find((item) => item.kind === kind && item.source === "calculated" && item.doneAt !== null);
    return { kind, date: event.date, title: event.title, source: "calculated", kept: own ? own.dueOn : null, keptReason: own ? (own.source === "calculated" ? "done" : "manual") : null };
  });
  const middles = Object.hasOwn(body.apply, "middlePayments") ? body.apply.middlePayments : [];
  middles.slice(1).forEach((date, index) => {
    const label = `${index + 2}차 중도금`;
    if (events.some((item) => item.kind === "custom" && item.doneAt !== null && item.title.startsWith(label))) return;
    list.push({ kind: "custom", date, title: next.propertyLabel ? `${label}(${next.propertyLabel})` : label, source: "ai", kept: null, keptReason: null });
  });
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ok: true, events: list, previous: aiPreviousMiddles(body, events, list), twins: aiManualTwins(events, list) };
}

// 끝나지 않은 직접 일정(custom, ai_confirmed 아님) 가운데 제목이 이번에 넣을 AI 중도금과 같은 'n차 중도금'으로 시작하는 것.
// 서버는 직접 일정을 지우지 않고(AI_MIDDLE_DELETE_SQL은 ai_confirmed만), 완료한 같은 차만 건너뛰므로 끝나지 않은 것은 AI 일정과 두 줄이 된다.
/** @returns {{ date: string, title: string, aiDate: string }[]} */
function aiManualTwins(events, list) {
  const twins = [];
  for (const fresh of list.filter((item) => item.source === "ai")) {
    const label = /^(\d+차 중도금)/u.exec(fresh.title)?.[1];
    if (!label) continue;
    for (const item of events) {
      if (item.kind === "custom" && item.source !== "ai_confirmed" && item.source !== "calculated" && item.doneAt === null && item.title.startsWith(label)) {
        twins.push({ date: item.dueOn, title: item.title, aiDate: fresh.date });
      }
    }
  }
  return twins.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// 앞 확정이 넣은 둘째 이후 중도금(custom·ai_confirmed)이 이번 확정에서 어떻게 되는지(서버 AI_MIDDLE_DELETE_SQL과 같은 판정).
// 서버는 apply에 middlePayments가 있을 때만 끝나지 않은 ai_confirmed 일정을 모두 지우고 새로 넣는다. 완료한 것은 지우지 않는다.
// status: "changed"(같은 차를 새로 넣음, next = 새 날짜) | "removed"(이번 결과에 그 차가 없어 지움) | "done"(완료, 그대로) | "kept"(중도금을 넣지 않아 그대로).
/** @returns {{ date: string, title: string, status: "changed" | "removed" | "done" | "kept", next: string | null }[]} */
function aiPreviousMiddles(body, events, list) {
  const replacing = Object.hasOwn(body.apply, "middlePayments");
  const fresh = list.filter((item) => item.source === "ai");
  return events
    .filter((item) => item.kind === "custom" && item.source === "ai_confirmed")
    .map((item) => {
      if (item.doneAt !== null) return { date: item.dueOn, title: item.title, status: "done", next: null };
      if (!replacing) return { date: item.dueOn, title: item.title, status: "kept", next: null };
      const order = /^(\d+)차 중도금/u.exec(item.title)?.[1];
      const same = order ? fresh.find((event) => event.title.startsWith(`${order}차 중도금`)) : undefined;
      return same ? { date: item.dueOn, title: item.title, status: "changed", next: same.date } : { date: item.dueOn, title: item.title, status: "removed", next: null };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// "2026-12-18" → "12월 18일 (금)"
export function aiShortDate(value) {
  const [, month, day] = String(value).split("-");
  try {
    return `${Number(month)}월 ${Number(day)}일 (${describeCalendarDate(value).weekday})`;
  } catch {
    return String(value);
  }
}

// 확정 실패 문장(S-14 ~ S-16, G20). field는 400의 details에 있는 칸 이름들.
export const AI_CONFLICT_TEXT = "다른 곳에서 바뀌었습니다. 다시 불러와 주세요.";
export const AI_COPY_TRASHED_TEXT = "읽은 계약서 사본이 휴지통에 있어 이 결과를 거래에 넣을 수 없습니다. 휴지통에서 되살리면 이어집니다.";
export const AI_DEAL_CLOSED_TEXT = "끝난 거래와 취소한 거래에는 AI 결과를 넣을 수 없습니다.";
/** @param {string | null} code @param {string[]} [details] @param {(code: string | null) => string} [fallback] */
export function aiConfirmErrorText(code, details, fallback = () => "요청을 처리하지 못했습니다. 잠시 뒤 다시 해 주세요.") {
  if (code === "VERSION_CONFLICT" || code === "AI_JOB_STATE_CONFLICT") return AI_CONFLICT_TEXT;
  if (code === "NOT_FOUND") return AI_COPY_TRASHED_TEXT;
  if (code === "DEAL_CLOSED") return AI_DEAL_CLOSED_TEXT;
  if (code === "AI_DISABLED") return AI_DISABLED_TEXT;
  if (code === "VALIDATION_FAILED") {
    const names = (details ?? []).map((field) => AI_INTO_LABELS[field] ?? AI_FIELD_LABELS[field] ?? field);
    return names.length > 0
      ? `넣을 값이 맞지 않습니다: ${names.join(", ")}. 날짜 순서(계약일 → 중도금 → 잔금)와 계산에 필요한 칸(거래금액 등)을 확인해 주세요.`
      : "넣을 값이 맞지 않습니다. 칸을 다시 확인해 주세요.";
  }
  return fallback(code);
}

// 결과 고르기 화면 주소. 묶음 ID와 돌아갈 손님 카드 ID(UUID만)만 싣는다.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export const aiReviewHref = (groupId, customerId) => `/admin/work/ai/review/?id=${encodeURIComponent(groupId)}${customerId && UUID_PATTERN.test(customerId) ? `&from=${encodeURIComponent(customerId)}` : ""}`;
export function aiReviewParams(search) {
  const params = new URLSearchParams(search);
  const id = params.get("id") ?? "";
  const from = params.get("from") ?? "";
  return { id: UUID_PATTERN.test(id) ? id : null, from: UUID_PATTERN.test(from) ? from : null };
}

export { compareContractResults, compareGroupResults };
