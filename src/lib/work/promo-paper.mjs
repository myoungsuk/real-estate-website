// 홍보 종이 1차(보드 45번 C, 운영자 결정 2026-11-20 18:09 "① 가격 빼고 달·면적 흐리게"·"A 흰 종이"): 거래 완료 알림 그림 자료와 명함 글.
// 사무소 확정 공개 정보(office.json)와 화면 입력(단지 이름·거래 종류·전용면적)만 쓰고, 저장·서버 전송·URL·브라우저 저장소에 넣지 않는다.
// - 거래 완료 알림: 동·층·계약 날짜는 넣지 않는다. 면적은 정수로 내리고 "㎡대"를 붙인다(공개 실거래가와 맞춰 가격·층을 찾지 못하게).
//   가격은 처음에 꺼져 있고 켤 때만 넣는다(보드 20번, 2026-11-24 사용자 답 "넣을지 고르게 (추천)"·"아냐 그냥 만들어" — 허락 확인 칸 없음).
//   그림 글에는 날짜 모양을 넣지 않는다(단지 이름도 막고, 시험이 모양별 글 전체를 paper-parts.mjs findDateText로 확인).
// - 사무소 명시사항 5항목은 ad-disclosure.mjs 한 곳의 칸 목록·빈 칸 검사·3줄을 쓴다. 하나라도 비면 만들지 않는다.
// - 명함에는 직함을 넣지 않는다(확정 공개 정보에 없음). '평'은 쓰지 않는다.
import { formatWon, officeFieldsMissing, officeLines } from "./ad-disclosure.mjs";
import { findDateText } from "./paper-parts.mjs";
import { cleanSingleLine } from "./work-format.mjs";

export const DONE_CARD_SIZE = Object.freeze({ width: 1080, height: 1350 });
export const DONE_LIMITS = Object.freeze({ complexName: 30, areaMin: 10, areaMax: 400 });
export const DONE_DEAL_TYPES = Object.freeze([
  { value: "sale", label: "매매" },
  { value: "jeonse", label: "전세" },
  { value: "monthly-rent", label: "월세" },
]);
export const DONE_TITLE = "거래 완료 알림";
export const DONE_STAMP = "거래 완료";
export const DONE_GUARD = "거래하신 분을 위해 가격·동·층·계약 날짜는 싣지 않습니다.";
// 가격을 켰을 때의 보호 문장(허락을 받았다고 쓰지 않는다: 확인 칸이 없어 사실인지 알 수 없음).
export const DONE_GUARD_PRICED = "거래하신 분을 위해 동·층·계약 날짜는 싣지 않습니다.";
// 가격 칸(만 원 단위 정수). 매매가·보증금 1만 ~ 99억 9,999만, 월세 1만 ~ 9,999만.
export const DONE_PRICE_LIMITS = Object.freeze({ amountMax: 999_999, monthlyMax: 9_999 });
// 그림 모양(보드 20번, 2026-11-24 사용자 답 "어 그렇게 해" — 거래완료 01·06·09·11). '기본'은 지금 그림(2026-11-20 "A 흰 종이").
export const DONE_SHAPES = Object.freeze([
  ["basic", "기본"],
  ["white", "흰 종이"],
  ["green", "초록 카드"],
  ["receipt", "영수증"],
  ["stamp", "도장"],
]);
export const DONE_SHAPE_DEFAULT = "basic";
// 모양별 새 문구(공개 전 승인 대상, 보드 20번 보고 '새 문구'). 날짜 모양을 넣지 않는다.
export const DONE_COPY = Object.freeze({
  white: { head: "거래 완료", lines: ["좋은 분께", "잘 이어 드렸습니다."], sub: "이 단지의 매매·전세·월세도 대표가 직접 상담합니다." },
  green: { head: "계약을 마쳤습니다", lines: ["집 보는 날부터 잔금까지", "대표가 직접 챙겼습니다."] },
  receipt: { head: "거래 내역", labels: ["단지", "면적", "거래", "금액", "상태"], hidden: "싣지 않음", state: "계약 완료", thanks: "다음 집도 맡겨 주세요", bye: "감사합니다" },
  stamp: { lines: ["좋은 분께 잘 이어 드렸습니다."] },
});
export const DONE_CONSULT = "이 단지의 매매·전세·월세는 대표가 직접 상담합니다.";
// 확정 공개 정보의 실제 도메인(CLAUDE.md '확정 공개 정보'). 카카오톡은 채널 이름을 확인하지 않아 office.json의 상담 주소를 짧게 쓴다.
export const OFFICE_DOMAIN = "leaderscityhappy.com";
// "https://pf.kakao.com/_nxmabn/chat" → "카카오톡 pf.kakao.com/_nxmabn". 주소가 없으면 빈 글.
export function kakaoLine(kakaoUrl) {
  const match = String(kakaoUrl ?? "").match(/^https:\/\/(pf\.kakao\.com\/[A-Za-z0-9_]+)(?:\/chat)?\/?$/u);
  return match ? `카카오톡 ${match[1]}` : "";
}
// 명함 뒷면 상담 지역(CLAUDE.md 확정 공개 정보 '전문 지역'·'주요 상담 단지').
export const CARD_AREA_HEADLINE = "대전 동구 전역 상담";
export const CARD_AREA_LINE = "리더스시티 4·5블록 · 신흥 SK뷰 · 천동 · 신흥동";

// 단지 이름 칸에 들어오면 안 되는 것: 동 번호·호수·층, 휴대폰 번호(손님 정보를 넣지 않음).
const UNIT_NUMBER = /(?<!\d)\d{1,4}\s*호(?!선|점|기|차)/u;
const DONG_NUMBER = /(?<!\d)\d{1,4}\s*동(?!구)/u;
const FLOOR_NUMBER = /(?<!\d)\d{1,3}\s*층/u;
const MOBILE_NUMBER = /01[016789]\s*-?\s*\d{3,4}\s*-?\s*\d{4}/u;
const AREA_INPUT = /^\d{1,3}(?:\.\d{1,2})?$/u;

const fail = (code, message) => ({ ok: /** @type {const} */ (false), error: { code, message } });

// "41,500" → 41500(만 원). 숫자·쉼표·띄어쓰기만, 1 ~ max. 틀리면 null.
export function parseMan(value, max) {
  const text = String(value ?? "").replace(/[,\s]/gu, "");
  if (!/^\d{1,7}$/u.test(text)) return null;
  const man = Number(text);
  return man >= 1 && man <= max ? man : null;
}

// 가격 글: 매매 "4억 1,500만 원", 전세 "보증금 2억 3,000만 원", 월세 "보증금 3,000만 원 · 월 90만 원". 틀리면 { error }.
export function donePriceText(dealType, { amountMan, depositMan, monthlyMan } = {}) {
  const won = (man) => formatWon(man * 10_000);
  if (dealType === "monthly-rent") {
    const deposit = parseMan(depositMan, DONE_PRICE_LIMITS.amountMax);
    const monthly = parseMan(monthlyMan, DONE_PRICE_LIMITS.monthlyMax);
    if (deposit === null || monthly === null) return { error: "보증금과 월세를 만 원 단위 숫자로 넣어 주세요(예: 보증금 3000, 월세 90)." };
    return { text: `보증금 ${won(deposit)} · 월 ${won(monthly)}` };
  }
  const amount = parseMan(amountMan, DONE_PRICE_LIMITS.amountMax);
  if (amount === null) return { error: `${dealType === "jeonse" ? "보증금을" : "매매가를"} 만 원 단위 숫자로 넣어 주세요(예: 41500).` };
  return { text: dealType === "jeonse" ? `보증금 ${won(amount)}` : won(amount) };
}

// "84.97" → "전용 84㎡대"(정수로 내림). 범위 밖이거나 숫자가 아니면 null.
export function areaBandText(value) {
  const text = String(value ?? "").trim();
  if (!AREA_INPUT.test(text)) return null;
  const m2 = Number(text);
  if (!(m2 >= DONE_LIMITS.areaMin && m2 <= DONE_LIMITS.areaMax)) return null;
  return `전용 ${Math.floor(m2)}㎡대`;
}

// 사무소 5항목이 비었을 때 막는 문장(없으면 null).
export function officeBlockReason(office) {
  const missing = officeFieldsMissing(office);
  return missing.length > 0 ? `사무소 명시사항(${missing.join("·")})이 비어 있어 만들 수 없습니다. 사무소 정보를 먼저 채워 주세요.` : null;
}

// 돌려주는 값: { ok: true, notice } 또는 { ok: false, error }. notice는 그림이 그대로 쓰는 글 묶음이다.
// priceOn이 true일 때만 가격 칸(만 원 단위 글)을 읽는다. 꺼져 있으면 칸에 무엇이 있어도 넣지 않는다.
export function buildDoneNotice({ complexName, dealType, areaM2, priceOn = false, amountMan = "", depositMan = "", monthlyMan = "" }, office) {
  const blocked = officeBlockReason(office);
  if (blocked) return fail("OFFICE", blocked);
  const name = cleanSingleLine(complexName, DONE_LIMITS.complexName + 1);
  if (!name) return fail("NAME", "단지 이름을 넣어 주세요.");
  if (name.length > DONE_LIMITS.complexName) return fail("NAME", `단지 이름은 ${DONE_LIMITS.complexName}자까지 넣을 수 있습니다.`);
  if (UNIT_NUMBER.test(name) || DONG_NUMBER.test(name) || FLOOR_NUMBER.test(name)) return fail("NAME", "단지 이름에는 동 번호·호수·층을 넣지 않습니다.");
  if (MOBILE_NUMBER.test(name)) return fail("NAME", "단지 이름에는 전화번호를 넣지 않습니다.");
  if (findDateText([name]).length > 0) return fail("NAME", "단지 이름에는 날짜를 넣지 않습니다.");
  const deal = DONE_DEAL_TYPES.find((type) => type.value === dealType);
  if (!deal) return fail("DEAL", "거래 종류를 골라 주세요.");
  const area = areaBandText(areaM2);
  if (!area) return fail("AREA", `전용면적을 ㎡ 숫자로 넣어 주세요(${DONE_LIMITS.areaMin} ~ ${DONE_LIMITS.areaMax}, 예: 84.97).`);
  const priced = priceOn === true ? donePriceText(deal.value, { amountMan, depositMan, monthlyMan }) : null;
  if (priced?.error) return fail("PRICE", priced.error);
  return {
    ok: /** @type {const} */ (true),
    notice: {
      title: DONE_TITLE,
      stamp: DONE_STAMP,
      name,
      fact: `${area} · ${deal.label}`,
      area,
      deal: deal.label,
      price: priced?.text ?? null,
      message: [`${name} ${deal.label} 계약을 마쳤습니다.`, DONE_CONSULT],
      guard: priced ? DONE_GUARD_PRICED : DONE_GUARD,
      phone: `상담 ${office.mobile}`,
      mobile: office.mobile,
      // 영업시간은 office.json에서 만든다(모양 그림이 시간을 따로 적어 두지 않게).
      hours: cardHoursText(office.hours),
      sub: [kakaoLine(office.kakaoUrl), OFFICE_DOMAIN].filter(Boolean),
      disclosure: officeLines(office),
    },
  };
}

// 그림 파일 이름: 날짜만(단지 이름·손님 정보를 파일 이름에 넣지 않음).
export const doneFileName = (todayIso) => `deal-done-${String(todayIso).replaceAll("-", "")}.png`;

// 보라 밤 모양(가격표·명함)의 시간 꼬리표: office.json 평일 닫는 시각으로 만든다. "20:00" → "평일 밤 8시까지 상담"(18시 이후는 '밤' + 12시간제),
// "17:30" → "평일 17시 30분까지 상담". 평일 닫는 시각이 없거나 모양이 틀리면 null(꼬리표를 그리지 않음).
export function weekdayCloseTag(hours) {
  const weekday = (hours ?? []).find((hour) => hour.label === "평일" && typeof hour.closes === "string");
  const match = weekday?.closes.match(/^([01]\d|2[0-3]):([0-5]\d)$/u);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const clock = hour >= 18 ? `밤 ${hour - 12}시` : `${hour}시`;
  return `평일 ${clock}${minute ? ` ${minute}분` : ""}까지 상담`;
}

const DAY_SHORT = { 평일: "평일", 토요일: "토", 일요일: "일" };

// office.hours → "평일 09:00 ~ 20:00 · 토 09:00 ~ 18:00 · 일 예약 상담"
export function cardHoursText(hours) {
  return (hours ?? []).map((hour) => {
    const label = DAY_SHORT[hour.label] ?? hour.label;
    if (hour.opens && hour.closes) return `${label} ${hour.opens} ~ ${hour.closes}`;
    return /예약/u.test(hour.note ?? "") ? `${label} 예약 상담` : `${label} 휴무`;
  }).join(" · ");
}

// 명함 모양(보드 20번, 2026-11-24 사용자 답 "다 마음에 드는데 고를 수 있게 하면 안되나" — 시안 6가지 모두, 처음 값 흰 종이).
// 고른 모양은 화면 메모리에만 둔다. 글은 모양과 상관없이 같고(아래 businessCardView), 모양은 BusinessCard.astro의 class만 바꾼다.
export const CARD_SHAPES = Object.freeze([
  ["white", "흰 종이"],
  ["green", "초록 카드"],
  ["sign", "간판색"],
  ["photo", "사진"],
  ["stamp", "도장"],
  ["night", "보라 밤"],
]);
export const CARD_SHAPE_DEFAULT = "white";
// 사진 모양 앞면의 대표 사진(공개 승인 사진, CLAUDE.md '확정 공개 정보' 아래 문단 2026-08-25).
export const CARD_PHOTO = "/images/office/representative-baek-jinok.webp";

// 명함 앞·뒤 글(A안 흰 종이). 5항목이 비면 blocked에 막는 문장을 넣는다.
export function businessCardView(office) {
  return {
    blocked: officeBlockReason(office),
    front: { brand: office.brandName, role: "대표", name: office.representative, phone: office.mobile, email: office.email, closeTag: weekdayCloseTag(office.hours) },
    back: {
      headline: CARD_AREA_HEADLINE,
      areas: CARD_AREA_LINE,
      rows: [
        ["영업", cardHoursText(office.hours)],
        ...(kakaoLine(office.kakaoUrl) ? [["상담", kakaoLine(office.kakaoUrl)]] : []),
        ["홈", OFFICE_DOMAIN],
      ],
      legal: [`${office.legalName} · 등록번호 ${office.registrationNumber}`, office.address],
    },
  };
}
