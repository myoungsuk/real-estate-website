// 업무 도구 단계 2 PR-B2: 거래 일정(다시 계산·직접 일정·고치기·지우기)과 거래 .ics 시험. 가짜 자료만 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildContractSchedule } from "../src/lib/work/legal-dates.mjs";
import { NOW, ORIGIN, OWNER, authenticate, freshDb, nextUuid, rows, signToken, work, workEnv } from "./work-test-kit.mjs";
import { handleAdminApi } from "../worker/admin-api.mjs";
import { ALARM_TRIGGERS, buildDealIcsCalendar, dealIcsFileName, isAllowedAlarmTriggers } from "../worker/work-calendar.mjs";

const legalRules = JSON.parse(await readFile(new URL("../src/data/work/legal-rules.json", import.meta.url), "utf8"));
const audit = (database) => rows(database, "SELECT actor_email, action, target_type, target_id, outcome, reason FROM audit_events ORDER BY seq");
const KIND = { contract: "contract", middlePayment: "middle_payment", balance: "balance", transactionReport: "transaction_report", fundingPlanDelivery: "funding_plan_to_agent", fundingPlanSeparate: "funding_plan_submit", leaseReport: "lease_report" };

async function makeDeal(env, body) {
  const result = await work(env, "/deals", { method: "POST", body: { title: "가상 거래", dealType: "sale", propertyKind: "housing", ...body } });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data.deal;
}

const calculate = (env, dealId, options = {}) => work(env, `/deals/${dealId}/events/calculate`, { method: "POST", body: { replaceCalculated: true }, ...options });

test("다시 계산: 단계 0과 같은 함수·법령 데이터로 일정을 만들고(매매 7억 = 거래신고·자금조달), 안내 문장을 함께 돌려준다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { propertyLabel: "가상단지 101동", priceWon: 700_000_000, contractOn: "2026-11-20", balanceOn: "2027-01-20", separateFundingSubmission: true });
  const result = await calculate(env, deal.id);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  const expected = buildContractSchedule({ dealKind: "sale", target: "housing", regulation: "none", contractDate: "2026-11-20", balanceDate: "2027-01-20", propertyLabel: "가상단지 101동", priceWon: 700_000_000, buyerType: "individual", landPermitArea: false, capitalAreaEtc: true, landShare: false, separateFundingSubmission: true, reportingRegion: true, renewalWithoutChange: false }, legalRules);
  assert.equal(expected.ok, true);
  assert.deepEqual(result.json.data.events.map((event) => [event.kind, event.dueOn, event.title]).sort(),
    expected.events.map((event) => [KIND[event.kind], event.date, event.title]).sort(), "단계 0 화면과 같은 날짜·제목");
  assert.ok(result.json.data.events.some((event) => event.kind === "funding_plan_submit"), "분리 제출 체크 → 별도 제출 일정");
  assert.ok(result.json.data.events.every((event) => event.source === "calculated" && event.alarmOffsets.length === 1 && event.alarmOffsets[0] === "-PT6H"));
  assert.deepEqual(result.json.data.notices, expected.notices);
  assert.deepEqual(result.json.data.kept, [], "처음 계산은 남긴 종류 없음");
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "event.calculate", target_type: "deal", target_id: deal.id, outcome: "ok", reason: null });
  const view = await work(env, `/deals/${deal.id}`);
  assert.deepEqual(view.json.data.events, result.json.data.events, "거래 보기의 일정도 일정 API와 같은 모양(dealId 포함)");

  const lease = await makeDeal(env, { title: "가상 월세", dealType: "monthly_rent", propertyKind: "officetel", scheduleTarget: "housing", depositWon: 10_000_000, monthlyRentWon: 500_000, contractOn: "2026-11-20" });
  const leaseEvents = (await calculate(env, lease.id)).json.data.events.map((event) => event.kind);
  assert.ok(leaseEvents.includes("lease_report"), "주거용으로 고른 오피스텔 월세 30만 원 초과 → 임대차 신고");
  const other = await makeDeal(env, { title: "가상 오피스텔 그 밖", dealType: "monthly_rent", propertyKind: "officetel", scheduleTarget: "other", depositWon: 10_000_000, monthlyRentWon: 500_000, contractOn: "2026-11-20" });
  assert.ok(!(await calculate(env, other.id)).json.data.events.some((event) => event.kind === "lease_report"), "그 밖의 건축물로 고르면 임대차 신고 없음");
});

test("다시 계산 입력 검사: 계약일·필요한 금액이 없으면 칸 이름으로 400, 지원 전 계약일·요청 모양도 400", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  for (const [body, fields] of [
    [{ priceWon: 700_000_000 }, ["contractOn"]],
    [{ contractOn: "2026-11-20" }, ["priceWon"]],
    [{ dealType: "jeonse", contractOn: "2026-11-20" }, ["depositWon"]],
    [{ dealType: "monthly_rent", depositWon: 0, contractOn: "2026-11-20" }, ["monthlyRentWon"]],
    [{ priceWon: 700_000_000, contractOn: "2000-01-01" }, ["contractOn"]],
  ]) {
    const deal = await makeDeal(env, body);
    const result = await calculate(env, deal.id);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.deepEqual(result.json.error.details, fields, JSON.stringify(body));
  }
  const exchange = await makeDeal(env, { dealType: "exchange", contractOn: "2026-11-20" });
  assert.equal((await calculate(env, exchange.id)).status, 200, "교환은 거래신고 대상이 아니라 금액 없이도 계산(안내 문장만)");
  const officetel = await makeDeal(env, { dealType: "jeonse", propertyKind: "officetel", scheduleTarget: "housing", depositWon: 100_000_000, contractOn: "2026-11-20" });
  database.prepare("UPDATE deals SET schedule_target = NULL WHERE id = ?").run(officetel.id);
  assert.deepEqual((await calculate(env, officetel.id)).json.error.details, ["scheduleTarget"], "일정 판정 없는 오피스텔은 주택으로 짐작하지 않음");
  const deal = await makeDeal(env, { priceWon: 700_000_000, contractOn: "2026-11-20" });
  assert.equal((await work(env, `/deals/${deal.id}/events/calculate`, { method: "POST", body: {} })).status, 400);
  assert.equal((await work(env, `/deals/${deal.id}/events/calculate`, { method: "POST", body: { replaceCalculated: false } })).status, 400);
  assert.equal((await calculate(env, "00000000-0000-4000-8000-999999999999")).status, 404);
});

test("다시 계산(D4): 끝나지 않은 자동 일정은 그 자리에서 새 날짜로(알림 유지), 완료한 자동 일정·날짜를 고친 일정은 그대로 두고 새 기한을 kept로 알린다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { priceWon: 300_000_000, contractOn: "2026-11-20", middlePaymentOn: "2026-12-01", balanceOn: "2027-01-20" });
  let dealVersion = 1;
  const patchDeal = async (body) => {
    const result = await work(env, `/deals/${deal.id}`, { method: "PATCH", body: { version: dealVersion, ...body } });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    dealVersion = result.json.data.deal.version;
  };
  const byKind = (events, kind) => events.find((event) => event.kind === kind);
  const first = (await calculate(env, deal.id)).json.data.events;
  assert.deepEqual(first.map((event) => event.kind).sort(), ["balance", "contract", "middle_payment", "transaction_report"]);

  const alarmOnly = await work(env, `/events/${byKind(first, "transaction_report").id}`, { method: "PATCH", body: { version: 1, alarmOffsets: ["PT9H", "-P2DT15H"] } });
  assert.equal(alarmOnly.json.data.event.source, "calculated", "알림만 바꾸면 자동 일정 그대로");
  const done = await work(env, `/events/${byKind(first, "middle_payment").id}`, { method: "PATCH", body: { version: 1, done: true } });
  assert.equal(done.json.data.event.source, "calculated", "완료 표시만 하면 자동 일정 그대로");
  const doneAt = done.json.data.event.doneAt;
  assert.ok(doneAt);
  const redated = await work(env, `/events/${byKind(first, "balance").id}`, { method: "PATCH", body: { version: 1, dueOn: "2027-01-25" } });
  assert.equal(redated.json.data.event.source, "manual", "날짜를 고치면 사용자 일정");
  const custom = await work(env, `/deals/${deal.id}/events`, { method: "POST", body: { kind: "custom", dueOn: "2026-12-05", title: "가상 현장 확인" } });
  assert.equal(custom.status, 201);
  const uids = async () => new Set((await workRaw(env, `/deals/${deal.id}/calendar.ics`)).text.replace(/\r\n /gu, "").split("\r\n").filter((line) => line.startsWith("UID:")));
  const uidsBefore = await uids();

  // 날개-2 재현: 알림만 바꾼 거래신고 → 계약일 변경 → 다시 계산하면 새 기한으로 바뀌어야 한다.
  await patchDeal({ contractOn: "2026-11-25", middlePaymentOn: "2026-12-03" });
  const second = await calculate(env, deal.id);
  const events = second.json.data.events;
  assert.equal(events.length, 5, "같은 종류를 두 번 만들지 않음");
  const report = byKind(events, "transaction_report");
  assert.deepEqual([report.id, report.dueOn, report.source, report.alarmOffsets, report.version],
    [byKind(first, "transaction_report").id, "2026-12-24", "calculated", ["PT9H", "-P2DT15H"], 3], "같은 id로 새 기한, 알림 이어받음");
  const contract = byKind(events, "contract");
  assert.deepEqual([contract.id, contract.dueOn, contract.version], [byKind(first, "contract").id, "2026-11-25", 2]);
  const middle = byKind(events, "middle_payment");
  assert.deepEqual([middle.id, middle.dueOn, middle.source, middle.doneAt, middle.version], [byKind(first, "middle_payment").id, "2026-12-01", "calculated", doneAt, 2], "완료한 자동 일정은 날짜·완료 그대로");
  assert.deepEqual([byKind(events, "balance").dueOn, byKind(events, "balance").source], ["2027-01-25", "manual"], "날짜를 고친 일정 그대로");
  assert.ok(byKind(events, "custom"), "직접 넣은 일정 그대로");
  assert.deepEqual(second.json.data.kept, [
    { kind: "middle_payment", keptOn: "2026-12-01", calculatedOn: "2026-12-03", reason: "done" },
    { kind: "balance", keptOn: "2027-01-25", calculatedOn: "2027-01-20", reason: "manual" },
  ]);
  assert.deepEqual(second.json.data.notices.slice(0, 4), [
    "중도금: 완료로 표시한 일정의 날짜(2026-12-01)를 그대로 두었습니다. 지금 거래 기준으로 다시 계산한 날짜는 2026-12-03입니다.",
    "잔금: 직접 정한 날짜(2027-01-25)를 그대로 두었습니다. 지금 거래 기준으로 다시 계산한 날짜는 2027-01-20입니다.",
    "직접 고친 일정을 다시 계산한 값으로 바꾸려면 그 일정을 지운 뒤 다시 계산하세요.",
    "완료로 표시한 일정을 다시 계산한 날짜로 바꾸려면 완료 표시를 푼 뒤 다시 계산하세요.",
  ]);
  assert.deepEqual(await uids(), uidsBefore, "다시 계산 전후 .ics UID 같음");
  assert.ok(uidsBefore.has(`UID:${deal.id}-transaction_report@leaderscityhappy.com`));
  assert.ok(uidsBefore.has(`UID:${custom.json.data.event.id}@leaderscityhappy.com`), "직접 넣은 일정만 일정 id");

  // 날짜를 직접 고친 법정 기한: 그대로 두고 새로 계산한 기한을 함께 알린다.
  await work(env, `/events/${report.id}`, { method: "PATCH", body: { version: 3, dueOn: "2026-12-30" } });
  await patchDeal({ contractOn: "2026-12-11", middlePaymentOn: "2026-12-15" });
  const third = await calculate(env, deal.id);
  assert.equal(byKind(third.json.data.events, "transaction_report").dueOn, "2026-12-30");
  assert.ok(third.json.data.notices.includes("거래신고: 직접 정한 기한(2026-12-30)을 그대로 두었습니다. 지금 거래 기준으로 다시 계산한 기한은 2027-01-09입니다."));
  assert.deepEqual(third.json.data.kept.find((item) => item.kind === "transaction_report"), { kind: "transaction_report", keptOn: "2026-12-30", calculatedOn: "2027-01-09", reason: "manual" });
  const titleOnly = await work(env, `/events/${byKind(third.json.data.events, "contract").id}`, { method: "PATCH", body: { version: 3, title: "가상 계약(고친 제목)" } });
  assert.equal(titleOnly.json.data.event.source, "manual", "제목을 고쳐도 사용자 일정");
  assert.ok((await calculate(env, deal.id)).json.data.notices.includes("계약일: 직접 고친 일정을 그대로 두었습니다(날짜는 다시 계산한 값과 같습니다)."));

  // 완료를 풀면 자동 일정 그대로이고, 다음 다시 계산 때 새 날짜로 바뀐다.
  const undone = await work(env, `/events/${middle.id}`, { method: "PATCH", body: { version: byKind(third.json.data.events, "middle_payment").version, done: false } });
  assert.deepEqual([undone.json.data.event.source, undone.json.data.event.doneAt], ["calculated", null]);
  const afterUndo = (await calculate(env, deal.id)).json.data;
  assert.deepEqual([byKind(afterUndo.events, "middle_payment").id, byKind(afterUndo.events, "middle_payment").dueOn], [middle.id, "2026-12-15"]);
  assert.ok(!afterUndo.kept.some((item) => item.kind === "middle_payment"));
  assert.ok(!afterUndo.notices.some((notice) => notice.startsWith("완료로 표시한")));

  // 계산에서 빠진 종류: 끝나지 않은 자동 일정은 지우고, 완료한 자동 일정은 기록으로 남긴다. 다시 생기면 UID는 같다.
  await patchDeal({ priceWon: 700_000_000 });
  const funding = byKind((await calculate(env, deal.id)).json.data.events, "funding_plan_to_agent");
  assert.ok(funding, "6억 이상 → 자금조달 일정 추가");
  await patchDeal({ priceWon: 300_000_000 });
  assert.equal(byKind((await calculate(env, deal.id)).json.data.events, "funding_plan_to_agent"), undefined, "빠진 종류의 끝나지 않은 자동 일정은 지움");
  await patchDeal({ priceWon: 700_000_000 });
  const fundingAgain = byKind((await calculate(env, deal.id)).json.data.events, "funding_plan_to_agent");
  assert.notEqual(fundingAgain.id, funding.id);
  assert.ok((await uids()).has(`UID:${deal.id}-funding_plan_to_agent@leaderscityhappy.com`), "일정 id가 바뀌어도 UID 같음");
  await work(env, `/events/${fundingAgain.id}`, { method: "PATCH", body: { version: 1, done: true } });
  await patchDeal({ priceWon: 300_000_000 });
  const keptDone = byKind((await calculate(env, deal.id)).json.data.events, "funding_plan_to_agent");
  assert.deepEqual([keptDone?.id, keptDone?.source], [fundingAgain.id, "calculated"], "완료한 자동 일정은 빠진 종류여도 남김");
  await patchDeal({ priceWon: 700_000_000, contractOn: "2026-12-12", middlePaymentOn: "2026-12-16" });
  const sameDone = (await calculate(env, deal.id)).json.data;
  assert.deepEqual(byKind(sameDone.events, "funding_plan_to_agent").id, fundingAgain.id, "완료한 자동 일정이 있는 종류는 새로 만들지 않음");
  assert.equal(sameDone.events.filter((event) => event.kind === "funding_plan_to_agent").length, 1);
  assert.equal(sameDone.kept.find((item) => item.kind === "funding_plan_to_agent").reason, "done");

  // 같은 종류에 자동 일정과 사용자 일정이 함께 있으면(앞으로 AI 확정 일정 등) 자동 일정을 지우고 사용자 일정만 남긴다.
  const other = await makeDeal(env, { title: "가상 겹침", priceWon: 300_000_000, contractOn: "2026-11-20" });
  await calculate(env, other.id);
  database.prepare("INSERT INTO deal_events (id, deal_id, kind, due_on, title, source, created_at, updated_at) VALUES ('ai-1', ?, 'transaction_report', '2026-12-10', '가상 확정 일정', 'ai_confirmed', ?, ?)")
    .run(other.id, "2026-11-17T05:00:00.000Z", "2026-11-17T05:00:00.000Z");
  const overlap = (await calculate(env, other.id)).json.data.events.filter((event) => event.kind === "transaction_report");
  assert.deepEqual(overlap.map((event) => [event.id, event.source]), [["ai-1", "ai_confirmed"]]);
});

test("고치기: 지금과 같은 날짜·제목을 함께 보내고 알림만 바꾸면 자동 일정 그대로(화면이 칸을 모두 보내는 경우)", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { priceWon: 300_000_000, contractOn: "2026-11-20" });
  const report = (await calculate(env, deal.id)).json.data.events.find((event) => event.kind === "transaction_report");
  const same = await work(env, `/events/${report.id}`, { method: "PATCH", body: { version: 1, dueOn: report.dueOn, title: report.title, alarmOffsets: ["PT9H"] } });
  assert.equal(same.status, 200, JSON.stringify(same.json));
  assert.deepEqual([same.json.data.event.source, same.json.data.event.alarmOffsets], ["calculated", ["PT9H"]]);
  assert.equal((await work(env, `/deals/${deal.id}`, { method: "PATCH", body: { version: 1, contractOn: "2026-11-25" } })).status, 200);
  const moved = (await calculate(env, deal.id)).json.data.events.find((event) => event.kind === "transaction_report");
  assert.deepEqual([moved.id, moved.dueOn, moved.source, moved.alarmOffsets], [report.id, "2026-12-24", "calculated", ["PT9H"]], "계약일을 바꾸면 새 기한");
  const retitled = await work(env, `/events/${report.id}`, { method: "PATCH", body: { version: moved.version, dueOn: moved.dueOn, title: "가상 거래신고(고친 제목)" } });
  assert.equal(retitled.json.data.event.source, "manual", "제목이 실제로 바뀌면 사용자 일정");
});

test("동시 작업: 다시 계산하는 사이 거래가 고쳐지면 409이고 일정·감사는 그대로", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { priceWon: 300_000_000, contractOn: "2026-11-20" });
  await calculate(env, deal.id);
  const before = rows(database, "SELECT id, due_on FROM deal_events ORDER BY id");
  const auditCount = audit(database).length;
  db.beforeNextBatch = () => database.prepare("UPDATE deals SET contract_on = '2026-11-28', version = version + 1 WHERE id = ?").run(deal.id);
  const result = await calculate(env, deal.id);
  assert.equal(result.status, 409);
  assert.deepEqual(rows(database, "SELECT id, due_on FROM deal_events ORDER BY id"), before);
  assert.equal(audit(database).length, auditCount);
});

test("직접 일정·고치기·지우기: 입력 검사, version 충돌·같은 밀리초 겹침 409, 지우면 감사", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, {});
  const add = (body) => work(env, `/deals/${deal.id}/events`, { method: "POST", body: { kind: "custom", dueOn: "2026-12-01", title: "가상 일정", ...body } });
  for (const [body, fields] of [
    [{ kind: "contract" }, ["kind"]],
    [{ dueOn: "2026-02-30" }, ["dueOn"]],
    [{ title: "" }, ["title"]],
    [{ title: "가".repeat(81) }, ["title"]],
    [{ alarmOffsets: ["-PT1H"] }, ["alarmOffsets"]],
    [{ alarmOffsets: ALARM_TRIGGERS }, ["alarmOffsets"]],
    [{ alarmOffsets: ["-PT6H", "-PT6H"] }, ["alarmOffsets"]],
    [{ extra: 1 }, ["extra"]],
  ]) {
    const result = await add(body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.deepEqual(result.json.error.details, fields, JSON.stringify(body));
  }
  const created = await add({ title: "가상 900101-1234567 확인", alarmOffsets: ["PT9H", "-P2DT15H"] });
  assert.equal(created.status, 201);
  const event = created.json.data.event;
  assert.equal(event.title, "가상 ******-******* 확인");
  assert.deepEqual(event.alarmOffsets, ["PT9H", "-P2DT15H"]);
  assert.equal(audit(database).at(-1).reason, "rrn_masked=1");
  assert.equal((await work(env, "/deals/00000000-0000-4000-8000-999999999999/events", { method: "POST", body: { kind: "custom", dueOn: "2026-12-01", title: "가상" } })).status, 404);

  const undone = await work(env, `/events/${event.id}`, { method: "PATCH", body: { version: 1, done: true } });
  assert.ok(undone.json.data.event.doneAt);
  const redo = await work(env, `/events/${event.id}`, { method: "PATCH", body: { version: 2, done: false, dueOn: "2026-12-02" } });
  assert.equal(redo.json.data.event.doneAt, null);
  assert.equal(redo.json.data.event.dueOn, "2026-12-02");
  assert.equal((await work(env, `/events/${event.id}`, { method: "PATCH", body: { version: 1, title: "가상 늦게" } })).status, 409);
  const auditCount = audit(database).length;
  db.beforeNextBatch = () => database.prepare("UPDATE deal_events SET title = '가상 먼저', version = version + 1 WHERE id = ?").run(event.id);
  assert.equal((await work(env, `/events/${event.id}`, { method: "PATCH", body: { version: 3, title: "가상 늦게" } })).status, 409, "같은 밀리초 겹침");
  assert.equal(audit(database).length, auditCount);
  assert.equal((await work(env, `/events/${event.id}`, { method: "PATCH", body: { version: 4 } })).status, 400, "바꿀 칸 없음");

  assert.equal((await work(env, `/events/${event.id}`, { method: "DELETE", body: { x: 1 } })).status, 400);
  const removed = await work(env, `/events/${event.id}`, { method: "DELETE", body: {} });
  assert.deepEqual(removed.json.data, { deleted: true });
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "event.delete", target_type: "event", target_id: event.id, outcome: "ok", reason: null });
  assert.equal((await work(env, `/events/${event.id}`, { method: "DELETE", body: {} })).status, 404);
});

test("거래 .ics: 내려받기 헤더·파일 이름, 일정마다 UID·알림, 법정 문구, 끝난 일정 제외, 손님 이름 없음, deal.view(format=ics) 감사", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = (await work(env, "/customers", { method: "POST", body: { displayName: "가상 손님 비밀이름" } })).json.data.customer;
  const deal = await makeDeal(env, { propertyLabel: "가상단지 101동", priceWon: 300_000_000, contractOn: "2026-11-20", parties: [{ customerId: customer.id, role: "buyer" }] });
  const events = (await calculate(env, deal.id)).json.data.events;
  const contract = events.find((event) => event.kind === "contract");
  await work(env, `/events/${contract.id}`, { method: "PATCH", body: { version: 1, done: true } });
  const custom = (await work(env, `/deals/${deal.id}/events`, { method: "POST", body: { kind: "custom", dueOn: "2026-12-05", title: "가상 현장 확인", alarmOffsets: ["PT9H"] } })).json.data.event;

  const raw = await workRaw(env, `/deals/${deal.id}/calendar.ics`);
  assert.equal(raw.status, 200);
  assert.equal(raw.headers.get("Content-Type"), "text/calendar; charset=utf-8");
  assert.equal(raw.headers.get("Content-Disposition"), 'attachment; filename="work-deal-20261120.ics"');
  assert.equal(raw.headers.get("Cache-Control"), "no-store");
  assert.equal(raw.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(raw.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
  assert.ok(raw.headers.get("X-Request-Id"));
  const body = raw.text;
  assert.ok(body.startsWith("BEGIN:VCALENDAR\r\n") && body.endsWith("END:VCALENDAR\r\n"));
  assert.ok(body.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75), "75옥텟 접기");
  const unfolded = body.replace(/\r\n /gu, "");
  assert.ok(unfolded.includes(`UID:${custom.id}@leaderscityhappy.com`));
  assert.ok(!unfolded.includes(`UID:${deal.id}-contract@`), "끝난 일정 제외");
  assert.ok(unfolded.includes(`UID:${deal.id}-transaction_report@leaderscityhappy.com`), "자동 일정 UID = 거래 ID-종류");
  assert.match(unfolded, /SUMMARY:가상 현장 확인\r\n/u);
  assert.match(unfolded, /TRIGGER:PT9H/u);
  assert.match(unfolded, /DESCRIPTION:법정 기한: 계약일부터 30일 이내/u, "거래신고 법정 문구");
  assert.doesNotMatch(unfolded, /비밀이름/u, "손님 이름 없음");
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "deal.view", target_type: "deal", target_id: deal.id, outcome: "ok", reason: "format=ics" });

  const empty = await makeDeal(env, { title: "가상 빈 거래" });
  const emptyRaw = await workRaw(env, `/deals/${empty.id}/calendar.ics`);
  assert.equal(emptyRaw.status, 200, "일정 0개면 빈 캘린더");
  assert.doesNotMatch(emptyRaw.text, /BEGIN:VEVENT/u);
  assert.equal(emptyRaw.headers.get("Content-Disposition"), 'attachment; filename="work-deal-20261117.ics"', "계약일 없으면 오늘(한국 날짜)");
  assert.equal((await work(env, "/deals/00000000-0000-4000-8000-999999999999/calendar.ics")).status, 404);
  assert.equal((await work(env, `/deals/${deal.id}/calendar.ics`, { method: "POST", body: {} })).status, 405);
});

test("일정 경로는 정해진 방식만 받는다(405 + Allow), 알림 시점은 단계 0과 같은 세 가지뿐", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, {});
  const calc = await work(env, `/deals/${deal.id}/events/calculate`);
  assert.equal(calc.status, 405);
  assert.equal(calc.response.headers.get("Allow"), "POST");
  const event = (await work(env, `/deals/${deal.id}/events`, { method: "POST", body: { kind: "custom", dueOn: "2026-12-01", title: "가상" } })).json.data.event;
  const get = await work(env, `/events/${event.id}`);
  assert.equal(get.status, 405);
  assert.equal(get.response.headers.get("Allow"), "PATCH, DELETE");
  assert.equal((await work(env, "/events/not-a-uuid", { method: "PATCH", body: { version: 1, title: "x" } })).status, 404);
  assert.equal((await work(env, `/deals/${deal.id}/events/other`, { method: "POST", body: {} })).status, 404);
  assert.deepEqual(ALARM_TRIGGERS, ["-PT6H", "PT9H", "-P2DT15H"]);
  assert.equal(isAllowedAlarmTriggers([]), true);
  assert.equal(isAllowedAlarmTriggers(["-PT6H", "PT9H", "-P2DT15H"]), false, "최대 2개");
  assert.equal(dealIcsFileName("2026-01-05"), "work-deal-20260105.ics");
  assert.match(buildDealIcsCalendar({ events: [], now: new Date(NOW) }), /^BEGIN:VCALENDAR\r\n[^]*END:VCALENDAR\r\n$/u);
});

test("공용 단계 0 계산 파일(src/lib/work)은 이 PR에서 고치지 않고 가져다 쓰기만 한다", async () => {
  const source = await readFile(new URL("../worker/work-calendar.mjs", import.meta.url), "utf8");
  assert.match(source, /from "\.\.\/src\/lib\/work\/ics\.mjs"/u);
  const events = await readFile(new URL("../worker/work-events.mjs", import.meta.url), "utf8");
  assert.match(events, /buildContractSchedule/u);
  assert.match(events, /legal-rules\.json/u);
});

// .ics 응답은 JSON이 아니라서 work() 대신 원문을 읽는다.
async function workRaw(env, path) {
  const request = new Request(`${ORIGIN}/api/admin/v1/work${path}`, { headers: { "Cf-Access-Jwt-Assertion": await signToken() } });
  const response = await handleAdminApi(request, env, { authenticate, work: { now: () => NOW, auditLog: () => {}, randomUUID: nextUuid } });
  return { status: response.status, headers: response.headers, text: await response.text() };
}
