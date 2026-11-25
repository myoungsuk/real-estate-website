// 최근 거래 완료 소식: 꼴 검사·넣는 순간 판정·화면 글·공개 목록(순수 함수)과 빌드 전 검증·관리자 저장 검증 길.
// 단지 이름·숫자는 모두 가상이거나 이미 공개된 단지 이름이다. 서버·D1·외부 서비스를 부르지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  DEAL_NEWS_AREA_BAND,
  DEAL_NEWS_DEAL_TYPES,
  DEAL_NEWS_GUARD,
  DEAL_NEWS_KEYS,
  DEAL_NEWS_PROPERTY_KINDS,
  DEAL_NEWS_PUBLIC_MAX,
  dealNewsAreaText,
  dealNewsLine,
  publicDealNews,
} from "../src/lib/deal-news.mjs";
import {
  DEAL_NEWS_COUNT_MONTHS,
  DEAL_NEWS_MIN_COUNT,
  DEAL_NEWS_UMD_NAMES,
  DEAL_NEWS_WAIT_DAYS,
  appendDealNews,
  buildDealNewsItem,
  dealNewsAreaBand,
  dealNewsCountWindow,
  dealNewsNameProblem,
  dealNewsPublishableFrom,
  dealNewsToday,
  judgeDealNews,
  judgeDealNewsName,
  newDealNewsId,
  validateDealNews,
} from "../src/lib/admin-deal-news.mjs";
import { DONE_DEAL_TYPES, DONE_GUARD, DONE_LIMITS, areaBandText, buildDoneNotice } from "../src/lib/work/promo-paper.mjs";
import { findUnexpectedKeys, validateContent } from "../scripts/content-validation.mjs";
import { planIndexNowUrls } from "../scripts/indexnow.mjs";
import { ADMIN_RESOURCE_PATHS } from "../src/lib/admin-resource-digest.mjs";
import { createAdminContentDiff } from "../src/lib/admin-content-diff.mjs";
import { ADMIN_RESOURCE_CONTENT_KEYS, getAdminResourcePath, validateAdminResource } from "../worker/admin-resource-validation.mjs";
import { handleAdminApi } from "../worker/admin-api.mjs";
import { createCsrfToken } from "../worker/admin-security.mjs";

const hex = (index) => `dn-${String(index).padStart(16, "0")}`;
const complexItem = (index = 1, extra = {}) => ({
  id: hex(index), status: "published", placeKind: "complex", umdName: "천동", complexName: "리더스시티 4블록", propertyKind: "apartment", dealType: "sale", areaBand: 84, ...extra,
});
const areaItem = (index = 2, extra = {}) => ({
  id: hex(index), status: "published", placeKind: "area", umdName: "천동", propertyKind: "villa", dealType: "jeonse", areaBand: 59, ...extra,
});
const errorsOf = (items) => validateDealNews(items).join("\n");

// ── 저장 자료 ──

test("거래 완료 소식 JSON은 처음에 0건이고(가짜 샘플 없음) 맨 배열이다", async () => {
  const data = JSON.parse(await readFile(new URL("../src/data/deal-news.json", import.meta.url), "utf8"));
  assert.deepEqual(data, []);
  assert.deepEqual(publicDealNews(data), [], "0건이면 홈 칸을 그리지 않음");
});

test("칸은 8개뿐이고 금액·동·층·호수·날짜·손님 칸은 목록에 없다", () => {
  assert.deepEqual([...DEAL_NEWS_KEYS], ["id", "status", "placeKind", "umdName", "complexName", "propertyKind", "dealType", "areaBand"]);
  assert.equal(DEAL_NEWS_KEYS.some((key) => /price|amount|won|deposit|rent|floor|dong|unit|date|At$|customer|client|owner|memo|note|count/iu.test(key)), false);
});

// ── 꼴 검사 ──

test("꼴 검사: 단지 이름 소식·동네 이름 소식·초안은 통과한다", () => {
  assert.deepEqual(validateDealNews([]), []);
  assert.deepEqual(validateDealNews([complexItem(1), areaItem(2), areaItem(3, { status: "draft", propertyKind: "apartment" })]), []);
  assert.deepEqual(validateDealNews([complexItem(1, { complexName: "신흥 SK뷰" }), complexItem(2, { complexName: "은어송마을 2단지" }), complexItem(3, { complexName: "천동 위드힐 1단지" })]), []);
});

test("꼴 검사: 허용 칸 밖의 키는 어떤 이름이든 거절한다(금액·동·층·호수·날짜·손님 칸을 만들 수 없음)", () => {
  for (const key of ["price", "priceWon", "amountMan", "depositWon", "monthlyRent", "floor", "dong", "aptDong", "unit", "date", "contractDate", "publishedAt", "createdAt", "customer", "customerName", "memo", "recentCount", "balancePaid", "aptSeq", "tradeKey"]) {
    const errors = errorsOf([complexItem(1, { [key]: "x" })]);
    assert.match(errors, new RegExp(`dealNews\\[0\\]\\.${key}: 허용되지 않은 칸`, "u"), key);
  }
  // 빌드 전 검증의 허용 키 검사도 같은 목록을 쓴다.
  assert.deepEqual(findUnexpectedKeys("dealNews", [complexItem(1)]), []);
  assert.match(findUnexpectedKeys("dealNews", [areaItem(1, { priceWon: 1 })]).join("\n"), /dealNews\[0\]\.priceWon: 허용되지 않은 필드/u);
});

test("꼴 검사: 배열이 아니거나 항목이 객체가 아니면 거절한다", () => {
  for (const value of [undefined, null, {}, "x", { items: [] }]) assert.deepEqual(validateDealNews(value), ["dealNews: 배열이어야 합니다."]);
  for (const item of [null, "글", 3, []]) assert.match(errorsOf([item]), /dealNews\[0\]: 소식 하나는 객체/u);
});

test("꼴 검사: id는 'dn-' + 16진수 16자만(UUID·시각 꼴을 넣을 수 없음), 중복 거절", () => {
  for (const id of [undefined, "", "dn-1", "DN-0000000000000001", "dn-000000000000000g", "dn-00000000000000001", "0f8fad5b-d9cb-469f-a165-70867728950e", "20261125-153000", "deal-1"]) {
    assert.match(errorsOf([complexItem(1, { id })]), /dealNews\[0\]\.id: 'dn-'/u, String(id));
  }
  assert.match(errorsOf([complexItem(1), areaItem(1)]), /dealNews\[1\]\.id: 중복 ID/u);
});

test("꼴 검사: 상태·자리 종류·건물 종류·거래 종류는 정해 둔 값만", () => {
  assert.match(errorsOf([complexItem(1, { status: "ended" })]), /status: draft 또는 published/u);
  assert.match(errorsOf([complexItem(1, { status: undefined })]), /status:/u);
  assert.match(errorsOf([complexItem(1, { placeKind: "neighborhood" })]), /placeKind: complex 또는 area/u);
  assert.match(errorsOf([areaItem(1, { propertyKind: "land" })]), /propertyKind:/u);
  assert.match(errorsOf([areaItem(1, { propertyKind: "아파트" })]), /propertyKind:/u);
  assert.match(errorsOf([areaItem(1, { dealType: "presale" })]), /dealType:/u);
  assert.match(errorsOf([areaItem(1, { dealType: "매매" })]), /dealType:/u);
});

test("꼴 검사: 동네는 대전 동구 법정동 45개 중 하나만", () => {
  assert.equal(DEAL_NEWS_UMD_NAMES.length, 45);
  for (const umdName of ["천동", "신흥동", "판암동", "가오동", "효평동"]) assert.deepEqual(validateDealNews([areaItem(1, { umdName })]), [], umdName);
  // 둔산동(서구)·은행동(중구)·봉명동(유성구)·'천동 3구역'(자유 글)·빈 값
  for (const umdName of ["둔산동", "은행동", "봉명동", "천동 3구역", "대전 동구", "", undefined, 3]) {
    assert.match(errorsOf([areaItem(1, { umdName })]), /umdName: 대전 동구 법정동/u, String(umdName));
  }
});

test("꼴 검사: 전용면적대는 10 ~ 400 사이 정수만(소수·글자·범위 밖 거절)", () => {
  for (const areaBand of [DEAL_NEWS_AREA_BAND.min, 59, 84, DEAL_NEWS_AREA_BAND.max]) assert.deepEqual(validateDealNews([areaItem(1, { areaBand })]), [], String(areaBand));
  for (const areaBand of [9, 401, 84.97, "84", null, undefined, Number.NaN]) assert.match(errorsOf([areaItem(1, { areaBand })]), /areaBand: 10 ~ 400/u, String(areaBand));
});

test("꼴 검사: 단지 이름은 아파트에만, 동네 이름 소식에는 단지 이름 칸 자체를 둘 수 없다", () => {
  for (const propertyKind of ["villa", "officetel", "house", "shop"]) {
    assert.match(errorsOf([complexItem(1, { propertyKind })]), /placeKind: 단지 이름은 아파트 거래에만/u, propertyKind);
  }
  assert.match(errorsOf([complexItem(1, { complexName: undefined })]), /complexName: 단지 이름이 필요/u);
  assert.match(errorsOf([complexItem(1, { complexName: "" })]), /complexName: 단지 이름이 필요/u);
  for (const complexName of ["리더스시티 4블록", "", null, undefined]) {
    assert.match(errorsOf([areaItem(1, { complexName })]), /complexName: 동네 이름으로 올리는 소식에는 단지 이름 칸을 두지 않습니다/u, String(complexName));
  }
});

test("꼴 검사: 단지 이름에 동 번호·호수·층·전화·날짜·금액·번호 꼴이 있으면 거절한다", () => {
  const cases = [
    ["리더스시티 4블록 104동", /동 번호·호수·층/u],
    ["리더스시티 4블록 1203호", /동 번호·호수·층/u],
    ["리더스시티 4블록 15층", /동 번호·호수·층/u],
    ["리더스시티 ４블록 １０４동", /동 번호·호수·층/u], // 전각 숫자
    ["신흥 SK뷰 010-1234-5678", /전화번호/u],
    ["신흥 SK뷰 2026년 9월", /날짜/u],
    ["신흥 SK뷰 9월 계약", /날짜/u],
    ["신흥 SK뷰 9/15", /날짜/u],
    ["신흥 SK뷰 3억", /금액/u],
    ["신흥 SK뷰 5.2억", /금액/u],
    ["신흥 SK뷰 삼억", /금액/u],
    ["신흥 SK뷰 2,500만", /금액/u],
    ["신흥 SK뷰 5천만", /금액/u],
    ["신흥 SK뷰 오천만", /금액/u],
    ["신흥 SK뷰 보증금 3천", /금액/u],
    ["신흥 SK뷰 80만원", /금액/u],
    ["신흥 SK뷰 104-1203", /세 자리 이상 숫자나 숫자-숫자/u],
    ["신흥 SK뷰 1203", /세 자리 이상 숫자/u],
    ["신흥 SK뷰 4-12", /숫자-숫자/u],
    ["신흥 SK뷰 32,000", /세 자리 이상 숫자|숫자-숫자/u],
    [" 신흥 SK뷰", /공백/u],
    ["신흥  SK뷰", /공백/u],
    ["신흥 SK뷰\n104", /보이지 않는 글자/u],
    ["신흥 SK뷰 104​동", /보이지 않는 글자/u],
    ["가".repeat(31), /30자까지/u],
  ];
  for (const [complexName, pattern] of cases) {
    assert.match(String(dealNewsNameProblem(complexName)), pattern, complexName);
    assert.match(errorsOf([complexItem(1, { complexName })]), /dealNews\[0\]\.complexName:/u, complexName);
  }
  // 흔한 단지 이름은 걸리지 않는다(천동·천년·원동·단지 번호·블록·차).
  for (const complexName of ["리더스시티 5블록", "천동 위드힐 2단지", "판암 천년나무 3단지", "원동 센트럴 2차", "e편한세상 대전에코포레", "가".repeat(30)]) {
    assert.equal(dealNewsNameProblem(complexName), null, complexName);
  }
});

test("꼴 검사: published는 5건까지, 초안은 세지 않는다", () => {
  const five = [1, 2, 3, 4, 5].map((index) => areaItem(index));
  assert.equal(DEAL_NEWS_PUBLIC_MAX, 5);
  assert.deepEqual(validateDealNews([...five, areaItem(6, { status: "draft" })]), []);
  assert.match(errorsOf([...five, areaItem(6)]), /dealNews: 공개\(published\)는 5건까지/u);
});

// ── 날짜 계산·판정 ──

test("60일 경계: 계약일에서 딱 60일째 날은 올릴 수 없고 61일째 날부터 올릴 수 있다", () => {
  assert.equal(DEAL_NEWS_WAIT_DAYS, 60);
  assert.equal(dealNewsPublishableFrom("2026-09-01"), "2026-11-01"); // 9월 30일 + 10월 31일 = 61일
  const base = { propertyKind: "apartment", dealType: "jeonse", contractDate: "2026-09-01", balancePaid: true, recentCount: 5 };
  const day59 = judgeDealNews({ ...base, today: "2026-10-30" });
  const day60 = judgeDealNews({ ...base, today: "2026-10-31" });
  const day61 = judgeDealNews({ ...base, today: "2026-11-01" });
  assert.deepEqual([day59.canPublish, day60.canPublish, day61.canPublish], [false, false, true]);
  assert.deepEqual(day60.blockers.map((entry) => entry.code), ["WAIT_DAYS"]);
  assert.match(day60.blockers[0].message, /계약일에서 60일이 지난 뒤/u);
  assert.equal(day60.publishableFrom, "2026-11-01");
  // 해·윤달을 넘는 경계
  assert.equal(dealNewsPublishableFrom("2027-12-31"), "2028-03-01"); // 2028년 2월은 29일
  assert.equal(dealNewsPublishableFrom("2026-12-31"), "2027-03-02");
  assert.equal(dealNewsPublishableFrom("2026-02-30"), null, "없는 날짜");
});

test("판정: 잔금이 끝나지 않았으면 60일이 지나도 올릴 수 없다", () => {
  const base = { propertyKind: "apartment", dealType: "monthly-rent", contractDate: "2026-01-10", today: "2026-11-25", recentCount: 3 };
  assert.equal(judgeDealNews({ ...base, balancePaid: true }).canPublish, true);
  for (const balancePaid of [false, undefined, null, "true", 1]) {
    const result = judgeDealNews({ ...base, balancePaid });
    assert.deepEqual([result.canPublish, result.blockers.map((entry) => entry.code)], [false, ["BALANCE_UNPAID"]], String(balancePaid));
  }
});

test("판정: 매매는 '실거래 자료에 올라온 것을 확인함'이 참일 때만 올릴 수 있고, 전세·월세는 그 값을 보지 않는다", () => {
  const base = { propertyKind: "apartment", contractDate: "2026-01-10", today: "2026-11-25", balancePaid: true, recentCount: 4 };
  assert.equal(judgeDealNews({ ...base, dealType: "sale", saleSeenInData: true }).canPublish, true);
  for (const saleSeenInData of [false, undefined, null, "true", 1]) {
    const result = judgeDealNews({ ...base, dealType: "sale", saleSeenInData });
    assert.deepEqual([result.canPublish, result.blockers.map((entry) => entry.code)], [false, ["SALE_NOT_SEEN"]], String(saleSeenInData));
    assert.match(result.blockers[0].message, /실거래 자료에 이 거래가 올라온 것을 확인/u);
  }
  for (const dealType of ["jeonse", "monthly-rent"]) {
    assert.equal(judgeDealNews({ ...base, dealType, saleSeenInData: false }).canPublish, true, dealType);
    assert.equal(judgeDealNews({ ...base, dealType }).canPublish, true, dealType);
  }
});

test("판정: 날짜가 틀리거나 계약일이 오늘보다 뒤이면 올릴 수 없고, 까닭은 한꺼번에 모두 돌려준다", () => {
  const base = { propertyKind: "apartment", dealType: "jeonse", balancePaid: true, recentCount: 3 };
  assert.deepEqual(judgeDealNews({ ...base, contractDate: "2026-13-01", today: "2026-11-25" }).blockers.map((entry) => entry.code), ["DATE_INVALID"]);
  assert.deepEqual(judgeDealNews({ ...base, contractDate: "2026.09.01", today: "2026-11-25" }).blockers.map((entry) => entry.code), ["DATE_INVALID"]);
  assert.deepEqual(judgeDealNews({ ...base, contractDate: "2026-09-01", today: undefined }).blockers.map((entry) => entry.code), ["DATE_INVALID"]);
  assert.deepEqual(judgeDealNews({ ...base, contractDate: "2026-11-26", today: "2026-11-25" }).blockers.map((entry) => entry.code), ["DATE_FUTURE"]);
  const many = judgeDealNews({ propertyKind: "land", dealType: "sale", contractDate: "2026-11-20", today: "2026-11-25" });
  assert.deepEqual(many.blockers.map((entry) => entry.code), ["PROPERTY_KIND", "WAIT_DAYS", "BALANCE_UNPAID", "SALE_NOT_SEEN"]);
  assert.equal(judgeDealNews().canPublish, false, "입력이 없으면 올릴 수 없음");
});

test("단지 이름 판정: 아파트이고 최근 6개월 3건 이상일 때만 단지 이름, 2건이면 동네 이름", () => {
  assert.deepEqual([DEAL_NEWS_COUNT_MONTHS, DEAL_NEWS_MIN_COUNT], [6, 3]);
  const two = judgeDealNewsName({ propertyKind: "apartment", recentCount: 2 });
  const three = judgeDealNewsName({ propertyKind: "apartment", recentCount: 3 });
  assert.deepEqual([two.canUse, two.code], [false, "COUNT_LOW"]);
  assert.deepEqual([three.canUse, three.code], [true, "COUNT_OK"]);
  assert.equal(two.message, "최근 6개월 동안 같은 단지·같은 전용면적대·같은 거래 종류가 2건입니다. 3건보다 적어 동네 이름으로 올립니다.");
  assert.equal(three.message, "최근 6개월 동안 같은 단지·같은 전용면적대·같은 거래 종류가 3건입니다. 3건 이상이라 단지 이름을 쓸 수 있습니다.");
  assert.doesNotMatch(`${two.message}${three.message}`, /60일/u, "건수 셈에는 60일을 빼는 말이 없음");
  assert.equal(judgeDealNewsName({ propertyKind: "apartment", recentCount: 0 }).canUse, false);
  // 건수를 모르면(API를 못 불렀거나 값이 이상하면) 쓸 수 없다.
  for (const recentCount of [null, undefined, "3", 3.5, -1, Number.NaN]) {
    assert.deepEqual([judgeDealNewsName({ propertyKind: "apartment", recentCount }).code], ["COUNT_UNKNOWN"], String(recentCount));
  }
  // 아파트가 아니면 건수가 많아도 늘 동네 이름.
  for (const propertyKind of ["villa", "officetel", "house", "shop"]) {
    assert.deepEqual([judgeDealNewsName({ propertyKind, recentCount: 99 }).code], ["NOT_APARTMENT"], propertyKind);
  }
  const judged = judgeDealNews({ propertyKind: "apartment", dealType: "jeonse", contractDate: "2026-01-10", today: "2026-11-25", balancePaid: true, recentCount: 2 });
  assert.deepEqual([judged.canPublish, judged.placeKind, judged.canUseComplexName, judged.name.code], [true, "area", false, "COUNT_LOW"], "건수가 모자라도 동네 이름으로는 올릴 수 있음");
  assert.equal(judgeDealNews({ propertyKind: "apartment", dealType: "jeonse", contractDate: "2026-01-10", today: "2026-11-25", balancePaid: true, recentCount: 3 }).placeKind, "complex");
});

test("건수 구간: 오늘에서 6개월 전 ~ 오늘(양 끝 포함), 그 달에 같은 날이 없으면 그 달 마지막 날", () => {
  assert.deepEqual(dealNewsCountWindow("2026-11-25"), { from: "2026-05-25", to: "2026-11-25" });
  assert.deepEqual(dealNewsCountWindow("2026-08-31"), { from: "2026-02-28", to: "2026-08-31" });
  assert.deepEqual(dealNewsCountWindow("2028-08-31"), { from: "2028-02-29", to: "2028-08-31" }, "윤년");
  assert.deepEqual(dealNewsCountWindow("2026-03-15"), { from: "2025-09-15", to: "2026-03-15" }, "해를 넘김");
  assert.equal(dealNewsCountWindow("2026-02-30"), null);
  assert.equal(dealNewsToday(Date.parse("2026-11-24T15:00:00.000Z")), "2026-11-25", "한국 시각 자정");
  assert.equal(dealNewsToday(Date.parse("2026-11-24T14:59:59.999Z")), "2026-11-24");
});

// ── 화면 글·공개 목록 ──

test("화면 글: 단지 이름 소식과 동네 이름 소식의 한 줄, 금액·날짜·동·층이 없다", () => {
  assert.deepEqual(dealNewsLine(complexItem(1)), { place: "리더스시티 4블록", area: "전용 84㎡대", deal: "매매", text: "리더스시티 4블록 · 전용 84㎡대 · 매매" });
  assert.equal(dealNewsLine(areaItem(1, { propertyKind: "apartment", dealType: "sale", areaBand: 84 })).text, "천동 아파트 · 전용 84㎡대 · 매매");
  assert.equal(dealNewsLine(areaItem(1)).text, "천동 빌라 · 전용 59㎡대 · 전세");
  assert.equal(dealNewsLine(areaItem(1, { umdName: "신흥동", propertyKind: "officetel", dealType: "monthly-rent", areaBand: 33 })).text, "신흥동 오피스텔 · 전용 33㎡대 · 월세");
  assert.deepEqual(DEAL_NEWS_PROPERTY_KINDS.map((entry) => entry.label), ["아파트", "빌라", "오피스텔", "주택", "상가"]);
});

test("화면 글·면적 계산은 홍보 종이(거래 완료 알림)와 같은 값을 쓴다", () => {
  assert.deepEqual(DEAL_NEWS_DEAL_TYPES.map((entry) => ({ ...entry })), DONE_DEAL_TYPES.map((entry) => ({ ...entry })));
  assert.equal(DEAL_NEWS_GUARD, DONE_GUARD);
  assert.deepEqual([DEAL_NEWS_AREA_BAND.min, DEAL_NEWS_AREA_BAND.max], [DONE_LIMITS.areaMin, DONE_LIMITS.areaMax]);
  for (const input of ["84.97", "59", "10", "400", "135.5"]) {
    assert.equal(dealNewsAreaText(dealNewsAreaBand(input)), areaBandText(input), input);
  }
  assert.equal(dealNewsAreaBand("84.97"), 84);
  for (const input of ["9.99", "400.01", "84.975", "abc", "", undefined]) assert.equal(dealNewsAreaBand(input), null, String(input));
  // 홍보 종이가 막는 단지 이름은 소식에서도 막힌다(같은 정규식).
  const office = { legalName: "가상공인중개사사무소", address: "대전광역시 동구 가상로 1", mobile: "010-0000-0000", representative: "홍길동", registrationNumber: "00000-0000-00000" };
  for (const name of ["리더스시티 104동", "리더스시티 1203호", "리더스시티 3층", "리더스시티 010-1234-5678"]) {
    assert.equal(buildDoneNotice({ complexName: name, dealType: "sale", areaM2: "84.97" }, office).error?.code, "NAME", name);
    assert.notEqual(dealNewsNameProblem(name), null, name);
  }
  assert.equal(buildDoneNotice({ complexName: "리더스시티 4블록", dealType: "sale", areaM2: "84.97" }, office).ok, true);
});

test("공개 목록: published만, 새 것(배열 끝)부터, 최대 5건이고 상태 칸은 싣지 않는다", () => {
  const items = [areaItem(1), areaItem(2, { status: "draft" }), complexItem(3), areaItem(4), areaItem(5), areaItem(6), areaItem(7)];
  const list = publicDealNews(items);
  assert.deepEqual(list.map((entry) => entry.id), [hex(7), hex(6), hex(5), hex(4), hex(3)]);
  assert.deepEqual(Object.keys(list[0]), ["id", "place", "area", "deal", "text"]);
  assert.equal(list[4].text, "리더스시티 4블록 · 전용 84㎡대 · 매매");
  assert.deepEqual(publicDealNews([areaItem(1, { status: "draft" })]), []);
  assert.deepEqual(publicDealNews(undefined), []);
});

test("항목 만들기: 무작위 ID·허용 칸만·여섯째 published를 붙이면 가장 오래된 published를 뺀다", () => {
  const id = newDealNewsId();
  assert.match(id, /^dn-[0-9a-f]{16}$/u);
  assert.notEqual(newDealNewsId(), id);
  assert.equal(newDealNewsId({ getRandomValues: (bytes) => bytes.fill(171) }), "dn-abababababababab");
  const built = buildDealNewsItem({ id, status: "published", placeKind: "area", umdName: "천동", complexName: "리더스시티 4블록", propertyKind: "apartment", dealType: "sale", areaBand: 84, priceWon: 1, contractDate: "2026-09-01" });
  assert.deepEqual(Object.keys(built), ["id", "status", "placeKind", "umdName", "propertyKind", "dealType", "areaBand"], "동네 이름 소식은 단지 이름을 버리고 다른 칸도 담지 않음");
  assert.deepEqual(validateDealNews([built]), []);
  assert.deepEqual(Object.keys(buildDealNewsItem({ ...complexItem(1) })), [...DEAL_NEWS_KEYS]);

  const five = [areaItem(1, { status: "draft" }), areaItem(2), areaItem(3), areaItem(4), areaItem(5), areaItem(6)];
  const added = appendDealNews(five, complexItem(7));
  assert.deepEqual(added.dropped.map((entry) => entry.id), [hex(2)], "초안이 아니라 가장 오래된 published를 뺌");
  assert.deepEqual(added.items.map((entry) => entry.id), [hex(1), hex(3), hex(4), hex(5), hex(6), hex(7)]);
  assert.deepEqual(validateDealNews(added.items), []);
  assert.equal(five.length, 6, "받은 배열은 바꾸지 않음");
  assert.deepEqual(appendDealNews(five, areaItem(8, { status: "draft" })).dropped, []);
});

// ── 빌드 전 검증·관리자 저장 검증 길 ──

const readResources = async () => Object.fromEntries(await Promise.all(Object.entries(ADMIN_RESOURCE_PATHS).map(async ([resource, path]) => [
  resource, JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8")),
])));
const contentOf = (resources) => Object.fromEntries(Object.entries(ADMIN_RESOURCE_CONTENT_KEYS).map(([resource, key]) => [key, resources[resource]]));

test("빌드 전 검증: 지금 자료는 통과하고, 거래 완료 소식의 틀린 꼴·금지 칸·민감 문자열은 빌드를 막는다", async () => {
  const resources = await readResources();
  assert.deepEqual(validateContent(contentOf(resources)), []);
  assert.deepEqual(validateContent({ ...contentOf(resources), dealNews: [complexItem(1), areaItem(2)] }), []);
  assert.match(validateContent({ ...contentOf(resources), dealNews: undefined }).join("\n"), /dealNews: 배열이어야 합니다/u, "파일이 빠지면 빌드를 막음");
  const errors = validateContent({ ...contentOf(resources), dealNews: [complexItem(1, { complexName: "신흥 SK뷰 104동", priceWon: 300_000_000, clientPhone: "010-1111-2222" })] }).join("\n");
  assert.match(errors, /dealNews\[0\]\.complexName: 단지 이름에는 동 번호·호수·층/u);
  assert.match(errors, /dealNews\[0\]\.priceWon: 허용되지 않은 필드/u);
  assert.match(errors, /dealNews\[0\]\.clientPhone: 공개 저장 금지 필드/u);
  assert.match(errors, /dealNews\[0\]\.clientPhone: 공개 승인되지 않은 휴대전화번호/u);
});

test("관리자 저장 검증: 자원 이름 deal-news가 허용 경로에 있고, 단건·전체 교차 검증 모두 같은 꼴 검사를 쓴다", async () => {
  const resources = await readResources();
  assert.equal(getAdminResourcePath("deal-news"), "src/data/deal-news.json");
  assert.equal(ADMIN_RESOURCE_CONTENT_KEYS["deal-news"], "dealNews");
  const good = [complexItem(1), areaItem(2)];
  assert.deepEqual(validateAdminResource("deal-news", good), []);
  assert.deepEqual(validateAdminResource("deal-news", good, resources), []);
  for (const current of [null, resources]) {
    const errors = validateAdminResource("deal-news", [areaItem(1, { umdName: "둔산동", contractDate: "2026-09-01", unitNumber: "1203" })], current).join("\n");
    assert.match(errors, /umdName: 대전 동구 법정동/u);
    assert.match(errors, /contractDate: 허용되지 않은/u);
    assert.match(errors, /unitNumber: 공개 저장 금지 필드/u);
  }
  // 다른 자원을 저장할 때도 지금 거래 완료 소식을 함께 본다(전체 교차 검증).
  assert.deepEqual(validateAdminResource("faq", resources.faq, resources), []);
  assert.match(validateAdminResource("faq", resources.faq, { ...resources, "deal-news": [areaItem(1, { areaBand: 5 })] }).join("\n"), /dealNews\[0\]\.areaBand/u);
});

test("관리자 저장 검증 API: 틀린 거래 완료 소식은 422로 거절하고 GitHub에 쓰지 않으며, 맞는 소식은 통과한다", async () => {
  const resources = await readResources();
  const snapshot = {
    baseCommitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
    resources: Object.fromEntries(Object.entries(resources).map(([resource, data]) => [resource, { resource, sha: `${resource}-sha`, data: structuredClone(data) }])),
  };
  const env = {
    CF_ACCESS_TEAM_DOMAIN: "https://leaderscityhappy.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-audience",
    ADMIN_ALLOWED_EMAILS: "owner@example.com",
    ADMIN_WRITE_ENABLED: "true",
    ADMIN_CSRF_SECRET: "12345678901234567890123456789012",
    GITHUB_CONTENTS_TOKEN: "test-token",
    GITHUB_REPOSITORY: "owner/repository",
    GITHUB_BRANCH: "master",
  };
  const csrfToken = await createCsrfToken("owner@example.com", env.ADMIN_CSRF_SECRET);
  let writes = 0;
  const call = async (path, method, body) => {
    const response = await handleAdminApi(
      new Request(`https://leaderscityhappy.com/api/admin/v1/${path}`, {
        method,
        headers: { Origin: "https://leaderscityhappy.com", "Content-Type": "application/json", "X-Admin-CSRF": csrfToken },
        body: JSON.stringify(body),
      }),
      env,
      {
        authenticate: async () => ({ email: "owner@example.com", subject: "subject-1" }),
        readResourcesSnapshot: async () => snapshot,
        writeResource: async () => { writes += 1; return { commitSha: "c".repeat(40) }; },
        writeResources: async () => { writes += 1; return { commitSha: "c".repeat(40) }; },
        auditLog: () => {},
      },
    );
    return { status: response.status, json: await response.json() };
  };
  const bad = [complexItem(1, { complexName: "신흥 SK뷰 3억", floor: 15 })];
  const validated = await call("content/validate", "POST", { changes: [{ resource: "deal-news", sha: "deal-news-sha", data: bad }] });
  assert.deepEqual([validated.status, validated.json.error.code], [422, "CONTENT_VALIDATION_FAILED"]);
  assert.match(validated.json.error.details.join("\n"), /complexName: 단지 이름에는 금액/u);
  assert.match(validated.json.error.details.join("\n"), /floor: 허용되지 않은/u);
  const saved = await call("content/deal-news", "PUT", { sha: "deal-news-sha", data: bad });
  assert.deepEqual([saved.status, saved.json.error.code], [422, "CONTENT_VALIDATION_FAILED"]);
  assert.equal(writes, 0, "거절한 저장은 GitHub 쓰기를 부르지 않음");

  const good = [areaItem(1)];
  const ok = await call("content/validate", "POST", { changes: [{ resource: "deal-news", sha: "deal-news-sha", data: good }] });
  assert.deepEqual([ok.status, ok.json.data.valid, ok.json.data.changedResources], [200, true, ["deal-news"]]);
  assert.equal((await call("content/deal-news", "PUT", { sha: "deal-news-sha", data: good })).status, 200);
  assert.equal(writes, 1);
});

test("변경 미리보기·IndexNow: 거래 완료 소식은 이름표가 붙고, 바뀌면 홈 한 곳만 알린다", () => {
  const before = [areaItem(1, { status: "draft" })];
  const diff = createAdminContentDiff("deal-news", before, [areaItem(1), complexItem(2)]);
  assert.deepEqual(diff.map((entry) => [entry.label, entry.kind]), [["거래 완료 소식 · 공개 상태", "changed"], ["거래 완료 소식 · 소식 한 건", "added"]]);
  const changed = createAdminContentDiff("deal-news", [complexItem(1)], [complexItem(1, { complexName: "신흥 SK뷰", areaBand: 59, dealType: "jeonse", umdName: "신흥동" })]);
  assert.deepEqual(changed.map((entry) => entry.label).sort(), ["거래 완료 소식 · 거래 종류", "거래 완료 소식 · 단지 이름", "거래 완료 소식 · 동네", "거래 완료 소식 · 전용면적대(㎡)"]);
  const sitemapUrls = ["https://leaderscityhappy.com/", "https://leaderscityhappy.com/faq/", "https://leaderscityhappy.com/properties/"];
  assert.deepEqual(planIndexNowUrls(["src/data/deal-news.json"], sitemapUrls), ["https://leaderscityhappy.com/"]);
  assert.deepEqual(planIndexNowUrls(["src/lib/admin-deal-news.mjs"], sitemapUrls), [], "검사·판정 모듈은 관리자 전용 경로");
});
