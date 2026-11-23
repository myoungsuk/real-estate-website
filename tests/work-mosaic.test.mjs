// 사진 내보내기 얼굴 가림(단계 3 M-a) 순수 함수 시험(테스트 체크리스트 T3-16·T3-17, 설계서 13.4절). 가상 픽셀만 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MOSAIC_BLOCK_DIVISOR,
  MOSAIC_MAX_BOXES,
  addMaskBox,
  applyMosaic,
  boxFromPoints,
  minBoxInImage,
  cellEdges,
  clearMaskBoxes,
  emptyMaskHistory,
  maskCountText,
  maskedFileName,
  mosaicBlockSize,
  pixelateRegion,
  redoMaskBox,
  toImagePoint,
  undoMaskBox,
} from "../src/lib/work/mosaic.mjs";

// 자리마다 다른 값(무늬)인 가상 사진
function pattern(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      data[at] = (x * 7 + y * 3) % 256;
      data[at + 1] = (x * 13) % 256;
      data[at + 2] = (y * 11) % 256;
      data[at + 3] = 255;
    }
  }
  return data;
}
const pixel = (data, width, x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));

test("T3-17 블록 크기는 max(16px, 상자 짧은 변 ÷ 5 올림)이라 늘 상자 크기의 1/5 이상이다", () => {
  assert.equal(MOSAIC_BLOCK_DIVISOR, 5);
  assert.equal(mosaicBlockSize({ w: 40, h: 40 }), 16);
  assert.equal(mosaicBlockSize({ w: 80, h: 400 }), 16);
  assert.equal(mosaicBlockSize({ w: 81, h: 400 }), 17);
  assert.equal(mosaicBlockSize({ w: 800, h: 600 }), 120);
  for (const [w, h] of [[8, 8], [20, 300], [131, 131], [999, 1001], [4096, 3000]]) {
    const block = mosaicBlockSize({ w, h });
    assert.ok(block >= 16 && block >= Math.min(w, h) / 5, `${w}×${h} → ${block}`);
  }
});

test("T3-17 칸 경계는 상자 끝에 작은 칸을 남기지 않는다(모든 칸 ≥ 블록, 상자가 블록보다 작으면 칸 1개)", () => {
  for (const [start, length, block] of [[0, 100, 16], [5, 47, 16], [3, 15, 16], [0, 16, 16], [10, 799, 75], [0, 33, 16]]) {
    const edges = cellEdges(start, length, block);
    assert.equal(edges[0], start);
    assert.equal(edges.at(-1), start + length);
    const sizes = edges.slice(1).map((edge, index) => edge - edges[index]);
    if (length < block) assert.deepEqual(sizes, [length]);
    else for (const size of sizes) assert.ok(size >= block, `${start}+${length} 블록 ${block}: 칸 ${sizes}`);
  }
});

test("모자이크는 상자 안 칸마다 평균색 하나로 칠하고 상자 밖은 1픽셀도 바꾸지 않으며, 칸 안에 원래 무늬가 남지 않는다", () => {
  const width = 120;
  const height = 90;
  const original = pattern(width, height);
  const data = original.slice();
  const box = { x: 10, y: 7, w: 70, h: 50 };
  pixelateRegion(data, width, height, box);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= box.x && x < box.x + box.w && y >= box.y && y < box.y + box.h;
      if (!inside) assert.deepEqual(pixel(data, width, x, y), pixel(original, width, x, y), `밖 (${x},${y})`);
    }
  }
  const block = mosaicBlockSize(box);
  const xs = cellEdges(box.x, box.w, block);
  const ys = cellEdges(box.y, box.h, block);
  assert.deepEqual([xs.length - 1, ys.length - 1], [4, 3]);
  for (let row = 0; row < ys.length - 1; row += 1) {
    for (let col = 0; col < xs.length - 1; col += 1) {
      const sum = [0, 0, 0, 0];
      let count = 0;
      const colors = new Set();
      for (let y = ys[row]; y < ys[row + 1]; y += 1) {
        for (let x = xs[col]; x < xs[col + 1]; x += 1) {
          pixel(original, width, x, y).forEach((value, index) => { sum[index] += value; });
          count += 1;
          colors.add(pixel(data, width, x, y).join(","));
        }
      }
      assert.equal(colors.size, 1, "칸 하나는 한 색");
      assert.deepEqual([...colors][0].split(",").map(Number), sum.map((value) => Math.round(value / count)), "칸 평균");
    }
  }
});

test("사진 밖으로 걸친 상자·여러 상자·작은 상자", () => {
  const width = 40;
  const height = 30;
  const original = pattern(width, height);
  const edge = pixelateRegion(original.slice(), width, height, { x: 30, y: 20, w: 50, h: 50 });
  assert.deepEqual(pixel(edge, width, 29, 19), pixel(original, width, 29, 19));
  assert.deepEqual(pixel(edge, width, 39, 29), pixel(edge, width, 30, 20), "사진 안쪽 10×10이 한 칸");
  const tiny = pixelateRegion(original.slice(), width, height, { x: 0, y: 0, w: 8, h: 8 });
  assert.deepEqual(pixel(tiny, width, 0, 0), pixel(tiny, width, 7, 7), "블록보다 작은 상자는 통째로 한 색");
  const both = applyMosaic(original.slice(), width, height, [{ x: 0, y: 0, w: 16, h: 16 }, { x: 20, y: 10, w: 16, h: 16 }]);
  assert.deepEqual(pixel(both, width, 0, 0), pixel(both, width, 15, 15));
  assert.deepEqual(pixel(both, width, 20, 10), pixel(both, width, 35, 25));
  assert.deepEqual(pixel(both, width, 18, 5), pixel(original, width, 18, 5), "두 상자 사이는 그대로");
  assert.equal(applyMosaic(original.slice(), width, height, []).every((value, index) => value === original[index]), true, "상자 없으면 그대로");
});

test("T3-16 화면 좌표를 사진 좌표로 바꾸고, 끌기 두 점으로 상자를 만든다(거꾸로 끌어도 같고, 사진 밖은 잘리며, 8px 미만은 버림)", () => {
  const rect = { left: 100, top: 50, width: 400, height: 300 };
  const image = { width: 4000, height: 3000 };
  assert.deepEqual(toImagePoint({ x: 300, y: 200 }, rect, image), { x: 2000, y: 1500 });
  assert.deepEqual(toImagePoint({ x: 0, y: 9999 }, rect, image), { x: 0, y: 3000 });
  assert.deepEqual(toImagePoint({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 }, image), { x: 0, y: 0 });
  const box = boxFromPoints({ x: 10.6, y: 20.2 }, { x: 110.1, y: 70.9 }, image);
  assert.deepEqual(box, { x: 10, y: 20, w: 101, h: 51 }, "바깥쪽으로 정수화(가릴 곳이 줄지 않음)");
  assert.deepEqual(boxFromPoints({ x: 110.1, y: 70.9 }, { x: 10.6, y: 20.2 }, image), box);
  assert.deepEqual(boxFromPoints({ x: -50, y: -50 }, { x: 30, y: 30 }, image), { x: 0, y: 0, w: 30, h: 30 });
  assert.deepEqual(boxFromPoints({ x: 3990, y: 2990 }, { x: 5000, y: 5000 }, image), { x: 3990, y: 2990, w: 10, h: 10 });
  assert.equal(boxFromPoints({ x: 10, y: 10 }, { x: 17, y: 60 }, image), null);
  assert.equal(boxFromPoints({ x: 10, y: 10 }, { x: Number.NaN, y: 60 }, image), null);
});

test("T3-16 살짝 끌린 것을 거르는 최소 크기는 화면에 보이는 크기(8px)로 잰다: 휴대폰 사진(폭 4032)을 화면 336px로 볼 때 1 ~ 3px 끌림은 상자가 아니다", () => {
  const image = { width: 4032, height: 3024 };
  const rect = { left: 12, top: 100, width: 336, height: 252 };
  const min = minBoxInImage(image.width, rect.width);
  assert.equal(min, 96, "화면 8px = 사진 96px");
  const drag = (pixels) => boxFromPoints(
    toImagePoint({ x: 112, y: 200 }, rect, image),
    toImagePoint({ x: 112 + pixels, y: 200 + pixels }, rect, image),
    image,
    min,
  );
  for (const pixels of [1, 2, 3, 7]) assert.equal(drag(pixels), null, `화면 ${pixels}px 끌림`);
  assert.deepEqual(drag(8), { x: 1200, y: 1200, w: 96, h: 96 });
  assert.deepEqual(drag(40), { x: 1200, y: 1200, w: 480, h: 480 });
  // 한쪽만 길게 끌어도 다른 쪽이 화면 8px에 못 미치면 버린다.
  assert.equal(boxFromPoints({ x: 1200, y: 1200 }, { x: 2400, y: 1236 }, image, min), null);
  // 사진이 화면보다 작으면(늘려 보임) 최소 크기도 그만큼 작아진다.
  assert.equal(minBoxInImage(200, 400), 4);
  assert.deepEqual(boxFromPoints({ x: 10, y: 10 }, { x: 15, y: 15 }, { width: 200, height: 150 }, minBoxInImage(200, 400)), { x: 10, y: 10, w: 5, h: 5 });
  // 화면 폭을 알 수 없으면 상자를 만들지 않는다.
  for (const shown of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(minBoxInImage(4032, shown), null, `화면 폭 ${shown}`);
    assert.equal(boxFromPoints({ x: 0, y: 0 }, { x: 2000, y: 2000 }, image, minBoxInImage(4032, shown)), null);
  }
  assert.equal(minBoxInImage(0, 336), null);
  for (const bad of [null, 0, -8, Number.NaN]) assert.equal(boxFromPoints({ x: 0, y: 0 }, { x: 2000, y: 2000 }, image, bad), null, `최소값 ${bad}`);
  // 최소값을 주지 않으면 예전처럼 사진 픽셀 8로 잰다(다른 쓰임이 흔들리지 않게).
  assert.deepEqual(boxFromPoints({ x: 0, y: 0 }, { x: 8, y: 8 }, image), { x: 0, y: 0, w: 8, h: 8 });
});

test("T3-16 되돌리기·다시 하기·다 지우기: 새 상자를 그리면 다시 하기 목록이 비고, 다 지우기도 하나씩 되살릴 수 있으며, 상태는 바뀌지 않는 값이다", () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  const b = { x: 20, y: 0, w: 10, h: 10 };
  const c = { x: 40, y: 0, w: 10, h: 10 };
  let state = emptyMaskHistory();
  assert.equal(undoMaskBox(state), state, "빈 상태 되돌리기는 그대로");
  assert.equal(redoMaskBox(state), state);
  state = addMaskBox(addMaskBox(state, a), b);
  assert.deepEqual(state.boxes, [a, b]);
  const before = state;
  state = undoMaskBox(state);
  assert.deepEqual([state.boxes, state.redo], [[a], [b]]);
  assert.deepEqual(before.boxes, [a, b], "예전 상태는 그대로");
  state = redoMaskBox(state);
  assert.deepEqual([state.boxes, state.redo], [[a, b], []]);
  state = addMaskBox(undoMaskBox(state), c);
  assert.deepEqual([state.boxes, state.redo], [[a, c], []], "새로 그리면 다시 하기 없음");
  state = clearMaskBoxes(state);
  assert.deepEqual(state.boxes, []);
  state = redoMaskBox(state);
  assert.deepEqual(state.boxes, [a]);
  state = redoMaskBox(state);
  assert.deepEqual(state.boxes, [a, c]);
  assert.equal(addMaskBox(state, null), state);
  assert.throws(() => { state.boxes.push(b); }, TypeError);
  let full = emptyMaskHistory();
  for (let index = 0; index < MOSAIC_MAX_BOXES + 5; index += 1) full = addMaskBox(full, a);
  assert.equal(full.boxes.length, MOSAIC_MAX_BOXES);
});

test("내려받기 파일 이름은 날짜만(손님 이름·동·호수 없음)", () => {
  assert.equal(maskedFileName("2026-11-22"), "photo-masked-20261122.jpg");
});

test("가린 곳 줄: 0곳·n곳·한도(30곳)", () => {
  assert.equal(maskCountText(0), "아직 가린 곳이 없습니다");
  assert.equal(maskCountText(2), "2곳 가림");
  assert.equal(maskCountText(MOSAIC_MAX_BOXES), `${MOSAIC_MAX_BOXES}곳 가림 (최대 ${MOSAIC_MAX_BOXES}곳, 더 그릴 수 없음)`);
});
