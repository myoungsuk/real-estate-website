// 글 초안 카드 그림 글 묶음(2026-11-23 사용자 선택 "B 큰 숫자 인포그래픽"·"3장 한 벌") 순수 함수 src/lib/work/blog-cards.mjs.
// 단지는 공개 파일(complexes.json) 그대로, 매물은 지어낸 값(가상단지)이고 사무소·명시 규칙은 공개 파일(office.json·ad-disclosure-rules.json)이다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDisclosure, officeLines } from "../src/lib/work/ad-disclosure.mjs";
import { validateBlogInputs } from "../src/lib/work/blog-checks.mjs";
import {
  BLOG_CARD_CHECKS_MAX,
  BLOG_CARD_SIZE,
  blogCardFileName,
  buildComplexCards,
  buildListingCover,
  cardTitleLines,
  complexCardData,
  parkingView,
  readParking,
  shortDateText,
} from "../src/lib/work/blog-cards.mjs";
import { listBlogSources } from "../src/lib/work/blog-sources.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const complexes = await readJson("../src/data/complexes.json");
const office = await readJson("../src/data/office.json");
const rules = await readJson("../src/data/work/ad-disclosure-rules.json");
const published = complexes.filter((item) => item.status === "published");
const bySlug = (slug) => complexes.find((item) => item.slug === slug);
const cardsOf = (slug) => {
  const view = buildComplexCards(complexCardData(bySlug(slug)), office);
  assert.equal(view.ok, true, JSON.stringify(view));
  return Object.fromEntries(view.cards.map((card) => [card.key, card]));
};
// 글 묶음 안의 숫자(쉼표 묶음은 한 수로). 사무소 명시사항 줄은 office.json 값이라 따로 본다.
const numbersIn = (value) => (JSON.stringify(value).match(/\d[\d,]*/gu) ?? []).map((text) => Number(text.replaceAll(",", "")));

test("카드는 1080×1350이고, 공개 단지마다 표지·단지 정보·확인할 점 3장을 만든다(확인할 점은 최대 6개)", () => {
  assert.deepEqual({ ...BLOG_CARD_SIZE }, { width: 1080, height: 1350 });
  assert.ok(published.length >= 1);
  for (const item of published) {
    const view = buildComplexCards(complexCardData(item), office);
    assert.equal(view.ok, true, item.slug);
    assert.deepEqual(view.cards.map((card) => card.key), ["cover", "info", "checks"], item.slug);
    const checks = view.cards[2];
    assert.ok(checks.items.length >= 1 && checks.items.length <= BLOG_CARD_CHECKS_MAX);
    assert.equal(checks.heading, `확인할 ${checks.items.length}가지`);
    for (const card of view.cards) assert.deepEqual(card.disclosure, officeLines(office), `${item.slug} ${card.key}: 카드마다 사무소 명시사항 3줄`);
  }
});

test("카드의 숫자는 그 단지의 공개 자료(complexes.json)에 있는 숫자뿐이다(합계·비율·퍼센트를 새로 만들지 않음)", () => {
  for (const item of published) {
    const allowed = new Set(numbersIn(item));
    const view = buildComplexCards(complexCardData(item), office);
    for (const card of view.cards) {
      // 사무소 줄(office.json)과 확인할 점 개수 제목("확인할 6가지")은 단지 숫자가 아니다.
      const { disclosure, heading, ...rest } = card;
      for (const number of numbersIn(rest)) assert.ok(allowed.has(number), `${item.slug} ${card.key}: ${number}는 단지 자료에 없는 숫자`);
    }
  }
});

test("신흥 SK뷰: 지상 0대면 합계 대신 '전부 지하'로 쓰고, 전용면적 구간 2줄은 도넛, 분양·임대는 막대로 간다", () => {
  const data = complexCardData(bySlug("sinheung-sk-view"));
  assert.equal(data.households, 1588);
  assert.equal(data.dongs, 12);
  assert.deepEqual(data.parking, { ground: 0, under: 1957 });
  assert.deepEqual(data.date, { label: "사용승인", value: "2022. 4. 28." });
  const { cover, info, checks } = cardsOf("sinheung-sk-view");
  assert.equal(cover.big, "1,588");
  assert.equal(cover.bigNote, "12개동");
  assert.deepEqual(cover.titleLines, ["2022년 입주한 1,588세대,", "신흥 SK뷰를 한눈에"]);
  assert.deepEqual(cover.chips, ["2022. 4. 28. 사용승인", "주차 1,957대 전부 지하"]);
  assert.equal(cover.image, "/images/area/sinheung-sk-view.webp");
  assert.equal(info.subtitle, "대전 동구 신흥동 · 신흥3구역 재개발정비사업");
  assert.deepEqual(info.side, { title: "주차", big: "1,957", unit: "대", note: "전부 지하 주차", rows: [] });
  assert.equal(info.donut.title, "전용면적 구성");
  assert.deepEqual(info.donut.rows.map((row) => row.label), ["60㎡ 이하", "60㎡ 초과 ~ 85㎡ 이하"]);
  assert.deepEqual(info.supplyBar.map((row) => row.text), ["분양 1,499세대", "임대 89세대"]);
  assert.deepEqual(info.tiles, [{ label: "사용승인", value: "2022. 4. 28." }, { label: "동 수", value: "12개동" }, { label: "승강기", value: "34대" }]);
  assert.match(info.sourceLine, /^출처 K-apt 공동주택관리정보시스템 · 대전광역시 동구 · 대전광역시 · 확인\u00A02026\.\u00A09\.\u00A01\.$/u);
  assert.equal(checks.items[0], "같은 면적도 타입별 구조를 확인합니다");
  assert.ok(!JSON.stringify(info).includes("3,546"), "지상 + 지하 같은 합계를 만들지 않음");
});

test("리더스시티: 전용면적 줄이 5개를 넘으면 공급 구성이 도넛으로 가고, 공급이 한 줄이면 큰 숫자와 겹치지 않게 '전 세대 분양'으로 쓴다", () => {
  const five = cardsOf("leaders-city-5");
  assert.equal(five.info.donut.title, "공급 구성");
  assert.deepEqual(five.info.donut.rows.map((row) => row.text), ["1,423세대", "712세대"]);
  assert.equal(five.info.supplyBar, null, "도넛에 쓴 공급은 막대로 다시 그리지 않음");
  assert.deepEqual(five.info.side, { title: "입주", big: "2024. 12.", unit: null, note: "16개동", rows: [] });
  const four = cardsOf("leaders-city-4");
  assert.equal(four.info.donut.title, "전용면적 구성");
  assert.deepEqual(four.cover.chips, ["2024. 7. 입주", "전 세대 분양"]);
  assert.deepEqual(four.info.supplyBar.map((row) => row.text), ["분양 1,328세대"]);
  assert.ok(!four.info.tiles.some((tile) => tile.label === "동 수"), "동 수는 오른쪽 칸 아래 줄에만");
});

test("빈 칸이 있으면 만들지 않는다: 사무소 명시사항 5항목, 지금 공개 자료에 없는 단지, 세대수 없는 단지", () => {
  const data = complexCardData(bySlug("sinheung-sk-view"));
  for (const key of ["legalName", "address", "mobile", "registrationNumber", "representative"]) {
    const view = buildComplexCards(data, { ...office, [key]: " " });
    assert.equal(view.ok, false, key);
    assert.match(view.error, /사무소 명시사항\(.+\)이 비어 있어 만들 수 없습니다/u);
  }
  assert.match(buildComplexCards(null, office).error, /공개 단지 자료에 없어/u);
  assert.match(buildComplexCards({ ...data, households: null }, office).error, /세대수/u);
  assert.equal(complexCardData({ ...bySlug("sinheung-sk-view"), status: "draft" }), null);
});

test("주차·날짜 읽기: 둘 다 있으면 합계 없이 두 줄, 지하 0대면 '전부 지상', 못 읽으면 없음", () => {
  assert.deepEqual(readParking("지상 0대 · 지하 1,957대"), { ground: 0, under: 1957 });
  assert.equal(readParking("지하 1,957대"), null);
  assert.equal(readParking("지상 0대 · 지하 0대"), null);
  assert.deepEqual(parkingView({ ground: 120, under: 800 }), { big: null, note: null, chip: null, rows: [["지상", "120대"], ["지하", "800대"]] });
  assert.equal(parkingView({ ground: 300, under: 0 }).note, "전부 지상 주차");
  assert.equal(shortDateText("2022년 4월 28일"), "2022. 4. 28.");
  assert.equal(shortDateText("2024년 12월"), "2024. 12.");
  assert.equal(shortDateText("2024년 하반기"), "2024년 하반기");
});

test("제목 줄: 첫 쉼표 뒤에서 나누고 단지 이름은 띄어쓰기에서 끊기지 않게 붙인다", () => {
  assert.deepEqual(cardTitleLines("리더스시티 5블록, 단지 안에서 바로 상담합니다", "리더스시티 5블록"), ["리더스시티 5블록,", "단지 안에서 바로 상담합니다"]);
  assert.deepEqual(cardTitleLines("쉼표 없는 제목", "단지"), ["쉼표 없는 제목"]);
});

test("파일 이름: 단지 카드는 날짜 + 단지 이름 + 번호(파일 이름에 못 쓰는 글자·띄어쓰기는 뺌), 매물 표지는 날짜만", () => {
  assert.equal(blogCardFileName("2026-11-20", { name: "신흥 SK뷰", index: 0 }), "2026-11-20-신흥SK뷰-1.png");
  assert.equal(blogCardFileName("2026-11-20", { name: "가상/단지:*1", index: 2 }), "2026-11-20-가상단지1-3.png");
  assert.equal(blogCardFileName("2026-11-20", { name: "가상단지 101동", index: 0, listing: true }), "2026-11-20-매물표지.png");
});

test("매물 표지: 명시사항 빈 칸이 있으면 만들지 않고, 다 차면 buildDisclosure() 항목을 그대로 싣는다(가격은 거래 형태를 뗀 큰 글)", () => {
  const [source] = listBlogSources({
    rules,
    listings: [],
    naverListings: { items: [{ id: "9900000001", title: "가상단지 101동", propertyType: "아파트", tradeType: "sale", priceLabel: "2억 6,000", areaLabel: "111㎡ · 전용 84.77㎡", floorLabel: "2/22층", direction: "남향", summary: "" }] },
    complexes: [],
  });
  const inputs = (extra = {}) => validateBlogInputs({
    location: "대전광역시 동구 가상동 100", kind: "아파트", violation: "none", floorMode: "number", floorNumber: 2, totalFloors: 22,
    moveIn: { type: "now" }, rooms: 3, bathrooms: 2, approvalDate: "2010-05-01", parking: { basis: "perHousehold", value: 1.2 },
    managementFee: { type: "average", monthlyWon: 250_000, included: ["general"] }, directionBasis: "거실", ...extra,
  }, { officePhone: office.mobile }).inputs;
  const partial = buildDisclosure({ source, inputs: inputs({ location: "" }), office, rules });
  assert.ok(partial.missing.includes("location"));
  assert.deepEqual(buildListingCover(source, partial, office), { ok: false, error: "명시사항 빈 칸을 모두 채우면 표지를 만듭니다." });
  const full = buildDisclosure({ source, inputs: inputs(), office, rules });
  assert.deepEqual(full.missing, []);
  const view = buildListingCover(source, full, office);
  assert.equal(view.ok, true);
  const [card] = view.cards;
  assert.equal(card.key, "listing");
  assert.equal(card.chip, "매매 · 아파트");
  assert.equal(card.name, "가상단지 101동");
  assert.equal(card.price, "2억 6,000만 원");
  assert.deepEqual(card.rows, full.items.map(({ key, label, value }) => ({ key, label, value })));
  assert.deepEqual(card.disclosure, officeLines(office));
  assert.match(buildListingCover(source, full, { ...office, mobile: "" }).error, /연락처/u);
  assert.equal(buildListingCover({ type: "complex" }, full, office).ok, false);
});

test("확인할 점은 앞에서부터 6개까지만 싣고, 없으면 확인할 점 카드를 만들지 않는다", () => {
  const base = bySlug("sinheung-sk-view");
  const many = complexCardData({ ...base, checkpoints: Array.from({ length: 8 }, (_, index) => ({ title: `가상 확인 ${index + 1}`, description: "" })) });
  assert.deepEqual(many.checks, ["가상 확인 1", "가상 확인 2", "가상 확인 3", "가상 확인 4", "가상 확인 5", "가상 확인 6"]);
  const none = buildComplexCards(complexCardData({ ...base, checkpoints: [] }), office);
  assert.deepEqual(none.cards.map((card) => card.key), ["cover", "info"]);
});

test("출처 줄은 공식·공공 자료만 싣고 뉴스는 빼며, 도넛은 4줄까지만(5줄이면 공급 구성으로 바꿈) — 날개-2 2026-11-23 깨 보기 보탬", () => {
  const four = cardsOf("leaders-city-4");
  assert.ok(bySlug("leaders-city-4").sources.some((row) => row.kind === "news"), "시험 자료에 뉴스 출처가 있어야 함");
  assert.ok(!four.info.sourceLine.includes("충청뉴스"), four.info.sourceLine);
  assert.match(four.info.sourceLine, /^출처 대전광역시 · /u);
  const base = bySlug("sinheung-sk-view");
  const rowsOf = (count) => Array.from({ length: count }, (_, index) => ({ category: "전체", areaLabel: `${50 + index * 10}㎡`, households: 100 + index }));
  const withUnits = (count) => buildComplexCards(complexCardData({ ...base, unitGroups: rowsOf(count) }), office).cards.find((card) => card.key === "info");
  assert.equal(withUnits(4).donut.title, "전용면적 구성");
  assert.equal(withUnits(4).donut.rows.length, 4);
  assert.equal(withUnits(5).donut.title, "공급 구성", "전용면적 5줄은 도넛에 싣지 않음");
});
