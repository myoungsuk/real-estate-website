// 다른 사무소 값으로 도는 시험(대장 후속 목록 "다른 사무소 값으로 도는 시험", 2026-11-25).
// 사무소 명시사항·사무소 한 줄·명함·카드·글이 office.json 값을 실제로 받아 쓰는지, 우리 사무소 값이 코드에 박혀 있지 않은지 본다.
// 가짜 사무소는 지어낸 값이다(실제 있는 사무소 이름·번호를 쓰지 않음). 매물·거래도 지어낸 값(가상단지·가상숲)이다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDisclosure, officeFieldsMissing, officeLine, officeLines } from "../src/lib/work/ad-disclosure.mjs";
import { buildComplexCards, buildListingCover, complexCardData } from "../src/lib/work/blog-cards.mjs";
import { findPersonalPatterns, validateBlogInputs } from "../src/lib/work/blog-checks.mjs";
import { listBlogSources } from "../src/lib/work/blog-sources.mjs";
import { calculateBrokerageFee } from "../src/lib/work/brokerage-fee.mjs";
import { buildFeeReceipt } from "../src/lib/work/fee-receipt.mjs";
import { buildIntroView } from "../src/lib/work/intro-paper.mjs";
import { buildCompareSheet, buildListingSheet, buildShapeSheet, checkListingInputs, listingPaperSources } from "../src/lib/work/listing-paper.mjs";
import { MESSAGE_TEMPLATES, MESSAGE_VARIANTS, buildWorkMessage } from "../src/lib/work/message-templates.mjs";
import { checkPaperCopy, copyTextProblem, paperCopyFields } from "../src/lib/work/paper-copy.mjs";
import { buildDoneNotice, businessCardView } from "../src/lib/work/promo-paper.mjs";
import { promoCards, promoOfficeLine, promoTexts } from "../src/lib/work/realprice-promo.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const real = await readJson("src/data/office.json");
const rules = await readJson("src/data/work/ad-disclosure-rules.json");
const legalRules = await readJson("src/data/work/legal-rules.json");
const complexes = await readJson("src/data/complexes.json");

// 가짜 사무소: 사무소를 가리키는 칸은 모두 다른 값, 영업시간 모양 같은 칸은 그대로 둔다.
const fake = {
  ...real,
  legalName: "가상시험공인중개사사무소",
  brandName: "가상시험 부동산",
  representative: "가시험",
  mobile: "010-0000-1234",
  address: "가상시 가상구 시험로 1, 가상빌딩 1층",
  registrationNumber: "00000-0000-00001",
  businessNumber: "000-00-00001",
  email: "office@example.invalid",
  kakaoUrl: "https://pf.kakao.com/_fakeoffice/chat",
  introduction: ["가상 소개 첫 줄입니다.", "가상 소개 둘째 줄입니다.", "가상 소개 셋째 줄입니다.", "가상 소개 넷째 줄입니다."],
};

// 결과에 나오면 안 되는 우리 사무소 값(office.json에서 읽음, 같은 번호의 다른 꼴 포함).
const digitsOf = (value) => value.replace(/\D/gu, "");
const realValues = [
  real.legalName,
  real.representative,
  real.mobile,
  digitsOf(real.mobile),
  real.mobile.replaceAll("-", " "),
  real.registrationNumber,
  real.businessNumber,
  real.address,
  real.address.split(",")[0],
  real.brandName,
  real.email,
  new URL(real.kakaoUrl).pathname.split("/")[1],
];
const fakeValues = [fake.legalName, fake.representative, fake.mobile, fake.registrationNumber, fake.address];

// 결과(객체·글)를 글자로 펴서 우리 사무소 값이 하나도 없는지 본다.
const assertNoReal = (value, label) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const word of realValues) assert.ok(!text.includes(word), `${label}: 우리 사무소 값 '${word}'이 나옴`);
};
// 명시사항 5항목이 가짜 값으로 모두 들어 있는지.
const assertHasFake = (value, label, words = fakeValues) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const word of words) assert.ok(text.includes(word), `${label}: 가짜 사무소 값 '${word}'이 없음`);
};

test("가짜 사무소 값은 5항목이 모두 차 있고 우리 사무소 값과 겹치지 않는다(시험 입력 확인)", () => {
  assert.deepEqual(officeFieldsMissing(fake), []);
  assertNoReal(fakeValues.join(" "), "가짜 값");
});

test("명시사항 줄·그림 아래 3줄·사무소 한 줄은 office 값만 쓴다", () => {
  assertHasFake(officeLine(fake), "officeLine");
  assertNoReal(officeLine(fake), "officeLine");
  assertHasFake(officeLines(fake), "officeLines");
  assertNoReal(officeLines(fake), "officeLines");
  assert.equal(promoOfficeLine(fake), `${fake.legalName} ${fake.mobile}`);
  const complex = buildDisclosure({ source: { type: "complex" }, office: fake, rules });
  assert.equal(complex.text, officeLine(fake));
});

// 실거래가 홍보물: 매매·신고가·전세·월세를 섞은 가상 거래.
const RECEIVED = "2026-11-25T06:10:00.000Z";
let seq = 0;
const trade = (kind, over) => ({ tradeKey: `${kind}:202611:${String(++seq).padStart(20, "0")}:1`, kind, lawdCd: "30110", umdName: "천동", floor: 10, buildYear: 2020, priceWon: null, depositWon: null, monthlyRentWon: null, dealingGbn: kind === "sale" ? "broker" : null, cancelled: false, recordHigh: false, prevMaxWon: null, areaM2: 84.97, dealDate: "2026-11-12", aptName: "가상숲", ...over });
const tradeSets = [
  [trade("sale", { priceWon: 300_000_000 })],
  [trade("sale", { priceWon: 500_000_000, recordHigh: true, prevMaxWon: 480_000_000 }), trade("rent", { depositWon: 250_000_000 })],
  Array.from({ length: 6 }, (_, index) => (index % 2 ? trade("rent", { depositWon: 30_000_000, monthlyRentWon: 850_000 }) : trade("sale", { priceWon: 300_000_000 + index * 1e6 }))),
];

test("실거래가 홍보물 글 4가지와 카드 그림 글 묶음은 office 값만 쓴다", () => {
  for (const items of tradeSets) {
    const input = { items, receivedAt: RECEIVED, office: fake };
    const texts = promoTexts(input);
    assert.ok(texts, "글 4가지를 만듦");
    for (const [kind, text] of Object.entries(texts)) assertNoReal(text, `promoTexts ${kind} ${items.length}건`);
    // 2026-11-27부터 글 4가지 끝은 상호·연락처 한 줄뿐이다(5항목은 카드 그림에만, 아래 promoCards).
    for (const [kind, text] of Object.entries(texts)) {
      assert.ok(text.split("\n").includes(promoOfficeLine(fake)), `${kind} 사무소 한 줄`);
      assertHasFake(text, `${kind} ${items.length}건`, [fake.legalName, fake.mobile]);
    }
    const cards = promoCards(input);
    assert.ok(cards.length >= 1);
    assertNoReal(cards, `promoCards ${items.length}건`);
    assertHasFake(cards, `promoCards ${items.length}건`);
  }
});

test("거래 완료 알림·명함·대표 소개는 office 값만 쓴다", () => {
  for (const priceOn of [false, true]) {
    const built = buildDoneNotice({ complexName: "가상단지", dealType: "sale", areaM2: "84.97", priceOn, amountMan: "30000" }, fake);
    assert.equal(built.ok, true, JSON.stringify(built));
    assertNoReal(built.notice, `buildDoneNotice priceOn=${priceOn}`);
    assertHasFake(built.notice, `buildDoneNotice priceOn=${priceOn}`);
    assert.ok(built.notice.sub.includes("카카오톡 pf.kakao.com/_fakeoffice"), "카카오톡 줄은 office.kakaoUrl에서");
  }
  const card = businessCardView(fake);
  assert.equal(card.blocked, null);
  assertNoReal(card, "businessCardView");
  assertHasFake(card, "businessCardView", [fake.legalName, fake.representative, fake.mobile, fake.registrationNumber, fake.address, fake.email, fake.brandName]);
  const intro = buildIntroView(fake);
  assert.equal(intro.ok, true);
  assertNoReal({ ...intro.view, photos: undefined }, "buildIntroView(사진 경로 뺌)");
  assertHasFake(intro.view, "buildIntroView");
  assert.equal(intro.view.quote, fake.introduction[2]);
  assert.equal(intro.view.place, "가상빌딩 1층");
});

// 매물 안내지·비교표·가격표: 기존 시험과 같은 지어낸 매물과 공동주택 명시사항.
const naverListings = {
  checkedAt: "2026-11-20",
  items: [
    { id: "9900000001", title: "가상단지 101동", propertyType: "아파트", tradeType: "sale", priceLabel: "2억 6,000", areaLabel: "111㎡ · 전용 84.77㎡", floorLabel: "2/22층", direction: "남향", summary: "", registeredAt: "2026-08-25", source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000001" },
    { id: "9900000002", title: "가상단지 102동", propertyType: "아파트", tradeType: "sale", priceLabel: "2억 7,000", areaLabel: "112㎡ · 전용 84.87㎡", floorLabel: "중/15층", direction: "남동향", summary: "", registeredAt: "2026-08-26", source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000002" },
  ],
};
const listingInputs = (extra = {}) => ({
  location: "대전광역시 동구 가상동 100", kind: "아파트", violation: "none", floorMode: "number", floorNumber: 2, totalFloors: 22,
  moveIn: { type: "now" }, rooms: 3, bathrooms: 2, approvalDate: "2010-05-01", parking: { basis: "perHousehold", value: 1.2 },
  managementFee: { type: "average", monthlyWon: 250_000, included: ["general"] }, direction: "남향", directionBasis: "거실", ...extra,
});

test("매물 안내지·비교표·가격표는 office 값만 쓴다", () => {
  const sources = listingPaperSources(naverListings, rules);
  const items = sources.map((source) => {
    const checked = checkListingInputs(source, listingInputs(), { office: fake, rules });
    assert.equal(checked.ok, true, JSON.stringify(checked));
    return checked.item;
  });
  const sheets = {
    sheet: buildListingSheet(items[0], fake),
    compare: buildCompareSheet(items, fake, naverListings.checkedAt),
    shape: buildShapeSheet(items, fake, naverListings.checkedAt),
  };
  for (const [name, built] of Object.entries(sheets)) {
    assert.equal(built.ok, true, `${name}: ${JSON.stringify(built)}`);
    assertNoReal(built.sheet, name);
    assertHasFake(built.sheet, name);
  }
  assertNoReal(items, "checkListingInputs 결과");
});

test("글 초안 카드(단지 3장·매물 표지)는 office 값만 쓴다", () => {
  for (const item of complexes.filter((entry) => entry.status === "published")) {
    const view = buildComplexCards(complexCardData(item), fake);
    assert.equal(view.ok, true, `${item.slug}: ${JSON.stringify(view)}`);
    assertNoReal(view.cards, `buildComplexCards ${item.slug}`);
    for (const card of view.cards) assertHasFake(card.disclosure, `${item.slug} ${card.key}`);
  }
  const [source] = listBlogSources({ rules, listings: [], naverListings: { items: [naverListings.items[0]] }, complexes: [] });
  const checked = validateBlogInputs(listingInputs(), { officePhone: fake.mobile });
  assert.deepEqual([...checked.errors, ...checked.personal], [], JSON.stringify(checked));
  const disclosure = buildDisclosure({ source, inputs: checked.inputs, office: fake, rules });
  assert.deepEqual(disclosure.missing, []);
  assertNoReal(disclosure, "buildDisclosure 매물");
  assertHasFake(disclosure.text, "buildDisclosure 매물");
  const cover = buildListingCover(source, disclosure, fake);
  assert.equal(cover.ok, true);
  assertNoReal(cover.cards, "buildListingCover");
  assertHasFake(cover.cards, "buildListingCover");
});

test("중개보수 영수증·안내 문자는 office 값만 쓴다", () => {
  const result = calculateBrokerageFee({ contractDate: "2026-11-16", propertyKind: "housing", dealType: "sale", priceWon: 300_000_000, depositWon: 300_000_000, vatDisplay: true }, legalRules);
  assert.equal(result.ok, true);
  const receipt = buildFeeReceipt(result, { payer: "가상손님", issuedOn: "2026-11-20", property: "가상단지 84㎡" }, fake);
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assertNoReal(receipt.receipt, "buildFeeReceipt");
  assertHasFake(receipt.receipt, "buildFeeReceipt", [...fakeValues, fake.businessNumber]);
  for (const templateId of Object.keys(MESSAGE_TEMPLATES)) {
    for (const variant of Object.keys(MESSAGE_VARIANTS)) {
      const { text } = buildWorkMessage({ templateId, variant, values: {}, office: fake });
      assertNoReal(text, `buildWorkMessage ${templateId} ${variant}`);
      assertHasFake(text, `buildWorkMessage ${templateId} ${variant}`, [fake.mobile]);
    }
  }
});

test("홍보 종이 문구 칸: 처음 문구에 우리 사무소 값이 없고, 전화번호는 그 office 번호만 허용한다", () => {
  for (const tool of ["done", "listing", "intro", "card"]) {
    const fields = paperCopyFields(tool, fake);
    assertNoReal(fields, `paperCopyFields ${tool}`);
    for (const shape of Object.keys(fields)) assert.equal(checkPaperCopy(tool, shape, {}, fake).ok, true, `${tool} ${shape} 처음 문구`);
  }
  assert.equal(copyTextProblem("listing", `문의 ${fake.mobile}`, fake), null, "가짜 사무소 번호는 허용");
  assert.match(copyTextProblem("listing", `문의 ${real.mobile}`, fake) ?? "", /사무소 번호가 아닌/u, "다른 사무소 번호(우리 번호)는 막음");
  assert.equal(findPersonalPatterns(`문의 ${fake.mobile}`, { officePhone: fake.mobile }).length, 0, "글 초안 검사: 그 office 번호는 허용");
  assert.ok(findPersonalPatterns(`문의 ${real.mobile}`, { officePhone: fake.mobile }).length > 0, "글 초안 검사: 다른 번호는 잡음");
});

test("가짜 사무소에서도 5항목 중 하나라도 비면 그림·글을 만들지 않는다", () => {
  const sources = listingPaperSources(naverListings, rules);
  const item = checkListingInputs(sources[0], listingInputs(), { office: fake, rules }).item;
  for (const key of ["legalName", "address", "mobile", "registrationNumber", "representative"]) {
    const broken = { ...fake, [key]: " " };
    assert.equal(promoTexts({ items: tradeSets[0], receivedAt: RECEIVED, office: broken }), null, `promoTexts ${key}`);
    assert.deepEqual(promoCards({ items: tradeSets[0], receivedAt: RECEIVED, office: broken }), [], `promoCards ${key}`);
    assert.equal(buildDoneNotice({ complexName: "가상단지", dealType: "sale", areaM2: "84.97" }, broken).ok, false, `buildDoneNotice ${key}`);
    assert.notEqual(businessCardView(broken).blocked, null, `businessCardView ${key}`);
    assert.equal(buildIntroView(broken).ok, false, `buildIntroView ${key}`);
    assert.equal(buildListingSheet(item, broken).ok, false, `buildListingSheet ${key}`);
    assert.equal(buildComplexCards(complexCardData(complexes.find((entry) => entry.status === "published")), broken).ok, false, `buildComplexCards ${key}`);
  }
});
