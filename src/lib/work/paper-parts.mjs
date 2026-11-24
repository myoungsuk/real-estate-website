// 종이 만들기 공용 부품의 순수 함수(보드 20번, 2026-11-24 사용자 결정 "거래완료, 매물 가격표, 소장 소개·명함"·"참고처럼 10가지 안팎").
// 그리기는 src/lib/work-paper-parts.ts가 하고, 여기에는 화면 없이 시험할 수 있는 계산만 둔다.
// - 명시사항 표: 지금 매물 안내지 비교표(work-listing-card.ts)의 가장 작은 글씨(25px × 0.8 = 20px)보다 작게 줄이지 않는다.
//   다 같은 값인 줄(소재지·종류·사용승인일 등)은 한 줄로 합쳐 칸 수를 줄인다. 가격 줄은 합치지 않는다.
// - 무늬(코르크 점)는 씨앗 값으로 늘 같은 그림을 만든다(같은 입력이면 같은 PNG).
// 저장·서버 전송·URL·브라우저 저장소를 쓰지 않는다.

export const DISCLOSURE_START_PX = 25;
export const DISCLOSURE_MIN_PX = 20;
export const OFFICE_FOOT_PX = 28;
export const STAMP_TEXT = Object.freeze(["계약", "완료"]);
const NEVER_MERGE = new Set(["price", "id"]);
const EMPTY = "—";

// 25, 24, … 20: 표가 자리에 맞을 때까지 이 순서로 줄여 본다.
export function fitSteps(start = DISCLOSURE_START_PX, min = DISCLOSURE_MIN_PX) {
  const steps = [];
  for (let px = Math.round(start); px >= Math.ceil(min); px -= 1) steps.push(px);
  return steps;
}

// 표 줄 맞추기: 매물 1건 줄({ label, value })도 값 1칸짜리 줄로 바꾼다.
export function normalizeRows(rows) {
  return (rows ?? []).map((row) => ({
    key: String(row.key ?? ""),
    label: String(row.label ?? ""),
    values: Array.isArray(row.values) ? row.values.map((value) => String(value ?? EMPTY)) : [String(row.value ?? EMPTY)],
  }));
}

// 여러 건 표에서 모든 칸이 같은 값인 줄은 common으로 뺀다(한 줄을 다 씀). 1건 표나 가격·매물번호 줄은 그대로 둔다.
export function splitCommonRows(rows) {
  const common = [];
  const rest = [];
  for (const row of normalizeRows(rows)) {
    const same = row.values.length > 1 && !NEVER_MERGE.has(row.key) && row.values.every((value) => value === row.values[0]) && row.values[0] !== EMPTY;
    if (same) common.push({ key: row.key, label: row.label, value: row.values[0] });
    else rest.push(row);
  }
  return { common, rows: rest };
}

// 표 칸 나누기: 이름 칸 + 매물 칸 n개. 이름 칸은 폭의 22%(최소 150px), 나머지를 같게 나눈다.
export function tableColumns(width, count) {
  const n = Math.max(1, Math.floor(count));
  const labelW = Math.max(150, Math.round(width * 0.22));
  const colW = (width - labelW) / n;
  return { labelW, colW, n };
}

// 씨앗 값이 같으면 같은 수열(mulberry32). 0 이상 1 미만.
export function seededRandom(seed) {
  let state = Math.floor(Number(seed) || 0) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 코르크 점: 넓이 1만 px²마다 density개. shade 0 ~ 2(어두움·밝음·중간).
export function corkSpecks(width, height, seed = 1, density = 18) {
  const rand = seededRandom(seed);
  const count = Math.max(0, Math.round((width * height) / 10000 * density));
  const specks = [];
  for (let i = 0; i < count; i += 1) {
    specks.push({ x: rand() * width, y: rand() * height, r: 0.8 + rand() * 1.8, shade: Math.floor(rand() * 3) });
  }
  return specks;
}

// 돌린 네모(가운데 기준)가 차지하는 바깥 네모. 돌린 계약서·사진이 그림 밖으로 나가는지 볼 때 쓴다.
export function rotatedBounds(x, y, w, h, deg) {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const bw = w * cos + h * sin;
  const bh = w * sin + h * cos;
  const cx = x + w / 2;
  const cy = y + h / 2;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

// 계약서 그림의 회색 줄 길이(폭 비율). 씨앗이 같으면 늘 같다. 글자는 넣지 않는다(제목만).
export function contractBars(seed = 7, count = 7) {
  const rand = seededRandom(seed);
  return Array.from({ length: count }, () => 0.55 + Math.round(rand() * 45) / 100);
}

// 거래 완료 그림에 들어갈 글에 날짜 모양이 있는지(보드 20번 대장 확인 2026-11-24: 가격을 켜면 실거래가와 맞춰 계약 달이 드러남).
// "2026년 11월 24일"·"2026. 11."·"11월"·"2026-11-24"·"11/24"를 잡는다. 찾은 글 조각 목록을 돌려준다(없으면 빈 배열).
// 등록번호(30110-2023-00028)·전화(010-2790-8675)처럼 숫자가 더 붙은 것은 날짜로 보지 않는다.
const DATE_LIKE = /(?<!\d)\d{4}\s*년(?:\s*\d{1,2}\s*월)?(?:\s*\d{1,2}\s*일)?|(?<!\d)\d{4}\s*[.\-/]\s*\d{1,2}(?!\d)(?:\s*[.\-/]\s*\d{1,2}(?!\d))?\.?|(?<![\d.])\d{1,2}\s*월(?:\s*\d{1,2}\s*일)?|(?<![\d./])\d{1,2}\/\d{1,2}(?![\d/])/gu;
export function findDateText(lines) {
  const found = [];
  for (const line of lines ?? []) for (const match of String(line ?? "").matchAll(DATE_LIKE)) found.push(match[0].trim());
  return found;
}
