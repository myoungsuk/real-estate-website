// 홍보 종이 1차(보드 45번 C, 운영자 결정 2026-11-20 18:09 "① 가격 빼고 달·면적 흐리게"·"A 흰 종이"): 거래 완료 알림 그림 자료와 명함 글.
// 사무소 확정 공개 정보(office.json)와 화면 입력(단지 이름·거래 종류·전용면적)만 쓰고, 저장·서버 전송·URL·브라우저 저장소에 넣지 않는다.
// - 거래 완료 알림: 가격·동·층·계약 날짜는 넣지 않는다. 면적은 정수로 내리고 "㎡대"를 붙인다(공개 실거래가와 맞춰 가격·층을 찾지 못하게).
// - 사무소 명시사항 5항목은 ad-disclosure.mjs 한 곳의 칸 목록·빈 칸 검사·3줄을 쓴다. 하나라도 비면 만들지 않는다.
// - 명함에는 직함을 넣지 않는다(확정 공개 정보에 없음). '평'은 쓰지 않는다.
import { officeFieldsMissing, officeLines } from "./ad-disclosure.mjs";
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
export function buildDoneNotice({ complexName, dealType, areaM2 }, office) {
  const blocked = officeBlockReason(office);
  if (blocked) return fail("OFFICE", blocked);
  const name = cleanSingleLine(complexName, DONE_LIMITS.complexName + 1);
  if (!name) return fail("NAME", "단지 이름을 넣어 주세요.");
  if (name.length > DONE_LIMITS.complexName) return fail("NAME", `단지 이름은 ${DONE_LIMITS.complexName}자까지 넣을 수 있습니다.`);
  if (UNIT_NUMBER.test(name) || DONG_NUMBER.test(name) || FLOOR_NUMBER.test(name)) return fail("NAME", "단지 이름에는 동 번호·호수·층을 넣지 않습니다.");
  if (MOBILE_NUMBER.test(name)) return fail("NAME", "단지 이름에는 전화번호를 넣지 않습니다.");
  const deal = DONE_DEAL_TYPES.find((type) => type.value === dealType);
  if (!deal) return fail("DEAL", "거래 종류를 골라 주세요.");
  const area = areaBandText(areaM2);
  if (!area) return fail("AREA", `전용면적을 ㎡ 숫자로 넣어 주세요(${DONE_LIMITS.areaMin} ~ ${DONE_LIMITS.areaMax}, 예: 84.97).`);
  return {
    ok: /** @type {const} */ (true),
    notice: {
      title: DONE_TITLE,
      stamp: DONE_STAMP,
      name,
      fact: `${area} · ${deal.label}`,
      message: [`${name} ${deal.label} 계약을 마쳤습니다.`, DONE_CONSULT],
      guard: DONE_GUARD,
      phone: `상담 ${office.mobile}`,
      sub: [kakaoLine(office.kakaoUrl), OFFICE_DOMAIN].filter(Boolean),
      disclosure: officeLines(office),
    },
  };
}

// 그림 파일 이름: 날짜만(단지 이름·손님 정보를 파일 이름에 넣지 않음).
export const doneFileName = (todayIso) => `deal-done-${String(todayIso).replaceAll("-", "")}.png`;

const DAY_SHORT = { 평일: "평일", 토요일: "토", 일요일: "일" };

// office.hours → "평일 09:00 ~ 20:00 · 토 09:00 ~ 18:00 · 일 예약 상담"
export function cardHoursText(hours) {
  return (hours ?? []).map((hour) => {
    const label = DAY_SHORT[hour.label] ?? hour.label;
    if (hour.opens && hour.closes) return `${label} ${hour.opens} ~ ${hour.closes}`;
    return /예약/u.test(hour.note ?? "") ? `${label} 예약 상담` : `${label} 휴무`;
  }).join(" · ");
}

// 명함 앞·뒤 글(A안 흰 종이). 5항목이 비면 blocked에 막는 문장을 넣는다.
export function businessCardView(office) {
  return {
    blocked: officeBlockReason(office),
    front: { role: "대표", name: office.representative, phone: office.mobile, email: office.email },
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
