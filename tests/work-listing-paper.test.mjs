// 매물 안내지·비교표(보드 45번 D) 순수 함수 src/lib/work/listing-paper.mjs.
// 운영자 결정 2026-11-20 23:41:16: A안 매물 종이, 명시사항은 만들 때마다 넣고 저장하지 않음, 최저가 표시는 넣지 않음.
// 매물은 지어낸 값(가상단지·가상동)이고 명시 규칙·사무소 정보는 공개 파일(ad-disclosure-rules.json·office.json)이다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { officeLines } from "../src/lib/work/ad-disclosure.mjs";
import {
  LISTING_CARD_SIZE,
  LISTING_PICK_MAX,
  bigPriceText,
  buildCompareSheet,
  buildListingSheet,
  checkListingInputs,
  listingFileName,
  listingOfficeBlockReason,
  listingPaperSources,
  pickBlockReason,
} from "../src/lib/work/listing-paper.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const rules = await readJson("../src/data/work/ad-disclosure-rules.json");
const office = await readJson("../src/data/office.json");

const naverListings = {
  checkedAt: "2026-11-20",
  items: [
    { id: "9900000001", title: "가상단지 101동", propertyType: "아파트", tradeType: "sale", priceLabel: "2억 6,000", areaLabel: "111㎡ · 전용 84.77㎡", floorLabel: "2/22층", direction: "남향", summary: "  해가 잘 드는 집입니다  ", registeredAt: "2026-08-25", source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000001" },
    { id: "9900000002", title: "가상단지 102동", propertyType: "아파트", tradeType: "sale", priceLabel: "2억 7,000", areaLabel: "112㎡ · 전용 84.87㎡", floorLabel: "중/15층", direction: "남동향", summary: "", registeredAt: "2026-08-26", source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000002" },
    { id: "9900000003", title: "가상단지 103동", propertyType: "아파트", tradeType: "monthly-rent", priceLabel: "10,000/140", areaLabel: "113㎡ · 전용 84㎡", floorLabel: "5/33층", direction: "남향", summary: "", registeredAt: null, source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000003" },
    { id: "9900000004", title: "가상상가", propertyType: "상가점포", tradeType: "sale", priceLabel: "3억", areaLabel: "계약 45㎡ · 전용 36㎡", floorLabel: "1/1층", direction: "남향", summary: "", registeredAt: null, source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000004" },
    { id: "9900000005", title: "가상분양 1단지", propertyType: "아파트분양권", tradeType: "sale", priceLabel: "4억 4,630", areaLabel: "85㎡ · 전용 59㎡", floorLabel: "8/29층", direction: "남향", summary: "", registeredAt: null, source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000005" },
    { id: "9900000006", title: "가상단지 104동", propertyType: "아파트", tradeType: "sale", priceLabel: "2억 5,500", areaLabel: "111㎡ · 전용 84.7㎡", floorLabel: "7/22층", direction: "남향", summary: "", registeredAt: null, source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000006" },
    { id: "9900000007", title: "가상단지 105동", propertyType: "아파트", tradeType: "sale", priceLabel: "2억 8,000", areaLabel: "111㎡ · 전용 84.7㎡", floorLabel: "9/22층", direction: "남향", summary: "", registeredAt: null, source: "네이버페이 부동산", url: "https://fin.land.naver.com/articles/9900000007" },
  ],
};
const sources = listingPaperSources(naverListings, rules);
const byId = (id) => sources.find((source) => source.id === id);
// 공동주택 명시사항을 다 채운 값(화면 칸에서 읽은 그대로의 모양).
const raw = (extra = {}) => ({
  location: "대전광역시 동구 가상동 100",
  kind: "아파트",
  violation: "none",
  floorMode: "number",
  floorNumber: 2,
  totalFloors: 22,
  moveIn: { type: "now" },
  rooms: 3,
  bathrooms: 2,
  approvalDate: "2010-05-01",
  parking: { basis: "perHousehold", value: 1.2 },
  managementFee: { type: "average", monthlyWon: 250_000, included: ["general"] },
  direction: "남향",
  directionBasis: "거실",
  ...extra,
});
const itemOf = (id, extra) => {
  const checked = checkListingInputs(byId(id), raw(extra), { office, rules });
  assert.equal(checked.ok, true, `${id}: ${JSON.stringify(checked)}`);
  return checked.item;
};
const sheetText = (sheet) => JSON.stringify(sheet);
const multiFamily = rules.categories.find((category) => category.id === "multi-family");

test("고를 수 있는 매물은 네이버 공개 매물뿐이고, 분양권은 까닭과 함께 막힌다", () => {
  assert.equal(sources.length, naverListings.items.length);
  assert.ok(sources.every((source) => source.type === "naver_listing"));
  const blocked = byId("9900000005");
  assert.equal(blocked.category, null);
  assert.match(blocked.blockedReason, /분양권/u);
  assert.equal(pickBlockReason(blocked, []), blocked.blockedReason);
  assert.deepEqual({ width: LISTING_CARD_SIZE.width, height: LISTING_CARD_SIZE.height }, { width: 1080, height: 1350 });
});

test("담기: 한 장에 3건까지, 처음 담은 매물과 분류·거래 형태가 같아야 한다", () => {
  const first = byId("9900000001");
  assert.equal(LISTING_PICK_MAX, 3);
  assert.equal(pickBlockReason(first, []), null);
  assert.equal(pickBlockReason(first, [first]), null, "이미 담은 매물은 뺄 수 있게 막지 않음");
  assert.equal(pickBlockReason(byId("9900000002"), [first]), null);
  assert.match(pickBlockReason(byId("9900000003"), [first]), /종류·거래 형태가 같아야/u, "월세는 매매와 섞지 않음");
  assert.match(pickBlockReason(byId("9900000004"), [first]), /종류·거래 형태가 같아야/u, "상가는 아파트와 섞지 않음");
  const three = ["9900000001", "9900000002", "9900000006"].map(byId);
  assert.equal(pickBlockReason(byId("9900000007"), three), "한 장에 3건까지 담을 수 있습니다.");
});

test("큰 가격 글: buildDisclosure 가격 글에서 거래 형태만 뗀다(월세는 보증금 / 월세)", () => {
  assert.equal(bigPriceText(byId("9900000001").facts), "2억 6,000만 원");
  assert.equal(bigPriceText(byId("9900000003").facts), "보증금 1억 원 / 월 140만 원");
});

test("명시사항: 빈 필수 항목·호수 모양이 있으면 만들지 않는다", () => {
  const empty = checkListingInputs(byId("9900000001"), raw({ location: "" }), { office, rules });
  assert.equal(empty.ok, false);
  assert.ok(empty.missing.includes("location"));
  const noFee = checkListingInputs(byId("9900000001"), raw({ managementFee: undefined }), { office, rules });
  assert.equal(noFee.ok, false);
  assert.ok(noFee.missing.includes("managementFee"));
  const unit = checkListingInputs(byId("9900000001"), raw({ location: "대전광역시 동구 가상동 100 101동 1203호" }), { office, rules });
  assert.equal(unit.ok, false);
  assert.ok(unit.personal.includes("location"), "호수는 넣을 수 없음");
});

test("안내지: 공동주택 필수 13항목이 모두 그림 글에 있고, 머리 칸에 보인 항목은 표에서 뺀다", () => {
  const item = itemOf("9900000001");
  assert.deepEqual(item.disclosure.map((entry) => entry.key).sort(), [...multiFamily.required].sort(), "buildDisclosure 항목 = 필수 13항목");
  const built = buildListingSheet(item, office);
  assert.equal(built.ok, true);
  const { sheet } = built;
  assert.equal(sheet.title, "매물 안내");
  assert.equal(sheet.chip, "매매 · 아파트");
  assert.equal(sheet.name, "가상단지 101동");
  assert.equal(sheet.price, "2억 6,000만 원");
  assert.deepEqual(sheet.boxes, [["전용면적", "84.77㎡"], ["층", "2층 / 총 22층"], ["방향", "남향(거실 기준)"]]);
  assert.equal(sheet.summary, "해가 잘 드는 집입니다");
  assert.deepEqual(sheet.rows.map((row) => row.key), ["location", "kind", "approvalDate", "rooms", "moveIn", "parking", "managementFee"]);
  assert.deepEqual(sheet.rows.find((row) => row.key === "rooms"), { key: "rooms", label: "방 · 욕실", value: "3개 · 2개" });
  // 13항목 값은 buildDisclosure() 글 그대로 그림 어딘가에 있다(층·면적은 칸에 나눠 보임).
  const text = sheetText(sheet);
  for (const { key, value } of item.disclosure) {
    if (key === "area") assert.ok(text.includes("84.77㎡"), key);
    else if (key === "totalFloors") assert.ok(text.includes(`총 ${value}`), key);
    else if (key === "tradeType") assert.ok(sheet.chip.startsWith(value), key);
    else if (key === "price") assert.equal(value, `${sheet.chip.split(" · ")[0]} ${sheet.price}`, key);
    else if (key === "rooms" || key === "bathrooms") assert.ok(text.includes(value), key);
    else assert.ok(text.includes(value), `${key}: ${value}`);
  }
  assert.match(sheet.caption, /^매물번호 9900000001 · 네이버 부동산 등록 2026\. 8\. 25\. · /u);
  assert.equal(sheet.phone, `상담 ${office.mobile}`);
  assert.deepEqual(sheet.disclosure, officeLines(office), "사무소 명시사항 5항목");
  assert.doesNotMatch(text, /최저|가장 낮|가장 싼|최고가|급매/u);
  assert.doesNotMatch(sheetText({ ...sheet, disclosure: [] }), /\d+\s*호/u, "사무소 주소 밖에는 호수 없음");
});

test("비교표: 2 ~ 3건만, 같은 줄 순서, 빈 값은 '—', 최저가 표시 없음", () => {
  const a = itemOf("9900000001");
  const b = itemOf("9900000002", { floorMode: "band", floorBand: "중", totalFloors: 15, rooms: 4 });
  assert.equal(buildCompareSheet([a], office, "2026-11-20").ok, false);
  const built = buildCompareSheet([a, b], office, naverListings.checkedAt);
  assert.equal(built.ok, true);
  const { sheet } = built;
  assert.equal(sheet.title, "매물 비교");
  assert.equal(sheet.heading, "매매 아파트 2건 비교");
  assert.match(sheet.sub, /^네이버 부동산 공개 매물 · 2026\. 11\. 20\. 확인 · /u);
  assert.deepEqual(sheet.columns, [{ no: "1", name: "가상단지 101동" }, { no: "2", name: "가상단지 102동" }]);
  assert.deepEqual(sheet.rows.map((row) => row.key), ["price", "area", "floor", "direction", "rooms", "moveIn", "managementFee", "parking", "approvalDate", "location", "kind", "id"]);
  assert.deepEqual(sheet.rows[0].values, ["2억 6,000만 원", "2억 7,000만 원"], "담은 순서대로(가격순으로 다시 늘어놓지 않음)");
  assert.deepEqual(sheet.rows.find((row) => row.key === "floor").values, ["2층 / 총 22층", "중층 / 총 15층"]);
  assert.deepEqual(sheet.rows.find((row) => row.key === "rooms").values, ["3개 · 2개", "4개 · 2개"]);
  assert.deepEqual(sheet.disclosure, officeLines(office));
  assert.ok(sheet.phoneSub.includes("leaderscityhappy.com"));
  assert.doesNotMatch(sheetText(sheet), /최저|가장 낮|가장 싼|최고가/u);
  const four = [a, b, itemOf("9900000006"), itemOf("9900000007")];
  assert.equal(buildCompareSheet(four, office, "2026-11-20").ok, false);
});

test("사무소 5항목이 비면 안내지·비교표 모두 만들지 않는다", () => {
  const broken = { ...office, registrationNumber: " " };
  assert.match(listingOfficeBlockReason(broken), /등록번호/u);
  assert.equal(listingOfficeBlockReason(office), null);
  const item = itemOf("9900000001");
  assert.equal(buildListingSheet(item, broken).ok, false);
  assert.equal(buildCompareSheet([item, itemOf("9900000002")], broken, "2026-11-20").ok, false);
});

test("파일 이름에는 날짜만 들어간다(단지·동 없음)", () => {
  assert.equal(listingFileName("2026-11-20", 1), "listing-20261120.png");
  assert.equal(listingFileName("2026-11-20", 3), "listing-compare-20261120.png");
});

test("위반건축물·미등기를 고르면 머리 칩·표·비교표 종류 줄에 buildDisclosure 글이 그대로 나온다", () => {
  for (const [violation, kind] of [["violation", "아파트(위반건축물)"], ["unregistered", "아파트(미등기건물)"]]) {
    const item = itemOf("9900000001", { violation });
    assert.equal(item.items.get("kind"), kind, violation);
    const { sheet } = buildListingSheet(item, office);
    assert.equal(sheet.chip, `매매 · ${kind}`, `${violation}: 머리 칩`);
    assert.deepEqual(sheet.rows.find((row) => row.key === "kind"), { key: "kind", label: "종류", value: kind }, `${violation}: 표에서도 빠지지 않음`);
    const compare = buildCompareSheet([item, itemOf("9900000002", { floorMode: "band", floorBand: "중", totalFloors: 15 })], office, naverListings.checkedAt).sheet;
    assert.deepEqual(compare.rows.find((row) => row.key === "kind").values, [kind, "아파트"], `${violation}: 비교표 종류 줄`);
  }
});
