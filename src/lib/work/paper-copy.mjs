// 종이 만들기 '문구 고치기'(보드 20번 2판, 2026-11-24 사용자 답 "문구도 수정할 수 있게 하면 안되나?").
// 모양마다 새로 쓴 글(제목·한 줄 글·도장 글·꼬리표·명함 뒷면 제목 등)만 고칠 수 있다. 처음 값은 지금 문구이고, 글은 화면 칸에만 있다(저장·서버 전송·URL·브라우저 저장소 없음).
// 고치지 않는 것: 사무소 명시사항 5항목, 공동주택 13항목, 단지 이름·면적·가격(이미 입력 칸이 있음), 가격을 켰을 때의 보호 문장, 매물 자료에서 만드는 제목·확인 줄.
// 검사(그리기 전, 걸리면 그림을 만들지 않고 까닭 한 줄):
// - 모든 칸: 동 번호·호수, 사무소 번호가 아닌 전화번호. 거래 완료 알림은 날짜 모양(findDateText)과 층도 막는다.
// - 칸마다 글자 수 한도(그 자리에 들어가는 만큼). 한도 안이어도 그림에 다 들지 않으면 그리는 쪽이 막는다(잘린 그림을 내지 않음).
// - 빈 칸: optional 칸은 그 줄을 빼고, 나머지(제목·도장 첫 줄·영수증 상태·소개 한 줄)는 막는다(비운 칸을 몰래 처음 문구로 바꾸지 않음).
import { CARD_AREA_HEADLINE, CARD_AREA_LINE, DONE_CONSULT, DONE_COPY, DONE_STAMP, DONE_TITLE, weekdayCloseTag } from "./promo-paper.mjs";
import { INTRO_COPY } from "./intro-paper.mjs";
import { LISTING_SHAPE_COPY } from "./listing-paper.mjs";
import { STAMP_TEXT, findDateText } from "./paper-parts.mjs";
import { cleanSingleLine } from "./work-format.mjs";

/** @typedef {{ key: string, label: string, max: number, value: string, optional: boolean, hint: string }} PaperCopyField */
// hint: 칸 아래 'n자까지' 뒤에 붙이는 안내(없으면 빈 글자). 한도 안이어도 폭 검사에 걸릴 수 있는 칸만 쓴다.
/** @returns {PaperCopyField} */
const field = (key, label, max, value, optional = false, hint = "") => Object.freeze({ key, label, max, value: String(value ?? ""), optional, hint });
export const CARD_AREA_FIT_HINT = "한글만 쓰면 30자쯤에서 명함 폭을 넘어 인쇄를 막습니다";
const stampFields = () => [field("stamp1", "도장 글(위)", 3, STAMP_TEXT[0]), field("stamp2", "도장 글(아래)", 3, STAMP_TEXT[1], true)];

// 칸 목록: { 모양: [칸] }. 칸이 없는 모양(매물 '기본'·'사진 크게')은 빈 배열.
// 한도는 가장 넓은 글자(한글 1글자 = 글자 크기 1em)로 그 자리에 드는 만큼이다. 감기는 칸은 줄 수가 늘어도 그림 높이 검사가 막는다.
/** @returns {Record<string, PaperCopyField[]>} */
export function paperCopyFields(tool, office) {
  if (tool === "done") {
    return {
      basic: [field("title", "머리 줄 제목", 16, DONE_TITLE), field("stamp", "도장 글", 12, DONE_STAMP), field("consult", "안내 글", 40, DONE_CONSULT, true)],
      white: [field("head", "큰 제목", 12, DONE_COPY.white.head), field("line1", "한 줄 글 1", 20, DONE_COPY.white.lines[0], true), field("line2", "한 줄 글 2", 20, DONE_COPY.white.lines[1], true), field("sub", "작은 글", 40, DONE_COPY.white.sub, true), ...stampFields()],
      green: [field("head", "큰 제목", 16, DONE_COPY.green.head), field("line1", "한 줄 글 1", 20, DONE_COPY.green.lines[0], true), field("line2", "한 줄 글 2", 20, DONE_COPY.green.lines[1], true), ...stampFields()],
      receipt: [field("head", "맨 위 제목", 10, DONE_COPY.receipt.head), field("state", "상태", 10, DONE_COPY.receipt.state), field("thanks", "인사 글", 18, DONE_COPY.receipt.thanks, true), field("bye", "맨 아래 인사", 12, DONE_COPY.receipt.bye, true), ...stampFields()],
      stamp: [field("line1", "한 줄 글", 24, DONE_COPY.stamp.lines[0], true), ...stampFields()],
    };
  }
  if (tool === "listing") {
    return {
      basic: [],
      white: [field("call", "상담 줄 글", 16, LISTING_SHAPE_COPY.white, true)],
      green: [field("head", "큰 제목", 12, LISTING_SHAPE_COPY.green), field("call", "전화 앞 글", 12, LISTING_SHAPE_COPY.call, true)],
      night: [field("line", "맨 위 작은 글", 16, LISTING_SHAPE_COPY.night, true), field("tag", "노란 꼬리표", 14, weekdayCloseTag(office?.hours) ?? "", true)],
      photo: [],
    };
  }
  if (tool === "intro") {
    return {
      white: [field("line", "한 줄 글", 28, INTRO_COPY.white)],
      green: [field("line", "한 줄 글", 40, INTRO_COPY.green)],
      photo: [field("line", "사진 위 큰 글", 18, INTRO_COPY.photo)],
    };
  }
  if (tool === "card") {
    // 지역 줄 36자는 띄어쓰기·숫자·'·'를 섞은 길이다. 한글만 쓰면 30자쯤(글꼴에 따라 29 ~ 31자)에서 명함 폭을 넘어 미리 보기 넘침 검사가 막으므로 칸 아래에 알린다(2026-11-25).
    const back = () => [field("headline", "뒷면 제목", 18, CARD_AREA_HEADLINE), field("areas", "뒷면 지역 줄", 36, CARD_AREA_LINE, true, CARD_AREA_FIT_HINT)];
    const tag = weekdayCloseTag(office?.hours);
    return {
      white: back(),
      green: back(),
      sign: back(),
      photo: back(),
      stamp: back(),
      night: [...(tag ? [field("tag", "앞면 노란 꼬리표", 14, tag, true)] : []), ...back()],
    };
  }
  return {};
}

// 칸 검사에 쓰는 모양(promo-paper.mjs 단지 이름 검사와 같은 동·호수·층 모양).
const UNIT_NUMBER = /(?<!\d)\d{1,4}\s*호(?!선|점|기|차)/u;
const DONG_NUMBER = /(?<!\d)\d{1,4}\s*동(?!구)/u;
const FLOOR_NUMBER = /(?<!\d)\d{1,3}\s*층/u;
// 전화번호 모양: 010·02·042 등으로 시작하는 번호와 1588 같은 대표 번호. 등록번호(30110-2023-00028)·사업자번호는 걸리지 않는다.
const PHONE_LIKE = /(?<!\d)(?:0\d{1,2}[\s.\-)]*\d{3,4}[\s.\-]*\d{4}|1[5-9]\d{2}[\s.\-]?\d{4})(?!\d)/gu;
const digits = (value) => String(value ?? "").replace(/\D/gu, "");

// 글 하나의 문제(없으면 null). tool이 "done"이면 날짜·층도 본다.
export function copyTextProblem(tool, value, office) {
  const text = String(value ?? "");
  if (UNIT_NUMBER.test(text) || DONG_NUMBER.test(text)) return "동 번호·호수는 넣지 않습니다.";
  if (tool === "done" && FLOOR_NUMBER.test(text)) return "층은 넣지 않습니다.";
  const allowed = new Set([digits(office?.mobile)].filter(Boolean));
  for (const match of text.matchAll(PHONE_LIKE)) if (!allowed.has(digits(match[0]))) return "사무소 번호가 아닌 전화번호는 넣지 않습니다.";
  if (tool === "done" && findDateText([text]).length > 0) return "날짜는 넣지 않습니다(계약 달이 드러남).";
  return null;
}

// values: { 칸 key: 화면 글 }. 돌려주는 값: { ok: true, copy: { key: 다듬은 글(뺀 칸은 "") } } 또는 { ok: false, error: { key, message } }.
// 모르는 모양이나 칸 목록에 없는 key는 무시하고, 칸이 없으면 처음 값을 쓴다(화면이 칸을 그리지 않은 경우).
export function checkPaperCopy(tool, shape, values, office) {
  const fields = paperCopyFields(tool, office)[shape] ?? [];
  /** @type {Record<string, string>} */
  const copy = {};
  for (const item of fields) {
    const raw = values && Object.hasOwn(values, item.key) ? values[item.key] : item.value;
    const text = cleanSingleLine(raw, item.max + 1);
    const fail = (message) => ({ ok: /** @type {const} */ (false), error: { key: item.key, message: `'${item.label}': ${message}` } });
    if (!text && !item.optional) return fail("비울 수 없습니다. 지금 문구로 돌리려면 '처음 문구로'를 누르세요.");
    if (text.length > item.max) return fail(`${item.max}자까지 넣을 수 있습니다.`);
    const problem = copyTextProblem(tool, text, office);
    if (problem) return fail(problem);
    copy[item.key] = text;
  }
  return { ok: /** @type {const} */ (true), copy };
}

// 처음 문구(시험·그리는 쪽 기본값).
export function defaultPaperCopy(tool, shape, office) {
  return Object.fromEntries((paperCopyFields(tool, office)[shape] ?? []).map((item) => [item.key, item.value]));
}

// 도장 글 두 칸 → 그릴 줄(빈 줄은 뺌).
export const stampLines = (copy) => [copy?.stamp1, copy?.stamp2].filter((line) => typeof line === "string" && line.length > 0);
