// 매물 안내지·비교표 그림 글 묶음(보드 45번 D, 운영자 결정 2026-11-20 23:41:16 "A 매물 종이"·"만들 때마다 넣고 저장 안 함"·"넣지 않기").
// 공개 매물(naver-listings.json 공개 칸)과 화면에서 넣은 명시사항 값만 쓴다. 저장·서버 전송·URL·브라우저 저장소에 넣지 않는다.
// - 매물 광고 명시사항은 ad-disclosure.mjs buildDisclosure() 한 곳이 만들고, 빈 필수 항목이 하나라도 있으면 그림을 만들지 않는다.
//   그림에 싣는 매물 항목 글은 buildDisclosure()가 돌려준 값을 그대로 쓴다(새로 꾸미지 않음, 층·면적 칸만 짧게 나눠 보임).
// - 분양권처럼 명시 기준이 정해지지 않은 매물은 고를 수 없다(blog-sources.mjs classifyPropertyType의 까닭을 그대로 보임).
// - 비교는 같은 종류(명시 규칙의 같은 분류)·같은 거래 형태끼리 최대 3건. '가장 낮은' 같은 표시는 넣지 않는다.
// - 호수·손님 정보는 넣지 않는다(소재지 칸은 blog-checks.mjs가 호수·전화번호 모양을 막음). 파일 이름에는 날짜만 넣는다.
import { MAX_COMPARE_LISTINGS } from "../listing-compare.mjs";
import { buildDisclosure, formatDate, formatPrice, officeFieldsMissing, officeLines, resolveFloor } from "./ad-disclosure.mjs";
import { listBlogSources } from "./blog-sources.mjs";
import { validateBlogInputs } from "./blog-checks.mjs";
import { OFFICE_DOMAIN, kakaoLine } from "./promo-paper.mjs";

export const LISTING_CARD_SIZE = Object.freeze({ width: 1080, height: 1350 });
export const LISTING_PICK_MAX = MAX_COMPARE_LISTINGS;
export const LISTING_SHEET_TITLE = "매물 안내";
export const LISTING_COMPARE_TITLE = "매물 비교";
export const LISTING_SOURCE_NOTE = "네이버 부동산 공개 매물";
export const LISTING_RECHECK = "세부 조건은 상담 때 다시 확인해 주세요.";
const TRADE_LABELS = { sale: "매매", jeonse: "전세", "monthly-rent": "월세" };
const SHOWN_IN_HEAD = new Set(["price", "tradeType", "area", "direction", "totalFloors"]);

// 고를 수 있는 공개 매물(네이버 매물만). 분양권·가격을 읽지 못한 매물은 blockedReason이 붙어 고를 수 없다.
export function listingPaperSources(naverListings, rules) {
  return listBlogSources({ naverListings, listings: [], complexes: [], rules }).filter((source) => source.type === "naver_listing");
}

// 이 매물을 지금 담을 수 있는지. 못 담으면 까닭 한 문장, 담을 수 있으면 null.
export function pickBlockReason(source, picked) {
  if (source.blockedReason) return source.blockedReason;
  if (picked.some((item) => item.id === source.id)) return null;
  if (picked.length >= LISTING_PICK_MAX) return `한 장에 ${LISTING_PICK_MAX}건까지 담을 수 있습니다.`;
  const first = picked[0];
  if (first && (first.category !== source.category || first.facts.tradeType !== source.facts.tradeType)) {
    return "처음 담은 매물과 종류·거래 형태가 같아야 한 장에 비교할 수 있습니다.";
  }
  return null;
}

// 사무소 5항목이 비었을 때 막는 문장(없으면 null).
export function listingOfficeBlockReason(office) {
  const missing = officeFieldsMissing(office);
  return missing.length > 0 ? `사무소 명시사항(${missing.join("·")})이 비어 있어 만들 수 없습니다. 사무소 정보를 먼저 채워 주세요.` : null;
}

// 크게 보일 가격: buildDisclosure()의 가격 글(formatPrice)에서 앞의 거래 형태만 뗀다(거래 형태는 칩에 보임). 월세는 "보증금 1억 원 / 월 140만 원".
export const bigPriceText = (facts) => formatPrice(facts).replace(/^(?:매매|전세|월세) /u, "");

function floorBox(source, inputs, items, rules) {
  const category = rules.categories.find((entry) => entry.id === source.category);
  const locationText = items.get("location") ?? "";
  const floor = category ? resolveFloor(category, source.facts, inputs) : null;
  // 층은 소재지 끝에 붙어 있을 때만 칸에 보인다(단독주택처럼 층을 적지 않는 분류는 빼기).
  const shownFloor = floor && locationText.endsWith(floor) ? floor : null;
  const total = items.get("totalFloors") ?? null;
  if (shownFloor && total) return `${shownFloor} / 총 ${total}`;
  return shownFloor ?? (total ? `총 ${total}` : null);
}

// 매물 1건을 검사해 그림 글 재료를 만든다. 돌려주는 값: { ok: true, item } 또는 { ok: false, missing[], errors[], personal[] }.
export function checkListingInputs(source, rawInputs, { office, rules }) {
  const checked = validateBlogInputs(rawInputs, { officePhone: office.mobile });
  const disclosure = buildDisclosure({ source, inputs: checked.inputs, office, rules });
  if (checked.errors.length > 0 || checked.personal.length > 0 || disclosure.missing.length > 0) {
    return { ok: false, missing: disclosure.missing, errors: checked.errors, personal: checked.personal };
  }
  const items = new Map(disclosure.items.map((item) => [item.key, item.value]));
  return {
    ok: true,
    item: {
      id: source.id,
      title: source.title,
      tradeLabel: TRADE_LABELS[source.facts.tradeType] ?? "",
      propertyType: source.facts.propertyType ?? "",
      price: bigPriceText(source.facts),
      area: (items.get("area") ?? "").replace(/^전용 /u, ""),
      areaLabel: (items.get("area") ?? "").startsWith("전용 ") ? "전용면적" : "면적",
      floor: floorBox(source, checked.inputs, items, rules),
      direction: items.get("direction") ?? null,
      summary: typeof source.facts.summary === "string" ? source.facts.summary.trim() : "",
      registeredAt: source.facts.registeredAt ?? null,
      disclosure: disclosure.items,
      items,
    },
  };
}

// 표에 싣는 줄(머리 칸에 이미 보인 가격·거래 형태·면적·방향·총 층수는 빼고, 방·욕실은 한 줄로).
function tableRows(item) {
  const rows = [];
  const rooms = item.items.get("rooms");
  const baths = item.items.get("bathrooms");
  for (const { key, label, value } of item.disclosure) {
    if (SHOWN_IN_HEAD.has(key)) continue;
    if (key === "rooms" || key === "bathrooms") {
      if (rows.some((row) => row.key === "rooms")) continue;
      rows.push({ key: "rooms", label: rooms && baths ? "방 · 욕실" : rooms ? "방" : "욕실", value: [rooms, baths].filter(Boolean).join(" · ") });
      continue;
    }
    rows.push({ key, label, value });
  }
  return rows;
}

const caption = (item) => [`매물번호 ${item.id}`, item.registeredAt ? `네이버 부동산 등록 ${formatDate(item.registeredAt)}` : null, LISTING_RECHECK].filter(Boolean).join(" · ");

// 매물 1건 안내지 글 묶음(A안 매물 종이).
export function buildListingSheet(item, office) {
  const blocked = listingOfficeBlockReason(office);
  if (blocked) return { ok: false, error: blocked };
  const boxes = [
    item.area ? [item.areaLabel, item.area] : null,
    item.floor ? ["층", item.floor] : null,
    item.direction ? ["방향", item.direction] : null,
  ].filter(Boolean);
  return {
    ok: true,
    sheet: {
      title: LISTING_SHEET_TITLE,
      chip: [item.tradeLabel, item.items.get("kind") ?? item.propertyType].filter(Boolean).join(" · "),
      name: item.title,
      price: item.price,
      boxes,
      summary: item.summary,
      rows: tableRows(item),
      caption: caption(item),
      phone: `상담 ${office.mobile}`,
      sub: [kakaoLine(office.kakaoUrl), OFFICE_DOMAIN].filter(Boolean),
      disclosure: officeLines(office),
    },
  };
}

// 비교표 줄 순서(같은 분류라 칸 이름이 같다). 없는 값은 "—".
const COMPARE_ROWS = [
  ["price", "가격"],
  ["area", "면적"],
  ["floor", "층"],
  ["direction", "방향"],
  ["rooms", "방 · 욕실"],
  ["moveIn", "입주 가능일"],
  ["managementFee", "관리비"],
  ["parking", "주차"],
  ["approvalDate", "사용승인일"],
  ["location", "소재지"],
  ["kind", "종류"],
  ["id", "매물번호"],
];

function compareValue(item, key) {
  if (key === "price") return item.price;
  if (key === "area") return item.items.get("area") ?? null;
  if (key === "floor") return item.floor;
  if (key === "id") return item.id;
  if (key === "rooms") {
    const parts = [item.items.get("rooms"), item.items.get("bathrooms")].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : null;
  }
  return item.items.get(key) ?? null;
}

// 2 ~ 3건 비교표 글 묶음. checkedAt: naver-listings.json 루트 확인일.
export function buildCompareSheet(items, office, checkedAt) {
  const blocked = listingOfficeBlockReason(office);
  if (blocked) return { ok: false, error: blocked };
  if (items.length < 2 || items.length > LISTING_PICK_MAX) return { ok: false, error: `비교표는 2 ~ ${LISTING_PICK_MAX}건으로 만듭니다.` };
  const types = [...new Set(items.map((item) => item.propertyType))];
  const trade = items[0].tradeLabel;
  const rows = COMPARE_ROWS.map(([key, label]) => ({ key, label, values: items.map((item) => compareValue(item, key) ?? "—") }))
    .filter((row) => row.values.some((value) => value !== "—"));
  return {
    ok: true,
    sheet: {
      title: LISTING_COMPARE_TITLE,
      heading: `${trade} ${types.length === 1 ? types[0] : "공동주택"} ${items.length}건 비교`,
      sub: [LISTING_SOURCE_NOTE, checkedAt ? `${formatDate(checkedAt)} 확인` : null, LISTING_RECHECK].filter(Boolean).join(" · "),
      columns: items.map((item, index) => ({ no: String(index + 1), name: item.title })),
      rows,
      phone: `상담 ${office.mobile}`,
      phoneSub: [kakaoLine(office.kakaoUrl), OFFICE_DOMAIN].filter(Boolean),
      disclosure: officeLines(office),
    },
  };
}

// 그림 파일 이름: 날짜만(단지·동·손님 정보를 넣지 않음).
export const listingFileName = (todayIso, count) => `${count > 1 ? "listing-compare" : "listing"}-${String(todayIso).replaceAll("-", "")}.png`;
