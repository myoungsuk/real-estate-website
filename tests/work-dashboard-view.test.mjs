import assert from "node:assert/strict";
import test from "node:test";

import {
  DASHBOARD_LINKS,
  dateTitle,
  emptyText,
  eventHref,
  eventKindText,
  eventPartyText,
  eventWhen,
  kpiItems,
  loadFailedState,
  moneyFigures,
  moneyItemMeta,
  sectionCount,
  sectionState,
  shortDate,
  taskWhen,
  tradeAreaText,
  undatedText,
} from "../src/lib/work/dashboard-view.mjs";

const TODAY = "2026-11-23";
const UUID = "6f1c2b0a-0000-4000-8000-000000000001";

const okData = () => ({
  today: TODAY,
  tasks: { ok: true, overdue: 1, dueToday: 2, items: [] },
  events: {
    ok: true, until: "2026-12-07", total: 2, overdue: 0,
    items: [{ id: "e1", kind: "balance", kindLabel: "잔금", title: "", dueOn: "2026-11-26", deal: { id: "d1", title: "가상숲 84㎡ 매매", dealType: "sale" }, customer: null, partyCount: 0 }],
  },
  money: { ok: true, month: "2026-11", basis: "balance", receivableWon: 3960000, receivedWon: 1980000, unpaidWon: 1980000, unpaidCount: 1, undatedCount: 0, items: [] },
  realprice: { ok: true, newCount: 12, watchNewCount: 3, newHighCount: null, partial: false, items: [] },
});

test("대시보드 날짜 글: 머리는 '11월 23일 월요일', 줄은 '11.26(목)'", () => {
  assert.equal(dateTitle(TODAY), "11월 23일 월요일");
  assert.equal(shortDate("2026-11-26"), "11.26(목)");
  assert.equal(shortDate("2027-01-03"), "1.3(일)");
});

test("일정 날짜: 오늘·D-n·지난 일정은 '!'와 지난 날 수(색만으로 알리지 않음)", () => {
  assert.deepEqual(eventWhen(TODAY, TODAY), { lead: "오늘", date: "11.23(월)", late: false });
  assert.deepEqual(eventWhen("2026-11-26", TODAY), { lead: "D-3", date: "11.26(목)", late: false });
  assert.deepEqual(eventWhen("2026-11-20", TODAY), { lead: "! 3일 지남", date: "11.20(금)", late: true });
  // 달이 바뀌어도 날 수가 맞다
  assert.equal(eventWhen("2026-12-07", TODAY).lead, "D-14");
  assert.equal(taskWhen("2026-11-21", TODAY).late, true);
  assert.equal(taskWhen(TODAY, TODAY).late, false);
});

test("일정 줄 이름·손님: 직접 넣은 일정은 그 제목, 손님이 여럿이면 '외 n명', 고리에는 UUID만", () => {
  assert.equal(eventKindText({ kind: "balance", kindLabel: "잔금", title: "" }), "잔금");
  assert.equal(eventKindText({ kind: "custom", kindLabel: "직접 넣은 일정", title: "열쇠 받기" }), "열쇠 받기");
  assert.equal(eventPartyText({ customer: null, partyCount: 0 }), "");
  assert.equal(eventPartyText({ customer: { displayName: "가상 손님" }, partyCount: 1 }), "가상 손님");
  assert.equal(eventPartyText({ customer: { displayName: "가상 손님" }, partyCount: 3 }), "가상 손님 외 2명");
  assert.equal(eventHref({ customer: { id: UUID } }), `/admin/work/customers/detail/?id=${UUID}`);
  assert.equal(eventHref({ customer: null }), DASHBOARD_LINKS.customers);
});

test("숫자 띠 4칸: 값과 고리, 기한 지남·미입금은 '!' 글자로도 알린다", () => {
  const items = kpiItems(okData());
  assert.deepEqual(items.map((item) => item.href), [DASHBOARD_LINKS.tasks, DASHBOARD_LINKS.customers, DASHBOARD_LINKS.ledger, DASHBOARD_LINKS.realprice]);
  assert.equal(items[0].value, "3");
  assert.equal(items[0].sub, "! 기한 지남 1건");
  assert.equal(items[1].sub, "가장 가까운 일정 11.26(목) 잔금");
  assert.equal(items[2].label, "11월 미입금");
  assert.equal(items[2].value, "1,980,000");
  assert.match(items[2].sub, /^! 1줄 · 받을 금액 /u);
  assert.equal(items[3].sub, "관심 단지 3 · 신고가 판정 준비 중");
  for (const item of items.filter((entry) => entry.warn)) assert.match(item.sub, /^!/u);
});

test("계약 일정 숫자는 앞날(오늘 포함)만 세고, 지난 일정은 '!' 곁말로만 보인다(이름 '14일 안'과 숫자가 맞게)", () => {
  const data = okData();
  data.events = { ...data.events, total: 4, overdue: 1 };
  const events = kpiItems(data)[1];
  assert.equal(events.label, "14일 안 계약 일정");
  assert.equal(events.value, "3");
  assert.equal(events.sub, "! 지난 일정 1건");
  assert.equal(sectionCount("events", data.events), "12.7(월)까지 3건 · 지난 일정 1건");
});

test("숫자 띠: 꺼진 칸은 '—'과 '꺼짐', 실패한 칸은 '—'과 '불러오지 못함'", () => {
  const data = { ...okData(), tasks: { ok: false, code: "WORK_DISABLED" }, realprice: { ok: false, code: "STORAGE_UNAVAILABLE" } };
  const [tasks, , , realprice] = kpiItems(data);
  assert.deepEqual([tasks.value, tasks.sub], ["—", "꺼짐"]);
  assert.deepEqual([realprice.value, realprice.sub], ["—", "불러오지 못함"]);
});

test("칸 상태 글: 꺼짐은 다시 불러오기 없음, 모르는 오류·감사 실패는 다시 불러오기", () => {
  assert.equal(sectionState("WORK_DISABLED").off, true);
  assert.equal(sectionState("REALPRICE_DISABLED").canRetry, false);
  assert.equal(sectionState("AUDIT_UNAVAILABLE").canRetry, true);
  assert.equal(sectionState("STORAGE_UNAVAILABLE").canRetry, true);
  assert.equal(sectionState(null).off, false);
  assert.equal(loadFailedState("AUTH_REQUIRED").canRetry, false);
  assert.match(loadFailedState("AUTH_REQUIRED").text, /로그인/u);
  assert.equal(loadFailedState(null).canRetry, true);
});

test("칸 제목 옆 숫자와 빈 칸 글", () => {
  const data = okData();
  assert.equal(sectionCount("tasks", data.tasks), "오늘까지 3건");
  assert.equal(sectionCount("events", data.events), "12.7(월)까지 2건");
  assert.equal(sectionCount("money", data.money), "11월 · 잔금일 기준");
  assert.equal(sectionCount("realprice", data.realprice), "새 거래 12건 · 7일");
  assert.equal(sectionCount("tasks", { ok: false, code: "X" }), "");
  assert.match(emptyText("realprice", { newHighCount: null }), /과거 자료/u);
  assert.equal(emptyText("realprice", { newHighCount: 0 }), "최근 30일 신고가가 없습니다.");
});

test("이번 달 돈: 미입금이 있으면 '!'와 표시, 잔금일 없는 줄은 따로 알림", () => {
  const [receivable, received, unpaid] = moneyFigures(okData().money);
  assert.equal(receivable.due, false);
  assert.equal(received.due, false);
  assert.equal(unpaid.due, true);
  assert.match(unpaid.value, /^! /u);
  assert.equal(moneyFigures({ receivableWon: 0, receivedWon: 0, unpaidWon: 0 })[2].due, false);
  assert.equal(undatedText({ undatedCount: 0 }), "");
  assert.match(undatedText({ undatedCount: 2 }), /2건/u);
  assert.match(moneyItemMeta({ payerRole: null, unpaidWon: 1000 }), /^미입금 /u);
});

test("실거래 면적은 정수로 내린다", () => {
  assert.equal(tradeAreaText(84.97), "84㎡");
  assert.equal(tradeAreaText(59), "59㎡");
});
