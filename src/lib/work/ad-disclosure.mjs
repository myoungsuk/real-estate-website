// 글 초안 명시사항 블록(설계서 22.11절 7, DEC-WT-23·34, 지시서 부록 B). AI가 아니라 이 코드가 붙인다.
// - 사무소 5항목: office.json(법적 상호·주소·연락처·등록번호·대표). 중개보조원 칸은 없다.
// - 매물 칸: 매물 종류별 규칙(ad-disclosure-rules.json)의 필수 칸을 공개 자료 사실 + 화면 입력으로 채운다. 하나라도 비면 missing에 넣는다.
// - 단지 소개 글(complex)은 사무소 5항목만 붙인다.
// - 면적은 ㎡만 쓴다(평 없음). 호수는 받지 않는다(화면 입력 검사에서 막음).
// 화면(빈 칸 표시·복사 막기)과 Worker(만들기 전에 막기, 운영자 결정 2026-11-20 "만들기부터 막음")가 같은 함수를 쓴다.

export const FEE_ITEM_LABELS = Object.freeze({
  general: "일반(공용)",
  electricity: "전기",
  water: "수도",
  gas: "가스",
  heating: "난방",
  internet: "인터넷",
  tv: "TV",
  other: "기타",
});
export const FEE_ITEM_KEYS = Object.freeze(Object.keys(FEE_ITEM_LABELS));
// 정액 관리비가 월 10만 원 이상이면 비목별 금액(또는 확인 불가 표시)이 필요하다(고시 제6조 11).
export const FEE_ITEMIZE_FROM_WON = 100_000;

export const DISCLOSURE_FIELD_LABELS = Object.freeze({
  location: "소재지",
  floor: "층수(소재지)",
  area: "면적",
  price: "가격",
  kind: "종류(건축물 용도·지목)",
  violation: "위반건축물·미등기 여부",
  tradeType: "거래 형태",
  totalFloors: "총 층수",
  moveIn: "입주 가능일",
  rooms: "방 수",
  bathrooms: "욕실 수",
  approvalDate: "사용승인일",
  parking: "주차 대수",
  managementFee: "관리비",
  direction: "방향",
  directionBasis: "방향 기준",
});

// 블록 글에 쓰는 짧은 이름(화면의 빈 칸 안내는 위 DISCLOSURE_FIELD_LABELS).
const BLOCK_LABELS = { location: "소재지", area: "면적", price: "가격", kind: "종류", tradeType: "거래 형태", totalFloors: "총 층수", approvalDate: "사용승인일",
  direction: "방향", rooms: "방", bathrooms: "욕실", moveIn: "입주 가능일", parking: "주차", managementFee: "관리비" };
const TRADE_NAMES = { sale: "매매", jeonse: "전세", "monthly-rent": "월세" };
const groupThousands = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");

// 원 → "2억 6,000만 원", "140만 원", "3억 원", "8,500원".
export function formatWon(won) {
  if (!Number.isSafeInteger(won) || won < 0) return "";
  if (won === 0) return "0원";
  const eok = Math.floor(won / 100_000_000);
  const man = Math.floor((won % 100_000_000) / 10_000);
  const rest = won % 10_000;
  const parts = [];
  if (eok) parts.push(`${groupThousands(eok)}억`);
  if (man) parts.push(`${groupThousands(man)}만`);
  if (rest) parts.push(`${groupThousands(rest)}원`);
  const text = parts.join(" ");
  return rest ? text : `${text} 원`;
}

export function formatArea(m2) {
  if (!Number.isFinite(m2)) return "";
  const fixed = Math.round(m2 * 100) / 100;
  const [whole, fraction] = String(fixed).split(".");
  return `${groupThousands(whole)}${fraction ? `.${fraction}` : ""}㎡`;
}

// "2016-06-30" → "2016. 6. 30."
export function formatDate(iso) {
  const match = typeof iso === "string" ? iso.match(/^(\d{4})-(\d{2})-(\d{2})$/u) : null;
  if (!match) return "";
  return `${match[1]}. ${Number(match[2])}. ${Number(match[3])}.`;
}

export function formatPrice(facts) {
  if (facts.tradeType === "sale" && Number.isSafeInteger(facts.priceWon)) return `매매 ${formatWon(facts.priceWon)}`;
  if (facts.tradeType === "jeonse" && Number.isSafeInteger(facts.depositWon)) return `전세 보증금 ${formatWon(facts.depositWon)}`;
  if (facts.tradeType === "monthly-rent" && Number.isSafeInteger(facts.depositWon) && Number.isSafeInteger(facts.monthlyRentWon)) {
    return `월세 보증금 ${formatWon(facts.depositWon)} / 월 ${formatWon(facts.monthlyRentWon)}`;
  }
  return "";
}

export function formatMoveIn(moveIn) {
  if (!moveIn) return "";
  if (moveIn.type === "now") return "즉시입주";
  if (moveIn.type === "date") return formatDate(moveIn.date);
  if (moveIn.type === "period") {
    const match = moveIn.month.match(/^(\d{4})-(\d{2})$/u);
    return match ? `${match[1]}년 ${Number(match[2])}월 ${moveIn.part}` : "";
  }
  return "";
}

export function formatParking(parking) {
  if (!parking) return "";
  const base = parking.basis === "total" ? `총 ${groupThousands(parking.value)}대` : `세대당 ${parking.value}대`;
  return parking.actual !== null && parking.actual !== undefined ? `${base}(실제 사용 가능 ${parking.actual}대)` : base;
}

export function formatManagementFee(fee) {
  if (!fee || fee.type === "omit") return "";
  if (fee.type === "average") {
    const included = fee.included.map((key) => FEE_ITEM_LABELS[key]).join("·");
    return `월 평균 ${formatWon(fee.monthlyWon)}(포함 비목: ${included})`;
  }
  if (fee.monthlyWon >= FEE_ITEMIZE_FROM_WON) {
    if (fee.itemsUnknown) return `월 ${formatWon(fee.monthlyWon)}(정액, 세부내역을 받지 못해 비목별 금액 확인 불가)`;
    const items = FEE_ITEM_KEYS.map((key) => `${FEE_ITEM_LABELS[key]} ${formatWon(fee.items[key])}`).join("·");
    return `월 ${formatWon(fee.monthlyWon)}(정액: ${items})`;
  }
  return `월 ${formatWon(fee.monthlyWon)}(정액)`;
}

export function officeLine(office) {
  return `[중개사무소] ${office.legalName} · ${office.address} · ${office.mobile} · 등록번호 ${office.registrationNumber} · 대표 ${office.representative}`;
}

// 이 분류에서 층을 소재지에 적어야 하는지(공동주택·상가, 다가구주택).
function needsFloor(category, inputs) {
  if (category.id === "multi-family" || category.id === "non-residential") return true;
  if (category.id === "detached") return inputs.kind === "다가구주택";
  return false;
}

// 층 표시: 숫자 층 또는(의뢰인이 원하지 않을 때만, 공동주택·다가구) 저·중·고.
export function resolveFloor(category, facts, inputs) {
  if (inputs.floorMode === "band" && category.floorBandAllowed) {
    const band = inputs.floorBand ?? facts.floorBand ?? null;
    return band ? `${band}층` : null;
  }
  const number = inputs.floorNumber ?? facts.floor ?? null;
  return Number.isSafeInteger(number) ? (number < 0 ? `지하 ${-number}층` : `${number}층`) : null;
}

const hasValue = (value) => value !== null && value !== undefined && value !== "";

// 명시사항 블록. source: blog-sources.mjs의 자료, inputs: blog-checks.mjs validateBlogInputs()가 고른 값.
// 돌려주는 값: { kind, items[{ key, label, value }], missing[key], text }. missing이 비어야 만들기·복사를 연다.
export function buildDisclosure({ source, inputs = {}, office, rules }) {
  const head = officeLine(office);
  if (source.type === "complex") return { kind: "complex", items: [], missing: [], text: head };
  const category = rules.categories.find((entry) => entry.id === source.category);
  if (!category) return { kind: "listing", items: [], missing: ["kind"], text: head };
  const facts = source.facts;
  const wanted = new Set([...category.required, ...category.optional]);
  const required = new Set(category.required);
  const items = [];
  const missing = [];
  const add = (key, value, { must = required.has(key) } = {}) => {
    if (hasValue(value)) items.push({ key, label: BLOCK_LABELS[key], value });
    else if (must) missing.push(key);
  };

  const floor = needsFloor(category, inputs) ? resolveFloor(category, facts, inputs) : null;
  if (needsFloor(category, inputs) && !floor) missing.push("floor");
  const locationText = hasValue(inputs.location) ? [inputs.location, floor].filter(Boolean).join(" ") : null;
  add("location", locationText);

  const area = category.id === "land" ? (facts.landM2 ?? inputs.areaM2 ?? null) : (facts.exclusiveM2 ?? inputs.areaM2 ?? null);
  add("area", Number.isFinite(area) ? `${category.id === "land" ? "" : "전용 "}${formatArea(area)}` : null);
  add("price", formatPrice(facts));

  let kind = hasValue(inputs.kind) ? inputs.kind : null;
  if (kind && category.id !== "land") {
    if (!inputs.violation) missing.push("violation");
    else if (inputs.violation === "violation") kind = `${kind}(위반건축물)`;
    else if (inputs.violation === "unregistered") kind = `${kind}(미등기건물)`;
  }
  add("kind", kind);
  add("tradeType", TRADE_NAMES[facts.tradeType] ?? null);

  if (wanted.has("totalFloors")) {
    const total = inputs.totalFloors ?? facts.totalFloors ?? null;
    add("totalFloors", Number.isSafeInteger(total) ? `${total}층` : null);
  }
  if (wanted.has("approvalDate")) add("approvalDate", formatDate(inputs.approvalDate) || null);
  if (wanted.has("direction")) {
    const direction = inputs.direction ?? facts.direction ?? null;
    if (direction && !hasValue(inputs.directionBasis)) missing.push("directionBasis");
    add("direction", direction && inputs.directionBasis ? `${direction}(${inputs.directionBasis} 기준)` : null, { must: required.has("direction") && !direction });
  }
  if (wanted.has("rooms")) add("rooms", Number.isSafeInteger(inputs.rooms) ? `${inputs.rooms}개` : null);
  if (wanted.has("bathrooms")) add("bathrooms", Number.isSafeInteger(inputs.bathrooms) ? `${category.id === "non-residential" ? "(화장실) " : ""}${inputs.bathrooms}개` : null);
  if (wanted.has("moveIn")) add("moveIn", formatMoveIn(inputs.moveIn) || null);
  if (wanted.has("parking")) add("parking", formatParking(inputs.parking) || null);
  if (wanted.has("managementFee")) {
    const fee = inputs.managementFee ?? null;
    const omitted = fee?.type === "omit" && !required.has("managementFee");
    if (!omitted) add("managementFee", formatManagementFee(fee) || null);
  }

  const listingLine = `[매물] ${items.map((item) => `${item.label} ${item.value}`).join(" · ")}`;
  return { kind: "listing", items, missing: [...new Set(missing)], text: `${head}\n${listingLine}` };
}
