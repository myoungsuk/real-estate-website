import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  TRASH_BACKUP_NOTICE,
  TRASH_ERASE_REQUEST,
  TRASH_KINDS,
  TRASH_KIND_LABELS,
  TRASH_MOVE_NOTICE,
  TRASH_PAGE_SIZE,
  isPurgeWord,
  isTrashPartial,
  isTrashStale,
  movedToTrashText,
  purgeAskText,
  purgeAskTitle,
  purgeResultText,
  restoreResultText,
  restoredLink,
  trashBlockedText,
  trashCountsText,
  trashDayText,
  trashDeletedText,
  trashEmptyText,
  trashErrorText,
  trashKindTag,
  trashLeftText,
  trashLinksText,
  trashListQuery,
  trashPurgeWhatText,
  trashStateText,
  trashStripText,
  trashUntilText,
  undoneText,
} from "../src/lib/work/trash-view.mjs";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const counts = (values = {}) => ({ customers: 0, deals: 0, parties: 0, events: 0, notes: 0, tasks: 0, ledger: 0, links: 0, ...values });

test("종류 7가지와 화면 이름(지시서 3.6 kind, 사진 file은 바로 찍기 PR에서 더함)", () => {
  assert.deepEqual(TRASH_KINDS, ["customer", "deal", "note", "event", "ledger", "task", "file"]);
  assert.deepEqual(TRASH_KINDS.map((kind) => TRASH_KIND_LABELS[kind]), ["손님", "거래", "메모", "일정", "장부 줄", "할 일", "사진·계약서 사본"], "file 묶음에는 손님 사진과 계약서 사본이 함께 든다");
});

test("사진 묶음: 함께 수·되살림 글·건너뜀·되살린 뒤 고리(바로 찍기 F-b)", () => {
  assert.equal(trashCountsText({ kind: "file", counts: { files: 1 } }), "사진 1장");
  assert.equal(trashCountsText({ kind: "customer", counts: { customers: 1, deals: 1, notes: 3, files: 4 } }), "거래 1건 · 메모 3개 · 사진·계약서 사본 4장", "손님 묶음의 파일은 둘이 섞일 수 있음");
  assert.equal(trashPurgeWhatText({ counts: { customers: 1, files: 2 } }), "손님 1명, 사진·계약서 사본 2장");
  assert.equal(trashPurgeWhatText({ kind: "file", label: "사진 · 11월 22일 14:05 올림", counts: { files: 1 } }), "사진 1장");
  assert.equal(trashEmptyText("file").title, "지운 사진·계약서 사본이 없습니다");
  assert.equal(trashStripText(2, { kind: "file" }), "사진·계약서 사본 묶음 2개 · 지운 때 최근 순");
  assert.deepEqual(restoredLink("file"), { text: "손님 목록 열기", href: "/admin/work/customers/" }, "응답에 손님 id가 없어 손님 목록으로");
  const done = restoreResultText("사진 · 11월 22일 14:05 올림", { restored: { files: 1 }, skipped: [], remaining: 0 }, "file");
  assert.match(done.lead, /사진 1장이 돌아왔습니다/u);
  const skipped = restoreResultText("거실 창 쪽 누수 자국", { restored: {}, skipped: [{ table: "files", reason: "customer_missing", count: 1 }], remaining: 1 }, "file");
  assert.equal(skipped.state, "warn");
  assert.ok(skipped.lines.some((line) => line.subject === "사진 1장" && /함께였던 손님이 지금 없어/u.test(line.text)), JSON.stringify(skipped.lines));
});

test("계약서 사본 묶음(단계 4 K-b): 줄의 종류 표시·수·되살림 글은 묶음 이름으로 '계약서 사본'을 가려 쓴다", () => {
  const copy = { kind: "file", label: "계약서 사본 · 11월 23일 10:40 올림", counts: { files: 1 } };
  assert.equal(trashKindTag(copy), "계약서 사본");
  assert.equal(trashKindTag({ kind: "file", label: "사진 · 11월 22일 14:05 올림" }), "사진");
  assert.equal(trashKindTag({ kind: "file", label: "거실 창 쪽 누수 자국" }), "사진", "설명이 있는 손님 사진");
  assert.equal(trashKindTag({ kind: "file", label: "계약서 사본 · 특약 쪽" }), "계약서 사본", "설명이 있어도 서버가 앞에 붙임");
  assert.equal(trashKindTag({ kind: "deal", label: "계약서 사본 · 가상" }), "거래", "파일 묶음이 아니면 이름을 보지 않음");
  assert.equal(trashKindTag({ kind: "unknown" }), "자료");
  assert.equal(trashCountsText(copy), "계약서 사본 1장");
  assert.equal(trashPurgeWhatText(copy), "계약서 사본 1장");
  assert.equal(trashCountsText({ kind: "deal", label: "가상숲 5블록 매매", counts: { deals: 1, events: 2, files: 3 } }), "일정 2개 · 사진·계약서 사본 3장");
  const done = restoreResultText(copy.label, { restored: { files: 1 }, skipped: [], remaining: 0 }, "file");
  assert.match(done.lead, /계약서 사본 1장이 돌아왔습니다/u);
  const skipped = restoreResultText(copy.label, { restored: {}, skipped: [{ table: "files", reason: "deal_missing", count: 1 }], remaining: 1 }, "file");
  assert.ok(skipped.lines.some((line) => line.subject === "계약서 사본 1장" && /함께였던 거래가 지금 없어/u.test(line.text)), JSON.stringify(skipped.lines));
  const mixed = restoreResultText("가상 손님 1", { restored: { customers: 1, files: 2 }, skipped: [], remaining: 0 }, "customer");
  assert.match(mixed.lead, /손님 1명, 사진·계약서 사본 2장이 돌아왔습니다/u);
});

test("지운 때·날짜는 한국 시각으로 쓴다(UTC 15시 이후는 다음 날)", () => {
  assert.equal(trashDeletedText("2026-11-18T01:12:00.000Z"), "11. 18.(수) 10:12");
  assert.equal(trashDeletedText("2026-11-17T15:05:00.000Z"), "11. 18.(수) 00:05");
  assert.equal(trashDayText("2026-11-25T01:12:00.000Z"), "11월 25일(수)");
  assert.equal(trashDeletedText("지운 때 아님"), "");
  assert.equal(trashUntilText({ batchId: "b", purgeAfter: "2026-11-25T01:12:00.000Z" }), "11월 25일(수)까지 휴지통에서 되살릴 수 있습니다.");
  assert.equal(trashUntilText(undefined), "", "응답에 휴지통 값이 없으면 말하지 않음");
});

test("남은 날: 0일은 '곧 영구 삭제'(다음 새벽 정리), 1일은 '!'와 빨간 줄, 그 밖은 영구 삭제가 시작되는 날", () => {
  const purgeAfter = "2026-11-25T01:12:00.000Z";
  assert.deepEqual(trashLeftText({ daysLeft: 0, purgeAfter }), { big: "! 곧 영구 삭제", small: "7일이 지나 다음 새벽 정리 때 지워집니다", late: true });
  assert.deepEqual(trashLeftText({ daysLeft: 1, purgeAfter }), { big: "! 1일 남음", small: "11월 25일(수)부터 영구 삭제", late: true });
  assert.deepEqual(trashLeftText({ daysLeft: 7, purgeAfter }), { big: "7일 남음", small: "11월 25일(수)부터 영구 삭제", late: false });
  assert.equal(trashLeftText({ daysLeft: -3, purgeAfter }).big, "! 곧 영구 삭제", "0 아래는 0으로");
});

test("'함께:' 글: 손님·거래 묶음은 자기 자신과 참여자 줄을 빼고, 한 개짜리 묶음은 그 한 개를 센다", () => {
  assert.equal(trashCountsText({ kind: "customer", counts: counts({ customers: 1, deals: 1, parties: 1, events: 2, notes: 3, tasks: 1, links: 2 }) }), "거래 1건 · 일정 2개 · 메모 3개 · 할 일 1개");
  assert.equal(trashCountsText({ kind: "deal", counts: counts({ deals: 1, parties: 2, events: 3, notes: 1, tasks: 2 }) }), "일정 3개 · 메모 1개 · 할 일 2개");
  assert.equal(trashCountsText({ kind: "note", counts: counts({ notes: 1 }) }), "메모 1개");
  assert.equal(trashCountsText({ kind: "ledger", counts: counts({ ledger: 1 }) }), "장부 줄 1개");
  assert.equal(trashCountsText({ kind: "customer", counts: counts({ customers: 1 }) }), "", "셀 것이 없으면 빈 글");
  // 되살리기 뒤 참여자 줄만 남은 손님 묶음(R-2)
  assert.equal(trashCountsText({ kind: "customer", counts: counts({ parties: 1 }) }), "참여자 1줄");
  assert.equal(trashPurgeWhatText({ counts: counts({ customers: 1, deals: 1, parties: 1, notes: 3 }) }), "손님 1명, 거래 1건, 메모 3개");
  assert.equal(purgeAskText({ counts: counts({ notes: 1 }) }), "메모 1개 — 모두 지금 바로 지워지고 되살릴 수 없습니다. 손님이 바로 지워 달라고 했을 때 씁니다.");
  assert.equal(purgeAskTitle("가상 손님 7"), "'가상 손님 7' 묶음을 영구 삭제할까요?");
  assert.match(trashLinksText({ counts: counts({ links: 2 }) }), /^되살리면 지울 때 끊었던 메모·장부 줄 연결 2개도 다시 잇습니다/u);
  assert.equal(trashLinksText({ counts: counts() }), "");
});

test("일부만 남은 묶음: 손님·거래 묶음은 그 손님·거래가 0이면, 그 밖에는 화면이 기억한 remaining으로", () => {
  assert.equal(isTrashPartial({ kind: "customer", counts: counts({ parties: 1 }) }), true);
  assert.equal(isTrashPartial({ kind: "customer", counts: counts({ customers: 1, parties: 1 }) }), false);
  assert.equal(isTrashPartial({ kind: "event", counts: counts({ events: 1 }) }), false);
  assert.equal(isTrashPartial({ kind: "event", counts: counts({ events: 1 }) }, true), true);
  assert.match(trashBlockedText({ purgeAfter: "2026-11-25T01:12:00.000Z" }), /되살릴 수 없습니다\. 영구 삭제만 할 수 있고, 두면 11월 25일\(수\)부터 저절로 지워집니다\.$/u);
});

test("목록 줄·0건 글과 목록 요청 값(커서·개수만, 종류·이름은 넣지 않음)", () => {
  assert.equal(trashStripText(6), "지운 묶음 6개 · 지운 때 최근 순");
  assert.equal(trashStripText(1, { kind: "customer", more: true }), "손님 묶음 1개 이상 · 지운 때 최근 순");
  assert.deepEqual(trashEmptyText(""), { title: "지운 자료가 없습니다", body: "지운 자료는 7일 동안 여기에 있습니다." });
  assert.equal(trashEmptyText("deal").title, "지운 거래가 없습니다");
  assert.equal(trashEmptyText("customer").title, "지운 손님이 없습니다");
  assert.equal(trashEmptyText("ledger").title, "지운 장부 줄이 없습니다");
  assert.equal(trashEmptyText("task").title, "지운 할 일이 없습니다");
  assert.equal(trashListQuery().toString(), `limit=${TRASH_PAGE_SIZE}`);
  assert.equal(trashListQuery({ cursor: "abc" }).toString(), `cursor=abc&limit=${TRASH_PAGE_SIZE}`);
  assert.equal(TRASH_PAGE_SIZE, 50, "서버 기본·최대");
});

test("되살리기 결과: 모두 됨", () => {
  const text = restoreResultText("가상 손님 7", {
    restored: { customers: 1, deals: 1, parties: 1, events: 2, notes: 3, tasks: 1, ledger: 0, links: 2, notesUnlinked: 0 },
    skipped: [],
    remaining: 0,
  });
  assert.equal(text.lead, "✓ '가상 손님 7'을(를) 되살렸습니다. 손님 1명, 거래 1건, 일정 2개, 메모 3개, 할 일 1개가 돌아왔고 연결 2개도 원래대로 이었습니다.");
  assert.deepEqual(text.lines, []);
  assert.equal(text.state, "success");
  assert.equal(text.remaining, false);
  assert.match(restoreResultText("가상 전단", { restored: { ledger: 1 }, skipped: [], remaining: 0 }).lead, /장부 줄 1개가 돌아왔습니다\.$/u);
  assert.match(restoreResultText("가상 손님", { restored: { customers: 1 }, skipped: [], remaining: 0 }).lead, /손님 1명이 돌아왔습니다\.$/u, "받침 있는 끝말은 '이'");
});

test("되살리기 결과: 일부 건너뜀은 까닭별 한 줄(relinked·changed·deal_missing·notesUnlinked), 남은 묶음 표시", () => {
  const text = restoreResultText("가상 손님 7", {
    restored: { customers: 1, deals: 1, parties: 0, events: 2, notes: 3, tasks: 1, ledger: 0, links: 0, notesUnlinked: 2 },
    skipped: [
      { table: "noteCustomer", reason: "relinked", count: 1 },
      { table: "ledgerDeal", reason: "changed", count: 1 },
      { table: "parties", reason: "deal_missing", count: 1 },
      { table: "notes", reason: "exists", count: 0 },
    ],
    remaining: 1,
  });
  assert.equal(text.lead, "✓ '가상 손님 7'을(를) 되살렸습니다. 손님 1명, 거래 1건, 일정 2개, 메모 3개, 할 일 1개가 돌아왔습니다. 다만 아래는 그대로 두었습니다.");
  assert.deepEqual(text.lines.map((line) => line.subject), ["메모 1개", "장부 줄 1개", "참여자 1줄", "메모 2개"], "0개 줄은 빼고, 연결 없이 되살린 메모는 끝에");
  assert.equal(text.lines[0].text, "지운 뒤 다른 손님에게 이미 붙여 두어서 그대로 두었습니다.");
  assert.equal(text.lines[1].text, "지운 뒤 고쳐져서 거래에 다시 잇지 않았습니다. 매출장부에서 직접 이어 주세요.");
  assert.match(text.lines[2].text, /^함께였던 거래가 지금 없어\(휴지통에 있을 수 있음\) 남겨 두었습니다\. 그 거래를 되살린 뒤 이 묶음에서 다시 '되살리기'를 누르세요\.$/u);
  assert.equal(text.lines[3].text, "이을 손님·거래가 지금 없어 그 연결만 비우고 되살렸습니다.");
  assert.equal(text.state, "warn");
  assert.equal(text.remaining, true);
  // 서버의 다른 까닭도 빈 글 없이 알린다(worker/work-trash.mjs SKIP_BEFORE·SKIP_AFTER)
  for (const [table, reason] of [["customers", "exists"], ["noteDeal", "relinked"], ["parties", "customer_missing"], ["noteCustomer", "note_missing"], ["ledgerDeal", "entry_missing"], ["events", "deal_missing"], ["tasks", "새 까닭"], ["deal_parties", "deal_missing"], ["deal_events", "deal_missing"], ["ledger_entries", "exists"]]) {
    const line = restoreResultText("가상", { restored: {}, skipped: [{ table, reason, count: 1 }], remaining: 0 }).lines[0];
    assert.ok(line.subject.endsWith("1개") || line.subject.endsWith("1명") || line.subject.endsWith("1줄") || line.subject.endsWith("1건"), `${table}: ${line.subject}`);
    assert.ok(line.text.length > 10, `${table}·${reason}: ${line.text}`);
    assert.doesNotMatch(line.subject, /^자료/u, `${table}: 대상 이름을 앎`);
  }
  const nothing = restoreResultText("가상", { restored: {}, skipped: [{ table: "notes", reason: "exists", count: 1 }], remaining: 0 });
  assert.equal(nothing.lead, "'가상'에서 되살린 것이 없습니다. 아래 까닭을 보세요.");
  assert.equal(nothing.state, "warn");
});

test("영구 삭제 글자 확인·결과·오류 글", () => {
  assert.equal(isPurgeWord("영구 삭제"), true);
  assert.equal(isPurgeWord("  영구 삭제 "), true, "앞뒤 빈칸만 무시");
  assert.equal(isPurgeWord("영구삭제"), false, "띄어쓰기까지 같아야 함");
  assert.equal(purgeResultText("가상 손님 7"), `✓ '가상 손님 7' 묶음을 영구 삭제했습니다. 되살릴 수 없습니다. ${TRASH_BACKUP_NOTICE}`);
  assert.equal(trashErrorText("NOT_FOUND", "x"), "되살리지 못했습니다. 이미 되살렸거나 영구 삭제된 묶음입니다(다른 관리자 화면에서 먼저 했을 수 있습니다). 목록을 새로 불러왔습니다.");
  assert.match(trashErrorText("TRASH_SCHEMA_CHANGED", "x"), /자료 구조가 바뀌기 전에 지운 묶음이라 되살릴 수 없습니다/u);
  assert.equal(trashErrorText("CONFIRMATION_MISMATCH", "x", "purge"), "영구 삭제하지 못했습니다. '영구 삭제'를 띄어쓰기까지 똑같이 넣어 주세요.");
  assert.equal(trashErrorText("STORAGE_UNAVAILABLE", "잠시 뒤 다시 해 주세요."), "되살리지 못했습니다. 잠시 뒤 다시 해 주세요.");
  assert.equal(isTrashStale("NOT_FOUND") && isTrashStale("TRASH_SCHEMA_CHANGED"), true);
  assert.equal(isTrashStale("CONFIRMATION_MISMATCH"), false);
  assert.match(trashStateText("WORK_DISABLED").body, /꺼져 있는 동안에도 7일이 지난 묶음은 새벽에 저절로 영구 삭제됩니다\./u);
  assert.match(trashStateText("WORK_SCHEMA_OUTDATED").body, /업무 자료 구조\(7번\)가 아직 적용되지 않았습니다/u);
  assert.deepEqual(restoredLink("customer"), { text: "손님 목록 열기", href: "/admin/work/customers/" });
  assert.equal(restoredLink("note"), null);
  assert.deepEqual(restoredLink("event", { events: 1 }), { text: "손님 목록 열기", href: "/admin/work/customers/" }, "거래 일정은 손님 목록으로");
  assert.deepEqual(restoredLink("event", { events: 1, appointments: 1 }), { text: "달력 열기", href: "/admin/work/calendar/" }, "거래 없는 일정은 달력으로");
});

test("지우기 화면 알림 글과 확인 글(지시서 4.1 문장 그대로)", () => {
  assert.equal(TRASH_MOVE_NOTICE, "휴지통으로 옮깁니다. 7일 안에 되살릴 수 있고, 그 뒤 자동으로 영구 삭제됩니다.");
  assert.equal(TRASH_BACKUP_NOTICE, "영구 삭제한 뒤에도 백업에는 개인정보 처리방침에 적힌 기간 동안 남았다가 지워집니다.");
  assert.equal(movedToTrashText("메모"), "✓ 메모를 휴지통으로 옮겼습니다.");
  assert.equal(movedToTrashText("장부 줄"), "✓ 장부 줄을 휴지통으로 옮겼습니다.");
  assert.equal(movedToTrashText("할 일"), "✓ 할 일을 휴지통으로 옮겼습니다.");
  assert.equal(undoneText("메모"), "✓ 메모를 되살렸습니다.");
});

test("사용법 상자·사용 안내의 휴지통 문장은 화면 글과 같다(삭제 요청 안내·백업 안내)", async () => {
  const help = await readSource("src/lib/admin-help.mjs");
  assert.ok(help.includes(TRASH_ERASE_REQUEST), "삭제 요청 안내(날개-2 안) 그대로");
  assert.ok(help.includes(TRASH_BACKUP_NOTICE), "백업 안내 그대로");
  assert.doesNotMatch(help, /지우면 되돌릴 수 없습니다/u, "휴지통이 생긴 뒤 옛 문장이 남지 않음");
});
