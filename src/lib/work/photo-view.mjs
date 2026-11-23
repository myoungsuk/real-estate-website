// 손님 카드 '사진' 칸(단계 2 바로 찍기, F-b)의 화면 문장·크기 계산·검사 순수 함수. 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// 사용자 결정 2026-11-22 15:23:20(긴 변 4096px·10MB, 작은 미리보기 긴 변 480px + 누르면 원본, 올리기 단추 이름, 보관은 손님 기록과 같게)과
// 시안 승인 15:39:08("이 시안대로", 하단 막대 '사진 찍기' 더함, 사진첩 한 번에 10장, 휴지통 이름 '사진 · 11월 22일 14:05 올림').
// 칸 이름과 한도는 worker/work-input.mjs·work-files.mjs와 같다(설명 0 ~ 200자, 주민번호 꼴 거부, 원본 10MB, 미리보기 256KB).
// 사진 설명에는 손님 이름이 들어갈 수 있으므로 화면에만 보이고 주소·브라우저 저장소·로그에 넣지 않는다.
import { cleanSingleLine } from "./work-format.mjs";

export const PHOTO_MAX_EDGE = 4096; // Q-1: 긴 변을 이 안쪽으로 줄여 다시 저장
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024; // 서버 FILE_PHOTO_MAX_BYTES와 같음
export const PHOTO_QUALITIES = Object.freeze([0.9, 0.8]); // JPEG 품질. 0.9로 10MB를 넘으면 0.8로 한 번 더(지시서 4.1)
export const THUMB_MAX_EDGE = 480; // Q-2: 목록 미리보기
export const THUMB_MAX_BYTES = 256 * 1024; // 서버 FILE_THUMB_MAX_BYTES와 같음
export const THUMB_QUALITIES = Object.freeze([0.8, 0.6]);
export const PREVIEW_MAX_EDGE = 960; // 올리기 전 확인 칸 그림(화면 메모리만)
export const PHOTO_PICK_MAX = 10; // 사진첩에서 한 번에 고르는 장수(2026-11-22 15:39:08)
export const PHOTO_PAGE_SIZE = 20; // 목록은 20장씩, 더 있으면 '20장 더 보기'
export const PHOTO_CAPTION_MAX = 200;
export const PHOTO_GO_LABEL = "신분증·주민번호 없음 확인, 올리기"; // Q-3 단추 이름
export const PHOTO_KIND_LABELS = Object.freeze({ property_photo: "현장 사진", other: "기타 사진" });

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;
const two = (value) => String(value).padStart(2, "0");

/** ISO 시각 → 한국 시각 조각. 읽지 못하면 null @param {unknown} iso */
function koreaParts(iso) {
  const time = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(time)) return null;
  const at = new Date(time + KOREA_OFFSET_MS);
  return { month: at.getUTCMonth() + 1, day: at.getUTCDate(), weekday: WEEKDAYS[at.getUTCDay()], hour: at.getUTCHours(), minute: at.getUTCMinutes() };
}
/** 목록 묶음 제목 "11월 22일(일)" @param {string} iso */
export function photoDayText(iso) {
  const at = koreaParts(iso);
  return at ? `${at.month}월 ${at.day}일(${at.weekday})` : "날짜 모름";
}
/** 목록 칸 시각 "14:05" @param {string} iso */
export function photoTimeText(iso) {
  const at = koreaParts(iso);
  return at ? `${two(at.hour)}:${two(at.minute)}` : "";
}
/** 요일 없이 "11월 22일 14:05"(계약서 사본 줄. 휴지통 묶음 이름과 같은 꼴) @param {string} iso */
export function photoShortAtText(iso) {
  const at = koreaParts(iso);
  return at ? `${at.month}월 ${at.day}일 ${two(at.hour)}:${two(at.minute)}` : "";
}
/** "11월 22일(일) 14:05" @param {string} iso */
export function photoAtText(iso) {
  const at = koreaParts(iso);
  return at ? `${photoDayText(iso)} ${photoTimeText(iso)}` : "";
}

/**
 * 긴 변을 max 안쪽으로 줄인 크기(늘리지 않음, 정수, 1 이상). 너비·높이를 읽지 못하면 null.
 * @param {number} width @param {number} height @param {number} max
 */
export function fitSize(width, height, max) {
  if (!(width > 0) || !(height > 0) || !(max > 0)) return null;
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** "2.8MB"·"640KB" @param {number} bytes */
export function photoSizeText(bytes) {
  if (!(bytes > 0)) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(Math.round((bytes / (1024 * 1024)) * 10) / 10).toLocaleString("ko-KR")}MB`;
}

/**
 * 고른 장수 검사. 0장이면 조용히 끝(고르기 창을 닫음), 10장을 넘으면 서버에 보내지 않고 안내.
 * @param {number} count
 */
export function checkPickCount(count) {
  if (!(count > 0)) return { ok: false, error: "" };
  if (count > PHOTO_PICK_MAX) return { ok: false, error: `한 번에 ${PHOTO_PICK_MAX}장까지 올릴 수 있습니다. ${count}장을 골랐으니 ${PHOTO_PICK_MAX}장 이하로 다시 골라 주세요.` };
  return { ok: true, error: "" };
}

// 주민등록번호 꼴. 서버 worker/work-input.mjs의 RRN_PATTERN·전각 글자 바꾸기와 같은 기준(앞 6자리 + 공백·하이픈·점 + 뒤 첫 자리 1 ~ 8 + 6자리).
const RESIDENT_NUMBER_PATTERN = /(?<!\d)\d{6}\s*[-.‐-―−]?\s*[1-8]\d{6}(?!\d)/u;
const WIDTH_VARIANTS = /[　﹐-﹯！-～]/gu;

/**
 * 설명 검사. 서버와 같은 cleanSingleLine으로 줄바꿈·연속 공백을 한 칸으로 정리하고 앞뒤 공백을 뺀다. 빈 설명은 받는다(설명 지우기).
 * @param {unknown} caption
 */
export function checkCaption(caption) {
  const text = cleanSingleLine(caption, Number.POSITIVE_INFINITY);
  if (text.length > PHOTO_CAPTION_MAX) return { ok: false, error: `설명은 ${PHOTO_CAPTION_MAX}자까지 넣을 수 있습니다.` };
  if (RESIDENT_NUMBER_PATTERN.test(text.replace(WIDTH_VARIANTS, (char) => char.normalize("NFKC")))) return { ok: false, error: "주민등록번호처럼 보이는 숫자는 사진 설명에 넣을 수 없습니다." };
  return { ok: true, value: text };
}
/** 설명 칸 아래 "23/200" @param {string} caption */
export const captionCountText = (caption) => `${String(caption ?? "").length}/${PHOTO_CAPTION_MAX}`;

/**
 * 목록을 한국 날짜로 묶는다(받은 순서 = 올린 때 최근 순을 그대로 둠).
 * @template {{ createdAt: string }} T @param {T[]} files @returns {{ day: string, items: T[] }[]}
 */
export function groupByDay(files) {
  /** @type {{ day: string, items: T[] }[]} */
  const groups = [];
  for (const file of files ?? []) {
    const day = photoDayText(file.createdAt);
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(file);
    else groups.push({ day, items: [file] });
  }
  return groups;
}

/** 사진 칸 단추 이름(화면 읽기 도구) @param {{ createdAt: string, caption?: string }} file */
export function photoButtonLabel(file) {
  const caption = String(file?.caption ?? "").trim();
  return `사진 크게 보기 · ${photoAtText(file?.createdAt)}${caption ? ` · ${caption}` : ""}`;
}
/** 크게 보기 아래 한 줄 "현장 사진 · 11월 22일(일) 14:05 올림 · 3장 중 1번째" @param {{ kind: string, createdAt: string }} file @param {number} index @param {number} total */
export function photoMetaText(file, index, total) {
  const kind = PHOTO_KIND_LABELS[file?.kind] ?? "사진";
  return `${kind} · ${photoAtText(file?.createdAt)} 올림 · ${total.toLocaleString("ko-KR")}장 중 ${(index + 1).toLocaleString("ko-KR")}번째`;
}
/** 목록 아래 "20장 보는 중 · 모두 24장"(모두 보이면 "") @param {number} shown @param {number} total */
export function photoShownText(shown, total) {
  return total > shown ? `${shown.toLocaleString("ko-KR")}장 보는 중 · 모두 ${total.toLocaleString("ko-KR")}장` : "";
}
/** 꺼짐 글. 이미 올린 사진이 있으면 그 수를 알린다 @param {number} count */
export function photosOffText(count) {
  return count > 0
    ? `파일 저장소가 아직 켜지지 않았습니다. 올려 둔 사진 ${count.toLocaleString("ko-KR")}장은 저장소를 다시 켜면 보입니다.`
    : "파일 저장소가 아직 켜지지 않았습니다. 켜지면 여기서 현장 사진을 바로 찍어 올릴 수 있습니다.";
}

/**
 * 올리기 칸 제목. 고른 상태(ready)·올리는 중(busy)·못 올린 것이 있음(fail).
 * @param {{ source: "camera" | "album", total: number, done: number, failed: number, busy: boolean }} state
 */
export function uploadTitleText({ source, total, done, failed, busy }) {
  if (busy) return { title: "올리는 중…", count: `${total.toLocaleString("ko-KR")}장 중 ${done.toLocaleString("ko-KR")}장 올림` };
  if (failed > 0) return { title: `! 사진 ${failed.toLocaleString("ko-KR")}장을 올리지 못했습니다`, count: "" };
  if (source === "camera" && total === 1) return { title: "찍은 사진 확인", count: "" };
  return { title: total === 1 ? "고른 사진 확인" : `고른 사진 ${total.toLocaleString("ko-KR")}장 확인`, count: "" };
}
/** 다 올린 뒤 알림 @param {number} count */
export const uploadedText = (count) => `✓ 사진 ${count.toLocaleString("ko-KR")}장을 올렸습니다.`;
/** 설명만 저장하지 못했을 때(사진은 올라감) @param {number} count */
export const captionMissedText = (count) => `사진은 올렸지만 ${count.toLocaleString("ko-KR")}장의 설명은 저장하지 못했습니다. 사진을 눌러 설명을 다시 넣어 주세요.`;

// 사진을 다시 저장하지 못한 까닭(서버에 보내기 전) → 화면 문장
export const PREPARE_ERROR_TEXTS = Object.freeze({
  DECODE_FAILED: "이 파일은 사진으로 읽을 수 없습니다. JPEG·PNG·WebP 사진을 골라 주세요.",
  TOO_LARGE: "이 사진은 줄여도 10MB가 넘어 올릴 수 없습니다. 휴대폰 카메라 설정에서 사진 크기를 줄여 다시 찍어 주세요.",
  ENCODE_FAILED: "사진을 다시 저장하지 못했습니다. 휴대폰 메모리가 모자랄 수 있으니 다른 앱을 닫고 다시 해 주세요.",
});
/** @param {string} code @param {number} [count] 같은 까닭으로 못 쓴 장수 */
export function prepareErrorText(code, count = 1) {
  const text = PREPARE_ERROR_TEXTS[code] ?? PREPARE_ERROR_TEXTS.ENCODE_FAILED;
  return count > 1 ? `${count.toLocaleString("ko-KR")}장: ${text}` : text;
}

// 서버 오류 코드 → 화면 문장(사진 칸 전용. 나머지는 손님 화면 문장 customerErrorText로)
export const PHOTO_ERROR_TEXTS = Object.freeze({
  FILES_DISABLED: "파일 저장소가 아직 켜지지 않았습니다.",
  FILE_STORAGE_FAILED: "파일 저장소에 연결하지 못했습니다. 잠시 뒤 '다시 올리기'를 눌러 주세요.",
  CHECKSUM_MISMATCH: "보내는 중에 사진이 깨졌습니다. '다시 올리기'를 눌러 주세요.",
  PAYLOAD_TOO_LARGE: "사진이 10MB를 넘어 올릴 수 없습니다.",
  IMAGE_METADATA_PRESENT: "사진에 촬영 정보가 남아 있어 서버가 받지 않았습니다. 개발 담당에게 '사진 촬영 정보 거부'라고 알려 주세요.",
  UNSUPPORTED_MEDIA_TYPE: "서버가 받지 않는 사진 형식입니다. 개발 담당에게 '사진 형식 거부'라고 알려 주세요.",
  FILE_KIND_NOT_READY: "이 종류의 파일은 아직 올릴 수 없습니다.",
  NOT_FOUND: "찾지 못했습니다. 손님이나 사진을 다른 화면에서 지웠을 수 있습니다.",
  AUDIT_UNAVAILABLE: "작업 기록을 남기지 못해 사진을 보여 드리지 않았습니다. 잠시 뒤 다시 해 주세요.",
});
/**
 * 못 올렸을 때 칸 안 첫 문장. 인터넷이 끊겨 서버 답이 없으면(code 없음) 연결 문장, 그 밖에는 사진 칸 문장 → 손님 화면 문장 순.
 * @param {string | null | undefined} code @param {(code: string) => string} fallback 손님 화면 오류 문장(customerErrorText)
 */
export function uploadFailText(code, fallback) {
  if (!code) return "인터넷이 끊겼거나 서버가 잠시 답하지 않았습니다.";
  return UPLOAD_ERROR_TEXTS[code] ?? PHOTO_ERROR_TEXTS[code] ?? fallback(code);
}
// 올리기에서만 쓰는 문장. 손님 화면 문장은 "화면을 새로고침"이라 하는데, 그러면 화면 메모리에만 있는 못 올린 사진이 없어진다(현장에서 Access 로그인이 끝날 때).
// 새로고침 대신 새 탭에서 다시 로그인하고 '다시 올리기'를 누르게 한다. 크게 보기의 설명 저장·지우기는 잃을 사진이 없으므로 손님 화면 문장 그대로.
export const UPLOAD_ERROR_TEXTS = Object.freeze({
  AUTH_REQUIRED: "관리자 로그인이 만료되었습니다. 새 탭에서 관리자 화면을 열어 다시 로그인한 뒤 '다시 올리기'를 누르세요.",
  CSRF_INVALID: "보안 확인이 만료되었습니다. 화면을 새로고침하지 말고 '다시 올리기'를 눌러 주세요.",
});
/** 다시 올려 볼 만한 오류인지(아니면 '다시 올리기'를 숨기고 '버리기'만) @param {string | undefined} code */
export const isUploadRetryable = (code) => !["FILES_DISABLED", "PAYLOAD_TOO_LARGE", "IMAGE_METADATA_PRESENT", "UNSUPPORTED_MEDIA_TYPE", "FILE_KIND_NOT_READY", "NOT_FOUND", "WORK_DISABLED", "WORK_CONFIG_MISSING", "WORK_SCHEMA_OUTDATED", "VALIDATION_FAILED"].includes(code ?? "");
