import assert from "node:assert/strict";
import test from "node:test";
import {
  CUSTOMER_STATUS_LABELS,
  CUSTOMER_STATUS_ORDER,
  agoText,
  checkCustomerInput,
  checkNoteBody,
  cleanQuery,
  customerChanges,
  customerCountText,
  customerErrorText,
  customerSaveErrorText,
  customerHref,
  customerIdFromSearch,
  customerListQuery,
  dateText,
  deleteResultText,
  dueText,
  isCleanupDue,
  isRetryable,
  noteListQuery,
  noteTimeText,
  phoneText,
  DEAL_PROPERTY_KIND_LABELS,
  DEAL_PROPERTY_KIND_ORDER,
  DEAL_SCHEDULE_TARGET_LABELS,
  DEAL_TITLE_MAX,
  DEAL_TYPE_LABELS,
  DEAL_TYPE_ORDER,
  PARTY_ROLE_LABELS,
  PARTY_ROLE_ORDER,
  checkDealInput,
  dealCreateNote,
  dealRoleChoices,
  dealServerErrors,
} from "../src/lib/work/customers-view.mjs";
import { DEAL_PAYER_SIDES } from "../src/lib/work/ledger-view.mjs";
import { DEAL_TYPES, OFFICETEL_SCHEDULE_TARGETS, PARTY_ROLES, PROPERTY_KINDS, parseDealCreate } from "../worker/work-input.mjs";

const TODAY = "2026-11-21";

test("손님 상태 이름 4가지와 거르기 순서(계약 진행 → 상담 중 → 보류 → 거래 끝)는 서버 상태 값과 같다", () => {
  assert.deepEqual(Object.keys(CUSTOMER_STATUS_LABELS).sort(), ["completed", "consulting", "contracting", "on_hold"]);
  assert.deepEqual([...CUSTOMER_STATUS_ORDER], ["contracting", "consulting", "on_hold", "completed"]);
  assert.equal(CUSTOMER_STATUS_LABELS.completed, "거래 끝");
});

test("날짜 글: 올해는 연도를 빼고, 며칠 전·남은 날은 한국 날짜끼리 센다", () => {
  assert.equal(dateText("2026-11-20", TODAY), "11. 20.");
  assert.equal(dateText("2025-10-01", TODAY), "2025. 10. 1.");
  assert.equal(dateText("잘못된 날", TODAY), "");
  assert.equal(agoText(TODAY, TODAY), "오늘");
  assert.equal(agoText("2026-11-20", TODAY), "어제");
  assert.equal(agoText("2026-11-06", TODAY), "15일 전");
  assert.equal(agoText("2026-08-21", TODAY), "3달 전");
  assert.equal(agoText("2024-11-01", TODAY), "2년 전");
  assert.equal(agoText("2026-11-22", TODAY), "오늘", "시계 차이로 내일이 와도 '오늘'");
  assert.equal(dueText("2026-11-24", TODAY), "3일 남음");
  assert.equal(dueText(TODAY, TODAY), "오늘");
  assert.equal(dueText("2026-11-19", TODAY), "2일 지남");
});

test("정리 안내는 기준일이 오늘보다 앞일 때만 '지남'이고, 기준일이 없으면 묻지 않는다", () => {
  assert.equal(isCleanupDue({ retentionUntil: "2026-11-20" }, TODAY), true);
  assert.equal(isCleanupDue({ retentionUntil: TODAY }, TODAY), false);
  assert.equal(isCleanupDue({ retentionUntil: null }, TODAY), false);
});

test("전화번호·메모 시각은 읽기 쉽게 바꾸고, 메모 시각은 한국 시각(UTC + 9시간)이다", () => {
  assert.equal(phoneText("01000000001"), "010-0000-0001");
  assert.equal(phoneText("0212345678"), "02-1234-5678");
  assert.equal(phoneText("0421234567"), "042-123-4567");
  assert.equal(phoneText("15881234"), "1588-1234");
  assert.equal(phoneText(null), "");
  assert.equal(noteTimeText("2026-11-21T06:10:00.000Z", TODAY), "11. 21. 15:10");
  assert.equal(noteTimeText("2026-11-20T15:30:00.000Z", TODAY), "11. 21. 00:30", "UTC 전날 밤은 한국 다음 날");
});

test("목록 요청 조건: 찾는 말은 앞뒤 빈칸을 떼고 30자까지, 상태는 4가지만, 메모 창고는 inbox=1", () => {
  assert.equal(customerListQuery({ q: "  가상 손님 1 ", status: "on_hold" }).toString(), "q=%EA%B0%80%EC%83%81+%EC%86%90%EB%8B%98+1&status=on_hold&limit=20");
  assert.equal(customerListQuery({ status: "없는상태", cursor: "abc" }).toString(), "cursor=abc&limit=20");
  assert.equal(cleanQuery("가".repeat(40)).length, 30);
  assert.equal(noteListQuery({ q: "주차" }).get("inbox"), "1");
  assert.equal(noteListQuery({}).toString(), "inbox=1&limit=20");
  assert.equal(customerCountText(3, {}), "손님 3명 · 최근 고친 순");
  assert.equal(customerCountText(20, { more: true, q: "가상" }), "찾은 손님 20명 이상 · 최근 고친 순");
});

test("손님 입력 검사는 서버와 같은 범위(이름 1 ~ 60자, 전화 숫자 8 ~ 12자리, 찾는 조건 2,000자)이고 칸별 오류를 준다", () => {
  const ok = checkCustomerInput({ displayName: " 가상 손님 1 ", phone: "010-0000-0001", needs: " 천동 84㎡ ", status: "consulting" });
  assert.deepEqual(ok, { ok: true, value: { displayName: "가상 손님 1", phoneDigits: "01000000001", needs: "천동 84㎡", status: "consulting" } });
  assert.equal(checkCustomerInput({ displayName: "가상 손님 2", phone: "" }).value.phoneDigits, null, "전화번호는 비워도 됨");
  const bad = checkCustomerInput({ displayName: "  ", phone: "010-12", needs: "가".repeat(2001), status: "unknown" });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["displayName", "needs", "phone", "status"]);
  assert.equal(checkCustomerInput({ displayName: "가".repeat(61) }).ok, false);
});

test("고치기는 바뀐 칸만 보내고, 바뀐 것이 없으면 보내지 않는다", () => {
  const before = { displayName: "가상 손님 1", phoneDigits: "01000000001", needs: "천동", status: "consulting" };
  assert.equal(customerChanges(before, { ...before }), null);
  assert.deepEqual(customerChanges(before, { ...before, status: "contracting", phoneDigits: null }), { phoneDigits: null, status: "contracting" });
});

test("메모 글은 비울 수 없고 20,000자까지다", () => {
  assert.deepEqual(checkNoteBody("  통화함 "), { ok: true, value: "통화함" });
  assert.equal(checkNoteBody("   ").ok, false);
  assert.equal(checkNoteBody("가".repeat(20001)).ok, false);
});

test("손님 지우기 결과 문장은 휴지통으로 함께 옮긴 것과, 다른 손님과 함께인 거래라 남긴 메모를 알린다", () => {
  assert.equal(deleteResultText({ deleted: { deals: 1, notes: 2 }, kept: { notes: 0 } }), "함께 옮긴 것: 이 손님만의 거래 1건, 메모 2개.");
  assert.match(deleteResultText({ deleted: { deals: 0, notes: 0 }, kept: { notes: 3 } }), /메모 3개는 그 거래 기록이라 남겼습니다/u);
  // 매출장부: 지운 거래의 장부 줄은 남기고 그 수를 알린다. 0개면 말하지 않는다.
  assert.match(deleteResultText({ deleted: { deals: 1, notes: 0 }, kept: { notes: 0, ledger: 2 } }), /장부 줄 2개는 매출장부에 남습니다/u);
  assert.doesNotMatch(deleteResultText({ deleted: { deals: 1, notes: 0 }, kept: { notes: 0, ledger: 0 } }), /장부 줄/u);
  // 그 거래에 붙은 할 일은 함께 지워지고 개수를 알린다. 0개면 말하지 않는다(2026-11-21 사용자 결정 U-4).
  assert.equal(deleteResultText({ deleted: { deals: 1, notes: 3, tasks: 2 }, kept: { notes: 0 } }), "함께 옮긴 것: 이 손님만의 거래 1건, 메모 3개, 할 일 2개.");
  assert.doesNotMatch(deleteResultText({ deleted: { deals: 1, notes: 0, tasks: 0 }, kept: { notes: 0 } }), /할 일/u);
  // 손님 사진도 함께 휴지통으로(바로 찍기 F-b). 0장이면 말하지 않음
  assert.equal(deleteResultText({ deleted: { deals: 1, notes: 2, files: 3, tasks: 1 }, kept: { notes: 0 } }), "함께 옮긴 것: 이 손님만의 거래 1건, 메모 2개, 사진·계약서 사본 3장, 할 일 1개.");
  assert.doesNotMatch(deleteResultText({ deleted: { deals: 1, notes: 0, files: 0 }, kept: { notes: 0 } }), /사진/u);
  // 휴지통(단계 2, 시안 2026-11-22 14:42:41): 응답의 trash.purgeAfter(한국 날짜)까지 되살릴 수 있다고 알린다. 값이 없으면 말하지 않는다.
  assert.equal(
    deleteResultText({ deleted: { deals: 1, notes: 3, tasks: 1 }, kept: { notes: 1 }, trash: { batchId: "b", purgeAfter: "2026-11-25T01:12:00.000Z" } }),
    "함께 옮긴 것: 이 손님만의 거래 1건, 메모 3개, 할 일 1개. 다른 손님과 함께인 거래의 메모 1개는 그 거래 기록이라 남겼습니다. 그 메모 글에 지운 손님 이름·전화가 있으면 직접 고쳐 주세요. 11월 25일(수)까지 휴지통에서 되살릴 수 있습니다.",
  );
  assert.match(deleteResultText({ deleted: { deals: 0, notes: 0 }, kept: { notes: 0 }, trash: { batchId: "b", purgeAfter: "2026-11-25T15:30:00.000Z" } }), /11월 26일\(목\)까지/u, "한국 날짜(UTC 15:30 = 다음 날 00:30)");
});

test("서버 오류 코드마다 쉬운 문장이 있고, 다시 해 볼 수 없는 오류에는 '다시 불러오기'를 보이지 않는다", () => {
  for (const code of ["WORK_DISABLED", "STORAGE_UNAVAILABLE", "VALIDATION_FAILED", "NOT_FOUND", "VERSION_CONFLICT", "CONFIRMATION_MISMATCH", "FILES_REQUIRE_STORAGE", "CSRF_INVALID", "AUTH_REQUIRED"]) {
    assert.notEqual(customerErrorText(code), customerErrorText("모르는 코드"), code);
  }
  assert.match(customerErrorText("VERSION_CONFLICT"), /'다시 불러오기'/u);
  assert.equal(isRetryable("STORAGE_UNAVAILABLE"), true);
  assert.equal(isRetryable(null), true);
  for (const code of ["AUTH_REQUIRED", "WORK_DISABLED", "WORK_CONFIG_MISSING", "WORK_SCHEMA_OUTDATED", "NOT_FOUND"]) assert.equal(isRetryable(code), false, code);
});

test("저장 실패 문장: 로그인·보안 확인 만료는 새로고침하라고 하지 않고 새 탭에서 로그인한 뒤 같은 단추를 누르게 하며, 그 밖은 화면 문장과 같다", () => {
  for (const code of ["AUTH_REQUIRED", "CSRF_INVALID"]) {
    const text = customerSaveErrorText(code);
    assert.match(text, /새로고침하지 말고/u, code);
    assert.match(text, /새 탭에서 관리자 화면을 열어 다시 로그인/u, code);
    assert.match(text, /같은 단추를 다시 눌러/u, code);
    assert.match(text, /넣던 글은 지워지지 않았습니다.$/u, code);
    assert.doesNotMatch(text, /새로고침해|새로고침한 뒤/u, code);
  }
  for (const code of ["STORAGE_UNAVAILABLE", "VERSION_CONFLICT", "VALIDATION_FAILED", null, "모르는 코드"]) assert.equal(customerSaveErrorText(code), customerErrorText(code), String(code));
  assert.match(customerErrorText("AUTH_REQUIRED"), /새로고침해/u, "불러오기 실패는 잃을 글이 없어 그대로");
  // 응답 없이 끊김(fetch TypeError): 저장됐는지 알 수 없어 새 탭에서 먼저 확인하게 함. 코드가 있으면 코드 문장이 먼저.
  const network = customerSaveErrorText(null, new TypeError("Failed to fetch"));
  assert.match(network, /연결이 끊겼거나 로그인이 만료되었을 수 있습니다/u);
  assert.match(network, /새로고침하지 말고/u);
  assert.match(network, /저장됐는지 확인한 뒤/u);
  assert.equal(customerSaveErrorText(null, new Error("x")), customerErrorText(null), "TypeError가 아니면 그대로");
  assert.equal(customerSaveErrorText("AUTH_REQUIRED", new TypeError("x")), customerSaveErrorText("AUTH_REQUIRED"));
});

test("손님 카드 주소는 무작위 UUID만 받고 이름·전화는 주소에 넣지 않는다", () => {
  const id = "3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b";
  assert.equal(customerHref(id), `/admin/work/customers/detail/?id=${id}`);
  assert.equal(customerIdFromSearch(`?id=${id}`), id);
  for (const search of ["", "?id=가상 손님 1", "?id=01000000001", `?id=${id.toUpperCase()}`, `?id=${id}x`]) assert.equal(customerIdFromSearch(search), null, search);
});

// 손님 카드 '새 거래'(2026-11-25). 고르기 값은 서버 값과 같아야 하고, 화면 검사를 지난 값은 서버 parseDealCreate도 받아야 한다.
const CUSTOMER_ID = "3f2b8c1e-5a6d-4e7f-8a9b-0c1d2e3f4a5b";

test("새 거래 고르기 값(거래 종류·물건 종류·오피스텔 일정 기준·역할)은 서버 허용 값과 같고, 이름이 모두 있다", () => {
  assert.deepEqual([...DEAL_TYPE_ORDER], [...DEAL_TYPES]);
  assert.deepEqual([...DEAL_PROPERTY_KIND_ORDER], [...PROPERTY_KINDS]);
  assert.deepEqual(Object.keys(DEAL_SCHEDULE_TARGET_LABELS), [...OFFICETEL_SCHEDULE_TARGETS]);
  assert.deepEqual([...PARTY_ROLE_ORDER], [...PARTY_ROLES]);
  for (const value of DEAL_TYPE_ORDER) assert.ok(DEAL_TYPE_LABELS[value], value);
  for (const value of DEAL_PROPERTY_KIND_ORDER) assert.ok(DEAL_PROPERTY_KIND_LABELS[value], value);
  for (const value of PARTY_ROLE_ORDER) assert.ok(PARTY_ROLE_LABELS[value], value);
  assert.equal(DEAL_TITLE_MAX, 80);
});

test("새 거래 역할: 거래 종류의 두 쪽(매출장부와 같은 짝) + 기타, 거래 종류를 고르기 전에는 다섯 가지", () => {
  for (const [dealType, sides] of Object.entries(DEAL_PAYER_SIDES)) assert.deepEqual(dealRoleChoices(dealType), [...sides, "other"], dealType);
  assert.deepEqual([...dealRoleChoices("")], [...PARTY_ROLE_ORDER]);
  assert.deepEqual([...dealRoleChoices("모름")], [...PARTY_ROLE_ORDER]);
});

test("새 거래 검사: 빈 칸·긴 제목·오피스텔 일정 기준·거래와 맞지 않는 역할은 칸별 문장으로 막는다", () => {
  const empty = checkDealInput({}, CUSTOMER_ID);
  assert.equal(empty.ok, false);
  assert.deepEqual(Object.keys(empty.errors).sort(), ["dealType", "propertyKind", "role", "title"]);
  assert.match(empty.errors.title, /거래 제목을 넣어 주세요/u);
  assert.equal(checkDealInput({ title: "   ", dealType: "sale", propertyKind: "housing", role: "buyer" }, CUSTOMER_ID).errors.title, empty.errors.title, "공백만은 빈 제목");
  const long = checkDealInput({ title: "가".repeat(81), dealType: "sale", propertyKind: "housing", role: "buyer" }, CUSTOMER_ID);
  assert.deepEqual(long.errors, { title: "거래 제목은 80자까지 넣을 수 있습니다." });
  assert.equal(checkDealInput({ title: ` ${"가".repeat(80)} `, dealType: "sale", propertyKind: "housing", role: "buyer" }, CUSTOMER_ID).ok, true, "앞뒤 공백은 빼고 센다");
  assert.deepEqual(checkDealInput({ title: "가상 거래", dealType: "sale", propertyKind: "officetel", role: "buyer" }, CUSTOMER_ID).errors, { scheduleTarget: "오피스텔 일정 기준을 골라 주세요." });
  assert.deepEqual(checkDealInput({ title: "가상 거래", dealType: "sale", propertyKind: "officetel", scheduleTarget: "toString", role: "buyer" }, CUSTOMER_ID).errors, { scheduleTarget: "오피스텔 일정 기준을 골라 주세요." }, "물려받은 속성 이름은 값이 아님");
  assert.deepEqual(checkDealInput({ title: "가상 거래", dealType: "sale", propertyKind: "housing", role: "tenant" }, CUSTOMER_ID).errors, { role: "이 손님이 거래에서 어느 쪽인지 골라 주세요." });
  assert.deepEqual(checkDealInput({ title: "가상 거래", dealType: "rent", propertyKind: "flat", role: "buyer" }, CUSTOMER_ID).errors, { dealType: "거래 종류를 골라 주세요.", propertyKind: "물건 종류를 골라 주세요." });
});

test("새 거래 검사를 지난 값은 제목을 다듬고 이 손님 한 명을 참여자로 붙이며, 모든 조합을 서버 parseDealCreate가 받는다", () => {
  const ok = checkDealInput({ title: "  가상숲5단지 84㎡ 매매 ", dealType: "sale", propertyKind: "housing", scheduleTarget: "housing", role: "buyer" }, CUSTOMER_ID);
  assert.deepEqual(ok, { ok: true, value: { title: "가상숲5단지 84㎡ 매매", dealType: "sale", propertyKind: "housing", parties: [{ customerId: CUSTOMER_ID, role: "buyer" }] } }, "주택이면 일정 기준을 보내지 않음");
  for (const dealType of DEAL_TYPE_ORDER) {
    for (const propertyKind of DEAL_PROPERTY_KIND_ORDER) {
      for (const role of dealRoleChoices(dealType)) {
        const scheduleTarget = propertyKind === "officetel" ? "housing" : "";
        const checked = checkDealInput({ title: "가상 거래", dealType, propertyKind, scheduleTarget, role }, CUSTOMER_ID);
        assert.equal(checked.ok, true, `${dealType}/${propertyKind}/${role}`);
        const parsed = parseDealCreate(checked.value);
        assert.equal(parsed.deal.dealType, dealType);
        assert.equal(parsed.deal.propertyKind, propertyKind);
        assert.equal(parsed.deal.scheduleTarget, propertyKind === "officetel" ? "housing" : null);
        assert.deepEqual(parsed.parties, [{ customerId: CUSTOMER_ID, role }]);
      }
    }
  }
});

test("새 거래 서버 검사 실패: 칸 이름은 그 칸 아래 문장으로, parties는 손님을 찾지 못한 것으로 본다", () => {
  assert.deepEqual(dealServerErrors(["title"]), { fields: { title: "거래 제목을 확인해 주세요(1 ~ 80자)." }, missingCustomer: false });
  assert.deepEqual(dealServerErrors(["parties"]), { fields: {}, missingCustomer: true });
  assert.deepEqual(dealServerErrors(["scheduleTarget", "body"]), { fields: { scheduleTarget: "오피스텔 일정 기준을 다시 골라 주세요." }, missingCustomer: false });
  assert.deepEqual(dealServerErrors(), { fields: {}, missingCustomer: false });
  assert.deepEqual(dealServerErrors(["constructor"]), { fields: {}, missingCustomer: false });
});

test("새 거래 칸 안내: AI 일정 뽑기가 켜졌을 때만 그 길을 알려 준다", () => {
  assert.match(dealCreateNote({ aiReady: true }), /'AI로 일정 뽑기'/u);
  assert.equal(dealCreateNote({ aiReady: false }), "계약일·금액·일정은 아직 이 화면에서 넣을 수 없습니다.");
});
