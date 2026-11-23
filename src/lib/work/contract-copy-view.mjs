// 손님 카드 거래 칸 '계약서 사본'(단계 4 K-b)의 화면 문장·크기 계산 순수 함수. 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// 사용자 결정 2026-11-23 10:22:02: 가림 화면 "이대로 구현해 올림", 확대 확인 "사진 전체를 크게, 끌어서 봄", 사본 칸 "접어 둠".
// - 계약서 사본은 거래에 붙인다(한 거래 10장, 서버 FILE_CONTRACT_COPY_MAX_PER_DEAL). 한 번에 한 장씩, 주민등록번호를 검게 칠한 사본만 올린다.
// - 가리기 전 사진은 서버로 보내지 않는다. 가린 곳이 0개면 한 번 더 물은 뒤 같은 표시(X-Work-Masked: rrn=1 = "가렸거나 번호가 없음")로 올린다.
// - 작은 미리보기는 만들지 않는다(서버가 받지 않음). 목록은 글자 줄이고 '보기'를 누를 때만 올려 둔 사본을 받는다(감사 file.download).
// 칸 이름과 한도는 worker/work-input.mjs·work-files.mjs와 같다.
import { maskCountText } from "./mosaic.mjs";
import { isUploadRetryable, photoShortAtText, uploadFailText } from "./photo-view.mjs";

export const COPY_KIND = "contract_copy";
export const COPY_MAX_PER_DEAL = 10; // 서버 FILE_CONTRACT_COPY_MAX_PER_DEAL와 같음
// 확대 확인의 크기: 사진 자리 폭의 4배 또는 실제 크기(사진 1픽셀 = 화면 1px) 중 작은 쪽.
// 까닭: A4 계약서를 화면 가득 찍은 휴대폰 사진(3024×4032)에서 주민등록번호 숫자 높이는 약 43px(종이 위 3mm)이다.
// 360px 휴대폰(사진 자리 폭 336px)에서 2배면 숫자가 약 10px라 한 글자씩 읽기 어렵고, 4배면 약 19px(본문 글자보다 큼)이다.
// 실제 크기보다 크게는 늘리지 않는다(흐려질 뿐 더 읽히지 않음).
export const COPY_ZOOM_TIMES = 4;

export const COPY_SHOOT_LABEL = "계약서 찍기";
export const COPY_PICK_LABEL = "사진첩에서 고르기";
export const COPY_NOTE_TEXT = "주민등록번호를 검게 가린 사본만 올립니다. 가리는 일은 이 기기에서 하고, 가리기 전 사진은 서버로 보내지 않습니다. 작은 미리보기는 만들지 않습니다.";
export const COPY_MASK_TITLE = "주민등록번호 가리기";
export const COPY_MASK_GUIDE = "주민등록번호를 마우스나 손가락으로 끌어 검게 칠하세요. 여러 곳을 칠할 수 있습니다. 키보드로는 그릴 수 없습니다.";
export const COPY_TO_CHECK_LABEL = "다 가렸음, 확대해서 확인";
export const COPY_NONE_LABEL = "가릴 주민번호 없음";
export const COPY_CHECK_TITLE = "가린 자리 확인";
export const COPY_CHECK_GUIDE = "크게 본 모습입니다. 사진을 끌어 옮겨 보면서 주민등록번호가 한 글자도 보이지 않는지 확인하세요.";
export const COPY_BACK_LABEL = "다시 가리기";
export const COPY_GO_LABEL = "주민번호 가림 확인, 올리기";
export const COPY_GO_NONE_LABEL = "주민번호 없음 확인, 올리기";
export const COPY_RETRY_LABEL = "다시 올리기";
export const COPY_VIEW_TITLE = "계약서 사본 보기";
export const COPY_VIEW_GUIDE = "올려 둔 사본입니다. '크게 보기'를 누른 뒤 사진을 끌어 옮겨 볼 수 있습니다.";
export const COPY_VIEW_BIG_LABEL = "크게 보기";
export const COPY_VIEW_FIT_LABEL = "화면에 맞추기";
export const COPY_UPLOADED_TEXT = "✓ 계약서 사본 1장을 올렸습니다.";
export const COPY_UPLOADED_STALE_TEXT = "✓ 계약서 사본은 올렸습니다. 다만 손님 카드를 새로 읽지 못해 아래 목록에는 아직 없습니다. 화면을 새로 고쳐 주세요.";
export const COPY_DROP_FAILED_TITLE = "못 올린 사본을 버릴까요?";
export const COPY_DROP_EDIT_TITLE = "가리던 사진을 버릴까요?";
export const COPY_KEEP_TEXT = "못 올린 사본은 이 화면에만 남아 있어, 화면을 닫거나 새로 고치면 없어집니다(휴대폰 사진첩에 없을 수 있음).";

/** 거래의 계약서 사본만(받은 순서 = 올린 때 최근 순) @param {{ files?: Array<{ kind: string }> } | null | undefined} deal */
export function copyFilesOf(deal) {
  return (deal?.files ?? []).filter((file) => file?.kind === COPY_KIND);
}

/** 접어 둔 칸의 단추 이름 "계약서 사본 2장"(펼치면 "계약서 사본 접기") @param {number} count @param {boolean} open */
export function copyToggleText(count, open) {
  return open ? "계약서 사본 접기" : `계약서 사본 ${Math.max(0, count).toLocaleString("ko-KR")}장`;
}
/** 펼친 칸 제목 옆 "2장 · 10장까지"(0장이면 "아직 없음 · 10장까지") @param {number} count */
export function copyHeadText(count) {
  return `${count > 0 ? `${count.toLocaleString("ko-KR")}장` : "아직 없음"} · ${COPY_MAX_PER_DEAL}장까지`;
}
/** 목록 한 줄 "계약서 사본 · 11월 23일 10:40 올림"(휴지통의 묶음 이름과 같은 꼴) @param {{ createdAt: string }} file */
export function copyRowText(file) {
  const at = photoShortAtText(file?.createdAt);
  return at ? `계약서 사본 · ${at} 올림` : "계약서 사본";
}
/** 10장을 다 채웠는지 @param {number} count */
export const isCopyFull = (count) => count >= COPY_MAX_PER_DEAL;
export const COPY_FULL_TEXT = `${COPY_MAX_PER_DEAL}장을 다 채웠습니다. 더 올리려면 먼저 한 장을 지워 주세요.`;
/** 파일 저장소가 꺼졌을 때 @param {number} count */
export function copyOffText(count) {
  return count > 0
    ? `파일 저장소가 아직 켜지지 않았습니다. 올려 둔 계약서 사본 ${count.toLocaleString("ko-KR")}장은 저장소를 다시 켜면 볼 수 있습니다.`
    : "파일 저장소가 아직 켜지지 않았습니다. 켜지면 여기서 계약서 사본을 찍어 올릴 수 있습니다.";
}

/**
 * 확대 확인에서 보일 사진 폭(CSS px). 사진 자리 폭의 4배와 사진 폭 중 작은 쪽. 폭을 읽지 못하면 null.
 * @param {number} imageWidth 사진 폭(픽셀) @param {number} stageWidth 사진 자리 폭(CSS px)
 * @returns {{ width: number, natural: boolean } | null}
 */
export function copyZoom(imageWidth, stageWidth) {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(stageWidth) || !(imageWidth > 0) || !(stageWidth > 0)) return null;
  const wide = Math.round(stageWidth * COPY_ZOOM_TIMES);
  return imageWidth <= wide ? { width: Math.round(imageWidth), natural: true } : { width: wide, natural: false };
}
/** "실제 크기로 보는 중"·"화면 폭의 4배로 보는 중" @param {{ natural: boolean } | null | undefined} zoom */
export function copyZoomText(zoom) {
  if (!zoom) return "";
  return zoom.natural ? "실제 크기로 보는 중" : `화면 폭의 ${COPY_ZOOM_TIMES}배로 보는 중`;
}
/** 확대 확인의 한 줄 "2곳 가림 · 화면 폭의 4배로 보는 중" @param {number} count @param {{ natural: boolean } | null | undefined} zoom */
export function copyCheckText(count, zoom) {
  return [maskCountText(count), copyZoomText(zoom)].filter(Boolean).join(" · ");
}
/**
 * 확대 확인을 열 때 처음 보일 자리: 첫 네모가 가운데 오게 하는 스크롤 값(0 아래로는 내려가지 않음).
 * @param {{ x: number, y: number, w: number, h: number } | undefined} box 사진 픽셀 좌표
 * @param {number} scale 보이는 폭 ÷ 사진 폭 @param {{ width: number, height: number }} stage 사진 자리 크기(CSS px)
 */
export function copyZoomStart(box, scale, stage) {
  if (!box || !(scale > 0)) return { left: 0, top: 0 };
  return {
    left: Math.max(0, Math.round((box.x + box.w / 2) * scale - stage.width / 2)),
    top: Math.max(0, Math.round((box.y + box.h / 2) * scale - stage.height / 2)),
  };
}

// 서버 오류 코드 → 화면 문장(계약서 사본 전용. 나머지는 사진 칸 문장 → 손님 화면 문장 순)
export const COPY_ERROR_TEXTS = Object.freeze({
  FILE_LIMIT_REACHED: `이 거래에는 계약서 사본을 ${COPY_MAX_PER_DEAL}장까지 올릴 수 있습니다. 다른 화면에서 한 장을 지운 뒤 '다시 올리기'를 누르세요.`,
  MASK_CONFIRMATION_REQUIRED: "주민등록번호를 가렸다고 확인한 사본인데 서버가 그 확인을 받지 못해 올리지 않았습니다. 개발 담당에게 알려 주세요.",
  FILE_THUMB_NOT_ALLOWED: "계약서 사본은 작은 미리보기를 만들지 않습니다.",
  NOT_FOUND: "찾지 못했습니다. 거래나 사본을 다른 화면에서 지웠을 수 있습니다.",
  FILE_KIND_NOT_READY: "서버가 아직 계약서 사본을 받지 않습니다. 개발 담당에게 알려 주세요.",
});
/**
 * 올리지 못했을 때 첫 문장. 인터넷이 끊겨 서버 답이 없으면(code 없음) 연결 문장.
 * @param {string | null | undefined} code @param {(code: string) => string} fallback 손님 화면 오류 문장(customerErrorText)
 */
export function copyFailText(code, fallback) {
  return (code && COPY_ERROR_TEXTS[code]) || uploadFailText(code, fallback);
}
/** 보기·지우기에서 쓰는 오류 문장 @param {string | null | undefined} code @param {(code: string) => string} fallback */
export function copyErrorText(code, fallback) {
  return (code && COPY_ERROR_TEXTS[code]) || fallback(code ?? "");
}
/** 같은 사본을 다시 올려 볼 만한 오류인지(아니면 '다시 올리기'를 숨김). 10장 넘음은 다른 화면에서 지우면 되므로 남긴다 @param {string | null | undefined} code */
export const isCopyRetryable = (code) => !["MASK_CONFIRMATION_REQUIRED", "FILE_THUMB_NOT_ALLOWED"].includes(code ?? "") && isUploadRetryable(code ?? undefined);
