// 매출장부 화면(단계 2, 설계서 6.12절)의 순수 함수. 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// 참고용 집계이며 세무 장부가 아니다. 금액은 원 단위 정수, 날짜는 "YYYY-MM-DD" 글자다.
import { calculateBrokerageFee, calculateVatWon, selectBrokerageFeeRule } from "./brokerage-fee.mjs";

export const LEDGER_NOTICE = "참고용 집계입니다. 세무 장부가 아닙니다.";
export const LEDGER_PAGE_SIZE = 50;
export const LEDGER_LABEL_MAX = 120;
export const LEDGER_MEMO_MAX = 500;
export const LEDGER_DEAL_QUERY_MAX = 30;
// CSV·기준일 없는 줄 보기는 화면 메모리에서 쪽을 이어 읽는다. 사무소 한 곳 규모라 이만큼이면 한 해가 다 들어간다(추정).
export const LEDGER_READ_ALL_PAGES = 40;

export const LEDGER_KIND_LABELS = Object.freeze({ fee: "보수", expense: "지출", other_income: "기타 수입" });
export const LEDGER_PAYER_LABELS = Object.freeze({ buyer: "매수인", seller: "매도인", tenant: "임차인", landlord: "임대인", other: "기타" });
export const LEDGER_BASIS_LABELS = Object.freeze({ balance: "잔금일", contract: "계약일", received: "입금일" });
export const LEDGER_BASES = Object.freeze(["balance", "contract", "received"]);
// 거래 종류마다 보수를 내는 두 쪽(쌍방 중개면 두 줄)
export const DEAL_PAYER_SIDES = Object.freeze({
  sale: ["buyer", "seller"],
  exchange: ["buyer", "seller"],
  jeonse: ["tenant", "landlord"],
  monthly_rent: ["tenant", "landlord"],
});

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const isDate = (value) => {
  const match = DATE_PATTERN.exec(value ?? "");
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCFullYear() === Number(match[1]) && date.getUTCMonth() === Number(match[2]) - 1 && date.getUTCDate() === Number(match[3]);
};

// 1980000 → "1,980,000"
export const numberText = (won) => Number(won ?? 0).toLocaleString("ko-KR");
// 1980000 → "1,980,000원"
export const wonText = (won) => `${numberText(won)}원`;

// "2026-11-20" → 그 해면 "11. 20.", 다른 해면 "2025. 10. 1.". 비면 "".
export function ledgerDateText(date, year) {
  const match = DATE_PATTERN.exec(date ?? "");
  if (!match) return "";
  const head = year && String(year) === match[1] ? "" : `${match[1]}. `;
  return `${head}${Number(match[2])}. ${Number(match[3])}.`;
}

// 장부 줄의 합계(공급가액 + 부가세)
export const entryTotalWon = (entry) => Number(entry?.amountWon ?? 0) + Number(entry?.vatWon ?? 0);

// 받을 돈 상태 한 줄. 지출은 받을 돈이 없다. 넘치게 받은 돈은 따로 알린다(설계서 6.12절 미입금).
export function payStateText(entry, year) {
  if (!entry || entry.kind === "expense") return { state: "none", text: "지출" };
  const total = entryTotalWon(entry);
  const received = Number(entry.receivedWon ?? 0);
  if (received > total) return { state: "over", text: `초과 입금 ${wonText(received - total)}` };
  const unpaid = Math.max(0, total - received);
  if (unpaid > 0) return { state: "due", text: received > 0 ? `미입금 ${wonText(unpaid)} (일부 입금 ${wonText(received)})` : `미입금 ${wonText(unpaid)}` };
  const on = ledgerDateText(entry.receivedOn, year);
  return { state: "paid", text: on ? `입금 끝 ${on}` : "입금 끝" };
}

// 서버 경고 코드 → 굵게 보일 문장(색만으로 알리지 않게 글자로). 부가세는 10%면 얼마인지 함께 적는다.
export function warningTexts(entry) {
  const texts = [];
  for (const code of entry?.warnings ?? []) {
    if (code === "FEE_OVER_CAP") texts.push("법정 상한보다 큽니다(그 거래의 중개보수 상한을 확인하세요)");
    else if (code === "VAT_DIFFERS") texts.push(`부가세가 10%와 다릅니다(10%면 ${wonText(calculateVatWon(Number(entry.amountWon ?? 0)))})`);
  }
  return texts;
}

// 기준일이 빈 줄 알림(설계서 6.12절, DEC-WT-39). 기준마다 글이 다르다.
export function undatedText(basis, count) {
  if (!count) return "";
  if (basis === "received") return `입금일이 없는 장부 줄 ${count}건(아직 입금 전 포함)은 합계에 없습니다.`;
  return `${LEDGER_BASIS_LABELS[basis] ?? "잔금일"}이 없는 장부 줄 ${count}건은 합계에 없습니다.`;
}

// 기준일 안내(⑤ 문구 가). 입금일 기준에서 지출은 잔금일(거래 없는 지출은 지출일)로 센다.
export function basisNote(basis) {
  if (basis === "received") return "입금일 기준 · 지출은 잔금일(거래 없는 지출은 지출일)로 셈";
  return `${LEDGER_BASIS_LABELS[basis] ?? "잔금일"} 기준`;
}

// 값 있는 달 번호들을 "1 ~ 8월, 12월"처럼 줄여 적는다.
export function monthRangesText(numbers) {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts = [];
  for (let index = 0; index < sorted.length; index += 1) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    parts.push(end - index >= 2 ? `${sorted[index]} ~ ${sorted[end]}월` : end === index ? `${sorted[index]}월` : `${sorted[index]}월, ${sorted[end]}월`);
    index = end;
  }
  return parts.join(", ");
}

export const LEDGER_PAID_NOTE = "부가세 포함 · 보수와 기타 수입";
// 휴대폰 달별 표는 머리가 좁아 "(부가세 포함)"을 붙이면 두 줄로 꺾이므로 표 아래 주석 한 줄로 대신한다.
export const LEDGER_NARROW_MONTHS_NOTE = "미입금은 부가세를 포함한 금액입니다(보수와 기타 수입).";

const SUMMARY_KEYS = ["feeWon", "vatWon", "feeWithVatWon", "receivedWon", "unpaidWon", "expenseWon", "otherIncomeWon", "netWon"];
const monthHasValue = (line) => SUMMARY_KEYS.some((key) => Number(line?.[key] ?? 0) !== 0);

// 달별 합계 응답 → 화면 칸. vat가 true면 보수를 부가세 포함으로 보인다(같은 응답으로 단추만 바꿈, 서버를 다시 부르지 않음).
/** @param {{ months?: Array<Record<string, any>>, total?: Record<string, any> } | null} summary @param {{ vat?: boolean }} [options] */
export function summaryView(summary, { vat = false } = {}) {
  const total = summary?.total ?? {};
  const months = (summary?.months ?? []).map((line) => ({ ...line, number: Number(String(line.month ?? "").slice(5, 7)), hasValue: monthHasValue(line) }));
  const fee = (line) => Number(vat ? line.feeWithVatWon : line.feeWon) || 0;
  const filled = months.filter((line) => line.hasValue);
  const empty = months.filter((line) => !line.hasValue).map((line) => line.number);
  return {
    tiles: [
      { key: "fee", label: "보수", value: wonText(fee(total)), note: vat ? "부가세 포함" : `부가세 ${wonText(total.vatWon)} 따로` },
      // 입금·미입금은 '부가세 빼고'에서도 부가세를 포함한 금액이다(서버 합계 그대로, 2026-11-21 대장 검토로 표시만 밝힘).
      { key: "received", label: "입금", value: wonText(total.receivedWon), note: LEDGER_PAID_NOTE },
      { key: "unpaid", label: "미입금", value: wonText(total.unpaidWon), note: LEDGER_PAID_NOTE, due: Number(total.unpaidWon) > 0 },
      { key: "expense", label: "지출", value: wonText(total.expenseWon), note: `기타 수입 ${wonText(total.otherIncomeWon)}` },
      { key: "net", label: "순수익", value: wonText(total.netWon), note: "보수(부가세 뺌) + 기타 수입 − 지출" },
    ],
    // 휴대폰: 값 있는 달만 최근 달부터
    narrowRows: filled.slice().reverse().map((line) => ({ month: `${line.number}월`, fee: numberText(fee(line)), unpaid: numberText(line.unpaidWon), due: Number(line.unpaidWon) > 0, net: numberText(line.netWon) })),
    emptyText: empty.length === 0 ? "" : empty.length === 12 ? "이 해에는 합계에 들어간 장부 줄이 없습니다." : `${monthRangesText(empty)}은 장부 줄이 없습니다.`,
    // PC: 12달 모두
    wideRows: months.map((line) => ({
      month: `${line.number}월`,
      empty: !line.hasValue,
      cells: [wonText(fee(line)), ...(vat ? [] : [wonText(line.vatWon)]), wonText(line.receivedWon), wonText(line.unpaidWon), wonText(line.expenseWon), wonText(line.otherIncomeWon), wonText(line.netWon)],
      due: Number(line.unpaidWon) > 0,
    })),
    wideTotal: [wonText(fee(total)), ...(vat ? [] : [wonText(total.vatWon)]), wonText(total.receivedWon), wonText(total.unpaidWon), wonText(total.expenseWon), wonText(total.otherIncomeWon), wonText(total.netWon)],
    wideHead: ["달", vat ? "보수(부가세 포함)" : "보수", ...(vat ? [] : ["부가세"]), "입금(부가세 포함)", "미입금(부가세 포함)", "지출", "기타 수입", "순수익"],
    isEmpty: filled.length === 0,
  };
}

// 입금일 기준 + 미입금만: 아직 안 받은 줄은 입금일이 없어 연도로 거르면 늘 빠지므로 연도 없이 모든 해를 본다(2026-11-21 대장 결정, 서버는 그대로).
export const LEDGER_UNPAID_ALL_YEARS_NOTE = "입금일 기준에서는 미입금 줄을 연도와 상관없이 모두 보여 줍니다(아직 입금일이 없으므로).";
export const unpaidAllYears = ({ basis = "balance", unpaid = false } = {}) => Boolean(unpaid) && basis === "received";

// 장부 목록 요청 주소 조건. 미입금만이면 미입금 큰 순, 그 밖에는 고른 해의 기준일 최근 순(서버 정렬).
/** @param {{ year?: string | number, basis?: string, kind?: string, unpaid?: boolean, dealId?: string, cursor?: string | null, all?: boolean, limit?: number }} [options] */
export function ledgerListQuery({ year, basis = "balance", kind = "", unpaid = false, dealId = "", cursor = null, all = false, limit = LEDGER_PAGE_SIZE } = {}) {
  const query = new URLSearchParams();
  if (year && !all && !unpaidAllYears({ basis, unpaid })) query.set("year", String(year));
  query.set("basis", LEDGER_BASES.includes(basis) ? basis : "balance");
  if (kind) query.set("kind", kind);
  if (unpaid) query.set("unpaid", "1");
  if (dealId) query.set("dealId", dealId);
  if (cursor) query.set("cursor", cursor);
  query.set("limit", String(limit));
  return query;
}

export function ledgerCountText(count, { more = false, unpaid = false, undated = false, basis = "balance" } = {}) {
  const n = `${count.toLocaleString("ko-KR")}개${more ? " 이상" : ""}`;
  if (undated) return `${LEDGER_BASIS_LABELS[basis] ?? "잔금일"}이 없는 장부 줄 ${n}`;
  return `장부 줄 ${n} · ${unpaid ? "미입금 큰 순" : "기준일 최근 순"}`;
}

// "1,800,000" "1800000원" " 180 000 " → 정수. 비면 null, 숫자가 아니면 NaN.
export function parseWon(text) {
  const raw = String(text ?? "").replace(/[\s,원]/gu, "");
  if (raw === "") return null;
  if (!/^\d{1,15}$/u.test(raw)) return Number.NaN;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : Number.NaN;
}

// 입력칸 값 → 서버로 보낼 값과 칸별 오류(서버 입력 검사와 같은 규칙, worker/work-input.mjs assertLedgerState).
// hasDeal: 거래에 잇는 줄인지(이으면 날짜 칸을 쓰지 않음). needsEntryOn: 날짜를 꼭 받아야 하는지(새 지출·기타 수입 중 거래 없는 줄).
/**
 * @param {Record<string, string | undefined>} values
 * @param {{ kind?: string, hasDeal?: boolean, needsEntryOn?: boolean }} [options]
 * @returns {{ ok: true, value: Record<string, any>, errors?: undefined } | { ok: false, errors: Record<string, string>, value?: undefined }}
 */
export function checkLedgerInput(values, { kind, hasDeal = false, needsEntryOn = false } = {}) {
  const errors = {};
  const value = {};
  if (!Object.hasOwn(LEDGER_KIND_LABELS, kind)) return { ok: false, errors: { kind: "종류를 골라 주세요." } };
  const amount = parseWon(values.amount);
  if (amount === null) errors.amount = "금액을 넣어 주세요.";
  else if (Number.isNaN(amount)) errors.amount = "금액은 숫자로만 넣어 주세요.";
  else value.amountWon = amount;
  const vat = parseWon(values.vat);
  if (Number.isNaN(vat)) errors.vat = "부가세는 숫자로만 넣어 주세요.";
  else value.vatWon = vat ?? 0;
  if (kind === "expense") {
    value.receivedWon = 0;
    value.receivedOn = null;
  } else {
    const received = parseWon(values.received);
    if (Number.isNaN(received)) errors.received = "입금액은 숫자로만 넣어 주세요.";
    else value.receivedWon = received ?? 0;
    const receivedOn = String(values.receivedOn ?? "").trim();
    if (receivedOn && !isDate(receivedOn)) errors.receivedOn = "입금일을 달력에서 골라 주세요.";
    else if ((value.receivedWon ?? 0) > 0 && !receivedOn) errors.receivedOn = "입금액이 있으면 입금일을 넣어 주세요.";
    else if ((value.receivedWon ?? 0) === 0 && receivedOn) errors.receivedOn = "입금액이 0원이면 입금일을 비워 주세요.";
    else value.receivedOn = receivedOn || null;
  }
  if (!hasDeal) {
    const entryOn = String(values.entryOn ?? "").trim();
    if (entryOn && !isDate(entryOn)) errors.entryOn = "날짜를 달력에서 골라 주세요.";
    else if (!entryOn && needsEntryOn) errors.entryOn = "거래에 잇지 않은 지출·기타 수입은 날짜가 있어야 합니다.";
    else value.entryOn = entryOn || null;
  }
  const label = String(values.label ?? "").trim().replace(/\s+/gu, " ");
  if (label.length > LEDGER_LABEL_MAX) errors.label = `물건 표시·내용은 ${LEDGER_LABEL_MAX}자까지입니다.`;
  else value.label = label;
  const memo = String(values.memo ?? "").replace(/\r\n?/gu, "\n").trim();
  if (memo.length > LEDGER_MEMO_MAX) errors.memo = `메모는 ${LEDGER_MEMO_MAX}자까지입니다.`;
  else value.memo = memo;
  if (kind === "fee") value.payerRole = Object.hasOwn(LEDGER_PAYER_LABELS, values.payerRole) ? values.payerRole : null;
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

// 고치기: 저장된 줄과 다른 칸만 보낸다(종류·거래는 서버가 받지 않음). 입금액·입금일은 함께 검사되므로 둘 중 하나가 바뀌면 둘 다 보낸다.
/** @param {Record<string, any> | null} before @param {Record<string, any>} value @returns {Record<string, unknown>} */
export function ledgerChanges(before, value) {
  /** @type {Record<string, unknown>} */
  const changes = {};
  for (const key of ["payerRole", "label", "entryOn", "amountWon", "vatWon", "receivedWon", "receivedOn", "memo"]) {
    if (!(key in value)) continue;
    if ((before?.[key] ?? null) !== (value[key] ?? null)) changes[key] = value[key];
  }
  if (("receivedWon" in changes) !== ("receivedOn" in changes) && before?.kind !== "expense") {
    changes.receivedWon = value.receivedWon;
    changes.receivedOn = value.receivedOn;
  }
  return changes;
}

// 보수 채워 넣기(설계서 6.12절): 거래의 금액·종류·계약일로 중개보수 계산 함수(단계 0과 같은 함수)를 돌려 법정 상한과 부가세를 낸다.
// 주택만 칸을 채운다. 오피스텔은 주거용 조건을, 그 밖의 건축물·토지는 사무소 게시 요율을 거래 자료에 두지 않아
// 서버 경고처럼 가장 높은 요율로 채우면 너무 큰 보수를 권하게 되므로 채우지 않고 까닭만 알린다. 교환은 두 물건 가액이 따로 없어 계산하지 않는다.
/**
 * @param {Record<string, any> | null} deal @param {any} legalRules
 * @returns {{ ok: true, maxFeeWon: number, vatWon: number, text: string, detail: string, reason?: undefined } | { ok: false, reason: string, maxFeeWon?: undefined, vatWon?: undefined, text?: undefined, detail?: undefined }}
 */
export function dealFeeCap(deal, legalRules) {
  if (!deal) return { ok: false, reason: "거래를 고르면 법정 상한을 계산합니다." };
  if (deal.dealType === "exchange") return { ok: false, reason: "교환 거래는 두 물건 가액이 따로 없어 상한을 계산하지 않습니다." };
  if (!deal.contractOn) return { ok: false, reason: "거래에 계약일이 없어 상한을 계산하지 않습니다." };
  if (deal.propertyKind !== "housing") return { ok: false, reason: "주택이 아닌 거래는 요율 조건을 거래 자료에 두지 않아 상한을 채우지 않습니다. '중개보수 계산'에서 확인해 주세요." };
  let rule;
  try {
    rule = selectBrokerageFeeRule(legalRules, deal.contractOn);
  } catch {
    return { ok: false, reason: "계약일이 법령 자료 범위 밖이라 상한을 계산하지 않습니다." };
  }
  const result = calculateBrokerageFee({
    contractDate: deal.contractOn,
    dealType: deal.dealType,
    propertyKind: "housing",
    officetelConditions: {},
    officeOtherRateBp: rule.otherMaxRateBp,
    priceWon: deal.priceWon,
    depositWon: deal.depositWon,
    monthlyRentWon: deal.monthlyRentWon,
    vatDisplay: false,
  }, legalRules);
  if (!result.ok) return { ok: false, reason: "거래 금액이 비어 있어 상한을 계산하지 않습니다." };
  const vatWon = calculateVatWon(result.maxFeeWon);
  return { ok: true, maxFeeWon: result.maxFeeWon, vatWon, text: `법정 상한 ${wonText(result.maxFeeWon)} + 부가세 ${wonText(vatWon)}`, detail: "계약일 기준 요율, 한쪽 의뢰인 기준" };
}

// 보수 줄 만들기(손님 카드 거래 칸): 그 거래의 두 쪽 중 손님으로 붙은 쪽을 미리 고른다. 아무도 없으면 첫 쪽. 둘 다면 쌍방.
/** @param {string} dealType @param {string[]} [partyRoles] @returns {{ role: string, label: string, checked: boolean }[]} */
export function payerSides(dealType, partyRoles = []) {
  const sides = DEAL_PAYER_SIDES[dealType] ?? ["buyer", "seller"];
  const roles = new Set(partyRoles);
  const present = sides.filter((side) => roles.has(side));
  return sides.map((side, index) => ({ role: side, label: LEDGER_PAYER_LABELS[side], checked: present.length > 0 ? present.includes(side) : index === 0 }));
}

// ── CSV(T2-96) ──
// 수식 막기: =·+·-·@·탭·CR로 시작하는 글자 칸은 앞에 '를 붙여 엑셀이 수식으로 읽지 않게 한다. 금액 칸은 숫자 그대로 둔다.
export function csvCell(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

export const LEDGER_CSV_HEAD = ["기준일", "종류", "낸 쪽", "물건 표시·내용", "공급가액", "부가세", "합계", "입금액", "입금일", "미입금", "경고", "메모"];

// UTF-8 BOM(엑셀 한글 깨짐 막기) + CRLF 줄바꿈.
export function ledgerCsv(entries) {
  const lines = [LEDGER_CSV_HEAD.map(csvCell).join(",")];
  for (const entry of entries) {
    lines.push([
      entry.basisOn ?? "",
      LEDGER_KIND_LABELS[entry.kind] ?? entry.kind,
      entry.payerRole ? LEDGER_PAYER_LABELS[entry.payerRole] ?? "" : "",
      entry.label ?? "",
      Number(entry.amountWon ?? 0),
      Number(entry.vatWon ?? 0),
      entryTotalWon(entry),
      Number(entry.receivedWon ?? 0),
      entry.receivedOn ?? "",
      Number(entry.unpaidWon ?? 0),
      warningTexts(entry).join(" / "),
      entry.memo ?? "",
    ].map(csvCell).join(","));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

export const ledgerCsvFileName = (year, basis) => `매출장부-${year}-${LEDGER_BASIS_LABELS[basis] ?? "잔금일"}기준.csv`;

// 서버 오류 코드 → 화면 문장(장부 전용 문장이 있는 것만, 나머지는 손님 화면 문장을 씀)
export function ledgerErrorText(code, fallback) {
  const texts = {
    WORK_DISABLED: "업무 자료 저장이 아직 켜지지 않았습니다.",
    WORK_SCHEMA_OUTDATED: "업무 자료 구조(5번)가 아직 적용되지 않았습니다. 배포 담당에게 '매출장부 구조 적용'을 확인해 달라고 알려 주세요.",
    VERSION_CONFLICT: "다른 곳에서 먼저 고쳤거나 거래가 지워져 저장하지 않았습니다. '새 값 보기'로 저장된 값을 본 뒤 다시 고쳐 주세요.",
    NOT_FOUND: "이 장부 줄을 찾지 못했습니다. 다른 화면에서 지웠을 수 있습니다.",
  };
  return texts[code] ?? fallback;
}
