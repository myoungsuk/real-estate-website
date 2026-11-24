// 대표 소개 그림 글 묶음(보드 20번, 2026-11-24 사용자 답 "거래완료, 매물 가격표, 소장 소개·명함"·"승인된 사진 + 그림"·"어 그렇게 해"(소개 01·06·10)).
// 입력 칸이 없다. 사무소 확정 공개 정보(office.json)와 공개 승인 사진만 쓰고, 저장·서버 전송·URL·브라우저 저장소에 넣지 않는다.
// - 대표 말은 office.json 소개글(공개 승인 문장)만 쓴다. 그 밖의 문구(INTRO_COPY)는 새로 쓴 것이라 공개 전 승인 대상이다.
// - 사무소 명시사항 5항목은 ad-disclosure.mjs 한 곳을 쓰고, 하나라도 비면 만들지 않는다.
// - 직함은 확정 공개 정보의 '대표'만 쓴다.
import { officeLines } from "./ad-disclosure.mjs";
import { OFFICE_DOMAIN, cardHoursText, kakaoLine, officeBlockReason } from "./promo-paper.mjs";

export const INTRO_CARD_SIZE = Object.freeze({ width: 1080, height: 1350 });
export const INTRO_SHAPES = Object.freeze([
  ["white", "흰 종이"],
  ["green", "초록 카드"],
  ["photo", "사진 크게"],
]);
export const INTRO_SHAPE_DEFAULT = "white";
// 공개 승인 사진(CLAUDE.md '확정 공개 정보' 아래 문단: 대표 사진·사무소·4·5블록 2026-08-25, 신흥 SK뷰 2026-09-01).
export const INTRO_PHOTOS = Object.freeze({
  representative: "/images/office/representative-baek-jinok.webp",
  storefront: "/images/office/office-storefront.webp",
  strip: Object.freeze([
    ["/images/area/leaders-city-4-landscape-640.webp", "리더스시티 4블록"],
    ["/images/area/leaders-city-5-entrance-640.webp", "리더스시티 5블록"],
    ["/images/area/sinheung-sk-view-640.webp", "신흥 SK뷰"],
    ["/images/office/office-consultation.webp", "사무소 상담실"],
  ]),
});
// 새로 쓴 문구(공개 전 승인 대상).
export const INTRO_COPY = Object.freeze({
  white: "단지 안 상가에서 직접 상담합니다",
  green: "리더스시티 4·5블록과 신흥 SK뷰를 직접 상담합니다.",
  photo: "이 문을 열면 바로 상담",
});
// 대표 말로 쓰는 소개글 줄(office.json introduction의 셋째 줄, 공개 승인 문장).
export const INTRO_QUOTE_INDEX = 2;

// "대전광역시 동구 안샘로14번길 7, 리더스시티5블록 근린생활시설 105호" → "리더스시티5블록 근린생활시설 105호"(쉼표 뒤). 쉼표가 없으면 전체.
export function shortAddress(address) {
  const text = String(address ?? "").trim();
  const at = text.lastIndexOf(",");
  return at >= 0 ? text.slice(at + 1).trim() : text;
}

// 돌려주는 값: { ok: true, view } 또는 { ok: false, error }.
export function buildIntroView(office) {
  const blocked = officeBlockReason(office);
  if (blocked) return { ok: /** @type {const} */ (false), error: blocked };
  const quote = Array.isArray(office.introduction) && typeof office.introduction[INTRO_QUOTE_INDEX] === "string" ? office.introduction[INTRO_QUOTE_INDEX].trim() : "";
  return {
    ok: /** @type {const} */ (true),
    view: {
      brand: office.brandName,
      role: "대표",
      name: office.representative,
      quote,
      place: shortAddress(office.address),
      hours: cardHoursText(office.hours),
      phone: office.mobile,
      sub: [kakaoLine(office.kakaoUrl), OFFICE_DOMAIN].filter(Boolean),
      copy: INTRO_COPY,
      photos: INTRO_PHOTOS,
      disclosure: officeLines(office),
    },
  };
}

// 그림 파일 이름: 날짜만.
export const introFileName = (todayIso) => `intro-${String(todayIso).replaceAll("-", "")}.png`;
