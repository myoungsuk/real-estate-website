// QR 그림을 canvas에 그린다('계약 일정' 화면 구독 칸의 '다른 휴대폰에 넘기기', 단계 3).
// 그림은 canvas 픽셀에만 둔다: img 주소(data:·blob:)·화면 주소·브라우저 저장소·서버 요청에 글(구독 주소)을 넣지 않는다.
// 칸 계산은 순수 함수 work/qr.mjs가 하고, 여기서는 둘레에 밝은 칸 4줄(조용한 띠)을 두고 검정·흰색으로만 칠한다(화면 색과 상관없이 읽히게).
// 한 칸은 화면 픽셀(CSS px) 정수 배로만 그린다. CSS로 늘이거나 줄이면 칸 폭이 들쭉날쭉해져 카메라가 읽기 어려워진다.
import { encodeQr } from "./work/qr.mjs";

export const QR_QUIET_MODULES = 4;
export const QR_MODULE_PIXELS_MAX = 6;
export const QR_MODULE_PIXELS_MIN = 3;

/** 쓸 수 있는 폭(CSS px)에 들어가는 한 칸 크기. 3 ~ 6px. */
export function qrModulePixels(modules: number, availableWidth: number): number {
  const fit = Math.floor(availableWidth / (modules + QR_QUIET_MODULES * 2));
  return Math.min(QR_MODULE_PIXELS_MAX, Math.max(QR_MODULE_PIXELS_MIN, Number.isFinite(fit) ? fit : QR_MODULE_PIXELS_MIN));
}

/** 글을 QR로 그린다. 글이 너무 길면 RangeError(encodeQr)를 던지고 canvas는 비운다. availableWidth는 그림을 둘 자리의 폭(CSS px). */
export function drawQr(canvas: HTMLCanvasElement, text: string, availableWidth: number): { version: number; modules: number; modulePixels: number } {
  clearQr(canvas);
  const symbol = encodeQr(text);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("QR을 그릴 수 없습니다.");
  const pixels = qrModulePixels(symbol.size, availableWidth);
  const side = (symbol.size + QR_QUIET_MODULES * 2) * pixels;
  canvas.width = side;
  canvas.height = side;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, side, side);
  context.fillStyle = "#000";
  symbol.modules.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) context.fillRect((x + QR_QUIET_MODULES) * pixels, (y + QR_QUIET_MODULES) * pixels, pixels, pixels);
    });
  });
  return { version: symbol.version, modules: symbol.size, modulePixels: pixels };
}

/** 그림을 지운다(크기를 0으로 줄여 픽셀 자체를 버림). */
export function clearQr(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}
