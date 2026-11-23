// 사진 내보내기 얼굴 가림(단계 3 M-a, 설계서 13.4절, DEC-WT-09·DEC-WT-42)의 순수 함수. 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// - 앱에 보관한 사진은 바꾸지 않는다. 내보낼 때만 사용자가 상자를 그리고, 그 상자 안을 모자이크(칸마다 평균색)로 칠한 사본을 기기에만 둔다.
// - 블록(칸) 크기: max(16px, 상자 짧은 변 ÷ 5)을 올림한 값(사용자 결정 2026-11-23 09:51:36 "더 굵게: 5칸 (Recommended)", 8칸이면 눈 자리가 어두운 칸으로 남음). 상자 끝에서 칸이 작게 남지 않게 칸 수를 내림해 남는 폭을 칸마다 나눠
//   모든 칸이 블록 크기 이상이 되게 한다(끝에 1 ~ 2px짜리 칸이 남으면 원래 픽셀이 거의 그대로 남음). 상자가 블록보다 작으면 상자 전체가 한 칸이다.
// - 좌표는 모두 사진 픽셀 좌표(화면 좌표는 toImagePoint로 바꾼다). 상자는 정수 { x, y, w, h }이고 사진 밖은 잘라 낸다.
// - 되돌리기·다시 하기는 상자 목록의 상태만 바꾼다(그림은 매번 원본에서 다시 칠함).

export const MOSAIC_MIN_BLOCK = 16;
export const MOSAIC_BLOCK_DIVISOR = 5;
export const MOSAIC_MIN_BOX = 8; // 이보다 작은 상자(손가락이 살짝 끌린 것)는 넣지 않는다. 화면에 보이는 크기(CSS px)로 잰다(minBoxInImage)
export const MOSAIC_MAX_BOXES = 30;

/** 블록 크기: max(16, ⌈짧은 변 ÷ 5⌉) @param {{ w: number, h: number }} box */
export function mosaicBlockSize(box) {
  return Math.max(MOSAIC_MIN_BLOCK, Math.ceil(Math.min(box.w, box.h) / MOSAIC_BLOCK_DIVISOR));
}

/**
 * 화면 좌표(포인터 clientX·clientY) → 사진 픽셀 좌표. rect는 화면에 보이는 사진(canvas)의 getBoundingClientRect() 값.
 * @param {{ x: number, y: number }} point
 * @param {{ left: number, top: number, width: number, height: number }} rect
 * @param {{ width: number, height: number }} image
 */
export function toImagePoint(point, rect, image) {
  if (!(rect.width > 0) || !(rect.height > 0)) return { x: 0, y: 0 };
  const x = ((point.x - rect.left) / rect.width) * image.width;
  const y = ((point.y - rect.top) / rect.height) * image.height;
  return { x: Math.min(image.width, Math.max(0, x)), y: Math.min(image.height, Math.max(0, y)) };
}

/**
 * 상자의 최소 크기를 사진 픽셀로: 화면에서 MOSAIC_MIN_BOX(8px)에 해당하는 사진 픽셀 수.
 * 휴대폰 사진(폭 4032px)을 화면 336px로 보면 화면 1px이 사진 12px이라, 사진 픽셀로 8을 재면 1px 끌림도 상자가 되어
 * 눈에 안 보이는 상자로 '1곳 가림'이 된다(가리지 않은 사진이 가린 사진으로 나감). 그래서 화면 크기로 잰다.
 * 화면 폭이나 사진 폭이 0 이하이거나 유한수가 아니면 null(상자를 만들지 않음).
 * @param {number} imageWidth 사진 폭(픽셀)
 * @param {number} shownWidth 화면에 보이는 사진 폭(CSS px)
 * @returns {number | null}
 */
export function minBoxInImage(imageWidth, shownWidth) {
  if (!Number.isFinite(imageWidth) || !Number.isFinite(shownWidth) || !(imageWidth > 0) || !(shownWidth > 0)) return null;
  return MOSAIC_MIN_BOX * (imageWidth / shownWidth);
}

/**
 * 두 점(끌기 시작·끝)으로 상자를 만든다. 사진 밖은 잘라 내고, 바깥쪽으로 정수화한다(가릴 곳이 줄지 않게).
 * 가로·세로가 minSize(사진 픽셀)보다 작으면 null. 화면에서 그릴 때는 minBoxInImage() 값을 넘긴다(null·0 이하·유한수 아님이면 늘 null).
 * @param {{ x: number, y: number }} start
 * @param {{ x: number, y: number }} end
 * @param {{ width: number, height: number }} image
 * @param {number | null} [minSize] 안 주면 MOSAIC_MIN_BOX
 */
export function boxFromPoints(start, end, image, minSize = MOSAIC_MIN_BOX) {
  if (typeof minSize !== "number" || !Number.isFinite(minSize) || !(minSize > 0)) return null;
  const clampX = (value) => Math.min(image.width, Math.max(0, value));
  const clampY = (value) => Math.min(image.height, Math.max(0, value));
  const left = Math.floor(clampX(Math.min(start.x, end.x)));
  const top = Math.floor(clampY(Math.min(start.y, end.y)));
  const right = Math.ceil(clampX(Math.max(start.x, end.x)));
  const bottom = Math.ceil(clampY(Math.max(start.y, end.y)));
  const w = right - left;
  const h = bottom - top;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < minSize || h < minSize) return null;
  return { x: left, y: top, w, h };
}

/** 한 방향(가로 또는 세로)의 칸 경계: 칸 수 = max(1, ⌊길이 ÷ 블록⌋), 경계는 고르게 나눠 모든 칸 ≥ 블록(길이가 블록보다 작으면 칸 1개). */
export function cellEdges(start, length, block) {
  const count = Math.max(1, Math.floor(length / block));
  return Array.from({ length: count + 1 }, (_, index) => start + Math.round((index * length) / count));
}

/**
 * RGBA 바이트(ImageData.data와 같은 꼴)의 상자 안을 모자이크로 칠한다. 상자 밖은 바꾸지 않는다. data를 고쳐 돌려준다.
 * 칸마다 R·G·B·A 평균(반올림)을 칸 전체에 넣는다.
 * @param {Uint8ClampedArray} data
 * @param {number} width
 * @param {number} height
 * @param {{ x: number, y: number, w: number, h: number }} box
 */
export function pixelateRegion(data, width, height, box) {
  const x0 = Math.max(0, Math.min(width, box.x));
  const y0 = Math.max(0, Math.min(height, box.y));
  const w = Math.max(0, Math.min(width, box.x + box.w) - x0);
  const h = Math.max(0, Math.min(height, box.y + box.h) - y0);
  if (w === 0 || h === 0) return data;
  const block = mosaicBlockSize(box);
  const xs = cellEdges(x0, w, block);
  const ys = cellEdges(y0, h, block);
  for (let row = 0; row < ys.length - 1; row += 1) {
    for (let col = 0; col < xs.length - 1; col += 1) {
      const sum = [0, 0, 0, 0];
      let count = 0;
      for (let y = ys[row]; y < ys[row + 1]; y += 1) {
        for (let x = xs[col]; x < xs[col + 1]; x += 1) {
          const at = (y * width + x) * 4;
          sum[0] += data[at]; sum[1] += data[at + 1]; sum[2] += data[at + 2]; sum[3] += data[at + 3];
          count += 1;
        }
      }
      const average = sum.map((value) => Math.round(value / count));
      for (let y = ys[row]; y < ys[row + 1]; y += 1) {
        for (let x = xs[col]; x < xs[col + 1]; x += 1) {
          const at = (y * width + x) * 4;
          data[at] = average[0]; data[at + 1] = average[1]; data[at + 2] = average[2]; data[at + 3] = average[3];
        }
      }
    }
  }
  return data;
}

/** 상자 여러 개를 그린 순서대로 칠한다(겹친 곳은 앞 상자가 칠한 값을 다시 평균). @param {Array<{x:number,y:number,w:number,h:number}>} boxes */
export function applyMosaic(data, width, height, boxes) {
  for (const box of boxes) pixelateRegion(data, width, height, box);
  return data;
}

// ── 되돌리기·다시 하기(상자 목록 상태) ──

/** @typedef {{ boxes: ReadonlyArray<{x:number,y:number,w:number,h:number}>, redo: ReadonlyArray<{x:number,y:number,w:number,h:number}> }} MaskHistory */

/** @returns {MaskHistory} */
export function emptyMaskHistory() {
  return Object.freeze({ boxes: Object.freeze([]), redo: Object.freeze([]) });
}

/** 상자 더하기: 다시 하기 목록은 비운다. 한도(30개)를 넘으면 그대로 둔다. @param {MaskHistory} state */
export function addMaskBox(state, box) {
  if (!box || state.boxes.length >= MOSAIC_MAX_BOXES) return state;
  return Object.freeze({ boxes: Object.freeze([...state.boxes, Object.freeze({ ...box })]), redo: Object.freeze([]) });
}

/** 되돌리기: 마지막 상자를 다시 하기 목록으로. @param {MaskHistory} state */
export function undoMaskBox(state) {
  if (state.boxes.length === 0) return state;
  return Object.freeze({ boxes: Object.freeze(state.boxes.slice(0, -1)), redo: Object.freeze([...state.redo, state.boxes[state.boxes.length - 1]]) });
}

/** 다시 하기: 마지막으로 되돌린 상자를 다시 넣는다. @param {MaskHistory} state */
export function redoMaskBox(state) {
  if (state.redo.length === 0) return state;
  return Object.freeze({ boxes: Object.freeze([...state.boxes, state.redo[state.redo.length - 1]]), redo: Object.freeze(state.redo.slice(0, -1)) });
}

/** 다 지우기도 한 번에 되돌릴 수 있게 지운 상자를 다시 하기 목록에 거꾸로 넣는다. @param {MaskHistory} state */
export function clearMaskBoxes(state) {
  if (state.boxes.length === 0) return state;
  return Object.freeze({ boxes: Object.freeze([]), redo: Object.freeze([...state.redo, ...[...state.boxes].reverse()]) });
}

/** '가린 곳' 줄(상자 수). 한도에 닿으면 더 그릴 수 없다고 알린다. @param {number} count */
export function maskCountText(count) {
  if (!(count > 0)) return "아직 가린 곳이 없습니다";
  return count >= MOSAIC_MAX_BOXES ? `${count}곳 가림 (최대 ${MOSAIC_MAX_BOXES}곳, 더 그릴 수 없음)` : `${count}곳 가림`;
}

/** 내려받기 파일 이름: 손님 이름·동·호수 없이 날짜만. @param {string} dateText YYYY-MM-DD */
export function maskedFileName(dateText) {
  return `photo-masked-${String(dateText).replaceAll("-", "")}.jpg`;
}
