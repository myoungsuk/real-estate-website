// 매출장부 화면과 손님 카드 장부 칸이 함께 쓰는 화면 조각. 서버 요청·브라우저 저장·주소 변경을 하지 않는다(서버 요청은 work-ledger-client.ts).
// 물건 표시·메모 글은 textContent로만 넣는다(HTML로 해석하지 않음). 경고·입금 상태는 색만이 아니라 글자·기호로 알린다.
import type { LedgerEntry } from "./work-ledger-client";
import { element } from "./work-customers-dom";
import { LEDGER_KIND_LABELS, LEDGER_PAYER_LABELS, entryTotalWon, ledgerDateText, payStateText, warningTexts, wonText } from "./work/ledger-view.mjs";

const kindLabels = LEDGER_KIND_LABELS as Record<string, string>;
const payerLabels = LEDGER_PAYER_LABELS as Record<string, string>;

export function kindBadge(kind: string) {
  return element("span", `lg-kind lg-kind--${kind}`, kindLabels[kind] ?? kind);
}

export function payState(entry: LedgerEntry, year: string | number) {
  const pay = payStateText(entry, year);
  return element("span", `lg-pay lg-pay--${pay.state}`, pay.text);
}

// 경고 목록(저장 응답·목록 응답의 warnings[]). 없으면 null.
export function warnList(entry: LedgerEntry) {
  const texts = warningTexts(entry);
  if (texts.length === 0) return null;
  const list = element("ul", "lg-warn");
  list.setAttribute("aria-label", "경고(저장은 됐습니다)");
  for (const text of texts) list.append(element("li", "", text));
  return list;
}

const basisText = (entry: LedgerEntry, year: string | number) => ledgerDateText(entry.basisOn, year) || "기준일 없음";
const labelText = (entry: LedgerEntry) => entry.label || "(물건 표시 없음)";
const moneyNote = (entry: LedgerEntry) => (entry.kind === "fee" || entry.vatWon > 0 ? `공급가액 ${wonText(entry.amountWon)} + 부가세 ${wonText(entry.vatWon)}` : "");

export function editButton(entry: LedgerEntry) {
  const button = element("button", "admin-text-link cu-linkbtn", "고치기");
  button.type = "button";
  button.dataset.lgEdit = entry.id;
  button.setAttribute("aria-label", `${labelText(entry)} ${kindLabels[entry.kind] ?? ""} 장부 줄 고치기`);
  return button;
}

// 1220px 이하: 세 줄 카드
export function entryCard(entry: LedgerEntry, year: string | number, saved = false) {
  const item = element("li", `lg-row${saved ? " is-saved" : ""}`);
  item.dataset.lgEntry = entry.id;
  const top = element("p", "lg-row__top");
  top.append(element("span", "", basisText(entry, year)), kindBadge(entry.kind));
  if (entry.payerRole) top.append(element("span", "", payerLabels[entry.payerRole] ?? ""));
  const money = element("p", "lg-row__money");
  money.append(element("strong", "", wonText(entryTotalWon(entry))));
  const note = moneyNote(entry);
  if (note) money.append(element("span", "", note));
  const pay = element("p", "lg-row__pay");
  pay.append(payState(entry, year), editButton(entry));
  item.append(top, element("p", "lg-row__label", labelText(entry)), money, pay);
  const warn = warnList(entry);
  if (warn) item.append(warn);
  return item;
}

// 1221px 이상의 표 줄은 work-ledger-grid.ts가 그린다(칸을 바로 고치는 표).

// 손님 카드 거래 칸 안의 장부 한 줄: 종류·낸 쪽·합계 | 입금 상태(+경고)
export function dealLedgerItem(entry: LedgerEntry, year: string | number) {
  const item = element("li");
  const left = element("span");
  left.append(kindBadge(entry.kind), ` ${entry.payerRole ? `${payerLabels[entry.payerRole] ?? ""} ` : ""}${wonText(entryTotalWon(entry))}`);
  item.append(left, payState(entry, year));
  const warn = warnList(entry);
  if (warn) item.append(warn);
  return item;
}
