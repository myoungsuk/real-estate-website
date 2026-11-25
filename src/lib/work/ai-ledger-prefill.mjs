// 계약서 AI '거래에 넣기' 뒤 매출장부 보수 줄 미리 채우기(중개날개 대조표 16절 2위, 사용자 선택 2026-11-25).
// - 새 계산식을 두지 않는다: 법정 상한·부가세는 손님 카드 '보수 줄 만들기'와 같은 dealFeeCap(중개보수 계산 함수 그대로),
//   낸 쪽은 payerSides, 입력 검사는 checkLedgerInput(ledger-view.mjs)을 쓴다. 공급가액을 고칠 때 부가세는 매출장부 표와 같은 규칙
//   (고치기 전 부가세가 공급가액의 10%였으면 함께 바꿈, ledger-grid.mjs)을 따른다.
// - 미리 채운 값은 화면 메모리에만 있고, 사람이 '장부에 넣기'를 눌러야 POST ledger로 만든다. 그 거래에 보수 줄이 이미 있으면 채우지 않는다.
import { calculateVatWon } from "./brokerage-fee.mjs";
import { dealFeeCap, numberText, parseWon, payerSides } from "./ledger-view.mjs";

export const AI_LEDGER_HEADING = "매출장부에 보수 줄 넣기";
export const AI_LEDGER_LOADING_TEXT = "이 거래의 장부 줄을 확인하고 있습니다…";
export const AI_LEDGER_RECHECK_TEXT = "답이 오지 않아 장부에 들어갔는지 다시 확인하고 있습니다…";

/**
 * 미리 채울 값. 주택 거래면 쪽마다 법정 상한과 부가세 10%를 채우고, 그 밖에는(주택 밖·교환·계약일이나 금액 없음) 빈칸과 까닭을 준다.
 * @param {Record<string, any> | null} deal 거래에 넣은 뒤의 거래(확정 응답의 deal)
 * @param {string[]} partyRoles 이 거래에 붙은 손님들의 쪽
 * @param {any} legalRules
 */
export function aiLedgerPrefill(deal, partyRoles, legalRules) {
  const cap = dealFeeCap(deal, legalRules);
  const sides = payerSides(deal?.dealType ?? "", partyRoles).map((side) => ({
    ...side,
    amountText: cap.ok ? numberText(cap.maxFeeWon) : "",
    vatText: cap.ok ? numberText(cap.vatWon) : "",
  }));
  const lead = cap.ok
    ? `거래에 넣은 금액으로 ${cap.text}을 채웠습니다(${cap.detail}). 아직 장부에 넣지 않았습니다. 실제 받을 금액으로 고친 뒤 '장부에 넣기'를 눌러 주세요.`
    : `보수를 미리 채우지 않았습니다. ${cap.reason} 금액을 직접 넣으면 장부에 넣을 수 있습니다.`;
  return { filled: cap.ok, lead, sides };
}

/** 그 거래의 보수 줄 수(지출·기타 수입은 세지 않음) @param {{ kind: string }[]} items */
export const aiLedgerFeeCount = (items) => items.filter((item) => item.kind === "fee").length;

/** @param {number} count @param {boolean} [more] */
export const aiLedgerExistingText = (count, more = false) =>
  `이 거래에는 보수 줄이 이미 ${count}줄${more ? " 이상" : ""} 있어 새로 채우지 않았습니다. 고칠 것은 손님 카드의 '장부 보기'나 매출장부에서 고쳐 주세요.`;

/** @param {number} n 고른 쪽 수 */
export const aiLedgerButtonText = (n) => (n > 0 ? `장부에 넣기 (보수 줄 ${n}개)` : "장부에 넣기");

/** @param {number} made @param {boolean} warned 서버가 경고(부가세 다름·법정 상한 초과)를 돌려준 줄이 있는지 */
export const aiLedgerDoneText = (made, warned) =>
  `✓ 보수 줄 ${made}개를 장부에 넣었습니다.${warned ? " 저장은 됐지만 부가세가 10%와 다르거나 법정 상한을 넘었다는 경고가 있습니다. 매출장부에서 확인해 주세요." : ""} 보수를 받으면 매출장부에서 입금액·입금일을 적어 주세요.`;

/** @param {number} made @param {string} reason */
export const aiLedgerPartialText = (made, reason) =>
  `보수 줄 ${made}개만 넣었습니다. 나머지는 넣지 못했습니다. ${reason} 빠진 쪽은 손님 카드의 '장부 보기' → '보수 줄 만들기'에서 넣어 주세요.`;

/**
 * 공급가액 칸을 고쳤을 때 부가세 칸에 넣을 글. 고치기 전 부가세가 그 전 공급가액의 10%(원 미만 버림, calculateVatWon)였을 때만 따라 바꾸고,
 * 사람이 부가세를 따로 고쳤거나 글이 숫자가 아니면 null(그대로 둠). 공급가액을 비우면 부가세도 비운다.
 * @param {number} prevAmountWon 고치기 전 공급가액(비었으면 0) @param {string} vatText 지금 부가세 칸 글 @param {string} nextAmountText 고친 공급가액 칸 글
 * @returns {string | null}
 */
export function aiLedgerVatFollow(prevAmountWon, vatText, nextAmountText) {
  const next = parseWon(nextAmountText);
  const vat = parseWon(vatText);
  if (Number.isNaN(next) || Number.isNaN(vat)) return null;
  if ((vat ?? 0) !== calculateVatWon(prevAmountWon)) return null;
  return next === null ? "" : numberText(calculateVatWon(next));
}
