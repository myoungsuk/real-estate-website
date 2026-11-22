// 할 일 화면 순수 함수(src/lib/work/tasks-view.mjs). 할 일 제목·거래 이름은 모두 지어낸 값이다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  TASK_TITLE_MAX,
  checkTaskInput,
  doneText,
  groupTasks,
  homeDateText,
  homeLinkText,
  homeStateText,
  lateDays,
  nextPreviewText,
  reopenText,
  repeatHelpText,
  repeatText,
  shiftedNote,
  taskChanges,
  taskCountText,
  taskDateText,
  taskErrorText,
  taskFieldErrors,
  taskGroupOf,
  taskGroupTitle,
  taskListQuery,
  taskLongDateText,
  weekEndOf,
} from "../src/lib/work/tasks-view.mjs";

const TODAY = "2026-11-18"; // 수요일

test("T2-129 묶음: 지난 할 일·오늘·이번 주(내일 ~ 이번 주 일요일)·나중·날짜 없음, 제목은 글자로 알린다", () => {
  assert.equal(weekEndOf(TODAY), "2026-11-22");
  assert.equal(weekEndOf("2026-11-22"), "2026-11-22", "일요일이면 이번 주는 오늘뿐");
  assert.equal(weekEndOf("2026-12-28"), "2027-01-03", "해를 넘는 주");
  const cases = { "2026-11-17": "past", "2026-11-18": "today", "2026-11-19": "week", "2026-11-22": "week", "2026-11-23": "later" };
  for (const [dueOn, key] of Object.entries(cases)) assert.equal(taskGroupOf({ dueOn }, TODAY), key, dueOn);
  assert.equal(taskGroupOf({ dueOn: null }, TODAY), "none");
  assert.equal(taskGroupTitle("past", TODAY), "! 지난 할 일", "색만이 아니라 ! 와 글자로");
  assert.equal(taskGroupTitle("today", TODAY), "오늘 · 11월 18일(수)");
  assert.equal(taskGroupTitle("week", TODAY), "이번 주 · 11월 22일(일)까지");
  const items = [
    { id: "a", dueOn: "2026-11-14" }, { id: "b", dueOn: "2026-11-18" }, { id: "c", dueOn: "2026-11-20" },
    { id: "d", dueOn: "2026-12-01" }, { id: "e", dueOn: null },
  ];
  assert.deepEqual(groupTasks(items, TODAY).map((group) => [group.key, group.items.map((item) => item.id)]), [["past", ["a"]], ["today", ["b"]], ["week", ["c"]], ["later", ["d"]], ["none", ["e"]]]);
  assert.deepEqual(groupTasks([{ dueOn: null }], TODAY).map((group) => group.key), ["none"], "빈 묶음은 뺌");
});

test("날짜·지난 날 수·반복 표시는 한국 날짜 글자로만 셈한다", () => {
  assert.equal(taskDateText("2026-11-14"), "11. 14.(토)");
  assert.equal(taskLongDateText("2027-02-28"), "2월 28일(일)");
  assert.equal(taskDateText("2026-02-30"), "", "없는 날");
  assert.equal(lateDays("2026-11-14", TODAY), 4);
  assert.equal(lateDays("2026-11-20", TODAY), 0);
  assert.equal(repeatText({ repeat: "weekly", dueOn: "2026-11-18", repeatDay: null }), "매주 수요일");
  assert.equal(repeatText({ repeat: "monthly", dueOn: "2026-11-30", repeatDay: 31 }), "매월 31일");
  assert.equal(repeatText({ repeat: "none", dueOn: "2026-11-30", repeatDay: null }), "");
  assert.equal(shiftedNote({ repeat: "monthly", dueOn: "2026-11-30", repeatDay: 31 }), "(31일이 없는 달이라 말일)");
  assert.equal(shiftedNote({ repeat: "monthly", dueOn: "2026-12-31", repeatDay: 31 }), "");
  assert.equal(homeDateText("2026-11-14", TODAY), "! 4일 지남");
  assert.equal(homeDateText(TODAY, TODAY), "오늘");
});

test("만들기 칸: 날짜가 없으면 반복을 고를 수 없고, 매월 29 ~ 31일은 말일 안내, 끝내면 다음 날짜를 서버와 같은 함수로 미리 보인다", () => {
  assert.equal(repeatHelpText("none", ""), "날짜를 넣으면 고를 수 있습니다.");
  assert.equal(repeatHelpText("weekly", "2026-11-18"), "매주 수요일.");
  assert.equal(repeatHelpText("monthly", "2027-01-31"), "매월 31일. 그 날짜가 없는 달은 그 달 마지막 날에 합니다.");
  assert.equal(repeatHelpText("monthly", "2027-01-15"), "매월 15일.");
  assert.equal(nextPreviewText({ dueOn: "2027-01-31", repeat: "monthly", today: TODAY }), "끝내면 다음 할 일: 2월 28일(일) (그다음은 3월 31일)");
  assert.equal(nextPreviewText({ dueOn: "2026-11-30", repeat: "monthly", repeatDay: 31, today: TODAY }), "끝내면 다음 할 일: 12월 31일(목)", "고칠 때는 저장된 기준일(31일)을 씀");
  assert.equal(nextPreviewText({ dueOn: "2026-11-01", repeat: "weekly", today: TODAY }), "끝내면 다음 할 일: 11월 22일(일)", "늦게 끝내면 오늘 이후 첫 같은 요일");
  assert.equal(nextPreviewText({ dueOn: "2026-11-18", repeat: "none", today: TODAY }), "");
  assert.equal(nextPreviewText({ dueOn: "", repeat: "weekly", today: TODAY }), "");
});

test("T2-130 입력 검사: 제목 빔·81자·반복인데 날짜 없음을 칸마다 알리고, 앞뒤 빈칸은 뺀다", () => {
  assert.deepEqual(checkTaskInput({ title: "   ", dueOn: "", repeat: "none" }), { ok: false, errors: { title: "제목을 넣어 주세요." } });
  const long = "가".repeat(TASK_TITLE_MAX + 1);
  assert.deepEqual(checkTaskInput({ title: long, dueOn: "", repeat: "none" }), { ok: false, errors: { title: "제목은 80자까지 넣을 수 있습니다(지금 81자)." } });
  assert.deepEqual(checkTaskInput({ title: "주간 광고", dueOn: "", repeat: "weekly" }), { ok: false, errors: { dueOn: "반복하려면 날짜를 넣어 주세요." } });
  assert.deepEqual(checkTaskInput({ title: "  명함   다시 주문 ", dueOn: "", repeat: "none" }), { ok: true, value: { title: "명함 다시 주문", dueOn: null, repeat: "none" } });
  assert.deepEqual(checkTaskInput({ title: "가".repeat(80), dueOn: "2026-11-30", repeat: "monthly" }).ok, true);
  assert.deepEqual(taskFieldErrors(["title", "dealId", "unknown"]), { title: "제목은 1 ~ 80자로 넣어 주세요.", dealId: "고른 거래를 찾지 못했습니다. 다시 찾아 주세요." });
});

test("고치기는 바뀐 칸만 보내고, 거래를 떼면 dealId: null", () => {
  const task = { title: "등기부등본 다시 떼기", dueOn: "2026-11-18", repeat: "none", deal: { id: "d1" } };
  assert.deepEqual(taskChanges(task, { title: "등기부등본 다시 떼기", dueOn: "2026-11-18", repeat: "none" }, "d1"), {});
  assert.deepEqual(taskChanges(task, { title: "등기부등본 떼기", dueOn: null, repeat: "none" }, null), { title: "등기부등본 떼기", dueOn: null, dealId: null });
  assert.deepEqual(taskChanges({ ...task, deal: null }, { title: task.title, dueOn: task.dueOn, repeat: "weekly" }, "d2"), { repeat: "weekly", dealId: "d2" });
});

test("목록 요청 값에는 상태·날짜·거래·커서·개수만 넣고 제목은 넣지 않는다", () => {
  assert.equal(String(taskListQuery()), "limit=50");
  assert.equal(String(taskListQuery({ status: "done", dealId: "d1", cursor: "c" })), "status=done&dealId=d1&cursor=c&limit=50");
  assert.equal(String(taskListQuery({ until: TODAY, limit: 50 })), "until=2026-11-18&limit=50");
  assert.equal(taskCountText(12), "열린 할 일 12개 보는 중 · 날짜 빠른 순");
  assert.equal(taskCountText(50, { more: true }), "열린 할 일 50개 보는 중 · 더 있음 · 날짜 빠른 순");
  assert.equal(taskCountText(3, { done: true }), "끝낸 할 일 3개 보는 중 · 끝낸 때 최근 순");
});

test("T2-130 끝냄·다시 열기 알림: 반복이면 다음 날짜를, 다시 열 때는 다음 할 일이 남아 있을 때만 알린다(서버 next)", () => {
  assert.equal(doneText({ title: "주간 매물 광고 갱신" }, { dueOn: "2026-11-25" }), "✓ '주간 매물 광고 갱신'을(를) 끝냈습니다. 다음 할 일을 만들었습니다(11월 25일(수)).");
  assert.equal(doneText({ title: "명함 다시 주문" }, null), "✓ '명함 다시 주문'을(를) 끝냈습니다.");
  assert.equal(reopenText({ title: "주간 매물 광고 갱신" }, { dueOn: "2026-11-25" }), "✓ '주간 매물 광고 갱신'을(를) 다시 열었습니다. 열린 할 일로 옮겼습니다. 다음 할 일(11월 25일(수))은 따로 남아 있습니다.");
  assert.equal(reopenText({ title: "명함 다시 주문" }, null), "✓ '명함 다시 주문'을(를) 다시 열었습니다. 열린 할 일로 옮겼습니다.");
});

test("첫 화면 '오늘 할 일' 칸: 0개·5개 이하·6개 이상·50개 넘음, 꺼짐·구조 옛날·실패는 한 줄", () => {
  assert.equal(homeLinkText(0, false), "할 일 만들기");
  assert.equal(homeLinkText(5, false), "할 일 화면으로");
  assert.equal(homeLinkText(8, false), "할 일 8개 모두 보기");
  assert.equal(homeLinkText(50, true), "할 일 50개 넘게 · 모두 보기");
  assert.equal(homeStateText("WORK_DISABLED"), "업무 도구가 켜지면 할 일을 볼 수 있습니다.");
  assert.equal(homeStateText("WORK_SCHEMA_OUTDATED"), "자료 구조 갱신 전이라 할 일을 볼 수 없습니다.");
  assert.equal(homeStateText("STORAGE_UNAVAILABLE"), "할 일을 불러오지 못했습니다.");
  assert.match(taskErrorText("WORK_SCHEMA_OUTDATED", ""), /구조\(6번\)/u);
  assert.match(taskErrorText("VERSION_CONFLICT", ""), /넣던 값은 그대로 있습니다/u);
  assert.equal(taskErrorText("OTHER", "기본 문장"), "기본 문장");
});
