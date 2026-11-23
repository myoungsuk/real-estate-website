// 글 초안 카드 그림(2026-11-23 사용자 선택 "B 큰 숫자 인포그래픽"·"3장 한 벌"): 단지 소개 초안은 표지·단지 정보·확인할 점 3장, 매물 초안은 사진 없는 표지 1장.
// 카드의 숫자·글은 AI 글이 아니라 공개 자료(complexes.json·office.json·매물 명시사항)에서만 가져온다. 이 파일은 글 묶음만 만들고, 그리기는 src/lib/work-blog-card.ts가 한다.
// - 단지 자료는 빌드 때 complexCardData()로 줄여 화면에 싣는다(서버 요청 없음). 화면 문장에 없는 합계·비율 숫자는 만들지 않는다.
// - 사무소 명시사항 5항목이 하나라도 비면 만들지 않는다(officeBlockReason, 거래 완료 알림과 같은 문장).
// - 매물 표지는 명시사항 빈 칸이 없을 때만 만든다(buildDisclosure() 값 그대로, 소재지는 화면 메모리에서만).
import { formatDate, officeLines } from "./ad-disclosure.mjs";
import { bigPriceText } from "./listing-paper.mjs";
import { officeBlockReason } from "./promo-paper.mjs";

export const BLOG_CARD_SIZE = Object.freeze({ width: 1080, height: 1350 });
export const BLOG_CARD_CHECKS_MAX = 6;
// 도넛에 싣는 줄 수(넘으면 공급 구성으로 바꾸고, 그것도 넘으면 도넛을 그리지 않는다).
export const BLOG_CARD_DONUT_MAX = 4;
export const BLOG_CARD_LABELS = Object.freeze({ cover: "표지", info: "단지 정보", checks: "확인할 점", listing: "매물 표지" });
const TRADE_NAMES = { sale: "매매", jeonse: "전세", "monthly-rent": "월세" };
// 출처 줄에 싣는 자료 종류(뉴스는 뺌).
const SOURCE_KINDS = new Set(["official", "public-data"]);

const textOf = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
const intOf = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(String(value).replaceAll(",", ""));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
};
const group = (value) => String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
// 물결표 양옆을 띄운다("60㎡ 초과~85㎡ 이하" → "60㎡ 초과 ~ 85㎡ 이하").
const spaceTilde = (value) => value.replace(/\s*~\s*/gu, " ~ ");

function factOf(item, labels) {
  const facts = Array.isArray(item?.facts) ? item.facts : [];
  for (const label of labels) {
    const hit = facts.find((fact) => fact?.label === label && textOf(fact?.value));
    if (hit) return hit.value.trim();
  }
  return null;
}

// "2022년 4월 28일" → "2022. 4. 28.", "2024년 7월" → "2024. 7.". 다른 꼴은 그대로.
export function shortDateText(value) {
  const text = textOf(value);
  if (!text) return null;
  const day = text.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/u);
  if (day) return `${day[1]}. ${Number(day[2])}. ${Number(day[3])}.`;
  const month = text.match(/^(\d{4})년\s*(\d{1,2})월$/u);
  if (month) return `${month[1]}. ${Number(month[2])}.`;
  return text;
}

// "지상 0대 · 지하 1,957대" → { ground: 0, under: 1957 }. 둘 다 읽혀야 쓴다.
export function readParking(value) {
  const text = textOf(value);
  if (!text) return null;
  const ground = intOf(text.match(/지상\s*([\d,]+)\s*대/u)?.[1]);
  const under = intOf(text.match(/지하\s*([\d,]+)\s*대/u)?.[1]);
  return ground !== null && under !== null && ground + under > 0 ? { ground, under } : null;
}

// 단지 하나(complexes.json 항목) → 카드에 쓰는 값만. published가 아니면 null.
export function complexCardData(item) {
  if (item?.status !== "published") return null;
  const scale = factOf(item, ["규모"]) ?? "";
  const households = intOf(scale.match(/([\d,]+)\s*세대/u)?.[1]);
  const dongs = intOf(scale.match(/([\d,]+)\s*개동/u)?.[1]);
  const approvalRaw = factOf(item, ["사용승인"]);
  const moveInRaw = approvalRaw ? null : factOf(item, ["입주"]);
  const date = approvalRaw ? { label: "사용승인", value: shortDateText(approvalRaw) } : moveInRaw ? { label: "입주", value: shortDateText(moveInRaw) } : null;
  const unitRows = (Array.isArray(item.unitGroups) ? item.unitGroups : [])
    .map((row) => ({ category: textOf(row?.category), label: textOf(row?.areaLabel), households: Number.isSafeInteger(row?.households) && row.households > 0 ? row.households : null }))
    .filter((row) => row.label && row.households !== null);
  const categories = new Set(unitRows.map((row) => row.category));
  const units = unitRows.map((row) => ({
    label: spaceTilde(categories.size > 1 && row.category && row.category !== "전체" ? `${row.category} ${row.label}` : row.label),
    households: row.households,
  }));
  const supply = (Array.isArray(item.supplySummary) ? item.supplySummary : [])
    .map((row) => ({ label: textOf(row?.label), households: intOf(String(row?.value ?? "").match(/([\d,]+)\s*세대/u)?.[1]) }))
    .filter((row) => row.label && row.households !== null && row.households > 0);
  const extras = [
    ["승강기", factOf(item, ["승강기"])],
    ["난방", factOf(item, ["난방"])],
  ].filter(([, value]) => value).map(([label, value]) => ({ label, value }));
  const checks = (Array.isArray(item.checkpoints) ? item.checkpoints : []).map((row) => textOf(row?.title)).filter(Boolean).slice(0, BLOG_CARD_CHECKS_MAX);
  const publishers = [...new Set((Array.isArray(item.sources) ? item.sources : []).filter((row) => SOURCE_KINDS.has(row?.kind)).map((row) => textOf(row?.publisher)).filter(Boolean))];
  return {
    slug: item.slug,
    name: textOf(item.name) ?? "",
    areaName: textOf(item.areaName),
    context: factOf(item, ["사업 맥락"]),
    title: textOf(item.introTitle) ?? textOf(item.name) ?? "",
    image: typeof item.image?.src === "string" && item.image.src.startsWith("/images/") ? item.image.src : null,
    households,
    dongs,
    date,
    units,
    supply,
    parking: readParking(factOf(item, ["주차"])),
    extras,
    checks,
    // 확인 날짜는 줄이 바뀌어도 끊기지 않게 붙임 칸으로 잇는다.
    sourceLine: publishers.length > 0 ? `출처 ${publishers.join(" · ")}${item.confirmedAt ? ` · 확인\u00A0${formatDate(item.confirmedAt).replace(/ /gu, "\u00A0")}` : ""}` : "",
  };
}

// 제목: 첫 쉼표 뒤에서 줄을 나누고, 단지 이름은 띄어쓰기에서 끊기지 않게 붙인다(그리기에서 줄바꿈 기준은 띄어쓰기).
export function cardTitleLines(title, name) {
  const glued = name ? title.replaceAll(name, name.replace(/ /gu, " ")) : title;
  const at = glued.indexOf(", ");
  return at > 0 ? [glued.slice(0, at + 1), glued.slice(at + 2)] : [glued];
}

// 주차 한 줄 글: 지상이 0이면 "전부 지하", 지하가 0이면 "전부 지상". 합계는 만들지 않는다.
export function parkingView(parking) {
  if (!parking) return null;
  if (parking.ground === 0) return { big: group(parking.under), note: "전부 지하 주차", chip: `주차 ${group(parking.under)}대 전부 지하`, rows: [] };
  if (parking.under === 0) return { big: group(parking.ground), note: "전부 지상 주차", chip: `주차 ${group(parking.ground)}대 전부 지상`, rows: [] };
  return { big: null, note: null, chip: null, rows: [["지상", `${group(parking.ground)}대`], ["지하", `${group(parking.under)}대`]] };
}

// 단지 카드 글 묶음. 돌려주는 값: { ok: true, cards } 또는 { ok: false, error }.
// cards: [{ key, label, ... }] — cover·info는 늘, checks는 확인할 점이 있을 때만.
export function buildComplexCards(data, office) {
  const blocked = officeBlockReason(office);
  if (blocked) return { ok: /** @type {const} */ (false), error: blocked };
  if (!data) return { ok: /** @type {const} */ (false), error: "이 단지는 지금 공개 단지 자료에 없어 카드를 만들 수 없습니다." };
  if (!data.households) return { ok: /** @type {const} */ (false), error: "단지 자료에 세대수(규모)가 없어 카드를 만들 수 없습니다." };
  const disclosure = officeLines(office);
  const parking = parkingView(data.parking);
  const households = group(data.households);
  const dongs = data.dongs ? `${group(data.dongs)}개동` : null;
  const dateChip = data.date ? `${data.date.value} ${data.date.label}` : null;
  // 공급이 한 줄이고 그 수가 전체 세대수와 같으면 큰 숫자와 겹치지 않게 "전 세대 분양"처럼 쓴다.
  const onlySupply = data.supply.length === 1 && data.supply[0].households === data.households;
  const supplyChip = data.supply[0] ? (onlySupply ? `전 세대 ${data.supply[0].label}` : `${data.supply[0].label} ${group(data.supply[0].households)}세대`) : null;
  const secondChip = parking?.chip ?? supplyChip;

  // 도넛: 전용면적 줄이 2 ~ 4개면 그것, 아니면 공급 구성 2 ~ 4줄, 둘 다 아니면 없음.
  const fits = (rows) => rows.length >= 2 && rows.length <= BLOG_CARD_DONUT_MAX;
  const donut = fits(data.units)
    ? { title: "전용면적 구성", rows: data.units.map((row) => ({ label: row.label, value: row.households, text: `${group(row.households)}세대` })) }
    : fits(data.supply)
      ? { title: "공급 구성", rows: data.supply.map((row) => ({ label: row.label, value: row.households, text: `${group(row.households)}세대` })) }
      : null;
  const supplyBar = donut?.title !== "공급 구성" && data.supply.length > 0 && data.supply.length <= BLOG_CARD_DONUT_MAX
    ? data.supply.map((row) => ({ label: row.label, value: row.households, text: `${row.label} ${group(row.households)}세대` }))
    : null;
  // 오른쪽 남색 칸: 주차가 있으면 주차, 없으면 사용승인·입주(이때 동 수는 칸 아래 한 줄로 옮겨 작은 칸과 겹치지 않게).
  const side = parking
    ? { title: "주차", big: parking.big, unit: parking.big ? "대" : null, note: parking.note, rows: parking.rows }
    : data.date
      ? { title: data.date.label, big: data.date.value, unit: null, note: dongs, rows: [] }
      : null;
  const tiles = [
    ...(data.date && side?.title !== data.date.label ? [{ label: data.date.label, value: data.date.value }] : []),
    ...(dongs && side?.note !== dongs ? [{ label: "동 수", value: dongs }] : []),
    ...data.extras,
  ].slice(0, 3);
  const subtitle = [data.areaName ? `대전 동구 ${data.areaName}` : null, data.context].filter(Boolean).join(" · ");

  const cards = [
    { key: "cover", label: BLOG_CARD_LABELS.cover, badge: "단지 한눈에", image: data.image, imageAlt: data.name, big: households, unit: "세대", bigNote: dongs ?? "",
      titleLines: cardTitleLines(data.title, data.name), chips: [dateChip, secondChip].filter(Boolean), disclosure },
    { key: "info", label: BLOG_CARD_LABELS.info, badge: "단지 정보", name: data.name, subtitle, households, donut, side, supplyBar, tiles, sourceLine: data.sourceLine, disclosure },
  ];
  if (data.checks.length > 0) cards.push({ key: "checks", label: BLOG_CARD_LABELS.checks, badge: "현장 체크", kicker: "계약 전 현장에서", heading: `확인할 ${data.checks.length}가지`, items: data.checks, disclosure });
  return { ok: /** @type {const} */ (true), cards };
}

// 매물 표지(사진 없음). disclosure는 buildDisclosure() 값이고 빈 칸이 있으면 만들지 않는다.
export function buildListingCover(source, disclosure, office) {
  const blocked = officeBlockReason(office);
  if (blocked) return { ok: /** @type {const} */ (false), error: blocked };
  if (!source || source.type === "complex") return { ok: /** @type {const} */ (false), error: "매물 자료가 아닙니다." };
  if (!disclosure || disclosure.kind !== "listing" || disclosure.missing.length > 0) return { ok: /** @type {const} */ (false), error: "명시사항 빈 칸을 모두 채우면 표지를 만듭니다." };
  const facts = source.facts;
  const chip = [TRADE_NAMES[facts.tradeType], facts.propertyType].filter(Boolean).join(" · ");
  return {
    ok: /** @type {const} */ (true),
    cards: [{
      key: "listing",
      label: BLOG_CARD_LABELS.listing,
      badge: "매물 소개",
      chip,
      name: source.title,
      price: bigPriceText(facts),
      rows: disclosure.items.map((row) => ({ key: row.key, label: row.label, value: row.value })),
      disclosure: officeLines(office),
    }],
  };
}

// 파일 이름: 단지 카드는 날짜 + 단지 이름 + 번호(공개 단지 이름만, 띄어쓰기·파일 이름에 못 쓰는 글자는 뺌). 매물 표지는 날짜만.
export function blogCardFileName(todayIso, { name = "", index = 0, listing = false } = {}) {
  const date = String(todayIso);
  if (listing) return `${date}-매물표지.png`;
  const safe = String(name).normalize("NFKC").replace(/[\s\\/:*?"<>|.]+/gu, "");
  return `${date}-${safe || "단지"}-${index + 1}.png`;
}
