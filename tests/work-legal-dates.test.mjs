import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  EXCHANGE_REPORT_NOTICE,
  HOLIDAY_NOTICE,
  LEASE_MOVE_IN_NOTICE,
  WEEKEND_NOTICE,
  buildContractSchedule,
  deadlineFromContractDate,
  describeCalendarDate,
  formatDeadlineLine,
  parseCalendarDate,
  screenFundingPlan,
  screenLeaseReport,
  todayInKorea,
} from "../src/lib/work/legal-dates.mjs";

const legalRules = JSON.parse(await readFile(new URL("../src/data/work/legal-rules.json", import.meta.url), "utf8"));

const schedule = (input) => buildContractSchedule({ contractDate: "2026-11-16", target: "housing", ...input }, legalRules);
const okSchedule = (input) => {
  const result = schedule(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};
const kinds = (result) => result.events.map((event) => event.kind);
const sale = (input = {}) => ({ dealKind: "sale", buyerType: "individual", regulation: "none", priceWon: 300_000_000, ...input });
const funding = (input) => screenFundingPlan({ dealKind: "sale", target: "housing", buyerType: "individual", regulation: "none", ...input }, legalRules);

test("T0-62 ~ T0-69a 첫날 포함 +24·+29 기한과 주말 표시", () => {
  const cases = [
    ["T0-62", "2026-11-16", "2026-12-10", "2026-12-15"],
    ["T0-63", "2026-12-10", "2027-01-03", "2027-01-08"],
    ["T0-64", "2026-12-20", "2027-01-13", "2027-01-18"],
    ["T0-65", "2027-01-31", "2027-02-24", "2027-03-01"],
    ["T0-66", "2027-02-28", "2027-03-24", "2027-03-29"],
    ["T0-67", "2028-01-31", "2028-02-24", "2028-02-29"],
    ["T0-68", "2028-02-29", "2028-03-24", "2028-03-29"],
    ["T0-69", "2026-11-20", "2026-12-14", "2026-12-19"],
    ["T0-69a", "2026-12-10", "2027-01-03", "2027-01-08"],
  ];
  for (const [id, contractDate, day25, day30] of cases) {
    assert.equal(deadlineFromContractDate(contractDate, 25), day25, id);
    assert.equal(deadlineFromContractDate(contractDate, 30), day30, id);
  }
  assert.equal(formatDeadlineLine("2026-12-10"), "늦어도 2026-12-10(목)까지", "T0-62");
  assert.equal(formatDeadlineLine("2026-12-15"), "늦어도 2026-12-15(화)까지", "T0-62");
  assert.equal(formatDeadlineLine("2026-12-19"), "늦어도 2026-12-19(토요일)까지", "T0-69");
  assert.equal(describeCalendarDate("2026-12-19").weekend, true, "T0-69");
  assert.equal(formatDeadlineLine("2027-01-03"), "늦어도 2027-01-03(일요일)까지", "T0-69a");
  assert.equal(formatDeadlineLine("2027-01-08"), "늦어도 2027-01-08(금)까지", "T0-69a");

  const weekendSale = okSchedule(sale({ contractDate: "2026-11-20" }));
  const report = weekendSale.events.find((event) => event.kind === "transactionReport");
  assert.equal(report.date, "2026-12-19", "T0-69 날짜를 미루지 않음");
  assert.ok(weekendSale.notices.includes(WEEKEND_NOTICE), "T0-69");
});

test("T0-70 공휴일 이름 없이 직접 확인 문구만 보여 준다", () => {
  const result = okSchedule(sale());
  assert.ok(result.notices.includes(HOLIDAY_NOTICE));
  assert.equal(HOLIDAY_NOTICE, "공휴일 여부는 직접 확인하세요.");
  for (const event of result.events) assert.doesNotMatch(`${event.dateLine} ${event.label}`, /공휴일|설날|추석|대체/u);
});

test("T0-71 브라우저 시간대가 달라도 같은 날짜를 계산한다", () => {
  const moduleUrl = new URL("../src/lib/work/legal-dates.mjs", import.meta.url).href;
  const code = `const m = await import(${JSON.stringify(moduleUrl)}); console.log(m.deadlineFromContractDate("2026-11-16", 25) + " " + m.deadlineFromContractDate("2026-11-16", 30) + " " + m.describeCalendarDate("2026-11-16").weekday);`;
  for (const timeZone of ["UTC", "Asia/Seoul", "America/Los_Angeles"]) {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
      env: { ...process.env, TZ: timeZone },
      encoding: "utf8",
    }).trim();
    assert.equal(output, "2026-12-10 2026-12-15 월", timeZone);
  }
});

test("T0-72 ~ T0-74 거래신고는 매매·공급계약·지위 매매만, 교환은 안내 문구", () => {
  for (const dealKind of ["sale", "supply", "status_sale"]) {
    const result = okSchedule(sale({ dealKind }));
    const report = result.events.find((event) => event.kind === "transactionReport");
    assert.equal(report?.date, "2026-12-15", `T0-72 ${dealKind}`);
    assert.equal(report.label, "거래신고", "T0-72");
    assert.match(report.legalText, /계약일부터 30일 이내\(부동산 거래신고 등에 관한 법률 제3조 제1항\)/u, "T0-72");
    assert.match(report.legalText, /개업공인중개사가 거래계약서를 작성·교부한 경우 그 중개사가 신고/u, "T0-72 신고 주체 조건(제3조③)");
    assert.match(report.legalText, /그 밖에는 거래당사자가 공동으로 신고/u, "T0-72 중개 거래가 아니면 당사자 공동 신고");
  }

  const exchange = okSchedule({ dealKind: "exchange" });
  assert.ok(!kinds(exchange).includes("transactionReport"), "T0-73");
  assert.ok(exchange.notices.includes(EXCHANGE_REPORT_NOTICE), "T0-73");
  assert.match(EXCHANGE_REPORT_NOTICE, /교환계약은 법 제3조① 신고 대상 계약 목록에 없습니다/u, "T0-73");

  assert.ok(!kinds(okSchedule({ dealKind: "jeonse", depositWon: 100_000_000 })).includes("transactionReport"), "T0-74");
  assert.ok(!kinds(okSchedule({ dealKind: "monthly_rent", depositWon: 10_000_000, monthlyRentWon: 500_000 })).includes("transactionReport"), "T0-74");
});

test("T0-75 ~ T0-83·T0-90 자금조달·토지이용계획서 대상 판정", () => {
  assert.equal(funding({ priceWon: 599_999_999 }).applies, false, "T0-75");
  assert.ok(!kinds(okSchedule(sale({ priceWon: 599_999_999 }))).includes("fundingPlanDelivery"), "T0-75");

  const sixHundred = okSchedule(sale({ priceWon: 600_000_000 }));
  const delivery = sixHundred.events.find((event) => event.kind === "fundingPlanDelivery");
  assert.equal(delivery?.date, "2026-12-10", "T0-76 +24");
  assert.equal(delivery.label, "자금조달계획서 등 전달(법인·매수인 외의 사람이 신고하는 경우)", "T0-76");
  assert.match(delivery.legalText, /시행규칙 제2조 제10항/u, "T0-76");
  assert.match(delivery.legalText, /법인 또는 매수인 외의 사람이 법인신고서등/u, "T0-76 조문 용어(⑩)");
  assert.match(delivery.legalText, /제공하지 않으면 법인 또는 매수인이 따로 제출/u, "T0-76");

  assert.equal(funding({ priceWon: 300_000_000, regulation: "adjusted" }).applies, true, "T0-77");
  const overheated = funding({ priceWon: 300_000_000, regulation: "overheated" });
  assert.equal(overheated.applies, true, "T0-77");
  assert.match(overheated.notes.join(" "), /증빙 서류/u, "T0-77");

  const corporation = funding({ priceWon: 100_000_000, buyerType: "corporation" });
  assert.equal(corporation.applies, true, "T0-78");
  assert.match(corporation.notes.join(" "), /법인 주택 거래계약 신고서/u, "T0-78");

  const permit = funding({ priceWon: 300_000_000, landPermitArea: true });
  assert.equal(permit.applies, true, "T0-79");
  assert.match(permit.notes.join(" "), /증빙 서류/u, "T0-79");

  const land = (priceWon, extra = {}) => funding({ target: "land", capitalAreaEtc: true, priceWon, ...extra });
  assert.equal(land(99_999_999).applies, false, "T0-80");
  assert.equal(land(100_000_000).applies, true, "T0-80");
  assert.equal(land(100_000_000).planName, "토지취득자금 조달 및 토지이용계획서", "T0-80");
  assert.equal(land(500_000_000, { capitalAreaEtc: false }).applies, false);
  assert.equal(land(600_000_000, { capitalAreaEtc: false }).applies, true);
  assert.equal(land(10_000_000, { landShare: true }).applies, true, "T0-81");
  assert.equal(land(10_000_000, { landShare: true, capitalAreaEtc: false }).applies, false);
  assert.equal(funding({ target: "land", priceWon: 100_000_000 }).applies, true, "T0-82 수도권등 기본값 켬");

  const separate = okSchedule(sale({ priceWon: 600_000_000, separateFundingSubmission: true }));
  const separateEvent = separate.events.find((event) => event.kind === "fundingPlanSeparate");
  assert.equal(separateEvent?.date, "2026-12-15", "T0-83 +29");
  assert.equal(separateEvent.label, "자금조달계획서 별도 제출", "T0-83");

  assert.equal(funding({ priceWon: 300_000_000, regulation: undefined }).applies, false, "T0-90 기본값 비규제");
  assert.equal(okSchedule({ dealKind: "sale", priceWon: 300_000_000 }).ok, true, "T0-90");
});

test("T0-84 ~ T0-89 주택 임대차 신고 대상 판정과 문구", () => {
  const lease = (input) => screenLeaseReport({ target: "housing", reportingRegion: true, ...input }, legalRules);
  assert.equal(lease({ dealKind: "jeonse", depositWon: 60_000_000 }).applies, false, "T0-84");
  assert.equal(lease({ dealKind: "jeonse", depositWon: 60_000_001 }).applies, true, "T0-85");
  assert.equal(lease({ dealKind: "monthly_rent", depositWon: 10_000_000, monthlyRentWon: 300_000 }).applies, false, "T0-86");
  assert.equal(lease({ dealKind: "monthly_rent", depositWon: 10_000_000, monthlyRentWon: 300_001 }).applies, true, "T0-87");
  assert.equal(lease({ dealKind: "jeonse", depositWon: 100_000_000, renewalWithoutChange: true }).applies, false, "T0-88");
  assert.equal(lease({ dealKind: "jeonse", depositWon: 100_000_000, target: "other" }).applies, false);

  const reported = okSchedule({ dealKind: "jeonse", depositWon: 60_000_001 });
  const event = reported.events.find((item) => item.kind === "leaseReport");
  assert.equal(event?.date, "2026-12-15", "T0-85 +29");
  assert.equal(event.label, "당사자 신고 기한(위임받아 대행 가능)", "T0-85");
  assert.match(event.legalText, /임대차계약당사자가 공동으로 신고하고, 한쪽이 국가 등이면 국가 등이 신고한다\(부동산 거래신고 등에 관한 법률 제6조의2 제1항\)/u, "T0-85");
  assert.match(event.legalText, /중개사에게는 신고 의무가 없다\(같은 항\)/u, "T0-85 해석 근거는 제6조의2①");
  assert.match(event.legalText, /대행할 수 있다\(같은 법 시행규칙 제6조의5\)/u, "T0-85 대행 근거는 시행규칙 제6조의5");
  assert.ok(reported.notices.includes(LEASE_MOVE_IN_NOTICE), "T0-89");
  assert.equal(LEASE_MOVE_IN_NOTICE, "임차인이 전입신고를 하면 임대차 신고를 한 것으로 봅니다(법 제6조의5①).", "T0-89");
  const notReported = okSchedule({ dealKind: "jeonse", depositWon: 60_000_000 });
  assert.ok(!kinds(notReported).includes("leaseReport"), "T0-84");
  assert.match(notReported.notices.join("\n"), /신고 대상이 아닙니다/u, "T0-84 대상 아님 이유");
  assert.match(reported.notices.join("\n"), /주택 임대차 신고 대상: 보증금 6,000만 원 초과 또는 월 차임 30만 원 초과/u, "T0-85");
  assert.ok(!okSchedule({ dealKind: "jeonse", target: "land" }).notices.includes(LEASE_MOVE_IN_NOTICE), "토지 임대차에는 전입신고 문구 없음");
});

test("자금조달계획서 판정 결과를 안내 문구로도 보여 준다", () => {
  assert.match(okSchedule(sale({ priceWon: 600_000_000 })).notices.join("\n"), /주택취득자금 조달 및 입주계획서 대상: 주택 실제 거래가격 6억 원 이상/u);
  assert.match(okSchedule(sale({ priceWon: 599_999_999 })).notices.join("\n"), /주택취득자금 조달 및 입주계획서 대상이 아닙니다/u);
  assert.doesNotMatch(okSchedule(sale({ target: "other", priceWon: undefined })).notices.join("\n"), /계획서/u);
});

test("날짜 검증: 없는 날짜·형식 오류·지원 시작일 이전·중도금 순서", () => {
  assert.equal(parseCalendarDate("2027-02-29"), null);
  assert.equal(parseCalendarDate("2026/11/16"), null);
  assert.deepEqual(parseCalendarDate("2028-02-29"), { year: 2028, month: 2, day: 29 });
  assert.equal(schedule(sale({ contractDate: "2027-02-29" })).error.code, "DATE_INVALID");
  assert.equal(schedule(sale({ contractDate: "2022-05-15" })).error.code, "DATE_UNSUPPORTED");
  assert.equal(schedule(sale({ middlePaymentDate: "2026-11-15" })).error.code, "DATE_ORDER_INVALID");
  const withPayments = okSchedule(sale({ middlePaymentDate: "2026-12-01", balanceDate: "2027-01-15", propertyLabel: "가상단지 101동" }));
  assert.deepEqual(kinds(withPayments), ["contract", "middlePayment", "transactionReport", "balance"]);
  assert.equal(withPayments.events.find((item) => item.kind === "transactionReport").title, "거래신고 기한(가상단지 101동)");
  assert.match(todayInKorea(new Date("2026-11-15T15:30:00Z")), /^2026-11-16$/u);
});
