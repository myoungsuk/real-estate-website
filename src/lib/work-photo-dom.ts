// 손님 카드 '사진' 칸: 찍거나 고른 사진을 화면 안에서 다시 저장한다(설계서 13.1, 지시서 1절 6번). 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// - createImageBitmap(파일, { imageOrientation: "from-image" })로 휴대폰이 적어 둔 방향을 그림에 먼저 반영한 뒤 canvas에 그려 JPEG로 다시 저장한다.
//   다시 저장하면 EXIF·GPS·기기 정보가 빠진다. 원래 파일과 파일 이름은 서버로 보내지 않는다.
// - 원본: 긴 변 4096px, JPEG 품질 0.9 → 10MB를 넘으면 0.8 → 그래도 넘으면 올리지 않음(TOO_LARGE).
// - 미리보기(Q-2): 긴 변 480px. WebP를 먼저 만들어 보고, Safari처럼 WebP를 만들지 못하면(결과가 image/webp가 아님) JPEG로(대장 2026-11-22).
//   256KB 안에 들지 않으면 미리보기 없이 올린다(목록은 글자 자리표).
// - 확인 칸 그림은 canvas로 그린다(blob: 주소를 쓰지 않음, CSP img-src). 다 쓴 원본 비트맵은 바로 close()로 푼다.
import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_QUALITIES, PREVIEW_MAX_EDGE, THUMB_MAX_BYTES, THUMB_MAX_EDGE, THUMB_QUALITIES, fitSize } from "./work/photo-view.mjs";

export type PrepareErrorCode = "DECODE_FAILED" | "TOO_LARGE" | "ENCODE_FAILED";
export class PhotoPrepareError extends Error {
  code: PrepareErrorCode;
  constructor(code: PrepareErrorCode) {
    super(code);
    this.name = "PhotoPrepareError";
    this.code = code;
  }
}

export interface PreparedImage { blob: Blob; sha256: string }
export interface PreparedPhoto extends PreparedImage {
  width: number;
  height: number;
  thumb: PreparedImage | null;
  preview: HTMLCanvasElement;
}

// SHA-256(소문자 hex 64자). 서버 X-Work-File-Sha256 꼴.
export async function sha256Hex(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

function drawScaled(source: CanvasImageSource, width: number, height: number, max: number) {
  const size = fitSize(width, height, max);
  if (!size) throw new PhotoPrepareError("DECODE_FAILED");
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new PhotoPrepareError("ENCODE_FAILED");
  // 투명한 PNG가 JPEG에서 검게 되지 않게 흰 바탕을 먼저 칠한다.
  context.fillStyle = "#fff";
  context.fillRect(0, 0, size.width, size.height);
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

async function decode(file: Blob) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoPrepareError("DECODE_FAILED");
  }
}

async function encodeOriginal(canvas: HTMLCanvasElement) {
  for (const quality of PHOTO_QUALITIES) {
    const blob = await toBlob(canvas, "image/jpeg", quality);
    if (!blob || blob.type !== "image/jpeg") throw new PhotoPrepareError("ENCODE_FAILED");
    if (blob.size <= PHOTO_MAX_BYTES) return blob;
  }
  throw new PhotoPrepareError("TOO_LARGE");
}

async function encodeThumb(canvas: HTMLCanvasElement) {
  for (const quality of THUMB_QUALITIES) {
    let blob = await toBlob(canvas, "image/webp", quality);
    if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality);
    if (!blob || (blob.type !== "image/webp" && blob.type !== "image/jpeg")) return null;
    if (blob.size <= THUMB_MAX_BYTES) return blob;
  }
  return null;
}

// 계약서 사본(단계 4 K-b): 찍거나 고른 사진을 방향을 반영해 긴 변 4096px 안쪽 canvas로만 만든다(JPEG로 다시 저장하는 것은 주민등록번호를 가린 뒤).
// 돌려준 canvas는 다 쓰면 width·height를 0으로 해 메모리를 푼다. 원래 파일과 파일 이름은 서버로 보내지 않는다.
export async function decodeScaled(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await decode(file);
  try {
    return drawScaled(bitmap, bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
  } finally {
    bitmap.close();
  }
}

export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  const bitmap = await decode(file);
  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = drawScaled(bitmap, bitmap.width, bitmap.height, PHOTO_MAX_EDGE);
  } finally {
    bitmap.close();
  }
  try {
    const blob = await encodeOriginal(canvas);
    const preview = drawScaled(canvas, canvas.width, canvas.height, PREVIEW_MAX_EDGE);
    const thumbBlob = await encodeThumb(drawScaled(canvas, canvas.width, canvas.height, THUMB_MAX_EDGE));
    const [sha256, thumbSha] = await Promise.all([sha256Hex(blob), thumbBlob ? sha256Hex(thumbBlob) : Promise.resolve("")]);
    return { blob, sha256, width: canvas.width, height: canvas.height, thumb: thumbBlob ? { blob: thumbBlob, sha256: thumbSha } : null, preview };
  } finally {
    // 큰 canvas 메모리를 바로 돌려준다(휴대폰에서 여러 장을 연달아 처리할 때).
    canvas.width = 0;
    canvas.height = 0;
  }
}

// 확인 칸에 그림을 보인다(같은 그림을 여러 곳에 그릴 수 있게 새 canvas에 복사).
export function previewCanvas(prepared: PreparedPhoto, label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = prepared.preview.width;
  canvas.height = prepared.preview.height;
  canvas.getContext("2d")?.drawImage(prepared.preview, 0, 0);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", label);
  return canvas;
}
