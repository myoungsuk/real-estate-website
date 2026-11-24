// 종이 만들기 공용 그리기 부품(보드 20번, 2026-11-24 사용자 결정 "거래완료, 매물 가격표, 소장 소개·명함"·"승인된 사진 + 그림").
// 어느 모양을 고르든 쓰는 것만 둔다: 명시사항 표, 사무소 아래 칸, 계약서 그림, 도장, 핀·테이프, 줄노트·모눈·코르크 무늬.
// 글 쓰기·줄 나누기는 work-card-draw.ts의 text()를 그대로 쓴다. 계산은 work/paper-parts.mjs 순수 함수에 있다.
// 서버 요청·브라우저 저장 없음. 계약서 그림에는 글자를 넣지 않는다(제목만).
import { CARD_COLORS as C, font, text, type Pen } from "./work-card-draw";
import { DISCLOSURE_MIN_PX, DISCLOSURE_START_PX, OFFICE_FOOT_PX, STAMP_TEXT, contractBars, corkSpecks, fitSteps, splitCommonRows, tableColumns } from "./work/paper-parts.mjs";

export const PAPER_COLORS = Object.freeze({
  stamp: "#D2382E",
  lined: "#FDFDF8", linedRule: "#B9CFE6", linedMargin: "#E98B8B",
  grid: "#FBFCFA", gridMinor: "#CFE3D6", gridMajor: "#A9CDB7",
  cork: "#B4834F", corkDark: "#8A5D30", corkLight: "#D4A46C", corkMid: "#9C6B3C",
  tape: "rgba(240, 230, 170, 0.78)",
  docEdge: "#CFD3D8", docBar: "#E3E6EA", docCell: "#EEF0F3",
});
export type Box = { x: number; y: number; w: number; h: number };
export type TableRow = { key?: string; label: string; value?: string; values?: string[] };
export type TableResult = { bottom: number; px: number; fits: boolean };

// (cx, cy)를 가운데로 deg도 돌려 그린다. 재기만 할 때(pen.draw false)도 fn은 부른다.
export function rotated(pen: Pen, cx: number, cy: number, deg: number, fn: () => void) {
  if (!pen.draw || !deg) { fn(); return; }
  const { ctx } = pen;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  fn();
  ctx.restore();
}

function shadow(pen: Pen, blur: number, dx: number, dy: number, color = "rgba(0, 0, 0, 0.28)") {
  pen.ctx.shadowColor = color;
  pen.ctx.shadowBlur = blur;
  pen.ctx.shadowOffsetX = dx;
  pen.ctx.shadowOffsetY = dy;
}
function noShadow(pen: Pen) { shadow(pen, 0, 0, 0, "transparent"); }

// ── 무늬 ──
export function fillLined(pen: Pen, box: Box, { gap = 56, margin = 118, paper = PAPER_COLORS.lined, rule = PAPER_COLORS.linedRule, marginColor = PAPER_COLORS.linedMargin } = {}) {
  if (!pen.draw) return;
  const { ctx } = pen;
  ctx.fillStyle = paper;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = rule;
  for (let y = box.y + gap; y < box.y + box.h; y += gap) ctx.fillRect(box.x, y - 1, box.w, 2);
  if (margin > 0) { ctx.fillStyle = marginColor; ctx.fillRect(box.x + margin, box.y, 3, box.h); }
}

export function fillGrid(pen: Pen, box: Box, { cell = 36, major = 5, paper = PAPER_COLORS.grid, minor = PAPER_COLORS.gridMinor, majorColor = PAPER_COLORS.gridMajor } = {}) {
  if (!pen.draw) return;
  const { ctx } = pen;
  ctx.fillStyle = paper;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  for (let i = 0, x = box.x; x <= box.x + box.w; i += 1, x += cell) {
    const strong = major > 0 && i % major === 0;
    ctx.fillStyle = strong ? majorColor : minor;
    ctx.fillRect(Math.round(x), box.y, strong ? 2 : 1, box.h);
  }
  for (let i = 0, y = box.y; y <= box.y + box.h; i += 1, y += cell) {
    const strong = major > 0 && i % major === 0;
    ctx.fillStyle = strong ? majorColor : minor;
    ctx.fillRect(box.x, Math.round(y), box.w, strong ? 2 : 1);
  }
}

export function fillCork(pen: Pen, box: Box, { seed = 1, density = 18 } = {}) {
  if (!pen.draw) return;
  const { ctx } = pen;
  ctx.fillStyle = PAPER_COLORS.cork;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  const colors = [PAPER_COLORS.corkDark, PAPER_COLORS.corkLight, PAPER_COLORS.corkMid];
  for (const speck of corkSpecks(box.w, box.h, seed, density)) {
    ctx.fillStyle = colors[speck.shade];
    ctx.beginPath();
    ctx.arc(box.x + speck.x, box.y + speck.y, speck.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── 핀·테이프 ──
export function drawPin(pen: Pen, { x, y, color = "#D2382E", r = 17 }: { x: number; y: number; color?: string; r?: number }) {
  if (!pen.draw) return;
  const { ctx } = pen;
  ctx.save();
  shadow(pen, 6, 2, 4, "rgba(0, 0, 0, 0.35)");
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, "rgba(255, 255, 255, 0.75)");
  g.addColorStop(0.45, color);
  g.addColorStop(1, "rgba(0, 0, 0, 0.45)");
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  noShadow(pen);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

export function drawTape(pen: Pen, { cx, cy, w = 150, h = 44, deg = -8, color = PAPER_COLORS.tape }: { cx: number; cy: number; w?: number; h?: number; deg?: number; color?: string }) {
  rotated(pen, cx, cy, deg, () => {
    if (!pen.draw) return;
    pen.ctx.fillStyle = color;
    pen.ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  });
}

// ── 도장 ──
// 두 겹 원 + 가운데 글(기본 "계약 / 완료"). 글자 크기는 원 안쪽 폭에 맞춘다.
export function drawStamp(pen: Pen, { cx, cy, r = 75, lines = STAMP_TEXT as readonly string[], color = PAPER_COLORS.stamp, deg = -14, alpha = 0.9, fill = "rgba(255, 255, 255, 0.15)" }: { cx: number; cy: number; r?: number; lines?: readonly string[]; color?: string; deg?: number; alpha?: number; fill?: string }) {
  if (!pen.draw) return;
  const { ctx } = pen;
  rotated(pen, cx, cy, deg, () => {
    ctx.save();
    ctx.globalAlpha = alpha;
    const outer = Math.max(3, r * 0.09);
    ctx.beginPath();
    ctx.arc(cx, cy, r - outer / 2, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = color;
    ctx.lineWidth = outer;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r - outer * 2, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1.5, outer * 0.3);
    ctx.stroke();
    const inner = (r - outer * 2.6) * 2;
    let px = Math.round(r * 0.46);
    const longest = lines.reduce((a, b) => (b.length > a.length ? b : a), "");
    ctx.font = font(px, 900);
    while (px > 8 && ctx.measureText(longest).width > inner * 0.86) { px -= 1; ctx.font = font(px, 900); }
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const lh = px * 1.1;
    lines.forEach((line, index) => ctx.fillText(line, cx, cy + (index - (lines.length - 1) / 2) * lh));
    ctx.restore();
  });
}

// ── 계약서 그림 ──
// 흰 종이 + 제목 + 회색 줄·칸(글자 없음) + 아래 오른쪽 도장. 돌린 그림의 높이를 돌려준다(돌리기 전 높이).
export function drawContractDoc(pen: Pen, { x, y, w = 420, deg = 0, title = "부동산 매매계약서", stamp = true, seed = 7, stampAt = "br", stampLines = STAMP_TEXT as readonly string[] }: { x: number; y: number; w?: number; deg?: number; title?: string; stamp?: boolean; seed?: number; stampAt?: "br" | "bl" | "tr"; stampLines?: readonly string[] }) {
  const s = w / 420;
  const pad = 34 * s;
  const barH = 12 * s;
  const bars = contractBars(seed, 7);
  const h = Math.round(470 * s);
  rotated(pen, x + w / 2, y + h / 2, deg, () => {
    if (!pen.draw) return;
    const { ctx } = pen;
    ctx.save();
    shadow(pen, 24 * s, 0, 10 * s, "rgba(0, 0, 0, 0.16)");
    ctx.fillStyle = C.paper;
    ctx.fillRect(x, y, w, h);
    noShadow(pen);
    ctx.strokeStyle = PAPER_COLORS.docEdge;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    ctx.restore();
    const px = Math.round(28 * s);
    ctx.font = font(px, 700);
    ctx.fillStyle = "#333333";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    // 글자 사이를 띄워 서류 제목처럼(letter-spacing 없이 글자마다 그림)
    const chars = [...title];
    const gapX = px * 0.3;
    const total = chars.reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + gapX * (chars.length - 1);
    let cx = x + w / 2 - total / 2;
    for (const ch of chars) { const cw = ctx.measureText(ch).width; ctx.fillText(ch, cx + cw / 2, y + pad + px / 2); cx += cw + gapX; }
    let at = y + pad + px + 22 * s;
    const bar = (ratio: number) => { ctx.fillStyle = PAPER_COLORS.docBar; ctx.fillRect(x + pad, at, (w - pad * 2) * ratio, barH); at += barH + 13 * s; };
    bar(1); bar(bars[0]);
    at += 5 * s;
    const cellH = 26 * s;
    const colA = (w - pad * 2 - 8 * s) / 3;
    for (let r = 0; r < 3; r += 1) {
      ctx.fillStyle = PAPER_COLORS.docCell;
      ctx.fillRect(x + pad, at, colA, cellH);
      ctx.fillRect(x + pad + colA + 8 * s, at, colA * 2, cellH);
      at += cellH + 8 * s;
    }
    at += 10 * s;
    bar(1); bar(bars[1]); bar(bars[2]);
    at += 9 * s;
    ctx.fillStyle = PAPER_COLORS.docBar;
    ctx.fillRect(x + pad, at, (w - pad * 2) * 0.4, barH);
    ctx.fillRect(x + w - pad - (w - pad * 2) * 0.4, at, (w - pad * 2) * 0.4, barH);
    if (stamp) {
      const r = 75 * s;
      // br: 아래 오른쪽 모서리에 걸침, bl: 아래 왼쪽, tr: 위 오른쪽 모서리 밖(제목을 가리지 않게)
      const cx = stampAt === "bl" ? x + 10 * s + r : stampAt === "tr" ? x + w + 10 * s : x + w - r + 30 * s;
      const cy = stampAt === "tr" ? y - 40 * s : y + h - r + 30 * s;
      drawStamp(pen, { cx, cy, r, lines: stampLines });
    }
  });
  return h;
}

// ── 명시사항 표 ──
// rows: 매물 1건 줄({ label, value }) 또는 여러 건 줄({ label, values[] }, buildCompareSheet와 같은 모양). columns: 여러 건일 때 머리 칸 이름.
// maxBottom 안에 들어갈 때까지 글씨를 25px부터 20px까지 줄여 본다. 20px에도 넘치면 fits false(그리긴 함, 쓰는 쪽이 둘째 장으로 넘기거나 막음).
export function drawDisclosureTable(pen: Pen, { x, y, w, rows, columns = [], maxBottom = Infinity, title = "매물 표시·광고 명시사항", colors = {} }: { x: number; y: number; w: number; rows: TableRow[]; columns?: string[]; maxBottom?: number; title?: string; colors?: { ink?: string; soft?: string; rule?: string; head?: string; accent?: string } }): TableResult {
  const ink = colors.ink ?? C.ink;
  const soft = colors.soft ?? C.soft;
  const rule = colors.rule ?? C.edge;
  const head = colors.head ?? C.paper2;
  const accent = colors.accent ?? C.navy;
  const split = splitCommonRows(rows as never);
  const count = Math.max(1, columns.length, ...split.rows.map((row: { values: string[] }) => row.values.length));
  const { labelW, colW } = tableColumns(w, count);
  const body = (draw: boolean, px: number) => {
    const p: Pen = { ...pen, draw: draw && pen.draw };
    const cellPad = Math.round(px * 0.4);
    let at = y;
    if (title) at = text(p, title, x, at, { px: px + 1, weight: 800, color: accent, maxW: w, lh: 1.3 }) + 4;
    if (p.draw) { p.ctx.fillStyle = accent; p.ctx.fillRect(x, at, w, 3); }
    at += 3;
    if (columns.length > 1) {
      const top = at;
      let bottom = top;
      columns.forEach((name) => { bottom = Math.max(bottom, text({ ...p, draw: false }, name, 0, top + cellPad, { px, weight: 800, maxW: colW - cellPad * 2, lh: 1.25 })); });
      bottom += cellPad;
      if (p.draw) { p.ctx.fillStyle = head; p.ctx.fillRect(x, top, w, bottom - top); }
      columns.forEach((name, index) => text(p, name, x + labelW + index * colW + cellPad, top + cellPad, { px, weight: 800, color: ink, maxW: colW - cellPad * 2, lh: 1.25 }));
      at = bottom;
      if (p.draw) { p.ctx.fillStyle = rule; p.ctx.fillRect(x, at, w, 1); }
      at += 1;
    }
    const line = (label: string, values: string[], wide: boolean) => {
      const top = at + cellPad;
      let bottom = text(p, label, x, top, { px, weight: 700, color: soft, maxW: labelW - cellPad, lh: 1.3 });
      if (wide) bottom = Math.max(bottom, text(p, values[0], x + labelW + cellPad, top, { px, weight: 500, color: ink, maxW: w - labelW - cellPad * 2, lh: 1.3 }));
      else values.forEach((value, index) => { bottom = Math.max(bottom, text(p, value, x + labelW + index * colW + cellPad, top, { px, weight: 500, color: ink, maxW: colW - cellPad * 2, lh: 1.3 })); });
      at = bottom + cellPad;
      if (p.draw) { p.ctx.fillStyle = rule; p.ctx.fillRect(x, at, w, 1); }
      at += 1;
    };
    for (const row of split.rows) line(row.label, row.values, row.values.length === 1 && count === 1);
    for (const row of split.common) line(row.label, [row.value], true);
    return at;
  };
  let px = DISCLOSURE_MIN_PX;
  let bottom = 0;
  for (const step of fitSteps(DISCLOSURE_START_PX, DISCLOSURE_MIN_PX)) {
    px = step;
    bottom = body(false, step);
    if (bottom <= maxBottom) break;
  }
  pen.minPx = Math.min(pen.minPx, px);
  bottom = body(true, px);
  return { bottom, px, fits: bottom <= maxBottom };
}

// ── 사무소 아래 칸 ──
// officeLines(office) 3줄. 첫 줄만 굵게. 아래에서 위로 놓고 싶으면 measure로 높이를 먼저 잰다.
export function drawOfficeFooter(pen: Pen, lines: string[], { x, y, w, px = OFFICE_FOOT_PX, color = C.ink, soft = C.soft }: { x: number; y: number; w: number; px?: number; color?: string; soft?: string }) {
  let at = y;
  lines.forEach((line, index) => { at = text(pen, line, x, at, { px, weight: index === 0 ? 700 : 400, color: index === 0 ? color : soft, maxW: w, lh: 1.35 }); });
  return at;
}
export function measureOfficeFooter(pen: Pen, lines: string[], w: number, px = OFFICE_FOOT_PX) {
  return drawOfficeFooter({ ...pen, draw: false }, lines, { x: 0, y: 0, w, px });
}

// ── 사진·글 맞추기 ──
// 같은 출처 사진만 읽는다(canvas가 오염되지 않아 toDataURL을 쓸 수 있음). 한 번 읽은 사진은 다시 쓴다.
const imageCache = new Map<string, Promise<HTMLImageElement>>();
export function loadImage(src: string) {
  let found = imageCache.get(src);
  if (!found) {
    found = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => { imageCache.delete(src); reject(new Error("image")); };
      image.src = src;
    });
    imageCache.set(src, found);
  }
  return found;
}

// 사진을 칸에 꽉 차게(넘치는 쪽은 잘라 냄). fx·fy는 자를 때 남길 자리(0 왼쪽·위 ~ 1 오른쪽·아래).
export function drawCover(pen: Pen, image: CanvasImageSource & { width: number; height: number }, box: Box, { fx = 0.5, fy = 0.5, grayscale = false } = {}) {
  if (!pen.draw) return;
  const { ctx } = pen;
  const iw = image.width;
  const ih = image.height;
  const scale = Math.max(box.w / iw, box.h / ih);
  const sw = box.w / scale;
  const sh = box.h / scale;
  const sx = (iw - sw) * fx;
  const sy = (ih - sh) * fy;
  ctx.save();
  if (grayscale) ctx.filter = "grayscale(1)";
  ctx.drawImage(image, sx, sy, sw, sh, box.x, box.y, box.w, box.h);
  ctx.restore();
}

// 한 줄에 들어갈 때까지 글자를 줄인다(start → min, 2px씩). 그래도 넘치면 min.
export function fitPx(pen: Pen, value: string, maxW: number, start: number, min: number, weight = 900) {
  let px = start;
  while (px > min) {
    pen.ctx.font = font(px, weight);
    if (pen.ctx.measureText(value).width <= maxW) break;
    px -= 2;
  }
  return Math.max(px, min);
}

// 그림 전체 바탕.
export function paintBackground(pen: Pen, w: number, h: number, color: string) {
  if (!pen.draw) return;
  pen.ctx.clearRect(0, 0, w, h);
  pen.ctx.fillStyle = color;
  pen.ctx.fillRect(0, 0, w, h);
}
