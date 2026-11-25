// 글 초안(P3) 검사(설계서 22.11절 2·5·6, 운영자 결정 2026-11-20). 화면과 Worker가 같은 함수를 쓴다.
// - 글 성격 21가지(2026-11-25, 그 전 7가지. 묶음 넷)와 거래 형태별로 쓸 수 없는 성격.
// - 화면 입력 칸 형식 검사(형식 밖이면 칸 이름만 돌려줌)와 개인정보 형식 검사(주민등록번호·사무소 번호가 아닌 전화번호·이메일·호수).
// - AI 결과 모양 검사(키 이름·글자 칸 모양). 글자 수·개수 상한(BLOG_RESULT_LIMITS)을 넘는 칸은 잘라서 받는다.
// - 글 검사: 입력과 다른 금액·면적·층·날짜는 복사를 막고, 평 표기·입력에 없는 생활 편의·직선거리·후기·가상 인물·과장 표현은 경고한다.
//   검사는 글자를 고치지 않는다. 사람이 고친 글로 다시 부른다.
import { FEE_ITEM_KEYS } from "./ad-disclosure.mjs";
import { complexDetailTexts } from "./blog-sources.mjs";

export const BLOG_STYLES = Object.freeze([
  // 기본·거래 조건
  { id: "plain", group: "terms", label: "담백하게", note: "사실만 차분하게 씁니다.", instruction: "과장 없이 사실을 차분하게 정리한다." },
  { id: "urgent", group: "terms", label: "급매", note: "가격·조건이 좋은 점을 앞에 둡니다. 급매로 의뢰받은 매물에만 쓰세요.", instruction: "급매 매물로 소개하되 입력된 가격·조건만 앞에 두고, 가격이 오른다·손해 없다 같은 말은 쓰지 않는다." },
  { id: "jeonse", group: "terms", label: "전세 안내", note: "전세 조건과 계약 때 확인할 점을 씁니다.", instruction: "전세 조건을 정리하고 계약 전에 등기부·보증금 반환 조건을 확인하라는 일반 안내를 덧붙인다." },
  { id: "monthly", group: "terms", label: "월세", note: "보증금·월세 조건과 입주 조건을 씁니다.", instruction: "보증금·월세 조건과 입주 조건을 정리한다." },
  { id: "yield", group: "terms", label: "수익형", note: "임대 조건을 숫자 그대로 씁니다. 수익을 약속하는 말은 쓰지 않습니다.", instruction: "임대·수익형 관점으로 쓰되 입력에 없는 수익률·임대료를 지어내지 않고 수익을 약속하는 말을 쓰지 않는다." },
  { id: "invest", group: "terms", label: "투자", note: "공개 자료의 사실만 씁니다. 오른다·보장 같은 말은 쓰지 않습니다.", instruction: "입력된 사실만으로 투자 관점의 장점을 정리하되 시세 상승·시세차익·보장 같은 단정은 쓰지 않는다." },
  { id: "redevelop", group: "terms", label: "재건축·재개발", memoHead: "사업 단계", note: "재건축·재개발 이야기를 앞에 둡니다. 사업 단계·일정처럼 확인한 사실을 아래 칸에 적어야 글이 됩니다. 앞으로의 가격은 쓰지 않습니다.", instruction: "재건축·재개발 관점으로 쓰되 입력에 있는 사업 단계·일정만 말하고, 입력에 없으면 사업 이야기를 꺼내지 않는다." },
  { id: "market", group: "terms", label: "시황·타이밍", memoHead: "최근 거래", note: "요즘 거래 흐름 속에서 소개합니다. 최근 거래·시세처럼 확인한 사실을 아래 칸에 적어야 글이 됩니다. 앞으로의 가격은 쓰지 않습니다.", instruction: "요즘 시장 흐름 속에서 소개하되 입력에 있는 거래·시세 사실만 말하고 앞으로의 가격은 내다보지 않는다." },
  // 누구에게 권할지
  { id: "live", group: "who", label: "실거주", note: "구조·방향·생활 동선처럼 사는 사람 눈으로 씁니다.", instruction: "실제로 살 사람 눈으로 구조·방향·채광처럼 입력된 사실을 풀어 쓴다." },
  { id: "firsthome", group: "who", label: "신혼부부·첫 집", note: "처음 집을 마련하는 신혼부부 눈으로 씁니다.", instruction: "신혼부부나 처음 집을 마련하는 사람 눈으로 입력된 사실을 풀어 쓴다." },
  { id: "retire", group: "who", label: "은퇴·실속", note: "관리비·층·면적처럼 살림에 드는 것을 앞에 둡니다.", instruction: "은퇴했거나 실속을 따지는 사람 눈으로 관리비·층·면적처럼 입력된 사실을 풀어 쓴다." },
  { id: "upgrade", group: "who", label: "갈아타기", note: "더 넓거나 여건이 나은 집으로 옮기려는 분 눈으로 씁니다.", instruction: "지금 집에서 더 넓거나 여건이 나은 집으로 옮기려는 사람 눈으로 입력된 사실을 풀어 쓴다." },
  { id: "beginner", group: "who", label: "처음 사는 분", note: "부동산 용어를 풀어서, 처음 알아보는 분도 알 수 있게 씁니다.", instruction: "부동산을 처음 알아보는 사람도 알 수 있게 용어를 풀어 쓴다." },
  // 무엇을 앞에 둘지
  { id: "school", group: "point", label: "학군·교육", note: "학교·교육 여건을 앞에 둡니다. 공개 자료와 아래 칸에 적은 것만 씁니다.", instruction: "학교·교육 여건을 앞에 두되 입력에 있는 학교·시설만 말한다." },
  { id: "transit", group: "point", label: "역세권·교통", note: "역·버스처럼 다니는 길을 앞에 둡니다. 공개 자료와 아래 칸에 적은 것만 씁니다.", instruction: "역·버스 같은 교통을 앞에 두되 입력에 있는 역·노선·시간만 말한다." },
  { id: "community", group: "point", label: "대단지·시설", note: "단지 규모와 단지 안 시설을 앞에 둡니다. 공개 자료와 아래 칸에 적은 것만 씁니다.", instruction: "단지 규모와 단지 안 시설을 앞에 두되 입력에 있는 세대수·시설만 말한다." },
  { id: "condition", group: "point", label: "신축·상태", note: "지은 해와 집 상태를 앞에 둡니다. 공개 자료와 아래 칸에 적은 것만 씁니다.", instruction: "지은 해와 집 상태를 앞에 두되 입력에 있는 사용승인일·수리 내용만 말한다." },
  { id: "view", group: "point", label: "조망·채광", note: "창밖 전망과 햇빛을 앞에 둡니다. 공개 자료와 아래 칸에 적은 것만 씁니다.", instruction: "창밖 전망과 채광을 앞에 두되 입력에 있는 방향·층·전망만 말한다." },
  // 글 짜임
  { id: "faq", group: "form", label: "자주 묻는 질문", note: "손님이 자주 묻는 것을 묻고 답하는 꼴로 씁니다.", instruction: "손님이 자주 묻는 질문과 답의 꼴로 쓰되 입력된 사실로 답할 수 있는 질문만 쓴다." },
  { id: "fit", group: "form", label: "이런 분께 추천", note: "어떤 분께 맞는 집인지 짚어 씁니다.", instruction: "어떤 사람에게 맞는 집인지 입력된 사실을 근거로 짚어 쓴다." },
  { id: "story", group: "form", label: "경험담", memoHead: "직접 본 것", note: "대표가 현장에서 직접 본 것을 이야기하듯 씁니다. 직접 본 것을 아래 칸에 적어야 글이 됩니다. 손님 후기는 쓰지 않습니다.", instruction: "중개사가 현장에서 직접 본 것을 이야기하듯 쓰되 입력의 현장 메모에 있는 것만 경험으로 말한다." },
]);
// 화면에서 성격을 나눠 보이는 묶음 넷(차례대로). 성격의 group이 이 id다.
export const BLOG_STYLE_GROUPS = Object.freeze([
  { id: "terms", label: "기본·거래 조건" },
  { id: "who", label: "누구에게 권할지" },
  { id: "point", label: "무엇을 앞에 둘지" },
  { id: "form", label: "글 짜임" },
]);
const STYLE_IDS = new Set(BLOG_STYLES.map((style) => style.id));
// 거래 형태별로 고를 수 없는 성격(매매에 전세 안내·월세를 쓰지 않음 등). 그 밖의 성격은 모두 고를 수 있다.
// 급매·수익형·투자·재건축·재개발은 사는 사람 쪽 이야기라 전세·월세 매물에 쓰지 않고, 단지 소개 글은 매물 조건이 없어 급매·전세 안내·월세·수익형을 쓰지 않는다.
const STYLES_OFF_BY_TRADE = {
  sale: ["jeonse", "monthly"],
  jeonse: ["urgent", "monthly", "yield", "invest", "redevelop"],
  "monthly-rent": ["urgent", "jeonse", "yield", "invest", "redevelop"],
  complex: ["urgent", "jeonse", "monthly", "yield"],
};
export function allowedStyles(source) {
  const off = STYLES_OFF_BY_TRADE[source?.type === "complex" ? "complex" : source?.facts?.tradeType];
  if (!off) return ["plain"];
  return BLOG_STYLES.filter((style) => !off.includes(style.id)).map((style) => style.id);
}

// sections·heading·sectionParagraphs·checklist·checkItem은 소제목이 있는 새 꼴(2026-11-23 "길이·구성 지시")에만 쓴다.
// AI 지시문에는 이 숫자를 적지 않는다(2026-11-24). 넘친 결과는 validateBlogResult()가 이 상한으로 잘라서 받는다.
export const BLOG_RESULT_LIMITS = Object.freeze({ title: 60, paragraphs: 12, paragraph: 600, hashtags: 10, hashtag: 30, snsShort: 200, factsUsed: 30, fact: 200,
  sections: 8, heading: 40, sectionParagraphs: 4, checklist: 10, checkItem: 120,
  // 올릴 곳 글(2026-11-25): 인스타그램 글과 스레드 글. 스레드 500자는 그곳의 글 상한이고, 명시사항을 붙인 뒤의 한도는 화면(blog-places.mjs placeVerdict)이 본다.
  instagram: 1200, threads: 500 });
export const EMPHASIS_MAX = 500;
export const LOCATION_MAX = 100;

// ── 현장 메모 머리말 ──
// 화면의 '빠르게 넣기' 단추가 메모 칸에 넣는 머리말("역·교통: "). 화면 단추(blog-style-view.mjs)와 서버가 같이 쓴다.
export const MEMO_HEADS = Object.freeze({
  listing: Object.freeze(["역·교통", "학교", "상권", "수리·상태", "전망·채광"]),
  complex: Object.freeze(["역·교통", "학교", "상권", "단지 시설"]),
});
const KNOWN_MEMO_HEADS = new Set([...MEMO_HEADS.listing, ...MEMO_HEADS.complex, ...BLOG_STYLES.map((style) => style.memoHead).filter(Boolean)]);
// 단추가 넣은 머리말만 있고 뒤에 쓴 글이 없는 줄("학교: ")인지. 단추가 아는 머리말만 본다(사용자가 직접 쓴 "주차:" 같은 줄은 건드리지 않음).
const isEmptyMemoHeadLine = (line) => {
  const text = line.trim();
  return text.endsWith(":") && KNOWN_MEMO_HEADS.has(text.slice(0, -1).trimEnd());
};
// 머리말만 있는 줄을 뺀 메모(앞뒤 공백 정리). 단추만 누르고 글을 쓰지 않은 메모는 빈 글자가 된다.
// 빈 메모 알림(memoNeedText)과 AI에 보내는 메모(validateEmphasis)가 같이 써서, 화면이 비었다고 본 메모는 서버도 빈 메모로 받는다.
export function dropEmptyMemoHeads(value) {
  return String(value ?? "").split("\n").filter((line) => !isEmptyMemoHeadLine(line)).join("\n").trim();
}
const DIRECTIONS = new Set(["동향", "서향", "남향", "북향", "남동향", "남서향", "북동향", "북서향"]);
const MOVE_IN_PARTS = new Set(["초순", "중순", "하순"]);
const INPUT_KEYS = new Set(["location", "areaM2", "kind", "violation", "totalFloors", "floorMode", "floorNumber", "floorBand", "moveIn", "rooms", "bathrooms",
  "approvalDate", "parking", "managementFee", "direction", "directionBasis"]);

// ── 개인정보 형식 ──
const RRN = /(?<!\d)\d{6}\s*[-.‐-―−]?\s*[1-8]\d{6}(?!\d)/u;
// 구분 글자: 공백·점·괄호·하이픈과 줄표(‐ ‑ ‒ – — ― −). "(010)1234-5678"·"010–1234–5678"도 잡는다.
const PHONE = /(?<!\d)0(?:1[016789]|[2-6]\d{0,1}|70|50\d?)(?:[\s.()\-‐-―−]{0,2}\d){7,8}(?!\d)/gu;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const UNIT = /(?<!\d)\d{1,4}\s*호(?!선|점|기|차|텔)/u;
const UNIT_ALL = new RegExp(UNIT.source, "gu");
const digitsOf = (value) => value.replace(/\D/gu, "");

// 글자 하나에서 찾은 개인정보 형식 이름들(rrn·phone·email·unit). 사무소 확정 번호는 빼고 본다.
export function findPersonalPatterns(text, { officePhone = "", checkUnit = false } = {}) {
  if (typeof text !== "string" || text === "") return [];
  const value = text.normalize("NFKC");
  const found = [];
  if (RRN.test(value)) found.push("rrn");
  const office = digitsOf(officePhone);
  for (const match of value.matchAll(PHONE)) {
    if (!office || digitsOf(match[0]) !== office) {
      found.push("phone");
      break;
    }
  }
  if (EMAIL.test(value)) found.push("email");
  if (checkUnit && UNIT.test(value)) found.push("unit");
  return found;
}

// ── 화면 입력 형식 ──
const isInt = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const isDecimal = (value, min, max, places) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
  && Math.abs(Math.round(value * 10 ** places) - value * 10 ** places) < 1e-6;
const isText = (value, max) => typeof value === "string" && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= "2100-12-31";
}
const isMonth = (value) => typeof value === "string" && /^(19|20)\d{2}-(0[1-9]|1[0-2])$/u.test(value);
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function readMoveIn(value) {
  if (!isPlainObject(value)) return undefined;
  if (value.type === "now" && Object.keys(value).length === 1) return { type: "now" };
  if (value.type === "date" && isCalendarDate(value.date) && Object.keys(value).length === 2) return { type: "date", date: value.date };
  if (value.type === "period" && isMonth(value.month) && MOVE_IN_PARTS.has(value.part) && Object.keys(value).length === 3) return { type: "period", month: value.month, part: value.part };
  return undefined;
}

function readParking(value) {
  if (!isPlainObject(value)) return undefined;
  const keys = Object.keys(value);
  if (keys.some((key) => !["basis", "value", "actual"].includes(key))) return undefined;
  const actual = value.actual === undefined || value.actual === null ? null : value.actual;
  if (actual !== null && !isDecimal(actual, 0, 10_000, 2)) return undefined;
  if (value.basis === "total" && isInt(value.value, 0, 10_000)) return { basis: "total", value: value.value, actual };
  if (value.basis === "perHousehold" && isDecimal(value.value, 0, 10, 2)) return { basis: "perHousehold", value: value.value, actual };
  return undefined;
}

function readManagementFee(value) {
  if (!isPlainObject(value)) return undefined;
  if (value.type === "omit" && Object.keys(value).length === 1) return { type: "omit" };
  if (!isInt(value.monthlyWon, 0, 10_000_000)) return undefined;
  if (value.type === "average") {
    if (Object.keys(value).some((key) => !["type", "monthlyWon", "included"].includes(key))) return undefined;
    const included = Array.isArray(value.included) ? [...new Set(value.included)] : [];
    if (included.length === 0 || included.some((key) => !FEE_ITEM_KEYS.includes(key))) return undefined;
    return { type: "average", monthlyWon: value.monthlyWon, included: FEE_ITEM_KEYS.filter((key) => included.includes(key)) };
  }
  if (value.type === "fixed") {
    if (Object.keys(value).some((key) => !["type", "monthlyWon", "items", "itemsUnknown"].includes(key))) return undefined;
    const itemsUnknown = value.itemsUnknown === true;
    if (value.itemsUnknown !== undefined && typeof value.itemsUnknown !== "boolean") return undefined;
    let items = null;
    if (value.items !== undefined && value.items !== null) {
      if (!isPlainObject(value.items) || Object.keys(value.items).length !== FEE_ITEM_KEYS.length) return undefined;
      if (FEE_ITEM_KEYS.some((key) => !isInt(value.items[key], 0, 10_000_000))) return undefined;
      items = Object.fromEntries(FEE_ITEM_KEYS.map((key) => [key, value.items[key]]));
    }
    if (value.monthlyWon >= 100_000 && !itemsUnknown && !items) return { type: "fixed", monthlyWon: value.monthlyWon, items: null, itemsUnknown: false, incomplete: true };
    return { type: "fixed", monthlyWon: value.monthlyWon, items, itemsUnknown };
  }
  return undefined;
}

// 만들기 요청의 inputs 검사. 모르는 칸·형식 밖 값은 errors(칸 이름), 개인정보 형식은 personal(칸 이름).
// 빈 칸(null·"")은 넣지 않은 것으로 본다. 필수 칸이 다 찼는지는 ad-disclosure.mjs buildDisclosure()가 본다.
export function validateBlogInputs(raw, { officePhone = "" } = {}) {
  const errors = [];
  const personal = [];
  const inputs = {};
  if (raw === undefined || raw === null) return { inputs, errors, personal };
  if (!isPlainObject(raw)) return { inputs, errors: ["inputs"], personal };
  for (const key of Object.keys(raw)) if (!INPUT_KEYS.has(key)) errors.push(key);
  const present = (key) => raw[key] !== undefined && raw[key] !== null && raw[key] !== "";
  const take = (key, ok, value = raw[key]) => {
    if (!present(key)) return;
    if (ok) inputs[key] = value;
    else errors.push(key);
  };
  take("location", isText(raw.location, LOCATION_MAX), typeof raw.location === "string" ? raw.location.trim().replace(/\s+/gu, " ") : null);
  take("areaM2", isDecimal(raw.areaM2, 0.01, 1_000_000, 2));
  take("kind", isText(raw.kind, 30), typeof raw.kind === "string" ? raw.kind.trim() : null);
  take("violation", ["none", "violation", "unregistered"].includes(raw.violation));
  take("totalFloors", isInt(raw.totalFloors, 1, 100));
  take("floorMode", ["number", "band"].includes(raw.floorMode));
  take("floorNumber", isInt(raw.floorNumber, -10, 100) && raw.floorNumber !== 0);
  take("floorBand", ["저", "중", "고"].includes(raw.floorBand));
  take("rooms", isInt(raw.rooms, 0, 20));
  take("bathrooms", isInt(raw.bathrooms, 0, 20));
  take("approvalDate", isCalendarDate(raw.approvalDate));
  take("direction", DIRECTIONS.has(raw.direction));
  take("directionBasis", isText(raw.directionBasis, 20), typeof raw.directionBasis === "string" ? raw.directionBasis.trim() : null);
  if (present("moveIn")) {
    const moveIn = readMoveIn(raw.moveIn);
    if (moveIn) inputs.moveIn = moveIn;
    else errors.push("moveIn");
  }
  if (present("parking")) {
    const parking = readParking(raw.parking);
    if (parking) inputs.parking = parking;
    else errors.push("parking");
  }
  if (present("managementFee")) {
    const fee = readManagementFee(raw.managementFee);
    if (!fee) errors.push("managementFee");
    else if (!fee.incomplete) inputs.managementFee = fee;
  }
  for (const key of ["location", "kind", "directionBasis"]) {
    if (typeof inputs[key] === "string" && findPersonalPatterns(inputs[key], { officePhone, checkUnit: key === "location" }).length > 0) personal.push(key);
  }
  return { inputs, errors: [...new Set(errors)], personal };
}

export function validateEmphasis(raw, { officePhone = "" } = {}) {
  if (raw === undefined || raw === null || raw === "") return { emphasis: "", error: false, personal: false };
  if (typeof raw !== "string" || raw.length > EMPHASIS_MAX || /[\u0000-\u0009\u000b-\u001f\u007f]/u.test(raw)) return { emphasis: "", error: true, personal: false };
  // 머리말만 있는 줄("학교: ")은 사실이 아니라 빈 칸이므로 빼고 받는다(화면이 보내기 전과 서버가 받은 뒤 둘 다 이 함수를 지난다).
  const emphasis = dropEmptyMemoHeads(raw);
  return { emphasis, error: false, personal: findPersonalPatterns(emphasis, { officePhone, checkUnit: true }).length > 0 };
}

// ── AI 결과 모양 ──
// 세 꼴을 받는다.
// - 옛 꼴(키 5개): title·paragraphs·hashtags·snsShort·factsUsed. 2026-11-23 전에 만든 초안과 같은 모양으로 돌려준다.
// - 소제목 꼴(키 6개): title·sections[{ heading, paragraphs[] }]·checklist[]·hashtags·snsShort·factsUsed. 2026-11-25 전에 만든 초안.
// - 올릴 곳 꼴(키 7개, 2026-11-25부터 AI에 이 꼴로 받는다): 소제목 꼴에서 snsShort 대신 instagram·threads(올릴 곳마다 따로 쓴 글).
//   돌려주는 값에는 snsShort가 없고 instagram·threads가 있다. 앞의 두 꼴은 그 반대다(화면이 snsShort를 두 곳에 같이 보임).
//   저장·화면은 문단을 한 줄로 펴서 paragraphs에 두고, headings(paragraphs와 같은 길이, 소제목이 시작되는 문단에만 글자, 나머지는 "")와 checklist를 함께 둔다.
//   그래서 숫자 검사·복사·화면의 문단 칸은 옛 꼴과 같은 paragraphs를 그대로 쓴다.
// 2026-11-24부터 AI 지시문에 글자 수·개수를 적지 않고(사용자 결정 "제약을 많이 걸지 말라"), 넘친 결과는 버리지 않고 잘라서 받는다.
// - 글자 수가 BLOG_RESULT_LIMITS를 넘는 칸은 cutBlogText()로 자르고, 개수가 넘는 목록은 앞에서부터 상한 개수만 남긴다.
// - 빈 글자 항목(공백뿐, 해시태그는 '#'뿐)은 버린다. 문단이 하나도 없는 소제목 칸은 소제목째 버린다.
// - 잘랐으면 result.trimmed = true(화면이 한 줄로 알림). 자르지 않았으면 이 키가 없다(그 전 초안과 같은 모양).
// 실패({ ok: false })는 모양이 다를 때(객체 아님·키 이름이 다름·글자 칸이 글자가 아님·목록이 배열이 아님)와 제목이나 문단이 비었을 때뿐이다. 원문은 돌려주지 않는다.
export function validateBlogResult(value) {
  const L = BLOG_RESULT_LIMITS;
  if (!isPlainObject(value)) return { ok: false };
  const keys = Object.keys(value).sort().join(",");
  const placed = keys === "checklist,factsUsed,hashtags,instagram,sections,threads,title";
  const sectioned = placed || keys === "checklist,factsUsed,hashtags,sections,snsShort,title";
  if (!sectioned && keys !== "factsUsed,hashtags,paragraphs,snsShort,title") return { ok: false };
  const isText = (item) => typeof item === "string";
  const isTextList = (list) => Array.isArray(list) && list.every(isText);
  if (!isText(value.title) || !isTextList(value.hashtags) || !isTextList(value.factsUsed)) return { ok: false };
  if (placed ? !isText(value.instagram) || !isText(value.threads) : !isText(value.snsShort)) return { ok: false };
  if (sectioned) {
    const isSection = (section) => isPlainObject(section) && Object.keys(section).sort().join(",") === "heading,paragraphs" && isText(section.heading) && isTextList(section.paragraphs);
    if (!isTextList(value.checklist) || !Array.isArray(value.sections) || !value.sections.every(isSection)) return { ok: false };
  } else if (!isTextList(value.paragraphs)) return { ok: false };

  let trimmed = false;
  const cut = (item, max) => {
    const whole = item.trim();
    const out = cutBlogText(whole, max);
    if (out.length < whole.length) trimmed = true;
    return out;
  };
  // 목록: 앞뒤 공백 정리 → (clean으로 앞 글자 정리) → 빈 항목 버림 → 앞에서 maxCount개 → 각 maxLength로 자름.
  const textList = (items, maxCount, maxLength, clean = (item) => item) => {
    const kept = items.map((item) => clean(item.trim())).filter(Boolean);
    if (kept.length > maxCount) trimmed = true;
    return kept.slice(0, maxCount).map((item) => cut(item, maxLength));
  };
  const title = cut(value.title, L.title);
  const common = {
    hashtags: textList(value.hashtags, L.hashtags, L.hashtag, (item) => item.replace(/^#*/u, "").trim()).map((item) => `#${item}`),
    ...(placed ? { instagram: cut(value.instagram, L.instagram), threads: cut(value.threads, L.threads) } : { snsShort: cut(value.snsShort, L.snsShort) }),
    factsUsed: textList(value.factsUsed, L.factsUsed, L.fact),
  };
  const mark = () => (trimmed ? { trimmed: true } : {});
  if (!sectioned) {
    const paragraphs = textList(value.paragraphs, L.paragraphs, L.paragraph);
    if (!title || paragraphs.length === 0) return { ok: false };
    return { ok: true, result: { title, paragraphs, ...common, ...mark() } };
  }
  const filled = value.sections.filter((section) => section.paragraphs.some((item) => item.trim()));
  if (filled.length > L.sections) trimmed = true;
  const paragraphs = [];
  const headings = [];
  for (const section of filled.slice(0, L.sections)) {
    const heading = cut(section.heading, L.heading);
    textList(section.paragraphs, L.sectionParagraphs, L.paragraph).forEach((item, index) => {
      paragraphs.push(item);
      headings.push(index === 0 ? heading : "");
    });
  }
  const checklist = textList(value.checklist, L.checklist, L.checkItem, (item) => item.replace(/^[-•·]\s*/u, ""));
  if (!title || paragraphs.length === 0) return { ok: false };
  return { ok: true, result: { title, paragraphs, headings, checklist, ...common, ...mark() } };
}

// 상한을 넘는 글을 자른다. 상한 안의 마지막 문장 끝(. ! ? 。 바로 뒤가 공백)이 상한의 절반보다 뒤에 있으면 거기서,
// 없으면 상한 글자에서 그냥 자른다(이모지 같은 두 칸 글자를 반으로 가르지 않음). 자른 글은 복사 글에 그대로 들어가므로 "…"은 붙이지 않는다.
export function cutBlogText(text, max) {
  const value = String(text ?? "").trim();
  if (value.length <= max) return value;
  for (let index = max - 1; index >= Math.floor(max / 2); index -= 1) {
    if (/[.!?。]/u.test(value[index]) && /\s/u.test(value[index + 1])) return value.slice(0, index + 1).trim();
  }
  const code = value.charCodeAt(max - 1);
  return value.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max).trim();
}

// ── 글 속 숫자 읽기 ──
// 읽기 전에 전각 숫자·쉼표·점을 반각으로 바꾸고(㎡ 같은 단위 글자는 그대로 두려고 NFKC 전체는 쓰지 않음),
// "5천만"·"3천5백만"·"5천 원"의 천·백을 숫자로 푼다. 천·백 바로 뒤에 만·원이 올 때만 푼다("천동" 같은 땅 이름은 그대로).
export function normalizeNumberText(text) {
  return String(text ?? "").replace(/[０-９，．]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/(\d+(?:\.\d+)?)천(?:\s*(\d+)백)?(?=\s*(?:만|원))/gu, (_, thousand, hundred) => String(Math.round(Number(thousand) * 1000 + (hundred ? Number(hundred) * 100 : 0))))
    .replace(/(\d+)백(?=\s*(?:만|원))/gu, (_, hundred) => String(Number(hundred) * 100));
}
const NUM = "\\d{1,3}(?:,\\d{3})+|\\d+(?:\\.\\d+)?";
const toNumber = (text) => Number(String(text).replace(/,/gu, ""));
// 금액: "2억 6,000만 원"·"2억6000만원"·"2.6억"·"26,000만 원"·"140만 원"·"3억". 원 단위 정수로.
const MONEY = new RegExp(`(?:(${NUM})\\s*억(?:\\s*(${NUM})\\s*만)?|(${NUM})\\s*만)(?:\\s*(${NUM}))?\\s*(?:원)?`, "gu");
export function extractMoney(text) {
  const found = [];
  for (const match of String(text).matchAll(MONEY)) {
    const [whole, eok, eokMan, man, tail] = match;
    let won;
    if (eok !== undefined) won = toNumber(eok) * 100_000_000 + (eokMan !== undefined ? toNumber(eokMan) * 10_000 : 0);
    else won = toNumber(man) * 10_000;
    // "2억 6,000"처럼 만이 빠진 꼬리는 만 원 단위로 본다(공개 매물 표기와 같음). "8,500원"처럼 원으로 끝나면 원 단위.
    if (tail !== undefined && /원$/u.test(whole)) won += toNumber(tail);
    else if (tail !== undefined && eok !== undefined && eokMan === undefined && toNumber(tail) < 10_000) won += toNumber(tail) * 10_000;
    found.push({ text: whole.trim(), won: Math.round(won) });
  }
  return found;
}
// 억·만 없이 원으로만 쓴 금액("250,000원"·"8500원"). 억·만 표기 뒤 꼬리는 위에서 이미 읽었으므로 앞에 억·만이 붙은 것은 뺀다.
const WON_ONLY = /(?<![\d.억만]\s?)(?<!\d,)(\d{1,3}(?:,\d{3})+|\d{4,})\s*원/gu;
export function extractAllMoney(text) {
  const value = String(text);
  return [...extractMoney(value), ...[...value.matchAll(WON_ONLY)].map((match) => ({ text: match[0], won: toNumber(match[1]) }))];
}
const AREA = new RegExp(`(${NUM})\\s*(?:㎡|m²|m2|제곱미터)`, "gu");
export const extractAreas = (text) => [...String(text).matchAll(AREA)].map((match) => ({ text: match[0], m2: toNumber(match[1]) }));
const FLOOR = /(?:지하\s*)?(\d{1,3})\s*층/gu;
export const extractFloors = (text) => [...String(text).matchAll(FLOOR)].map((match) => ({ text: match[0], floor: Number(match[1]) * (match[0].startsWith("지하") ? -1 : 1) }));
const FULL_DATE = /(\d{4})\s*(?:년\s*|[.-]\s*)(\d{1,2})\s*(?:월\s*|[.-]\s*)(\d{1,2})\s*일?/gu;
const MONTH_DATE = /(\d{4})\s*년\s*(\d{1,2})\s*월(?!\s*\d)/gu;
const pad = (value) => String(value).padStart(2, "0");
export function extractDates(text) {
  const value = String(text);
  const full = [...value.matchAll(FULL_DATE)].map((match) => ({ text: match[0].trim(), date: `${match[1]}-${pad(match[2])}-${pad(match[3])}` }));
  const months = [...value.matchAll(MONTH_DATE)].map((match) => ({ text: match[0].trim(), month: `${match[1]}-${pad(match[2])}` }));
  return { full, months };
}

// 입력 사실에서 허용 숫자 모음을 만든다. emphasis(사람이 쓴 강조점)에 나온 숫자도 허용한다.
export function allowedNumbers({ source, inputs = {}, emphasis = "" }) {
  const money = new Set();
  const areas = new Set();
  const floors = new Set();
  const dates = new Set();
  const months = new Set();
  const addText = (raw) => {
    const text = normalizeNumberText(raw);
    for (const item of extractAllMoney(text)) money.add(item.won);
    for (const item of extractAreas(text)) areas.add(item.m2);
    for (const item of extractFloors(text)) floors.add(item.floor);
    const found = extractDates(text);
    for (const item of found.full) dates.add(item.date);
    for (const item of found.months) months.add(item.month);
  };
  addText(emphasis);
  if (source.type === "complex") {
    for (const fact of source.facts.items) addText(`${fact.label} ${fact.value}`);
    addText(source.facts.summary);
    // 함께 보낸 단지 자료(highlights·unitGroups 등)의 숫자도 입력에 있는 숫자로 친다. 칸마다 따로 읽어 칸을 넘는 숫자가 생기지 않게 한다.
    for (const text of complexDetailTexts(source.facts.details)) addText(text);
    return { money, areas, floors, dates, months, complex: true };
  }
  const facts = source.facts;
  for (const won of [facts.priceWon, facts.depositWon, facts.monthlyRentWon]) if (Number.isSafeInteger(won)) money.add(won);
  const fee = inputs.managementFee;
  if (fee && fee.type !== "omit") {
    money.add(fee.monthlyWon);
    if (fee.items) for (const won of Object.values(fee.items)) money.add(won);
  }
  for (const m2 of [facts.exclusiveM2, facts.landM2, inputs.areaM2, ...(facts.otherAreasM2 ?? [])]) if (Number.isFinite(m2)) areas.add(m2);
  if (inputs.floorMode !== "band") for (const floor of [inputs.floorNumber, facts.floor]) if (Number.isSafeInteger(floor)) floors.add(floor);
  for (const floor of [inputs.totalFloors, facts.totalFloors]) if (Number.isSafeInteger(floor)) floors.add(floor);
  if (inputs.approvalDate) {
    dates.add(inputs.approvalDate);
    months.add(inputs.approvalDate.slice(0, 7));
  }
  if (inputs.moveIn?.type === "date") {
    dates.add(inputs.moveIn.date);
    months.add(inputs.moveIn.date.slice(0, 7));
  }
  if (inputs.moveIn?.type === "period") months.add(inputs.moveIn.month);
  return { money, areas, floors, dates, months, complex: false };
}

// ── 경고 낱말 ──
const AMENITY_WORDS = ["초등학교", "중학교", "고등학교", "학교", "학군", "학원가", "학원", "지하철", "전철", "버스", "정류장", "마트", "백화점", "병원", "공원", "편의점", "어린이집", "유치원", "역세권", "숲세권", "학세권", "슬세권", "몰세권"];
const STATION = /[가-힣]{1,8}역(?![가-힣])/gu;
// 역으로 끝나지만 역 이름이 아닌 낱말(뒤에 띄어쓰기·문장부호가 올 때만 걸리므로 몇 개면 됨).
const NOT_STATION = ["지역", "구역", "영역", "전역", "권역", "현역", "해역", "광역", "통역", "번역", "방역"];
const WALK = /도보\s*\d+\s*분/gu;
const DISTANCE = /직선\s*거리/u;
const REVIEW = /(후기|실제\s*입주민|입주민\s*(?:들의|분들|이\s*말)|살아\s*보니|살아\s*본|만족도\s*\d|추천\s*후기)/u;
const PERSONA = /(?:[가-힣]{2,3}|[A-Z])\s?씨(?=[는가의께이,\s])/u;
const HYPE = /(보장|확실|무조건|반드시\s*오|오를\s*(?:것|수밖에|일만)|오른다|상승\s*(?:예정|확실|보장)|시세\s*차익|수익률\s*\d|대박|100\s*%|손해\s*(?:없|볼\s*일)|투자\s*가치\s*최고|프리미엄\s*(?:확정|보장))/u;
// 2026-11-25 글 성격을 늘리며(경험담·시황·타이밍·재건축·재개발 등) 더한 꼴. AI 지시문에는 금지 목록을 넣지 않고 받은 뒤 여기서 잡는다(경고, 복사는 됨).
// 지어낸 손님 말(따옴표로 옮긴 말·"손님이 … 만족하셨")과 지어낸 손님 사례("어느 손님이"·"30대 … 고객이"), 수익·가격을 약속하는 말을 더 잡는다.
// 중개사가 직접 본 것을 쓴 문장이 사실인지는 글자로 가릴 수 없다(사람이 읽고 확인).
const REVIEW_MORE = /((?:손님|고객|세입자|입주민|매수인|임차인)(?:들|분들)?(?:이|은|께서|도)\s*[^.!?\n]{0,15}(?:만족하셨|만족해\s*하|칭찬|호평|말씀하셨|좋아하셨)|["“][^"”\n]{4,80}["”]\s*(?:(?:라고|라며)\s*(?:말씀|하셨|하시|했|칭찬|만족|좋아|전하)|라는\s*(?:말씀|말|반응|평|후기))|별점|평점\s*\d)/u;
const PERSONA_MORE = /((?<![가-힣])(?:어느|한)\s*(?:손님|고객|부부|신혼부부|어르신)(?:분|분들)?(?:이|가|께서|도)(?![가-힣])|[2-7]0대[^.!?\n]{0,10}(?:손님|고객|부부)(?:분|분들)?(?:이|가|께서|도)(?![가-힣]))/u;
const HYPE_MORE = /(확정\s*수익|수익\s*확정|안전\s*마진|불패|폭등|급등|마지막\s*기회|놓치면\s*후회|(?<![가-힣])연\s*\d+(?:[.,]\d+)?\s*%|(?<![가-힣])월\s*수익|상승\s*(?:여력|전망|기대)|(?:값|가격|시세)(?:이|가)?\s*(?:더\s*)?오를|더\s*오르)/u;

const sameArea = (a, b) => Math.abs(a - b) < 0.005;

// 글 검사. draft: { title, paragraphs[], hashtags[], snsShort } 또는 snsShort 대신 { instagram, threads }(올릴 곳 꼴). 돌려주는 값: { blocks[], warnings[] }.
// 항목 모양: { kind, text, where }. where는 "title"·"p1"…·"sns"(올릴 곳 꼴은 "instagram"·"threads"). 숫자 다름(block)은 복사를 막는다.
// 카카오톡 글은 따로 받지 않고 제목과 인스타그램 글로 코드가 만들므로(blog-places.mjs) 따로 볼 칸이 없다.
// 2026-11-24부터 결과 글 칸 전부의 주민등록번호·전화번호(사무소 공개 번호 officePhone 빼고)·이메일·호수 꼴도 복사를 막는다(kind "personal",
// text는 찾은 글자 대신 종류 이름만 적는다. check_json이 D1에 남기 때문). 공개 자료에 그대로 있는 호수(사무소 '105호' 같은 것)는 막지 않는다.
// 지번은 따로 보지 않는다(입력에 소재지를 보내지 않으므로 '입력에 있는 사실만' 지시문에 맡김, 대장 결정 2026-11-24).
export function checkBlogDraft(draft, { source, inputs = {}, emphasis = "", officePhone = "" }) {
  const allowed = allowedNumbers({ source, inputs, emphasis });
  const inputText = [emphasis, source.title, source.facts.summary,
    ...(source.type === "complex" ? [...source.facts.items.map((fact) => `${fact.label} ${fact.value}`), ...complexDetailTexts(source.facts.details)] : [])].join(" ");
  const publicUnits = new Set([...inputText.normalize("NFKC").matchAll(UNIT_ALL)].map((match) => match[0].replace(/\s/gu, "")));
  const blocks = [];
  const warnings = [];
  // 해시태그도 복사하는 글에 들어가므로 같은 숫자 대조를 한다.
  // 소제목(h1…, 그 문단 번호)과 '현장에서 확인할 점'(check)도 복사하는 글에 들어가므로 같이 본다. 옛 꼴 초안에는 둘 다 없다.
  const headingParts = (draft.headings ?? []).map((text, index) => [`h${index + 1}`, text]).filter(([, text]) => typeof text === "string" && text.trim());
  const parts = [["title", draft.title], ...headingParts, ...draft.paragraphs.map((text, index) => [`p${index + 1}`, text]),
    ...(draft.checklist ?? []).map((text) => ["check", text]),
    ...(typeof draft.instagram === "string" || typeof draft.threads === "string" ? [["instagram", draft.instagram], ["threads", draft.threads]] : [["sns", draft.snsShort]]),
    ["tags", (draft.hashtags ?? []).join(" ")]];
  for (const [where, raw] of parts) {
    const scrubbed = String(raw ?? "").normalize("NFKC").replace(UNIT_ALL, (unit) => (publicUnits.has(unit.replace(/\s/gu, "")) ? " " : unit));
    for (const kind of findPersonalPatterns(scrubbed, { officePhone, checkUnit: true })) blocks.push({ kind: "personal", text: PERSONAL_LABELS[kind], where });
    const text = normalizeNumberText(raw);
    for (const item of extractAllMoney(text)) {
      if (allowed.complex) blocks.push({ kind: "complex_number", text: item.text, where });
      else if (!allowed.money.has(item.won)) blocks.push({ kind: "money", text: item.text, where });
    }
    for (const item of extractAreas(text)) if (![...allowed.areas].some((m2) => sameArea(m2, item.m2))) blocks.push({ kind: "area", text: item.text, where });
    for (const item of extractFloors(text)) {
      if (!allowed.floors.has(item.floor)) blocks.push({ kind: allowed.complex ? "complex_number" : "floor", text: item.text, where });
    }
    const dates = extractDates(text);
    for (const item of dates.full) if (!allowed.dates.has(item.date)) blocks.push({ kind: "date", text: item.text, where });
    for (const item of dates.months) if (!allowed.months.has(item.month)) blocks.push({ kind: "date", text: item.text, where });
    if (/\d\s*평/u.test(text) || /평형/u.test(text)) warnings.push({ kind: "pyeong", text: (text.match(/\d[\d.,]*\s*평형?|평형/u) ?? ["평"])[0], where });
    const amenities = new Set();
    for (const word of AMENITY_WORDS) if (text.includes(word) && !inputText.includes(word)) amenities.add(word);
    for (const match of text.matchAll(STATION)) {
      if (NOT_STATION.includes(match[0])) continue;
      if (!inputText.includes(match[0])) amenities.add(match[0]);
    }
    for (const match of text.matchAll(WALK)) if (!inputText.includes(match[0])) amenities.add(match[0]);
    // 긴 낱말을 이미 찾았으면 그 안의 짧은 낱말(초등학교 안의 학교)은 따로 적지 않는다.
    const listed = [...amenities].filter((word) => ![...amenities].some((other) => other !== word && other.includes(word)));
    if (listed.length > 0) warnings.push({ kind: "amenity", text: listed.join(", "), where });
    if (DISTANCE.test(text)) warnings.push({ kind: "distance", text: "직선거리", where });
    const review = text.match(REVIEW) ?? text.match(REVIEW_MORE);
    if (review) warnings.push({ kind: "review", text: review[0], where });
    const persona = text.match(PERSONA) ?? text.match(PERSONA_MORE);
    if (persona) warnings.push({ kind: "persona", text: persona[0], where });
    const hype = text.match(HYPE) ?? text.match(HYPE_MORE);
    if (hype) warnings.push({ kind: "hype", text: hype[0], where });
  }
  return { blocks, warnings };
}

const PERSONAL_LABELS = Object.freeze({ rrn: "주민등록번호", phone: "전화번호", email: "이메일", unit: "호수" });

export const CHECK_KIND_LABELS = Object.freeze({
  personal: "연락처·호수처럼 보이는 글자",
  money: "입력과 다른 금액",
  area: "입력과 다른 면적",
  floor: "입력과 다른 층",
  date: "입력과 다른 날짜",
  complex_number: "단지 소개 글에 매물 가격·층 숫자",
  pyeong: "'평' 표기",
  amenity: "입력에 없는 생활 편의",
  distance: "직선거리 표현",
  review: "후기처럼 보이는 문장",
  persona: "지어낸 인물처럼 보이는 표현",
  hype: "과장·보장 표현",
});

export function isBlogStyle(value) {
  return typeof value === "string" && STYLE_IDS.has(value);
}
