// 그림 위에 네모를 그려 그 자리를 가리는 부품(단계 3 M-a, 설계서 13.4절). 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// 화면과 떨어져 있어 다른 화면이 그대로 쓴다: 끌어서 네모 만들기·되돌리기·다시 하기·화면 좌표 ↔ 원본 좌표·JPEG로 내보내기는 여기서 맡고,
// 가리는 방식만 paint 선택값으로 바꿔 끼운다(기본은 모자이크 paintMosaic. 단계 4 계약서 사본의 주민등록번호 가림은 검은 칠 paintBlack).
// - 앱에 보관한 사진(받아 온 바이트)은 바꾸지 않는다. 화면 메모리의 canvas 사본에만 모자이크를 칠하고, 내보낼 때 JPEG로 다시 저장해 돌려준다.
//   다시 저장하므로 EXIF·GPS·기기 정보가 남지 않는다. 결과를 서버로 다시 올리는 함수는 없다(내려받기·공유는 화면이 맡음).
// - 칠하기는 사진 원래 크기에서 한다(화면에 보이는 그림은 그 결과를 줄여 그린 것). 상자마다 그 자리만 읽어 칠하므로 사진 전체를 한 번에 읽지 않는다.
// - 상자 그리기는 포인터(손가락·마우스) 끌기다. 끌 때는 점선 상자를, 놓으면 칠한 결과와 실선 상자를 보인다. 키보드로는 그릴 수 없으므로
//   화면은 '되돌리기'·'다시 하기'·'다 지우기' 단추를 따로 둔다(**추가 확인 필요**: 키보드만 쓰는 사람의 대안).
import {
  addMaskBox,
  boxFromPoints,
  clearMaskBoxes,
  emptyMaskHistory,
  minBoxInImage,
  pixelateRegion,
  redoMaskBox,
  toImagePoint,
  undoMaskBox,
} from "./work/mosaic.mjs";
import { PREVIEW_MAX_EDGE, fitSize } from "./work/photo-view.mjs";

export interface MaskBox { x: number; y: number; w: number; h: number }
export interface MaskState { boxes: readonly MaskBox[]; redo: readonly MaskBox[] }
export type MaskErrorCode = "DECODE_FAILED" | "NO_BOXES" | "ENCODE_FAILED" | "CANCELLED";
export class MaskError extends Error {
  code: MaskErrorCode;
  constructor(code: MaskErrorCode) {
    super(code);
    this.code = code;
  }
}

/** 네모 한 개를 원래 크기 작업 사본(ctx)에 칠하는 함수. box는 사진 픽셀 좌표의 정수 네모이고, 그 밖은 바꾸지 않아야 한다. */
export type MaskPainter = (ctx: CanvasRenderingContext2D, box: MaskBox) => void;
export interface MaskEditorOptions {
  /** 네모를 더하거나 되돌릴 때마다 새 상태로 부른다(단추 켜고 끄기·'n곳 가림' 글에 씀). */
  onChange?: (state: MaskState) => void;
  /** 가리는 방식. 없으면 모자이크(paintMosaic). */
  paint?: MaskPainter;
  /** 그린 네모에 노란 테두리를 둘지. 없으면 둔다. 검은 칠처럼 가린 자리가 그대로 보이는 방식은 false(끄는 중 점선은 늘 보임). */
  outline?: boolean;
  /** 사진을 읽는 동안 화면이 그만뒀는지(창을 닫았거나 다른 사진을 열었는지). true를 돌려주면 view를 건드리지 않고 MaskError("CANCELLED")로 끝낸다
      (view는 화면이 함께 쓰는 canvas라, 늦게 끝난 앞 사진이 크기를 바꾸고 그려 넣으면 안 된다). */
  cancelled?: () => boolean;
}

/** 모자이크(칸마다 평균색): 그 네모만 읽어 칠하므로 사진 전체를 한 번에 읽지 않는다. */
export const paintMosaic: MaskPainter = (ctx, box) => {
  const region = ctx.getImageData(box.x, box.y, box.w, box.h);
  pixelateRegion(region.data, box.w, box.h, { x: 0, y: 0, w: box.w, h: box.h });
  ctx.putImageData(region, box.x, box.y);
};

/** 검은 칠(단계 4 계약서 사본의 주민등록번호 가림): 네모 안을 불투명한 검정으로 덮어 원래 픽셀을 남기지 않는다. */
export const paintBlack: MaskPainter = (ctx, box) => {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = "#000";
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.restore();
};

export interface MaskExportOptions {
  /** JPEG 품질. 없으면 0.9. */
  quality?: number;
  /** 네모가 0개여도 내보낼지. 없으면 NO_BOXES(가리지 않은 사본을 실수로 내보내지 않게). 화면이 한 번 더 물은 뒤에만 true. */
  allowEmpty?: boolean;
}

export interface MaskEditor {
  readonly width: number;
  readonly height: number;
  /** 칠한 결과(원래 크기) canvas. 확대해서 확인하는 화면이 복사 없이 그대로 붙여 보인다(테두리 없음 = 내보낼 그림 그대로). 바꾸지 않는다. */
  readonly result: HTMLCanvasElement;
  state(): MaskState;
  undo(): void;
  redo(): void;
  clear(): void;
  /** 잠그면 끌던 네모를 버리고(pointercancel과 같음), 풀 때까지 끌기·되돌리기·다시 하기·다 지우기를 받지 않는다(칠한 곳이 바뀌지 않음).
      내보낸 사본을 올리는 동안 화면과 올라가는 사본이 달라지지 않게 쓴다. 내보내기(exportJpeg)는 잠근 채로도 된다. */
  setLocked(locked: boolean): void;
  /** 가린 사본을 JPEG(품질 0.9)로. 상자가 하나도 없으면 NO_BOXES(가리지 않은 사본을 내보내지 않음. allowEmpty를 준 때만 내보냄). */
  exportJpeg(options?: MaskExportOptions): Promise<Blob>;
  /** 포인터 처리기를 떼고 비트맵·canvas 메모리를 푼다. 화면을 닫을 때 꼭 부른다. */
  destroy(): void;
}

const EXPORT_QUALITY = 0.9;
const OUTLINE = "#ffcc00";
const OUTLINE_SHADOW = "rgba(0, 0, 0, 0.75)";

function context2d(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new MaskError("DECODE_FAILED");
  return ctx;
}

function strokeBox(ctx: CanvasRenderingContext2D, box: MaskBox, scale: number, dashed: boolean) {
  const rect = [box.x * scale + 1, box.y * scale + 1, Math.max(0, box.w * scale - 2), Math.max(0, box.h * scale - 2)] as const;
  ctx.save();
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.lineWidth = 4;
  ctx.strokeStyle = OUTLINE_SHADOW;
  ctx.strokeRect(...rect);
  ctx.lineWidth = 2;
  ctx.strokeStyle = OUTLINE;
  ctx.strokeRect(...rect);
  ctx.restore();
}

/**
 * view: 화면에 보이는 canvas(가로 100%로 늘려 보여도 됨). photo: 앱에 보관한 사진 바이트(받아 온 그대로, 바꾸지 않음) 또는
 * 그 사진을 이미 다 읽어 들인 같은 출처의 <img>('사진 크게 보기'의 원본 그림. 원본을 다시 받지 않아 감사 file.download가 한 번 더 남지 않음),
 * 또는 화면이 방금 찍은 사진을 줄여 그려 둔 canvas(계약서 사본. 올리기 전이라 서버에 없음).
 * options: onChange(상태가 바뀔 때)·paint(가리는 방식, 기본 모자이크)·outline(그린 네모 테두리, 기본 있음).
 */
export async function openMaskEditor(view: HTMLCanvasElement, photo: Blob | HTMLImageElement | HTMLCanvasElement, options: MaskEditorOptions = {}): Promise<MaskEditor> {
  const onChange = options.onChange ?? (() => {});
  const paint = options.paint ?? paintMosaic;
  const outline = options.outline ?? true;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
  } catch {
    throw new MaskError("DECODE_FAILED");
  }
  if (options.cancelled?.()) {
    bitmap.close();
    throw new MaskError("CANCELLED");
  }
  const width = bitmap.width;
  const height = bitmap.height;
  const image = { width, height };
  // 원래 크기 작업 사본(칠한 결과). 보관한 사진 바이트와는 따로다.
  const work = document.createElement("canvas");
  work.width = width;
  work.height = height;
  const workCtx = context2d(work);
  const shown = fitSize(width, height, PREVIEW_MAX_EDGE);
  if (!shown) {
    bitmap.close();
    throw new MaskError("DECODE_FAILED");
  }
  view.width = shown.width;
  view.height = shown.height;
  view.style.touchAction = "none";
  const viewCtx = context2d(view);
  const scale = shown.width / width;

  let history: MaskState = emptyMaskHistory();
  let draftStart: { x: number; y: number } | null = null;
  let draft: MaskBox | null = null;
  let pointerId: number | null = null;
  let locked = false;

  function paintWork() {
    workCtx.drawImage(bitmap, 0, 0);
    for (const box of history.boxes) paint(workCtx, box);
  }
  function paintView() {
    viewCtx.clearRect(0, 0, view.width, view.height);
    viewCtx.drawImage(work, 0, 0, view.width, view.height);
    if (outline) for (const box of history.boxes) strokeBox(viewCtx, box, scale, false);
    if (draft) strokeBox(viewCtx, draft, scale, true);
  }
  function commit(next: MaskState) {
    if (locked || next === history) return;
    history = next;
    paintWork();
    paintView();
    onChange(history);
  }
  const pointOf = (event: PointerEvent) => toImagePoint({ x: event.clientX, y: event.clientY }, view.getBoundingClientRect(), image);
  // 살짝 끌린 것을 거르는 최소 크기는 화면에 보이는 크기로 잰다(큰 사진은 화면 1px이 사진 여러 픽셀이라 사진 픽셀로 재면 걸러지지 않음).
  const boxOf = (start: { x: number; y: number }, event: PointerEvent) =>
    boxFromPoints(start, pointOf(event), image, minBoxInImage(width, view.getBoundingClientRect().width));

  function onDown(event: PointerEvent) {
    if (locked || pointerId !== null || (event.pointerType === "mouse" && event.button !== 0)) return;
    pointerId = event.pointerId;
    draftStart = pointOf(event);
    draft = null;
    view.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }
  function onMove(event: PointerEvent) {
    if (event.pointerId !== pointerId || !draftStart) return;
    draft = boxOf(draftStart, event);
    paintView();
  }
  function finish(event: PointerEvent, keep: boolean) {
    if (event.pointerId !== pointerId || !draftStart) return;
    const box = keep ? boxOf(draftStart, event) : null;
    pointerId = null;
    draftStart = null;
    draft = null;
    if (box) commit(addMaskBox(history, box));
    else paintView();
  }
  // 끌던 네모를 버린다(잠글 때). 잡아 둔 포인터를 놓아, 뒤에 오는 pointerup이 이 끌기로 이어지지 않는다.
  function dropDraft() {
    if (pointerId === null) return;
    if (view.hasPointerCapture?.(pointerId)) view.releasePointerCapture(pointerId);
    pointerId = null;
    draftStart = null;
    draft = null;
    paintView();
  }
  const onUp = (event: PointerEvent) => finish(event, true);
  const onCancel = (event: PointerEvent) => finish(event, false);
  view.addEventListener("pointerdown", onDown);
  view.addEventListener("pointermove", onMove);
  view.addEventListener("pointerup", onUp);
  view.addEventListener("pointercancel", onCancel);

  paintWork();
  paintView();

  return {
    width,
    height,
    result: work,
    state: () => history,
    undo: () => commit(undoMaskBox(history)),
    redo: () => commit(redoMaskBox(history)),
    clear: () => commit(clearMaskBoxes(history)),
    setLocked(next: boolean) {
      locked = next;
      if (locked) dropDraft();
    },
    async exportJpeg({ quality = EXPORT_QUALITY, allowEmpty = false }: MaskExportOptions = {}) {
      if (history.boxes.length === 0 && !allowEmpty) throw new MaskError("NO_BOXES");
      const blob = await new Promise<Blob | null>((resolve) => work.toBlob(resolve, "image/jpeg", quality));
      if (!blob || blob.type !== "image/jpeg") throw new MaskError("ENCODE_FAILED");
      return blob;
    },
    destroy() {
      view.removeEventListener("pointerdown", onDown);
      view.removeEventListener("pointermove", onMove);
      view.removeEventListener("pointerup", onUp);
      view.removeEventListener("pointercancel", onCancel);
      bitmap.close();
      work.width = 0;
      work.height = 0;
    },
  };
}
