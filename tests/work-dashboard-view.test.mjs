import assert from "node:assert/strict";
import test from "node:test";

import {
  BANK_SYNC_STALE_HOURS,
  bankLastSeenOn,
  bankSyncState,
  DASHBOARD_LINKS,
  dateTitle,
  emptyText,
  eventHref,
  eventKindText,
  eventPartyText,
  eventWhen,
  highListTitle,
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

test("실거래 신고가 수는 30일 기준이라 숫자 띠에 '30일'을 붙이고, 목록 제목은 보이는 줄보다 많을 때만 '(n건 중 m건)'", () => {
  const item = (n) => ({ tradeKey: `sale:202611:${String(n).padStart(20, "0")}:1`, dealDate: "2026-11-10", aptName: `가상숲${n}단지`, areaM2: 84.97, priceWon: 400_000_000 });
  const realprice = (newHighCount, count) => ({ ok: true, newCount: 12, watchNewCount: 3, newHighCount, partial: false, items: Array.from({ length: count }, (_, index) => item(index + 1)) });
  const sub = (section) => kpiItems({ ...okData(), realprice: section })[3].sub;
  assert.equal(sub(realprice(5, 3)), "관심 단지 3 · 30일 신고가 5");
  assert.equal(sub(realprice(0, 0)), "관심 단지 3 · 30일 신고가 0");
  assert.equal(sub(realprice(null, 0)), "관심 단지 3 · 신고가 판정 준비 중", "판정 준비 중 글은 그대로");
  assert.equal(highListTitle(realprice(5, 3)), "최근 30일 신고가(5건 중 3건)");
  assert.equal(highListTitle(realprice(3, 3)), "최근 30일 신고가", "다 보이면 붙이지 않음");
  assert.equal(highListTitle(realprice(1, 1)), "최근 30일 신고가");
  assert.equal(highListTitle(realprice(0, 0)), "최근 30일 신고가");
  assert.equal(highListTitle(realprice(null, 0)), "최근 30일 신고가");
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

test("부동산뱅크 받은 날은 부동산뱅크 매물 가운데 가장 늦은 lastSeenAt이고, 없으면 null", () => {
  assert.equal(bankLastSeenOn({
    items: {
      a: { source: "bank", lastSeenAt: "2026-11-20" },
      b: { source: "bank", lastSeenAt: "2026-11-21" },
      c: { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-11-24" },
    },
  }), "2026-11-21");
  assert.equal(bankLastSeenOn({ items: { c: { source: "manual", lastSeenAt: null } } }), null);
  assert.equal(bankLastSeenOn({ items: { a: { source: "bank", lastSeenAt: "어제" } } }), null);
  assert.equal(bankLastSeenOn({}), null);
  assert.equal(bankLastSeenOn(null), null);
});

test("부동산뱅크 자동 받기는 받은 날 0시(한국 시각)부터 36시간이 넘으면 '!'와 '멈춤'으로 알린다", () => {
  assert.equal(BANK_SYNC_STALE_HOURS, 36);
  const at = (kst) => Date.parse(`${kst}+09:00`);
  // 오늘 받음
  assert.deepEqual(bankSyncState("2026-11-24", "2026-11-24", at("2026-11-24T09:00:00")), { stale: false, text: "부동산뱅크 자동 받기 오늘 · 11.24(화)" });
  // 다음 날 00:10 실행 전·늦은 배포까지는 정상(어제)
  assert.deepEqual(bankSyncState("2026-11-24", "2026-11-25", at("2026-11-25T11:59:59")), { stale: false, text: "부동산뱅크 자동 받기 어제 · 11.24(화)" });
  // 경계: 36시간 정각은 정상, 1밀리초 넘으면 멈춤
  assert.equal(bankSyncState("2026-11-24", "2026-11-25", at("2026-11-25T12:00:00")).stale, false);
  assert.deepEqual(bankSyncState("2026-11-24", "2026-11-25", at("2026-11-25T12:00:00") + 1), { stale: true, text: "! 부동산뱅크 자동 받기 멈춤 · 마지막 11.24(화)(어제)" });
  // 이번처럼 사흘 받지 못함
  assert.deepEqual(bankSyncState("2026-11-21", "2026-11-24", at("2026-11-24T09:00:00")), { stale: true, text: "! 부동산뱅크 자동 받기 멈춤 · 마지막 11.21(토)(3일 전)" });
  // 받은 날이 화면 시계보다 앞서도(시계 차이) 음수 날짜를 쓰지 않는다
  assert.deepEqual(bankSyncState("2026-11-25", "2026-11-24", at("2026-11-24T23:00:00")), { stale: false, text: "부동산뱅크 자동 받기 오늘 · 11.25(수)" });
  // 색만으로 알리지 않음: 멈춤 글에는 늘 '!'와 '멈춤'이 있다
  for (const state of [bankSyncState("2026-11-20", "2026-11-24", at("2026-11-24T00:00:00"))]) assert.match(state.text, /^! .*멈춤/u);
});
