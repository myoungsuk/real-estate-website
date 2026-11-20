// 실거래가 홍보물(P1-e) 순수 함수: 고른 거래 ID 읽기, 빼낼 거래 알림, 글 4가지(스레드·인스타그램·블로그·카카오톡), 카드 그림 자료, 파일 이름.
// 서버 요청·브라우저 저장·주소 변경은 하지 않는다(src/lib/work 공통 규칙, T0-115). 숫자는 받은 자료 그대로 쓴다(설계서 22.10절).
// - 동 번호·지번은 넣지 않고 층은 숫자 그대로 쓴다(DEC-WT-22). 사무소 명시사항 5항목이 하나라도 비면 복사·내려받기를 막는다(DEC-WT-23).
// - 해제된 거래는 고를 수 없고, 고른 뒤 해제로 바뀌었으면 빼고 알린다. recordHigh가 true가 아니면(false·null) '신고가' 말을 쓰지 않는다.
import { formatKoreanWon } from "./work-format.mjs";
import { areaText, dateText, floorText, kindLabel, priceParts } from "./realprice-view.mjs";

// 서버 상수와 같은 값(tests/work-realprice-promo.test.mjs가 worker 상수와 대조한다).
export const PROMO_IDS_MAX = 6; // REALPRICE_IDS_MAX
export const PROMO_TRADE_ID_PATTERN = /^(sale|rent|presale):\d{6}:[0-9a-f]{20}:\d{1,4}$/u; // worker TRADE_KEY_PATTERN
export const PROMO_COMPARE_FROM = "200601"; // REALPRICE_START_MONTHS.sale: 신고가 비교 범위의 시작 연월
export const PROMO_PATH = "/admin/work/realprice/promo/";

// 글자 수 상한(2026-11-20 확인): 스레드 글 500자는 Meta Threads API 문서("Text posts are limited to 500 characters", 이모지는 UTF-8 바이트 수로 셈).
// 인스타그램 캡션 2,200자·해시태그 30개는 Instagram Graph API 미디어 참조의 caption 설명을 옮긴 글과 Meta 변경 기록(캡션 길이·해시태그 수 오류)으로 확인했다(Meta 참조 원문은 직접 열지 못함, 추가 확인 필요).
// 블로그·카카오톡 1:1 채팅은 이 글 길이에서 걸리는 상한이 없어 두지 않는다. 글에 이모지를 넣지 않아 글자 수는 코드 포인트로 센다.
export const PROMO_LIMITS = Object.freeze({ threads: 500, instagram: 2200, instagramHashtags: 30 });
export const PROMO_CARD_SIZE = Object.freeze({ width: 1080, height: 1350 });
export const PROMO_CARD_ROWS = 3; // 한 장에 거래 3건까지, 4 ~ 6건은 두 장(2026-11-20 운영자 답 "3건씩 나눠 최대 2장")

export const PROMO_AREA_LABEL = "대전 동구 아파트 실거래가";
export const PROMO_SOURCE = "국토교통부 실거래가 공개 자료(공공데이터포털)";
export const PROMO_NOTICE = "계약일 기준입니다. 신고 기한(계약 후 30일) 때문에 최근 거래는 늘어날 수 있고, 해제된 거래는 뺐습니다.";
export const PROMO_NOTICE_SHORT = "계약일 기준, 최근 거래는 신고 기한(30일) 때문에 늘어날 수 있음, 해제 거래 제외.";
const compareFromText = `${PROMO_COMPARE_FROM.slice(0, 4)}년 ${Number(PROMO_COMPARE_FROM.slice(4))}월`;
// 판정 규칙은 worker/realprice-query.mjs의 REALPRICE_PRIOR_SQL·isRecordHighTarget과 같다(같은 단지 번호·같은 전용면적, 계약일이 앞선 매매, 해제·직거래 뺌).
export const PROMO_HIGH_RULE = `신고가: 같은 단지·같은 전용면적에서 계약일이 앞선 매매(해제·직거래 뺌) 최고가보다 높은 매매입니다. ${compareFromText} 이후 매매와 비교했습니다.`;
// 스레드(500자)·카카오톡용 짧은 판정 기준(같은 뜻, 3건이 한 줄씩 들어가게)
export const PROMO_HIGH_RULE_SHORT = `신고가: 같은 단지·전용면적의 앞선 매매(${compareFromText} 이후, 해제·직거래 뺌) 최고가보다 높은 거래.`;

// 사무소 명시사항 5항목(DEC-WT-23, 설계서 22.10절). 앞은 office.json 칸 이름.
export const PROMO_DISCLOSURE_FIELDS = Object.freeze([
  ["legalName", "중개사무소 명칭"],
  ["address", "소재지"],
  ["mobile", "연락처"],
  ["registrationNumber", "등록번호"],
  ["representative", "대표 성명"],
]);

// ── 고른 거래 ID ──

const uniqueIds = (ids) => [...new Set(ids)];

// 화면 주소의 ?ids=를 읽는다. 서버 검사와 같은 규칙(1 ~ 6개, 형식, ids는 한 번)이고, 어긋나면 ids 없이 error를 돌려준다.
export function parsePromoIds(search) {
  const params = new URLSearchParams(search);
  const values = params.getAll("ids");
  if (values.length === 0) return { ids: [], error: "none" };
  if (values.length !== 1) return { ids: [], error: "invalid" };
  const parts = values[0].split(",");
  if (parts.length > PROMO_IDS_MAX || parts.some((part) => !PROMO_TRADE_ID_PATTERN.test(part))) return { ids: [], error: "invalid" };
  return { ids: uniqueIds(parts), error: null };
}

// 목록에서 고른 거래로 홍보물 화면 주소를 만든다(거래 ID는 [a-z0-9:]뿐이라 그대로 쓴다).
export function promoHref(ids) {
  const list = uniqueIds(ids);
  if (list.length < 1 || list.length > PROMO_IDS_MAX || list.some((id) => !PROMO_TRADE_ID_PATTERN.test(id))) return null;
  return `${PROMO_PATH}?ids=${list.join(",")}`;
}

// 목록에서 고를 수 있는 거래: 해제되지 않았고 ID 형식이 맞는 것.
export const isPromoSelectable = (item) => item?.cancelled !== true && PROMO_TRADE_ID_PATTERN.test(item?.tradeKey ?? "");

export function selectionText(count) {
  if (count === 0) return `홍보물에 넣을 거래를 고르세요(최대 ${PROMO_IDS_MAX}건)`;
  return count >= PROMO_IDS_MAX ? `고른 거래 ${count}건(최대 ${PROMO_IDS_MAX}건)` : `고른 거래 ${count}건`;
}

// ── 서버 응답 → 쓸 거래·알림 ──

// ids 응답(items·missing·receivedAt)에서 해제로 바뀐 거래와 찾지 못한 거래를 빼고 알림 문장을 만든다.
export function promoSelection(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const usable = items.filter((item) => item.cancelled !== true);
  const cancelledCount = items.length - usable.length;
  const missingCount = Array.isArray(data?.missing) ? data.missing.length : 0;
  const notices = [];
  if (cancelledCount > 0) notices.push(`해제된 거래 ${cancelledCount}건을 뺐습니다.`);
  if (missingCount > 0) notices.push(`찾지 못한 거래 ${missingCount}건을 뺐습니다. 자료를 다시 받으면서 바뀌었을 수 있으니 목록에서 다시 골라 주세요.`);
  // 신고가 판정을 못 한 매매(판정 준비 전·조회가 많은 날, recordHigh null)가 있으면 신고가 말 없이 만든다고 알린다.
  const highOff = usable.some((item) => item.kind === "sale" && item.recordHigh === null);
  if (highOff) notices.push("지금은 신고가 판정을 할 수 없어(매매 과거 자료를 채우는 중이거나 조회가 많은 날) 신고가 표시 없이 만들었습니다.");
  return { items: usable, cancelledCount, missingCount, highOff, notices, receivedAt: usable.length > 0 ? data?.receivedAt ?? null : null };
}

// 명시사항 5항목 가운데 빈 칸의 이름(빈 배열이면 통과).
export function disclosureProblems(office) {
  return PROMO_DISCLOSURE_FIELDS.filter(([key]) => typeof office?.[key] !== "string" || office[key].trim() === "").map(([, label]) => label);
}

// 만들 수 없는 이유(없으면 null). 화면은 이 문장을 보여 주고 복사·내려받기·인쇄를 막는다.
export function promoBlockReason({ items, receivedAt, office }) {
  const missing = disclosureProblems(office);
  if (missing.length > 0) return `사무소 명시사항(${missing.join("·")})이 비어 있어 홍보물을 만들 수 없습니다. 사무소 정보를 먼저 채워 주세요.`;
  if (!items || items.length === 0) return "홍보물에 넣을 거래가 없습니다. 실거래가 목록에서 다시 골라 주세요.";
  if (!receivedAt) return "자료를 받은 시각을 확인하지 못해 홍보물을 만들 수 없습니다. 잠시 뒤 다시 열어 주세요.";
  return null;
}

// ── 문구 조각 ──

const kstParts = (iso) => Object.fromEntries(new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(new Date(iso)).map(({ type, value }) => [type, value]));

// 받은 시각 "2026. 11. 20. 09:50"(한국 시각)
export function receivedText(iso) {
  const p = kstParts(iso);
  return `${p.year}. ${p.month}. ${p.day}. ${p.hour}:${p.minute}`;
}

const isHigh = (item) => item.recordHigh === true && Number.isSafeInteger(item.prevMaxWon);
const allHigh = (items) => items.length > 0 && items.every(isHigh);
const anyHigh = (items) => items.some(isHigh);
export const priceText = (item) => {
  const parts = priceParts(item);
  return parts.monthly ? `${parts.main} ${parts.monthly}` : parts.main;
};
const metaLine = (item) => `전용 ${areaText(item.areaM2)} · ${floorText(item.floor)} · 계약 ${dateText(item.dealDate)}`;
const prevText = (item) => `같은 단지·같은 전용면적 앞선 최고 ${formatKoreanWon(item.prevMaxWon)}`;
const shortReceived = (iso) => {
  const p = kstParts(iso);
  return `${p.month}. ${p.day}. ${p.hour}:${p.minute} 받음`;
};
const shortDate = (isoDate) => `${Number(isoDate.slice(5, 7))}. ${Number(isoDate.slice(8, 10))}.`;

export function promoTitle(items) {
  if (items.length === 1) {
    const item = items[0];
    return `${item.aptName} ${kindLabel(item)}${isHigh(item) ? " 신고가" : ""}`;
  }
  return allHigh(items) ? `매매 신고가 ${items.length}건` : `실거래 ${items.length}건`;
}

export function monthsText(items) {
  const months = [...new Set(items.map((item) => item.dealDate.slice(0, 7)))].sort();
  const [y1, m1] = months[0].split("-");
  const [y2, m2] = months.at(-1).split("-");
  if (months.length === 1) return `${y1}년 ${Number(m1)}월 계약`;
  return y1 === y2 ? `${y1}년 ${Number(m1)} ~ ${Number(m2)}월 계약` : `${y1}년 ${Number(m1)}월 ~ ${y2}년 ${Number(m2)}월 계약`;
}

function dealRange(items) {
  const dates = items.map((item) => item.dealDate).sort();
  return dates[0] === dates.at(-1) ? `계약일 ${dateText(dates[0])}` : `계약일 ${dateText(dates[0])} ~ ${dateText(dates.at(-1))}`;
}

export const disclosureLines = (office) => [
  `${office.legalName} · 대표 ${office.representative}`,
  office.address,
  `연락처 ${office.mobile} · 등록번호 ${office.registrationNumber}`,
];
export const hashtags = (items) => ["#대전동구", "#실거래가", ...new Set(items.map((item) => `#${item.umdName.replace(/\s+/gu, "")}`))];
const tradeBlock = (item) => [`${item.aptName}(${item.umdName}) ${kindLabel(item)} ${priceText(item)}`, metaLine(item), ...(isHigh(item) ? [`신고가 · ${prevText(item)}`] : [])];
const compactLine = (item) => `- ${item.aptName} ${kindLabel(item)} ${priceText(item)}, 전용 ${areaText(item.areaM2)} ${floorText(item.floor)}, 계약 ${shortDate(item.dealDate)}${isHigh(item) ? " 신고가" : ""}`;
const headLine = (items) => `[${PROMO_AREA_LABEL}] ${items.length === 1 ? promoTitle(items) : `${promoTitle(items)}(${monthsText(items)})`}`;

// ── 글 4가지 ──

function fullText({ items, receivedAt, office }) {
  const lines = [headLine(items), ""];
  items.forEach((item, index) => {
    if (index) lines.push("");
    lines.push(...tradeBlock(item));
  });
  lines.push("", `출처: ${PROMO_SOURCE}, ${receivedText(receivedAt)} 받은 자료`, PROMO_NOTICE);
  if (anyHigh(items)) lines.push(PROMO_HIGH_RULE);
  lines.push("", ...disclosureLines(office));
  return lines.join("\n");
}

// 스레드: 1건은 자세히, 여러 건은 한 줄씩. 그래도 500자를 넘으면 거래 줄 대신 "그림에 정리" 한 줄로 줄인다.
function threadsText(input) {
  const { items, receivedAt, office } = input;
  if (items.length === 1 && [...fullText(input)].length <= PROMO_LIMITS.threads) return fullText(input);
  const tail = ["", `출처: ${PROMO_SOURCE}, ${shortReceived(receivedAt)}. ${PROMO_NOTICE_SHORT}`, ...(anyHigh(items) ? [PROMO_HIGH_RULE_SHORT] : []), "", ...disclosureLines(office)];
  const compact = [headLine(items), ...items.map(compactLine), ...tail].join("\n");
  if ([...compact].length <= PROMO_LIMITS.threads) return compact;
  return [headLine(items), `거래 ${items.length}건(${dealRange(items)})은 그림에 정리했습니다.`, ...tail].join("\n");
}

function instagramText(input) {
  return [fullText(input), "", hashtags(input.items).join(" ")].join("\n");
}

function blogText({ items, receivedAt, office }) {
  const head = items.length === 1
    ? `대전 동구 ${items[0].aptName} ${kindLabel(items[0])}${isHigh(items[0]) ? " 신고가" : ""} ${priceText(items[0])}(${monthsText(items)})`
    : `대전 동구 아파트 ${promoTitle(items)}(${monthsText(items)})`;
  const lines = [`제목: ${head}`, "", "국토교통부 실거래가 공개 자료에서 대전 동구 아파트 거래를 정리했습니다.", ""];
  for (const item of items) {
    lines.push(`■ ${item.aptName}(${item.umdName}) ${kindLabel(item)}${isHigh(item) ? " · 신고가" : ""}`);
    lines.push(`- 금액: ${priceText(item)}`, `- 전용면적: ${areaText(item.areaM2)}`, `- 층: ${floorText(item.floor)}`, `- 계약일: ${dateText(item.dealDate)}`);
    if (isHigh(item)) lines.push(`- 같은 단지·같은 전용면적 앞선 최고: ${formatKoreanWon(item.prevMaxWon)}`);
    lines.push("");
  }
  if (anyHigh(items)) lines.push(PROMO_HIGH_RULE, "");
  lines.push(`출처: ${PROMO_SOURCE}, ${receivedText(receivedAt)} 받은 자료`, PROMO_NOTICE, "");
  lines.push(...PROMO_DISCLOSURE_FIELDS.map(([key, label]) => `${label}: ${office[key]}`));
  return lines.join("\n");
}

// 카카오톡: 1:1 채팅에 붙여 넣는 짧은 글(2026-11-20 운영자 답 "권하는 대로").
function kakaoText({ items, receivedAt, office }) {
  const lines = [`[${PROMO_AREA_LABEL}] ${promoTitle(items)}`];
  if (items.length === 1) {
    const item = items[0];
    lines.push(`${priceText(item)} · ${metaLine(item)}`);
    if (isHigh(item)) lines.push(`(${prevText(item)})`);
  } else {
    lines.push(...items.map(compactLine));
  }
  lines.push(`출처: ${PROMO_SOURCE}, ${shortReceived(receivedAt)}. ${PROMO_NOTICE_SHORT}`);
  if (anyHigh(items)) lines.push(PROMO_HIGH_RULE_SHORT);
  lines.push(`${office.legalName} · 대표 ${office.representative} · ${office.address} · ${office.mobile} · 등록번호 ${office.registrationNumber}`);
  return lines.join("\n");
}

export const PROMO_TEXT_KINDS = Object.freeze([
  ["threads", "스레드"],
  ["instagram", "인스타그램"],
  ["blog", "블로그"],
  ["kakao", "카카오톡"],
]);

// 글 4가지. 만들 수 없으면(promoBlockReason) null.
export function promoTexts(input) {
  if (promoBlockReason(input)) return null;
  return { threads: threadsText(input), instagram: instagramText(input), blog: blogText(input), kakao: kakaoText(input) };
}

// 글자 수(한글 한 자 = 1자, 코드 포인트 기준)와 상한 넘음 여부.
export function textCount(kind, text) {
  const count = [...text].length;
  const tags = (text.match(/#[^\s#]+/gu) ?? []).length;
  const limit = PROMO_LIMITS[kind] ?? null;
  const over = (limit !== null && count > limit) || (kind === "instagram" && tags > PROMO_LIMITS.instagramHashtags);
  return { count, limit, tags, over, label: limit === null ? `${count.toLocaleString("ko-KR")}자` : `${count.toLocaleString("ko-KR")}자 / ${limit.toLocaleString("ko-KR")}자` };
}

// ── 카드 그림 자료(그리기는 src/lib/work-realprice-card.ts) ──

const cardItem = (item) => ({
  name: item.aptName,
  dong: item.umdName,
  kind: kindLabel(item),
  high: isHigh(item),
  price: priceParts(item),
  priceText: priceText(item),
  area: areaText(item.areaM2),
  floor: floorText(item.floor),
  date: dateText(item.dealDate),
  prev: isHigh(item) ? formatKoreanWon(item.prevMaxWon) : "",
});

// 3건씩 나눠 최대 2장. 여러 장이면 제목 끝에 " · 1/2장". 아래 칸은 출처·받은 시각·안내, 신고가가 있는 장만 판정 기준, 명시사항.
export function promoCards({ items, receivedAt, office }) {
  if (promoBlockReason({ items, receivedAt, office })) return [];
  const pages = [];
  for (let at = 0; at < items.length && pages.length < Math.ceil(PROMO_IDS_MAX / PROMO_CARD_ROWS); at += PROMO_CARD_ROWS) pages.push(items.slice(at, at + PROMO_CARD_ROWS));
  const title = promoTitle(items);
  return pages.map((pageItems, index) => ({
    title: pages.length > 1 ? `${title} · ${index + 1}/${pages.length}장` : title,
    allHigh: pages.length === 1 && allHigh(pageItems), // 한 장에 모두 신고가면 제목에 "신고가"가 있어 줄마다 표를 달지 않음
    areaLabel: PROMO_AREA_LABEL,
    range: dealRange(pageItems),
    items: pageItems.map(cardItem),
    source: `출처 ${PROMO_SOURCE}`,
    received: `${receivedText(receivedAt)} 받은 자료. ${PROMO_NOTICE}`,
    highRule: anyHigh(pageItems) ? PROMO_HIGH_RULE : "",
    disclosure: disclosureLines(office),
  }));
}

// 내려받는 파일 이름: 날짜만(realprice-YYYYMMDD.png, 두 장이면 -1·-2). todayKst는 "YYYY-MM-DD".
export function promoFileName(todayKst, index = 0, total = 1) {
  const day = String(todayKst).replaceAll("-", "");
  return total > 1 ? `realprice-${day}-${index + 1}.png` : `realprice-${day}.png`;
}

// 그림·글에 나오는 숫자(금액·면적·층·날짜) 목록. 시험이 그림 글자와 글 4가지가 같은 숫자인지 대조할 때 쓴다.
export function promoNumbers(items) {
  return items.flatMap((item) => [priceText(item), areaText(item.areaM2), floorText(item.floor), dateText(item.dealDate), ...(isHigh(item) ? [formatKoreanWon(item.prevMaxWon)] : [])]);
}
