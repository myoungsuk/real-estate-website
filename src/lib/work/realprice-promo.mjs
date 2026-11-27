// 실거래가 홍보물(P1-e) 순수 함수: 고른 거래 ID 읽기, 빼낼 거래 알림, 글 4가지(스레드·인스타그램·블로그·카카오톡), 카드 그림 자료, 파일 이름.
// 서버 요청·브라우저 저장·주소 변경은 하지 않는다(src/lib/work 공통 규칙, T0-115). 숫자는 받은 자료 그대로 쓴다(설계서 22.10절).
// - 동 번호·지번은 넣지 않고 층은 숫자 그대로 쓴다(DEC-WT-22). 사무소 명시사항 5항목이 하나라도 비면 복사·내려받기를 막는다(DEC-WT-23).
// - 해제된 거래는 고를 수 없고, 고른 뒤 해제로 바뀌었으면 빼고 알린다. recordHigh가 true가 아니면(false·null) '신고가' 말을 쓰지 않는다.
import { formatKoreanWon } from "./work-format.mjs";
import { OFFICE_DISCLOSURE_FIELDS, officeFieldsMissing, officeLines } from "./ad-disclosure.mjs";
import { areaText, dateText, floorText, kindLabel, priceParts } from "./realprice-view.mjs";
import { promoBasisLine, promoFlow } from "./realprice-insight-view.mjs";
import { REALPRICE_BASE_LAWD, regionFullName, regionName } from "./realprice-regions.mjs";

// 서버 상수와 같은 값(tests/work-realprice-promo.test.mjs가 worker 상수와 대조한다).
export const PROMO_IDS_MAX = 6; // REALPRICE_IDS_MAX
export const PROMO_TRADE_ID_PATTERN = /^(sale|rent|presale):\d{6}:[0-9a-f]{20}:\d{1,4}$/u; // worker TRADE_KEY_PATTERN
export const PROMO_COMPARE_FROM = "200601"; // REALPRICE_START_MONTHS.sale: 신고가 비교 범위의 시작 연월
export const PROMO_PATH = "/admin/work/realprice/promo/";

// 글자 수 상한(2026-11-20 확인): 스레드 글 500자는 Meta Threads API 문서("Text posts are limited to 500 characters", 이모지는 UTF-8 바이트 수로 셈).
// 인스타그램 캡션 2,200자·해시태그 30개는 Meta IG User Media 참조(2026-09-28 갱신)의 caption 설명 "Maximum 2200 characters, 30 hashtags, and 20 @ tags"(2026-11-20 확인).
// 블로그·카카오톡 1:1 채팅은 이 글 길이에서 걸리는 상한이 없어 두지 않는다. 글에 이모지를 넣지 않아 글자 수는 코드 포인트로 센다.
export const PROMO_LIMITS = Object.freeze({ threads: 500, instagram: 2200, instagramHashtags: 30 });
export const PROMO_CARD_SIZE = Object.freeze({ width: 1080, height: 1350 });
// 한 장에 거래 4건까지, 5 ~ 6건은 3건씩 두 장(2026-11-24 사용자 답 "4곳까지 1장", 그 전 2026-11-20 "3건씩 나눠 최대 2장").
export const PROMO_ONE_CARD_MAX = 4;
export const PROMO_SPLIT_ROWS = 3;
// 카드 모양 4가지(2026-11-24 사용자 답: 처음 모양 "기본"). 고른 모양은 화면 메모리에만 두고 브라우저에 저장하지 않는다.
export const PROMO_STYLES = Object.freeze([
  ["basic", "기본"],
  ["clean", "깔끔 카드"],
  ["magazine", "잡지"],
  ["dark", "다크"],
]);
export const PROMO_STYLE_DEFAULT = "basic";
export const isPromoStyle = (value) => PROMO_STYLES.some(([key]) => key === value);

// 지역 말(0008, 대전 5개 구): 그 전에 '대전 동구'로 고정돼 있던 자리만 고른 거래의 구로 바꾼다. 구 이름을 새 자리에 넣지는 않는다
// (2026-11-25 사용자 결정 "홍보물에는 안 넣어도 돼"). 고른 거래가 모두 한 구면 '대전 서구'처럼, 여러 구가 섞이면 '대전'만 쓴다.
// 구 코드가 없는 거래(0008 전 응답 모양)는 동구로 본다(0008이 기존 거래를 30110으로 읽는 것과 같음).
export function promoRegion(items) {
  const codes = new Set((items ?? []).map((item) => item?.lawdCd ?? REALPRICE_BASE_LAWD));
  return codes.size === 1 ? [...codes][0] : null;
}
const promoPlace = (items) => {
  const code = promoRegion(items);
  return code ? regionFullName(code) : "대전";
};
export const promoAreaLabel = (items) => `${promoPlace(items)} 아파트 실거래가`;
export const PROMO_SOURCE = "국토교통부 실거래가 공개 자료(공공데이터포털)";
export const PROMO_NOTICE_SHORT = "계약일 기준, 최근 거래는 신고 기한(30일) 때문에 늘어날 수 있음, 해제 거래 제외.";

// 사무소 명시사항 5항목(DEC-WT-23, 설계서 22.10절)은 ad-disclosure.mjs 한 곳에 둔다(보드 45번 C). 기존 이름은 그대로 다시 내보낸다.
export const PROMO_DISCLOSURE_FIELDS = OFFICE_DISCLOSURE_FIELDS;

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
  if (count === 0) return `홍보물에 넣을 거래를 담으세요(최대 ${PROMO_IDS_MAX}건)`;
  return count >= PROMO_IDS_MAX ? `담은 거래 ${count}건(최대 ${PROMO_IDS_MAX}건)` : `담은 거래 ${count}건`;
}

// '다 담기'(P1-f D안): 보이는 순서대로 이미 담은 거래와 해제 거래를 건너뛰고 남은 자리만큼 담는다(최대 PROMO_IDS_MAX건을 넘지 않음).
// 돌려주는 값: add(새로 담을 거래, 보이는 순서), skippedCancelled(담는 동안 건너뛴 해제 거래 수).
/** @param {any[]} visible @param {Set<string>} pickedKeys */
export function takeVisible(visible, pickedKeys, max = PROMO_IDS_MAX) {
  const room = Math.max(0, max - pickedKeys.size);
  const add = [];
  let skippedCancelled = 0;
  for (const item of visible) {
    if (add.length >= room) break;
    if (pickedKeys.has(item.tradeKey)) continue;
    if (!isPromoSelectable(item)) {
      skippedCancelled += 1;
      continue;
    }
    add.push(item);
  }
  return { add, skippedCancelled };
}

// '다 담기' 단추 글자: 다 찼으면 "6건 담음"(꺼짐), 담을 것이 없으면 꺼짐, 남은 자리보다 보이는 거래가 적으면 "보이는 n건 담기",
// 많으면 "위에서 n건 담기". 이미 담은 거래가 있으면 "… n건 더 담기".
/** @param {any[]} visible @param {Set<string>} pickedKeys */
export function takeButtonView(visible, pickedKeys, max = PROMO_IDS_MAX) {
  const room = max - pickedKeys.size;
  if (room <= 0) return { text: `${max}건 담음`, disabled: true };
  const candidates = visible.filter((item) => isPromoSelectable(item) && !pickedKeys.has(item.tradeKey)).length;
  if (candidates === 0) return { text: pickedKeys.size > 0 ? "보이는 거래 다 담음" : "담을 거래 없음", disabled: true };
  const count = Math.min(room, candidates);
  const more = pickedKeys.size > 0 ? " 더" : "";
  return { text: candidates <= room ? `보이는 ${count}건${more} 담기` : `위에서 ${count}건${more} 담기`, disabled: false };
}

// '다 담기' 뒤 알림(화면 읽기 프로그램에도 읽힘).
export function takeResultText(added, skippedCancelled, total) {
  const skipped = skippedCancelled > 0 ? ` 해제 거래 ${skippedCancelled}건은 건너뛰었습니다.` : "";
  return `${added}건을 담았습니다.${skipped} ${selectionText(total)}.`;
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

// 명시사항 5항목 가운데 빈 칸의 이름(빈 배열이면 통과). ad-disclosure.mjs officeFieldsMissing과 같은 함수.
export const disclosureProblems = officeFieldsMissing;

// 그림 아래 칸 3줄. ad-disclosure.mjs officeLines와 같은 함수(다른 화면·시험이 이 이름으로 씀).
export const disclosureLines = officeLines;

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
export function promoTitle(items) {
  if (items.length === 1) {
    const item = items[0];
    return `${item.aptName} ${kindLabel(item)}${isHigh(item) ? " 신고가" : ""}`;
  }
  return allHigh(items) ? `매매 신고가 ${items.length}건` : `실거래 ${items.length}건`;
}

function dealRange(items) {
  const dates = items.map((item) => item.dealDate).sort();
  return dates[0] === dates.at(-1) ? `계약일 ${dateText(dates[0])}` : `계약일 ${dateText(dates[0])} ~ ${dateText(dates.at(-1))}`;
}

// 해시태그(P1-f, 2026-11-20 운영자 답 "10개 안팎·단지 이름 넣음"): 고정 4개 → 거래 종류 → #신고가(있을 때) → 법정동 최대 3개 →
// 전용면적 최대 2개(#전용84, ㎡ 소수점 버림) → 단지 이름 최대 3개(띄어쓰기·기호 뺌). 겹치면 하나, 모두 PROMO_HASHTAGS_MAX개 안.
// 개수가 넘치면 단지 이름은 지키고 전용면적 → 법정동 순으로 줄인다. 동 번호는 넣지 않는다.
// 고정 4개 중 앞 2개는 구 해시태그(한 구면 '#대전서구'·'#서구아파트', 여러 구가 섞이면 넣지 않음, 0008).
export const PROMO_HASHTAGS_BASE = Object.freeze(["#대전아파트", "#아파트실거래가"]);
export function promoRegionTags(items) {
  const name = regionName(promoRegion(items) ?? "");
  return name ? [`#대전${name}`, `#${name}아파트`] : [];
}
export const PROMO_HASHTAGS_MAX = 12; // 운영자 "10개 안팎"(11-20 13:18:32)에 맞춰 15 → 12(11-20 운영자 "추천하는 대로")
const tagWord = (text) => String(text ?? "").normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
const kindTag = (item) => {
  if (item.kind === "sale") return "#아파트매매";
  if (item.kind === "presale") return "#분양권";
  return item.monthlyRentWon ? "#아파트월세" : "#아파트전세";
};
const firstTags = (words, count) => [...new Set(words.filter(Boolean).map((word) => `#${word}`))].slice(0, Math.max(0, count));
export function hashtags(items) {
  const must = [...promoRegionTags(items), ...PROMO_HASHTAGS_BASE, ...new Set(items.map(kindTag)), ...(anyHigh(items) ? ["#신고가"] : [])];
  const names = firstTags(items.map((item) => tagWord(item.aptName)), 3);
  let room = PROMO_HASHTAGS_MAX - must.length - names.length;
  const dongs = firstTags(items.map((item) => tagWord(item.umdName)), Math.min(3, room));
  room -= dongs.length;
  const areas = firstTags(items.map((item) => `전용${Math.floor(Number(item.areaM2))}`), Math.min(2, room));
  return [...new Set([...must, ...dongs, ...areas, ...names])];
}
// ── 글 4가지 ──

// 2026-11-27 사용자 요청 "홍보물 글내용이 너무 복잡해서 보기가 힘드네 … 부동산 이름 하고 전화번호만 나오게하고"(질문 도구 답 15:54:03,
// "글 4곳 모두, 그림은 그대로"·"법적 상호"·"그림 그대로"·"줄 끝에 '신고가'만"): 글 4가지는 제목 → 빈 줄 → 거래 한 줄씩 → 빈 줄 → 상호·연락처 한 줄이다.
// 인스타그램은 끝에 해시태그를, 블로그는 첫 줄에 '제목:'을 더한다. 출처·받은 시각·계약일 기준 안내·흐름 기준·신고가 판정 기준·대표·소재지·등록번호는
// 글에 넣지 않는다. 카드 그림 아래 칸(promoCards: 명시사항 5항목·출처 두 줄·흐름 기준)은 그대로이고, 칸이 비면 만들지 않는 규칙(DEC-WT-23)도 그대로다.

// 제목: "동구 매매 실거래 (11.21)". 구는 고른 거래가 모두 한 구일 때 그 구('동구'), 섞이면 '대전'(0008). 거래 종류가 모두 같을 때만 종류 말을 넣고,
// 날짜는 계약일이 하루면 그날, 여러 날이면 첫날 ~ 끝날이다(해가 다르면 '25.12.30 ~ 26.1.5'처럼 두 자리 연도를 붙임).
const shortRegion = (items) => regionName(promoRegion(items) ?? "") || "대전";
const sameKind = (items) => {
  const kinds = new Set(items.map(kindLabel));
  return kinds.size === 1 ? [...kinds][0] : "";
};
const shortDay = (isoDate, withYear) => `${withYear ? `${isoDate.slice(2, 4)}.` : ""}${Number(isoDate.slice(5, 7))}.${Number(isoDate.slice(8, 10))}`;
export function shortDealRange(items) {
  const dates = items.map((item) => item.dealDate).sort();
  const [first, last] = [dates[0], dates.at(-1)];
  if (first === last) return shortDay(first, false);
  const years = first.slice(0, 4) !== last.slice(0, 4);
  return `${shortDay(first, years)} ~ ${shortDay(last, years)}`;
}
export function shortTitle(items) {
  return [shortRegion(items), sameKind(items), "실거래", `(${shortDealRange(items)})`].filter(Boolean).join(" ");
}

// 짧은 금액: 만 원 단위를 줄여 "4억 2,000"·"5억"·"8,400만"으로 쓴다(그림처럼 '만 원'을 붙이지 않음, 1억이 안 되면 '만'만 붙임).
// 만 원 단위로 떨어지지 않는 금액(공개 자료에는 없음)은 지어내지 않고 원 단위 글 그대로 쓴다. 월세는 "보증금 / 월 월세"다.
const groupMan = (value) => value.toLocaleString("en-US");
export function shortAmount(won) {
  if (won === 0) return "0";
  if (!Number.isSafeInteger(won) || won < 0 || won % 10_000 !== 0) return formatKoreanWon(won);
  const man = won / 10_000;
  const eok = Math.floor(man / 10_000);
  const rest = man % 10_000;
  if (eok === 0) return `${groupMan(rest)}만`;
  return rest === 0 ? `${groupMan(eok)}억` : `${groupMan(eok)}억 ${groupMan(rest)}`;
}
export function shortPrice(item) {
  if (item.kind !== "rent") return Number.isSafeInteger(item.priceWon) ? shortAmount(item.priceWon) : "금액 없음";
  const deposit = Number.isSafeInteger(item.depositWon) ? item.depositWon : 0;
  return item.monthlyRentWon ? `${shortAmount(deposit)} / 월 ${shortAmount(item.monthlyRentWon)}` : shortAmount(deposit);
}

// 거래 한 줄: "신흥SKVIEW 59㎡ 4억 2,000 · 27층". 전용면적은 소수점을 버리고(해시태그 #전용84와 같은 셈), 종류가 섞이면 단지 이름 뒤에 종류를 넣는다.
// 신고가(recordHigh가 true이고 앞선 최고가가 있을 때)만 줄 끝에 " · 신고가"를 붙인다. 동 번호·지번은 넣지 않는다(DEC-WT-22).
const shortLine = (item, withKind) => {
  const floor = floorText(item.floor);
  return `${item.aptName}${withKind ? ` ${kindLabel(item)}` : ""} ${Math.floor(Number(item.areaM2))}㎡ ${shortPrice(item)}${floor ? ` · ${floor}` : ""}${isHigh(item) ? " · 신고가" : ""}`;
};
// 글 끝 사무소 한 줄: 법적 상호와 연락처뿐이다(값은 명시사항 칸 office를 그대로 씀).
export const promoOfficeLine = (office) => `${office.legalName} ${office.mobile}`;
const shortBody = (items) => items.map((item) => shortLine(item, !sameKind(items)));

// 스레드 500자: 거래 줄까지 넣어 넘으면(아주 긴 단지 이름) 거래 줄 대신 "거래 n건은 그림에 정리했습니다." 한 줄로 줄인다(자르지 않음).
function threadsText({ items, office }) {
  const full = [shortTitle(items), "", ...shortBody(items), "", promoOfficeLine(office)].join("\n");
  if ([...full].length <= PROMO_LIMITS.threads) return full;
  return [shortTitle(items), "", `거래 ${items.length}건은 그림에 정리했습니다.`, "", promoOfficeLine(office)].join("\n");
}
const kakaoText = ({ items, office }) => [shortTitle(items), "", ...shortBody(items), "", promoOfficeLine(office)].join("\n");
const instagramText = (input) => [kakaoText(input), "", hashtags(input.items).join(" ")].join("\n");
const blogText = ({ items, office }) => [`제목: ${shortTitle(items)}`, "", ...shortBody(items), "", promoOfficeLine(office)].join("\n");

export const PROMO_TEXT_KINDS = Object.freeze([
  ["threads", "스레드"],
  ["instagram", "인스타그램"],
  ["blog", "블로그"],
  ["kakao", "카카오톡"],
]);
// 홍보물 화면 '어디에 올릴까요?' 순서(P1-f D안, 인스타그램이 처음 골라진 곳).
export const PROMO_PLACES = Object.freeze([
  ["instagram", "인스타그램"],
  ["threads", "스레드"],
  ["blog", "블로그"],
  ["kakao", "카카오톡"],
]);

// 올릴 곳에 맞춘 순서 글 3줄(P1-f D안): ① 그림 저장 ② 글 복사(글자 수·해시태그 수) ③ 그 앱에서 붙여 넣기.
// counted: textCount(kind, 글) 결과, cardCount: 카드 그림 장 수.
/** @param {string} kind @param {{ cardCount?: number, counted: { count: number, limit: number | null, tags: number, over: boolean } }} options */
export function promoSteps(kind, { cardCount = 1, counted }) {
  const cards = cardCount > 1 ? `카드 그림 ${cardCount}장` : "카드 그림";
  const image = kind === "blog"
    ? `${cards}을 저장합니다(블로그 글에 사진으로 넣습니다).`
    : kind === "kakao" ? `${cards}을 저장합니다(채팅에 사진으로 보냅니다).` : `${cards}을 휴대폰에 저장합니다.`;
  const count = counted.count.toLocaleString("ko-KR");
  const size = counted.limit === null ? `${count}자` : `${counted.limit.toLocaleString("ko-KR")}자 중 ${count}자`;
  const over = counted.over ? ", 상한을 넘음" : "";
  const text = kind === "instagram" ? `글을 복사합니다(해시태그 ${counted.tags}개 포함, ${size}${over}).` : `글을 복사합니다(${size}${over}).`;
  const posts = {
    instagram: "인스타그램 앱에서 새 게시물 → 저장한 그림 고르기 → 글 붙여 넣기.",
    threads: "스레드 앱에서 새 스레드 → 저장한 그림 붙이기 → 글 붙여 넣기.",
    blog: "블로그 글쓰기에서 첫 줄 '제목:' 뒤 글을 제목 칸에 넣고 → 저장한 그림 넣기 → 나머지 글 붙여 넣기.",
    kakao: "카카오톡 1:1 채팅에서 저장한 그림을 사진으로 보내고 → 글 붙여 넣기.",
  };
  return { image, text, post: posts[kind] ?? posts.instagram };
}

// 글 4가지. 만들 수 없으면(promoBlockReason) null. 글에는 흐름을 쓰지 않으므로 input.insights는 보지 않는다(카드 그림만 씀).
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

// 흐름 기준 줄의 머리말(TR-11 PR #156 검토 권함 2, 2026-11-25). 카드 그림 아래 칸에서 basis 앞에 붙인다(work-realprice-card.ts).
export const PROMO_BASIS_LABEL = "흐름 기준";

// flow: 거래 흐름(보드 63번). 계산하지 못한 거래·흐름을 받지 못한 때는 null이라 지금 모양 그대로 그린다.
const itemFlow = (item, insight) => (item.kind === "sale" && insight ? promoFlow(insight, { high: isHigh(item), buildYear: item.buildYear ?? null }) : null);
const cardItem = (item, insight) => ({
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
  presale: item.kind === "presale",
  up: promoUpText(item),
  flow: itemFlow(item, insight),
});

// 장 나누기: 4건까지 한 장, 5 ~ 6건은 3건씩 두 장(5건은 3 + 2). 담는 최대 건수(PROMO_IDS_MAX)를 넘는 거래는 넣지 않는다.
export function promoPages(items) {
  const list = items.slice(0, PROMO_IDS_MAX);
  if (list.length <= PROMO_ONE_CARD_MAX) return list.length ? [list] : [];
  const pages = [];
  for (let at = 0; at < list.length; at += PROMO_SPLIT_ROWS) pages.push(list.slice(at, at + PROMO_SPLIT_ROWS));
  return pages;
}

// 금액을 큰 숫자와 작은 단위로 나눈다("5억 8,750만 원" → "5억 8,750" + "만 원", "4억 원" → "4억" + "원"). 월세 둘째 줄은 나누지 않는다.
export function priceSplit(main) {
  const match = /^(.+?) ?(만 원|원)$/u.exec(main);
  return match ? { num: match[1], unit: match[2] } : { num: main, unit: "" };
}

// 신고가 오름 폭: 앞선 최고 매매가보다 얼마나 높은지("▲ 300만"). 신고가가 아니면 빈 글자(직전 거래 대비는 쓰지 않음).
export function promoUpText(item) {
  if (!isHigh(item) || !Number.isSafeInteger(item.priceWon) || item.priceWon <= item.prevMaxWon) return "";
  return `▲ ${formatKoreanWon(item.priceWon - item.prevMaxWon).replace(/ 원$/u, "")}`;
}

// 장마다 그림 자료. 여러 장이면 제목 끝에 " · 1/2장". 아래 칸에는 사무소 명시사항 5항목과, 그 위 작은 글로 출처 두 줄(source: 출처·받은 시각 /
// 계약일 기준·신고 기한 안내·해제 거래 제외)과 흐름 기준 줄(basis, 그 장에 흐름을 그린 거래가 있을 때만)을 장마다 둔다(2026-11-25 사용자 요청
// "출처랑 명함부분은 … 표에만 나오게끔". 2026-11-24 "완전히 뺌"으로 뺐던 출처 상자와 같은 날 뺀 흐름 기준 줄을 작은 글로 되돌림).
// 신고가 판정 기준은 그림에도 넣지 않는다(P1-e 받은 시각 막기는 그대로). 2026-11-27부터 글 4가지에는 출처·흐름 기준·명시사항 5항목을 넣지 않으므로
// 이 셋은 그림 아래 칸에만 있다(글 끝에는 상호·연락처 한 줄만, 2026-11-27 사용자 답 15:54:03).
// insights: 거래 ID → 거래 흐름 응답 한 개(없거나 못 받았으면 빈 값). basis는 그 장에 실제로 그린 흐름 항목만 적는다.
export function promoCards({ items, receivedAt, office, insights = {}, style = PROMO_STYLE_DEFAULT }) {
  if (promoBlockReason({ items, receivedAt, office })) return [];
  const pages = promoPages(items);
  const title = promoTitle(items);
  return pages.map((pageItems, index) => {
    const cardItems = pageItems.map((item) => cardItem(item, insights[item.tradeKey] ?? null));
    return {
      title: pages.length > 1 ? `${title} · ${index + 1}/${pages.length}장` : title,
      allHigh: pages.length === 1 && allHigh(pageItems), // 한 장에 모두 신고가면 제목에 "신고가"가 있어 줄마다 표를 달지 않음
      areaLabel: promoAreaLabel(items),
      range: dealRange(pageItems),
      items: cardItems,
      source: [`출처: ${PROMO_SOURCE}, ${receivedText(receivedAt)} 받음.`, PROMO_NOTICE_SHORT],
      basis: promoBasisLine(cardItems.map((item) => item.flow)),
      style: isPromoStyle(style) ? style : PROMO_STYLE_DEFAULT,
      // 사무소 명시사항 5항목(DEC-WT-23): 상호는 크게, 대표·등록번호·주소는 작은 글, 연락처는 크게 그린다(2026-11-24 사용자 답 "상호를 크게").
      office: { name: office.legalName, representative: office.representative, address: office.address, mobile: office.mobile, registrationNumber: office.registrationNumber },
    };
  });
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
