// 글 초안(P3) 순수 함수 시험: 공개 자료 읽기(blog-sources)·명시사항 블록(ad-disclosure)·입력·결과·글 검사(blog-checks).
// 화면과 Worker가 같은 함수를 쓰므로 여기서 한 번 고정한다. 가짜 소재지 표식 ZZTEST-7F3A만 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import complexes from "../src/data/complexes.json" with { type: "json" };
import listings from "../src/data/listings.json" with { type: "json" };
import office from "../src/data/office.json" with { type: "json" };
import rules from "../src/data/work/ad-disclosure-rules.json" with { type: "json" };
import { buildDisclosure, formatArea, formatManagementFee, formatWon, officeLine } from "../src/lib/work/ad-disclosure.mjs";
import {
  BLOG_RESULT_LIMITS,
  BLOG_STYLES,
  allowedStyles,
  checkBlogDraft,
  extractAllMoney,
  findPersonalPatterns,
  validateBlogInputs,
  validateBlogResult,
  validateEmphasis,
} from "../src/lib/work/blog-checks.mjs";
import {
  COMPLEX_DETAIL_KEYS,
  COMPLEX_DETAILS_MAX_CHARS,
  classifyPropertyType,
  complexDetailTexts,
  findBlogSource,
  listBlogSources,
  readAreaFacts,
  readComplexDetails,
  readFloorFacts,
  readPriceFacts,
} from "../src/lib/work/blog-sources.mjs";

// 네이버 매물은 매일 부동산뱅크 동기화로 바뀌므로(내려간 매물 번호를 박으면 동기화의 npm test가 멈춤) 공개 매물과 같은 꼴의 가상 매물만 쓴다.
const NAVER_FIXTURE = {
  checkedAt: "2026-11-24",
  items: [
    { id: "9900000101", title: "가상단지 202동", propertyType: "아파트", tradeType: "sale", priceLabel: "2억 6,000", areaLabel: "111B㎡ · 전용 84.77B㎡", floorLabel: "2/22층", direction: "남향", summary: "선호동 남향으로 저층이지만 해 잘드는 집입니다", registeredAt: "2026-08-25", source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000101" },
    { id: "9900000102", title: "가상동 일반상가", propertyType: "상가점포", tradeType: "sale", priceLabel: "3억", areaLabel: "계약 45㎡ · 전용 36㎡", floorLabel: "1/1층", direction: null, summary: "냉난방기설치 신축아파트단지내상가 저렴한가격", registeredAt: "2026-08-17", source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000102" },
    { id: "9900000103", title: "가상면 답", propertyType: "토지", tradeType: "sale", priceLabel: "2억", areaLabel: "대지 4027㎡", floorLabel: null, direction: null, summary: "주말 농장으로 사용중, 3필지 같이 매매", registeredAt: "2026-07-27", source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000103" },
    { id: "9900000104", title: "가상분양1단지", propertyType: "아파트분양권", tradeType: "sale", priceLabel: "4억 4,630", areaLabel: "85㎡ · 전용 59㎡", floorLabel: "8/29층", direction: "남서향", summary: "", registeredAt: "2026-10-22", source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000104" },
    { id: "9900000105", title: "가상단지 203동", propertyType: "아파트", tradeType: "monthly-rent", priceLabel: "10,000/140", areaLabel: "113㎡ · 전용 84㎡", floorLabel: "중/33층", direction: "남동향", summary: "", registeredAt: "2026-11-01", source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000105" },
  ],
};
const sources = listBlogSources({ naverListings: NAVER_FIXTURE, listings, complexes, rules });
const source = (type, id) => findBlogSource(sources, type, id);
const APT = source("naver_listing", "9900000101"); // 가상단지 202동 매매 2억 6,000 · 전용 84.77㎡ · 2/22층 · 남향
const SHOP = source("naver_listing", "9900000102"); // 상가점포 매매 3억 · 전용 36㎡ · 1/1층
const LAND = source("naver_listing", "9900000103"); // 토지 매매 2억 · 대지 4027㎡
const PRESALE = source("naver_listing", "9900000104"); // 아파트분양권(고를 수 없음)
const RENT = source("naver_listing", "9900000105"); // 아파트 월세 보증금 1억 · 월 140만 원 · 중/33층
const COMPLEX = source("complex", "leaders-city-5");
const LOCATION = "대전 동구 ZZTEST-7F3A동 999-9";
const fullAptInputs = (extra = {}) => validateBlogInputs({
  location: LOCATION,
  kind: "아파트",
  violation: "none",
  moveIn: { type: "period", month: "2027-01", part: "초순" },
  rooms: 3,
  bathrooms: 2,
  approvalDate: "2016-06-30",
  parking: { basis: "total", value: 1200, actual: 1.1 },
  managementFee: { type: "average", monthlyWon: 180000, included: ["general", "water"] },
  directionBasis: "거실",
  ...extra,
}).inputs;

test("공개 자료 읽기: 만 원 단위 가격·전용/대지 면적·층 표기를 숫자로 읽고, 분양권과 규칙 없는 종류는 이유와 함께 고를 수 없음", () => {
  assert.deepEqual(readPriceFacts("2억 6,000", "sale"), { priceWon: 260_000_000, depositWon: null, monthlyRentWon: null });
  assert.deepEqual(readPriceFacts("1,000/50", "monthly-rent"), { priceWon: null, depositWon: 10_000_000, monthlyRentWon: 500_000 });
  assert.deepEqual(readAreaFacts("111B㎡ · 전용 84.77B㎡").exclusiveM2, 84.77);
  assert.equal(readAreaFacts("대지 4027㎡").landM2, 4027);
  assert.deepEqual(readAreaFacts("대지 330㎡ · 연면적 125㎡"), { exclusiveM2: null, landM2: null, otherAreasM2: [330, 125] }, "단독·다가구는 화면에서 면적을 넣음");
  assert.deepEqual(readFloorFacts("중/15층"), { floor: null, band: "중", totalFloors: 15 });
  assert.deepEqual(readFloorFacts("2/22층"), { floor: 2, band: null, totalFloors: 22 });
  assert.equal(classifyPropertyType("아파트분양권", rules).category, null);
  assert.match(classifyPropertyType("아파트분양권", rules).blockedReason, /분양권/u);
  assert.match(classifyPropertyType("오피스텔", rules).blockedReason, /아직 정하지 않아/u);
  assert.deepEqual([APT.category, APT.facts.priceWon, APT.facts.exclusiveM2, APT.facts.floor, APT.facts.totalFloors, APT.facts.direction], ["multi-family", 260_000_000, 84.77, 2, 22, "남향"]);
  // 매물 목록을 거쳐도 분양권은 까닭과 함께 잠기고(글 초안 API·매물 안내지가 같은 함수를 씀), 월세는 보증금·월세로 읽는다.
  assert.deepEqual([PRESALE.category, PRESALE.facts.propertyType], [null, "아파트분양권"]);
  assert.match(PRESALE.blockedReason, /분양권/u);
  assert.deepEqual([RENT.category, RENT.blockedReason, RENT.facts.depositWon, RENT.facts.monthlyRentWon, RENT.facts.floorBand, RENT.facts.totalFloors], ["multi-family", null, 100_000_000, 1_400_000, "중", 33]);
  assert.deepEqual(sources.filter((item) => item.type === "naver_listing").map((item) => item.id), NAVER_FIXTURE.items.map((item) => item.id), "넣은 가상 매물만, 넣은 순서대로");
  assert.deepEqual(sources.filter((item) => item.type === "complex").map((item) => item.id), ["leaders-city-4", "leaders-city-5", "sinheung-sk-view"], "published 단지만");
  assert.ok(sources.every((item) => item.type !== "listing" || listings.find((entry) => entry.id === item.id)?.status === "published"));
});

test("TK-49 명시사항 블록: 사무소 5항목은 office.json 값 그대로, 공동주택 13칸이 다 차면 빈 칸 0, 하나라도 비면 그 칸 이름", () => {
  const head = officeLine(office);
  for (const value of [office.legalName, office.address, office.mobile, office.registrationNumber, office.representative]) assert.ok(head.includes(value), value);
  const complete = buildDisclosure({ source: APT, inputs: fullAptInputs(), office, rules });
  assert.deepEqual(complete.missing, []);
  assert.deepEqual(complete.items.map((item) => item.key), ["location", "area", "price", "kind", "tradeType", "totalFloors", "approvalDate", "direction", "rooms", "bathrooms", "moveIn", "parking", "managementFee"]);
  assert.match(complete.text, /소재지 대전 동구 ZZTEST-7F3A동 999-9 2층/u);
  assert.match(complete.text, /면적 전용 84\.77㎡ · 가격 매매 2억 6,000만 원 · 종류 아파트 · 거래 형태 매매 · 총 층수 22층 · 사용승인일 2016\. 6\. 30\. · 방향 남향\(거실 기준\)/u);
  assert.match(complete.text, /입주 가능일 2027년 1월 초순 · 주차 총 1,200대\(실제 사용 가능 1\.1대\) · 관리비 월 평균 18만 원\(포함 비목: 일반\(공용\)·수도\)/u);
  assert.doesNotMatch(complete.text, /[0-9]\s*평|평형/u, "평 표기 없음");

  // 방향 기준이 빠지면 방향 기준, 위반 여부가 빠지면 위반 여부, 소재지가 빠지면 소재지.
  assert.deepEqual(buildDisclosure({ source: APT, inputs: fullAptInputs({ directionBasis: undefined }), office, rules }).missing, ["directionBasis"]);
  assert.deepEqual(buildDisclosure({ source: APT, inputs: fullAptInputs({ violation: undefined }), office, rules }).missing, ["violation"]);
  assert.deepEqual(buildDisclosure({ source: APT, inputs: fullAptInputs({ location: undefined }), office, rules }).missing, ["location"]);
  // 위반건축물·미등기 표시.
  assert.match(buildDisclosure({ source: APT, inputs: fullAptInputs({ violation: "violation" }), office, rules }).text, /종류 아파트\(위반건축물\)/u);
  // 의뢰인이 원하지 않을 때만 저·중·고(공동주택), 상가는 숫자 층만.
  assert.match(buildDisclosure({ source: APT, inputs: fullAptInputs({ floorMode: "band", floorBand: "저" }), office, rules }).text, /소재지 대전 동구 ZZTEST-7F3A동 999-9 저층/u);
});

test("TK-49 종류별 규칙: 상가는 방·관리비를 생략할 수 있고 욕실은 (화장실), 토지는 5칸만, 단지 소개 글은 사무소 줄만", () => {
  const shop = buildDisclosure({ source: SHOP, inputs: validateBlogInputs({ location: LOCATION, kind: "제1종 근린생활시설", violation: "none", moveIn: { type: "now" }, bathrooms: 1, approvalDate: "2015-03-02", parking: { basis: "total", value: 30 }, directionBasis: "주된 출입구", direction: "남향" }).inputs, office, rules });
  assert.deepEqual(shop.missing, []);
  assert.match(shop.text, /욕실 \(화장실\) 1개/u);
  assert.doesNotMatch(shop.text, /관리비|방 /u);
  const land = buildDisclosure({ source: LAND, inputs: validateBlogInputs({ location: LOCATION, kind: "답" }).inputs, office, rules });
  assert.deepEqual([land.missing, land.items.map((item) => item.key)], [[], ["location", "area", "price", "kind", "tradeType"]]);
  assert.match(land.text, /면적 4,027㎡/u);
  const complex = buildDisclosure({ source: COMPLEX, office, rules });
  assert.deepEqual([complex.kind, complex.missing, complex.text], ["complex", [], officeLine(office)]);
});

test("관리비: 정액 월 10만 원 이상은 비목 8개 금액 또는 '세부내역을 받지 못해 확인 불가', 10만 원 미만 정액·월 평균은 그대로, 비목 없는 10만 원 이상 정액은 빈 칸", () => {
  const items = { general: 50000, electricity: 30000, water: 10000, gas: 10000, heating: 20000, internet: 10000, tv: 10000, other: 10000 };
  assert.match(formatManagementFee({ type: "fixed", monthlyWon: 150000, items }), /^월 15만 원\(정액: 일반\(공용\) 5만 원·전기 3만 원·수도 1만 원/u);
  assert.equal(formatManagementFee({ type: "fixed", monthlyWon: 150000, items: null, itemsUnknown: true }), "월 15만 원(정액, 세부내역을 받지 못해 비목별 금액 확인 불가)");
  assert.equal(formatManagementFee({ type: "fixed", monthlyWon: 90000, items: null, itemsUnknown: false }), "월 9만 원(정액)");
  const incomplete = validateBlogInputs({ managementFee: { type: "fixed", monthlyWon: 150000 } });
  assert.deepEqual([incomplete.errors, incomplete.inputs.managementFee], [[], undefined], "빈 칸으로 남겨 명시사항이 막음");
  assert.deepEqual(validateBlogInputs({ managementFee: { type: "fixed", monthlyWon: 150000, items: { ...items, other: -1 } } }).errors, ["managementFee"]);
  assert.deepEqual(validateBlogInputs({ managementFee: { type: "average", monthlyWon: 100000, included: [] } }).errors, ["managementFee"]);
});

test("금액·면적 표기: formatWon·formatArea와 글 속 금액 읽기(억·만·원·소수 억·붙여 쓴 표기)", () => {
  assert.deepEqual([formatWon(260_000_000), formatWon(1_400_000), formatWon(300_000_000), formatWon(8_500), formatWon(0)], ["2억 6,000만 원", "140만 원", "3억 원", "8,500원", "0원"]);
  assert.deepEqual([formatArea(84.77), formatArea(4027), formatArea(59.4)], ["84.77㎡", "4,027㎡", "59.4㎡"]);
  const won = (text) => extractAllMoney(text).map((item) => item.won);
  assert.deepEqual(won("8억2500만원"), [825_000_000]);
  assert.deepEqual(won("8.25억"), [825_000_000]);
  assert.deepEqual(won("2억 6,000"), [260_000_000], "만이 빠진 꼬리는 만 원 단위(공개 매물 표기)");
  assert.deepEqual(won("관리비 150,000원, 8500원"), [150_000, 8_500]);
});

test("TK-47 개인정보 형식: 주민등록번호·사무소 번호가 아닌 전화번호(띄어쓰기·점·전각 변형 포함)·이메일을 찾고, 소재지 칸은 호수도 막음", () => {
  const officePhone = office.mobile;
  for (const text of ["900101-1234567", "900101 1234567", "010-1234-5678", "010 1234 5678", "010.1234.5678", "01012345678", "０１０-１２３４-５６７８", "042-123-4567", "a.b@example.co.kr"]) {
    assert.ok(findPersonalPatterns(text, { officePhone }).length > 0, text);
  }
  assert.deepEqual(findPersonalPatterns(`사무소 ${officePhone}`, { officePhone }), []);
  assert.deepEqual(findPersonalPatterns("전용 84.77㎡ 2억 6,000만 원 2016-06-30", { officePhone }), [], "매물 숫자는 개인정보가 아님");
  assert.deepEqual(findPersonalPatterns("101호", { officePhone, checkUnit: true }), ["unit"]);
  assert.deepEqual(findPersonalPatterns("1호선 역", { officePhone, checkUnit: true }), [], "호선은 호수가 아님");
  assert.deepEqual(validateBlogInputs({ location: "대전 동구 ZZTEST 1203호" }, { officePhone }).personal, ["location"]);
  assert.equal(validateEmphasis("연락 010-9999-0000", { officePhone }).personal, true);
  assert.equal(validateEmphasis("가".repeat(500)).error, false, "대표 현장 메모는 500자까지(2026-11-23)");
  assert.equal(validateEmphasis("가".repeat(501)).error, true);
  assert.deepEqual(validateBlogInputs({ unit: "101" }).errors, ["unit"], "호수 칸은 받지 않음");
});

test("TK-61 글 성격 7가지와 거래 형태별 허용: 매매에 전세·월세 성격 없음, 단지 소개 글은 담백하게·실거주·투자만", () => {
  assert.deepEqual(BLOG_STYLES.map((style) => style.label), ["담백하게", "급매", "실거주", "전세 안내", "월세", "수익형", "투자"]);
  assert.ok(BLOG_STYLES.every((style) => style.instruction && style.note));
  assert.deepEqual(allowedStyles(APT), ["plain", "urgent", "live", "yield", "invest"]);
  assert.deepEqual(allowedStyles({ type: "naver_listing", facts: { tradeType: "jeonse" } }), ["plain", "live", "jeonse"]);
  assert.deepEqual(allowedStyles({ type: "naver_listing", facts: { tradeType: "monthly-rent" } }), ["plain", "live", "monthly"]);
  assert.deepEqual(allowedStyles(COMPLEX), ["plain", "live", "invest"]);
});

test("TK-51 결과 모양: 키 5개 정확히, 경계값 통과·한 글자 넘으면 실패, 해시태그 앞에 # 하나", () => {
  const base = { title: "제목", paragraphs: ["문단"], hashtags: ["태그", "##둘"], snsShort: "짧은 글", factsUsed: [] };
  assert.deepEqual(validateBlogResult(base).result.hashtags, ["#태그", "#둘"]);
  assert.equal(validateBlogResult({ ...base, title: "가".repeat(60) }).ok, true);
  for (const bad of [{ ...base, title: "가".repeat(61) }, { ...base, title: " " }, { ...base, paragraphs: [] }, { ...base, snsShort: "가".repeat(201) }, { ...base, extra: 1 }, [base], null]) {
    assert.equal(validateBlogResult(bad).ok, false, JSON.stringify(bad)?.slice(0, 40));
  }
});

test("TK-48 숫자 대조: 입력과 다른 금액·면적·층·날짜는 막고, 강조점 숫자는 허용, 저·중·고를 고른 뒤 숫자 층은 막고, 단지 소개 글의 매물 숫자는 막음", () => {
  const inputs = fullAptInputs();
  const draft = (text) => ({ title: "제목", paragraphs: [text], hashtags: [], snsShort: "짧은 글" });
  assert.deepEqual(checkBlogDraft(draft("매매 2억 6,000만 원, 전용 84.77㎡, 2층, 22층 건물, 2016년 6월 30일 사용승인, 관리비 월 18만 원"), { source: APT, inputs }).blocks, []);
  const kinds = (text, options = {}) => checkBlogDraft(draft(text), { source: APT, inputs, ...options }).blocks.map((item) => [item.kind, item.text]);
  assert.deepEqual(kinds("매매 2억 7,000만 원"), [["money", "2억 7,000만 원"]]);
  assert.deepEqual(kinds("2.7억"), [["money", "2.7억"]]);
  assert.deepEqual(kinds("전용 84.7㎡"), [["area", "84.7㎡"]]);
  assert.deepEqual(kinds("15층"), [["floor", "15층"]]);
  assert.deepEqual(kinds("2017년 3월 5일"), [["date", "2017년 3월 5일"]]);
  assert.deepEqual(kinds("2억 5,000만 원까지 조정"), [["money", "2억 5,000만 원"]]);
  assert.deepEqual(kinds("2억 5,000만 원까지 조정", { emphasis: "2억 5,000만 원까지 조정 가능" }), [], "강조점에 쓴 숫자는 허용");
  const band = fullAptInputs({ floorMode: "band", floorBand: "고" });
  assert.deepEqual(checkBlogDraft(draft("2층입니다"), { source: APT, inputs: band }).blocks.map((item) => item.kind), ["floor"], "저·중·고를 고른 뒤 숫자 층");
  const complexBlocks = checkBlogDraft(draft("매매 3억 원, 5층"), { source: COMPLEX }).blocks.map((item) => item.kind);
  assert.deepEqual(complexBlocks, ["complex_number", "complex_number"]);
});

test("TK-48 숫자 대조 보강(TR-11 #87): 천·백 표기·전각 숫자·해시태그도 대조하고, '천동' 같은 땅 이름은 숫자로 읽지 않음", () => {
  const inputs = fullAptInputs();
  const draft = (text, hashtags = []) => ({ title: "제목", paragraphs: [text], hashtags, snsShort: "짧은 글" });
  const kinds = (text, hashtags) => checkBlogDraft(draft(text, hashtags), { source: APT, inputs }).blocks.map((item) => [item.kind, item.where]);
  assert.deepEqual(extractAllMoney("보증금 5천만 원"), [], "검사 밖 함수 자체는 그대로(풀기는 검사 앞에서)");
  assert.deepEqual(kinds("보증금 5천만 원"), [["money", "p1"]], "5천만 원 = 5,000만 원");
  assert.deepEqual(kinds("1억 5천만 원"), [["money", "p1"]], "1억 5천만 원 = 1억 5,000만 원");
  assert.deepEqual(kinds("3천5백만 원"), [["money", "p1"]]);
  assert.deepEqual(kinds("２억 ７,０００만 원"), [["money", "p1"]], "전각 숫자");
  assert.deepEqual(kinds("２억 ６,０００만 원"), [], "전각이라도 입력과 같으면 통과");
  assert.deepEqual(kinds("2억 6천만 원"), [], "천 표기라도 입력과 같으면 통과");
  assert.deepEqual(kinds("전용 84.77㎡ 천동 매물"), [], "천동은 숫자가 아님");
  assert.deepEqual(kinds("본문", ["#3억대", "#천동"]), [["money", "tags"]], "해시태그 금액");
  assert.deepEqual(kinds("본문", ["#15층"]), [["floor", "tags"]], "해시태그 층");
});

test("개인정보 형식 보강(TR-11 #87): 괄호·줄표로 쓴 휴대폰 번호도 잡음", () => {
  for (const text of ["(010)1234-5678", "010–1234–5678", "010—1234—5678", "010‐1234‐5678"]) {
    assert.deepEqual(findPersonalPatterns(text), ["phone"], text);
  }
  assert.deepEqual(findPersonalPatterns("전용 84.77㎡ 2억 6,000만 원"), []);
});

test("경고: 평 표기·입력에 없는 생활 편의·역 이름·도보 N분·직선거리·후기·가상 인물·보장 표현(급매·수익형·투자 결정 ④), 입력에 있는 낱말·지역 같은 낱말은 경고하지 않음", () => {
  const draft = (text) => ({ title: "제목", paragraphs: [text], hashtags: [], snsShort: "짧은 글" });
  const warn = (text) => checkBlogDraft(draft(text), { source: APT, inputs: fullAptInputs() }).warnings.map((item) => item.kind);
  assert.deepEqual(warn("34평형"), ["pyeong"]);
  assert.deepEqual(warn("초등학교와 마트가 가깝습니다"), ["amenity"]);
  assert.deepEqual(warn("대동역까지 도보 5분"), ["amenity"]);
  assert.deepEqual(warn("직선거리 300m"), ["distance"]);
  assert.deepEqual(warn("실제 입주민 후기"), ["review"]);
  assert.deepEqual(warn("김민수 씨는 만족합니다"), ["persona"]);
  for (const text of ["시세 상승 보장", "무조건 오릅니다", "확실한 시세차익", "손해 없는 투자"]) assert.ok(warn(text).includes("hype"), text);
  assert.deepEqual(warn("대전 동구 지역의 남향 아파트"), []);
  assert.deepEqual(checkBlogDraft(draft("마트가 가깝습니다"), { source: APT, inputs: fullAptInputs(), emphasis: "마트 가까움" }).warnings, [], "강조점에 쓴 낱말");
});

test("빌드 전 검사 validateAdDisclosureRules: 지금 규칙은 통과하고, 기본 5칸 빠짐·모르는 칸·겹친 종류·사무소 항목 바뀜·막을 이유 없음은 멈춤", async () => {
  const { validateAdDisclosureRules } = await import("../scripts/content-validation.mjs");
  assert.deepEqual(validateAdDisclosureRules(rules), []);
  const copy = () => structuredClone(rules);
  const broken = [
    (value) => { value.categories[0].required = value.categories[0].required.filter((field) => field !== "location"); },
    (value) => { value.categories[2].optional.push("unitNumber"); },
    (value) => { value.categories[1].propertyTypes.push("아파트"); },
    (value) => { value.officeFields = ["name", "address", "phone", "registrationNumber"]; },
    (value) => { value.blockedPropertyTypes[0].reason = ""; },
    (value) => { value.blockedPropertyTypes.push({ propertyType: "토지", reason: "이유" }); },
    (value) => { value.categories[0].directionBasisChoices = []; },
    (value) => { value.checkedAt = "2026-02-30"; },
    (value) => { value.sources = []; },
  ];
  for (const change of broken) {
    const value = copy();
    change(value);
    assert.ok(validateAdDisclosureRules(value).length > 0, change.toString().slice(0, 80));
  }
});

// ── 2026-11-23 글 초안 개선: 단지 자료 다 넣기 · 길이·구성(소제목·현장에서 확인할 점) · 대표 현장 메모 500자 ──

test("단지 자료: 단지 글 자료에 7개 항목을 글자 칸만 담고, 출처·검색 설정·사진·별칭·관련 콘텐츠와 분류 글자는 넣지 않음", () => {
  for (const item of complexes.filter((entry) => entry.status === "published")) {
    const found = source("complex", item.slug);
    assert.deepEqual(Object.keys(found.facts.details), COMPLEX_DETAIL_KEYS.filter((key) => (item[key] ?? []).length > 0), item.slug);
    const text = JSON.stringify(found.facts.details);
    assert.ok(text.length <= COMPLEX_DETAILS_MAX_CHARS, `${item.slug} ${text.length}자`);
    for (const word of ["seo", "sources", "image", "aliases", "relatedContentIds", "historical-plan", "\"official\"", "transport", "daily-life", "verification", ".webp", "http"]) {
      assert.ok(!text.includes(word), `${item.slug}: ${word}`);
    }
    // 지금 공개 자료는 상한 안이라 줄이지 않는다(줄 수가 원본과 같음).
    for (const key of COMPLEX_DETAIL_KEYS) assert.equal(found.facts.details[key]?.length ?? 0, (item[key] ?? []).length, `${item.slug}.${key}`);
  }
  const amenity = COMPLEX.facts.details.amenityGroups[0];
  assert.equal(amenity.basis, "입주 전 소개 자료(현재 운영 여부 확인 필요)", "분류 글자는 사람이 읽는 이름으로");
  assert.equal(COMPLEX.facts.details.livingSections[0].category, "교통");
  assert.equal(COMPLEX.facts.details.unitGroups[0].households, "208세대");
  assert.equal(APT.facts.details, undefined, "매물 글에는 단지 자료를 붙이지 않음(이번 범위 밖)");
});

test("단지 자료 상한: 넘으면 뒤 항목(faqs → checkpoints → …)의 끝 줄부터 빼고 앞 항목은 남김, 빈 칸·빈 줄은 버림", () => {
  const long = "가".repeat(300);
  const item = {
    highlights: [{ title: "특징", description: "신축" }, { title: "", description: "  " }],
    unitGroups: [{ category: "분양", areaLabel: "59㎡", households: 10 }, { category: "분양", areaLabel: "84㎡", households: -1 }],
    checkpoints: Array.from({ length: 4 }, (_, index) => ({ title: `확인 ${index + 1}`, description: long })),
    faqs: Array.from({ length: 6 }, (_, index) => ({ question: `질문 ${index + 1}`, answer: long })),
  };
  const full = readComplexDetails(item, 100_000);
  assert.deepEqual(full.highlights, [{ title: "특징", description: "신축" }], "빈 줄은 버림");
  assert.deepEqual(full.unitGroups[1], { category: "분양", areaLabel: "84㎡" }, "세대 수가 이상하면 그 칸만 뺌");
  const trimmed = readComplexDetails(item, 1_200);
  assert.ok(JSON.stringify(trimmed).length <= 1_200);
  assert.equal(trimmed.faqs, undefined, "맨 뒤 faqs부터 다 빠짐");
  assert.ok(trimmed.checkpoints.length > 0 && trimmed.checkpoints.length < 4, "그다음 checkpoints의 끝 줄");
  assert.deepEqual(trimmed.checkpoints.map((row) => row.title), ["확인 1", "확인 2", "확인 3"].slice(0, trimmed.checkpoints.length), "앞 줄이 남음");
  assert.deepEqual([trimmed.highlights.length, trimmed.unitGroups.length], [1, 2], "앞 항목은 그대로");
  assert.deepEqual(readComplexDetails(item, 10), {}, "아주 작으면 다 빠짐");
  assert.deepEqual(complexDetailTexts({ unitGroups: [{ areaLabel: "59㎡", households: "10세대" }] }), ["59㎡", "10세대"]);
});

test("단지 자료 숫자·낱말 검사: 함께 보낸 자료의 면적·날짜·시설 낱말은 입력에 있는 것으로 치고, 자료를 빼면 다시 막힘·경고, 금액은 여전히 막음", () => {
  const draft = (text) => ({ title: "리더스시티 5블록", paragraphs: [text], hashtags: [], snsShort: "짧은 글" });
  const text = "전용 51.89㎡ 126세대가 있고 천동중학교는 2027년 3월 개교 예정입니다. 실내골프장도 소개돼 있습니다.";
  assert.deepEqual(checkBlogDraft(draft(text), { source: COMPLEX }), { blocks: [], warnings: [] });
  const bare = { ...COMPLEX, facts: { ...COMPLEX.facts, details: undefined } };
  const without = checkBlogDraft(draft(text), { source: bare });
  assert.deepEqual(without.blocks.map((item) => item.kind).sort(), ["area", "date"], "자료가 없으면 51.89㎡·2027년 3월은 입력에 없는 숫자");
  assert.deepEqual(without.warnings.map((item) => item.kind), ["amenity"]);
  assert.deepEqual(checkBlogDraft(draft("59㎡가 3억 원입니다"), { source: COMPLEX }).blocks.map((item) => item.kind), ["complex_number"], "단지 글의 금액은 자료와 상관없이 막음");
});

test("결과 새 꼴: sections·checklist를 받아 문단을 펴고 headings를 같은 길이로, 옛 꼴은 그대로(headings·checklist 없음)", () => {
  const value = {
    title: "제목",
    sections: [{ heading: " 단지 개요 ", paragraphs: [" 첫 문단 ", "둘째 문단"] }, { heading: "생활", paragraphs: ["셋째 문단"] }],
    checklist: ["- 등기 확인", "• 관리비 고지서", "채광"],
    hashtags: ["천동"],
    snsShort: "짧은 글",
    factsUsed: [],
  };
  assert.deepEqual(validateBlogResult(value).result, {
    title: "제목",
    paragraphs: ["첫 문단", "둘째 문단", "셋째 문단"],
    headings: ["단지 개요", "", "생활"],
    checklist: ["등기 확인", "관리비 고지서", "채광"],
    hashtags: ["#천동"],
    snsShort: "짧은 글",
    factsUsed: [],
  });
  assert.deepEqual(validateBlogResult({ ...value, checklist: [] }).result.checklist, [], "확인할 점이 없어도 됨");
  const L = BLOG_RESULT_LIMITS;
  const section = (extra = {}) => ({ heading: "소제목", paragraphs: ["문단"], ...extra });
  assert.equal(validateBlogResult({ ...value, sections: Array.from({ length: L.sections }, () => section({ paragraphs: Array.from({ length: L.sectionParagraphs }, () => "가".repeat(600)), heading: "나".repeat(40) })), checklist: Array.from({ length: L.checklist }, () => "다".repeat(120)) }).ok, true, "경계값(8 × 4 × 600 · 소제목 40 · 확인 10 × 120)은 통과");
  for (const bad of [
    { ...value, sections: [] },
    { ...value, sections: Array.from({ length: L.sections + 1 }, () => section()) },
    { ...value, sections: [section({ heading: "가".repeat(41) })] },
    { ...value, sections: [section({ heading: " " })] },
    { ...value, sections: [section({ paragraphs: [] })] },
    { ...value, sections: [section({ paragraphs: Array.from({ length: L.sectionParagraphs + 1 }, () => "문단") })] },
    { ...value, sections: [section({ paragraphs: ["가".repeat(601)] })] },
    { ...value, sections: [{ ...section(), extra: 1 }] },
    { ...value, checklist: Array.from({ length: L.checklist + 1 }, () => "확인") },
    { ...value, checklist: ["가".repeat(121)] },
    { ...value, paragraphs: ["옛 칸과 섞임"] },
  ]) assert.equal(validateBlogResult(bad).ok, false, JSON.stringify(bad).slice(0, 80));
  const old = validateBlogResult({ title: "제목", paragraphs: ["문단"], hashtags: [], snsShort: "짧은 글", factsUsed: [] }).result;
  assert.deepEqual(Object.keys(old), ["title", "paragraphs", "hashtags", "snsShort", "factsUsed"], "옛 꼴 초안은 이전과 같은 모양");
});

test("새 꼴 검사: 소제목(h문단 번호)과 현장에서 확인할 점(check)의 숫자·낱말도 대조, 옛 꼴은 그 칸이 없어도 됨", () => {
  const inputs = fullAptInputs();
  const result = checkBlogDraft({
    title: "가상단지",
    paragraphs: ["매매 2억 6,000만 원입니다.", "남향입니다."],
    headings: ["", "3억 원대 급매"],
    checklist: ["등기 확인", "마트까지 도보 5분"],
    hashtags: [],
    snsShort: "짧은 글",
  }, { source: APT, inputs });
  assert.deepEqual(result.blocks.map((item) => [item.kind, item.where]), [["money", "h2"]]);
  assert.deepEqual(result.warnings.map((item) => [item.kind, item.where]), [["amenity", "check"]]);
  assert.deepEqual(checkBlogDraft({ title: "제목", paragraphs: ["매매 2억 6,000만 원입니다."], hashtags: [], snsShort: "짧은 글" }, { source: APT, inputs }).blocks, []);
});
