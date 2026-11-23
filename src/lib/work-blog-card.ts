// 글 초안 카드 그림(2026-11-23 사용자 선택 "B 큰 숫자 인포그래픽"·"3장 한 벌"). canvas 1080×1350 → toDataURL('image/png').
// 글 묶음은 src/lib/work/blog-cards.mjs가 공개 자료로만 만들고, 이 파일은 그리기만 한다(서버 요청·브라우저 저장 없음).
// 글꼴·줄 나누기·로고는 업무 카드 공통 파일(work-card-draw.ts)을 쓴다. 단지 사진·로고는 같은 출처 파일이라 canvas가 오염되지 않는다.
// 모양: 옅은 회색 바탕 + 남색 + 청록, 숫자가 주인공. 비율은 도넛·막대로만 보이고 퍼센트 숫자는 새로 만들지 않는다. 아래 칸은 사무소 명시사항(남색 띠).
import { BLOG_CARD_SIZE } from "./work/blog-cards.mjs";
import { font, loadLogo, wrap } from "./work-card-draw";

type Row = { label: string; value: number; text: string };
export type ComplexCoverCard = { key: "cover"; label: string; badge: string; image: string | null; imageAlt: string; big: string; unit: string; bigNote: string; titleLines: string[]; chips: string[]; disclosure: string[] };
export type ComplexInfoCard = {
  key: "info"; label: string; badge: string; name: string; subtitle: string; households: string;
  donut: { title: string; rows: Row[] } | null;
  side: { title: string; big: string | null; unit: string | null; note: string | null; rows: [string, string][] } | null;
  supplyBar: Row[] | null; tiles: { label: string; value: string }[]; sourceLine: string; disclosure: string[];
};
export type ComplexChecksCard = { key: "checks"; label: string; badge: string; kicker: string; heading: string; items: string[]; disclosure: string[] };
export type ListingCoverCard = { key: "listing"; label: string; badge: string; chip: string; name: string; price: string; rows: { key: string; label: string; value: string }[]; disclosure: string[] };
export type BlogCard = ComplexCoverCard | ComplexInfoCard | ComplexChecksCard | ListingCoverCard;
export type BlogCardImage = { key: string; label: string; dataUrl: string; alt: string };
export type BlogCardResult = { images: BlogCardImage[]; overflow: boolean };

const W = BLOG_CARD_SIZE.width;
const H = BLOG_CARD_SIZE.height;
const PAD = 56;
const MAXW = W - PAD * 2;
// 남색·청록은 실거래가 카드 남색(#132A3E)과 같은 집안. 도넛 3·4번째 칸은 남색을 옅게 한 색(뜻은 범례 글자가 전한다).
const B = { navy: "#132A3E", teal: "#13A89E", bg: "#F2F5F7", card: "#FFFFFF", soft: "#5B6773", faint: "#D9E1E7", slices: ["#132A3E", "#13A89E", "#6F8FAA", "#B5C4D1"] };
const FOOT_PX = 28;

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };
type TextOpt = { px: number; w?: number; color?: string; align?: CanvasTextAlign; maxW?: number; lh?: number; ls?: number };

function setFont(ctx: Ctx, px: number, w: number, ls: number) {
  ctx.font = font(px, w);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${ls}px`;
}
const linesOf = (ctx: Ctx, value: string, maxW: number) => value.split("\n").flatMap((part) => wrap(ctx, part, maxW));
// 글 쓰기: 위쪽 y에서 시작해 다음 y를 돌려준다. 줄바꿈 기준은 띄어쓰기(단지 이름은 붙임 칸으로 묶여 있다).
function t(ctx: Ctx, value: string, x: number, y: number, { px, w = 400, color = B.navy, align = "left", maxW = MAXW, lh = 1.35, ls = 0 }: TextOpt) {
  ctx.save();
  setFont(ctx, px, w, ls);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  const lines = linesOf(ctx, value, maxW);
  lines.forEach((line, index) => ctx.fillText(line, x, y + px * lh * (index + 0.5)));
  ctx.restore();
  return y + lines.length * px * lh;
}
function th(ctx: Ctx, value: string, { px, w = 400, maxW = MAXW, lh = 1.35, ls = 0 }: TextOpt) {
  ctx.save();
  setFont(ctx, px, w, ls);
  const count = linesOf(ctx, value, maxW).length;
  ctx.restore();
  return count * px * lh;
}
function tw(ctx: Ctx, value: string, px: number, w = 400, ls = 0) {
  ctx.save();
  setFont(ctx, px, w, ls);
  const m = ctx.measureText(value).width;
  ctx.restore();
  return m;
}
// 한 줄에 들어갈 때까지 줄인다(최소 min).
function fit(ctx: Ctx, value: string, start: number, min: number, maxW: number, w = 400, ls = 0) {
  let px = start;
  while (px > min && tw(ctx, value, px, w, ls) > maxW) px -= 2;
  return px;
}
function path(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}
function box(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, color: string) {
  ctx.save();
  path(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}
// 큰 숫자(글자 아래선 기준). 돌려주는 값은 숫자 폭.
function bigNumber(ctx: Ctx, value: string, x: number, baseline: number, px: number, color: string, ls: number) {
  ctx.save();
  setFont(ctx, px, 900, ls);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, baseline);
  const width = ctx.measureText(value).width;
  ctx.restore();
  return width;
}

// 로고: 공통 로고(흰 여백 자름)에서 흰 바탕만 투명하게 바꾼 사본(옅은 회색 바탕 위에 흰 네모가 보이지 않게).
let clearLogo: Promise<HTMLCanvasElement> | null = null;
function loadClearLogo() {
  clearLogo ??= loadLogo().then((logo) => {
    const out = document.createElement("canvas");
    out.width = logo.w;
    out.height = logo.h;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(logo.image, logo.x, logo.y, logo.w, logo.h, 0, 0, logo.w, logo.h);
    const image = ctx.getImageData(0, 0, logo.w, logo.h);
    const data = image.data;
    for (let at = 0; at < data.length; at += 4) {
      const low = Math.min(data[at], data[at + 1], data[at + 2]);
      if (low > 244) data[at + 3] = 0;
      else if (low > 225) data[at + 3] = Math.round((data[at + 3] * (244 - low)) / 19);
    }
    ctx.putImageData(image, 0, 0);
    return out;
  }).catch((error) => { clearLogo = null; throw error; });
  return clearLogo;
}
// 단지 사진(같은 출처 /images/). 못 읽으면 null(사진 자리를 남색 판으로 채운다).
function loadPhoto(src: string | null) {
  if (!src) return Promise.resolve(null);
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function head(ctx: Ctx, logo: HTMLCanvasElement, badge: string) {
  const h = 76;
  ctx.drawImage(logo, PAD, 44, (logo.width * h) / logo.height, h);
  const bw = tw(ctx, badge, 26, 700) + 44;
  box(ctx, W - PAD - bw, 56, bw, 54, 27, B.navy);
  t(ctx, badge, W - PAD - bw / 2, 65, { px: 26, w: 700, color: "#FFFFFF", align: "center" });
}
// 아래 띠: 사무소 명시사항 3줄(첫 줄 굵게). 돌려주는 값은 띠 위 끝.
function footTop(ctx: Ctx, lines: string[]) {
  const h = lines.reduce((sum, line) => sum + th(ctx, line, { px: FOOT_PX, w: 700, maxW: MAXW, lh: 1.42 }), 0);
  return H - Math.ceil(h + 72);
}
function foot(ctx: Ctx, lines: string[]) {
  const top = footTop(ctx, lines);
  ctx.fillStyle = B.navy;
  ctx.fillRect(0, top, W, H - top);
  let y = top + 36;
  lines.forEach((line, index) => {
    y = t(ctx, line, PAD, y, { px: FOOT_PX, w: index === 0 ? 700 : 400, color: index === 0 ? "#FFFFFF" : "rgba(255,255,255,0.78)", lh: 1.42 });
  });
  return top;
}
function cover(ctx: Ctx, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / image.width, h / image.height);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
}

// ── 1장: 표지 ──
function drawCover(ctx: Ctx, card: ComplexCoverCard, logo: HTMLCanvasElement, photo: HTMLImageElement | null) {
  ctx.fillStyle = B.bg;
  ctx.fillRect(0, 0, W, H);
  head(ctx, logo, card.badge);
  const bottom = footTop(ctx, card.disclosure) - 28;
  // 제목은 3줄을 넘지 않을 때까지 줄인다.
  const title = card.titleLines.join("\n");
  let titlePx = 60;
  while (titlePx > 44 && th(ctx, title, { px: titlePx, w: 800, lh: 1.22, ls: -1 }) > titlePx * 1.22 * 3) titlePx -= 4;
  const titleH = th(ctx, title, { px: titlePx, w: 800, lh: 1.22, ls: -1 });
  // 큰 숫자 판: 판이 사진 아래쪽에 86px 겹친다. 사진 높이는 남는 세로 공간에 맞춘다(380 ~ 520).
  const chipsH = card.chips.length ? 26 + 58 : 0;
  const below = 300 - 86 + 32 + titleH + chipsH;
  const photoH = Math.max(380, Math.min(520, bottom - 150 - below));
  const photoTop = 150;
  ctx.save();
  path(ctx, PAD, photoTop, MAXW, photoH, 28);
  ctx.clip();
  if (photo) cover(ctx, photo, PAD, photoTop, MAXW, photoH);
  else {
    ctx.fillStyle = B.navy;
    ctx.fillRect(PAD, photoTop, MAXW, photoH);
    t(ctx, card.imageAlt, W / 2, photoTop + photoH / 2 - 60, { px: 72, w: 800, color: "#FFFFFF", align: "center" });
  }
  ctx.restore();
  const plateTop = photoTop + photoH - 86;
  const numPx = fit(ctx, card.big, 200, 120, MAXW - 110 - tw(ctx, card.unit, 52, 800), 900, -8);
  const nw = tw(ctx, card.big, numPx, 900, -8);
  const uw = tw(ctx, card.unit, 52, 800);
  box(ctx, PAD, plateTop, Math.min(MAXW, nw + uw + 110), 300, 28, B.card);
  bigNumber(ctx, card.big, PAD + 36, plateTop + 206, numPx, B.navy, -8);
  t(ctx, card.unit, PAD + 36 + nw + 14, plateTop + 128, { px: 52, w: 800, color: B.teal });
  if (card.bigNote) t(ctx, card.bigNote, PAD + 40, plateTop + 244, { px: 28, w: 600, color: B.soft });
  let y = t(ctx, title, PAD, plateTop + 300 + 32, { px: titlePx, w: 800, lh: 1.22, ls: -1 });
  // 칩: 한 줄에 들어가는 만큼만(넘치면 뒤 칩을 뺀다).
  let x = PAD;
  y += 26;
  for (const chip of card.chips) {
    const cw = tw(ctx, chip, 28, 700) + 40;
    if (x + cw > W - PAD) break;
    box(ctx, x, y, cw, 58, 29, "#FFFFFF");
    ctx.save();
    path(ctx, x, y, cw, 58, 29);
    ctx.strokeStyle = B.faint;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    t(ctx, chip, x + 20, y + 10, { px: 28, w: 700 });
    x += cw + 12;
  }
  foot(ctx, card.disclosure);
  return y + 58 > bottom + 28;
}

function donut(ctx: Ctx, cx: number, cy: number, r: number, thick: number, rows: Row[]) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  let a = -Math.PI / 2;
  rows.forEach((row, index) => {
    const b = a + (row.value / total) * Math.PI * 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, a + 0.02, b - 0.02);
    ctx.strokeStyle = B.slices[index % B.slices.length];
    ctx.lineWidth = thick;
    ctx.stroke();
    ctx.restore();
    a = b;
  });
}

// ── 2장: 단지 정보 ──
function drawInfo(ctx: Ctx, card: ComplexInfoCard, logo: HTMLCanvasElement) {
  ctx.fillStyle = B.bg;
  ctx.fillRect(0, 0, W, H);
  head(ctx, logo, card.badge);
  const namePx = fit(ctx, card.name, 76, 52, MAXW, 800, -2);
  t(ctx, card.name, PAD, 150, { px: namePx, w: 800, ls: -2 });
  if (card.subtitle) t(ctx, card.subtitle, PAD, 254, { px: 28, w: 500, color: B.soft });
  const bottom = footTop(ctx, card.disclosure) - 20;
  const sourceH = card.sourceLine ? th(ctx, card.sourceLine, { px: 20, maxW: MAXW, lh: 1.35 }) : 0;
  const supplyH = card.supplyBar ? 190 + 16 : 0;
  const tilesH = card.tiles.length ? 112 + 16 : 0;
  const rowTop = 314;
  const rowH = Math.max(380, bottom - rowTop - 16 - supplyH - tilesH - sourceH);
  const half = (MAXW - 16) / 2;
  const leftW = card.side ? half : MAXW;
  // 왼쪽 흰 칸: 도넛(2 ~ 4줄) 또는 큰 세대수.
  box(ctx, PAD, rowTop, leftW, rowH, 28, B.card);
  if (card.donut) {
    const rows = card.donut.rows;
    t(ctx, card.donut.title, PAD + 32, rowTop + 28, { px: 28, w: 800 });
    // 도넛 + 범례를 한 덩이로 칸 가운데에 둔다(칸이 길어지면 도넛만 150px까지 커짐).
    const legendH = rows.length * 42;
    const areaTop = rowTop + 76;
    const areaH = rowH - 76 - 24;
    const outer = Math.min(150, (areaH - 20 - legendH) / 2);
    const groupTop = areaTop + (areaH - (outer * 2 + 20 + legendH)) / 2;
    const legendTop = groupTop + outer * 2 + 20;
    const thick = Math.max(28, Math.round(outer * 0.32));
    const cx = PAD + leftW / 2;
    const cy = groupTop + outer;
    donut(ctx, cx, cy, outer - thick / 2, thick, rows);
    const inner = outer - thick;
    const centerPx = fit(ctx, card.households, 52, 30, inner * 2 - 16, 900, -2);
    t(ctx, card.households, cx, cy - centerPx * 0.72, { px: centerPx, w: 900, align: "center", ls: -2 });
    t(ctx, "세대", cx, cy + centerPx * 0.42, { px: 24, w: 600, color: B.soft, align: "center" });
    rows.forEach((row, index) => {
      const y = legendTop + index * 42;
      const valueW = tw(ctx, row.text, 27, 800);
      box(ctx, PAD + 32, y + 8, 22, 22, 6, B.slices[index % B.slices.length]);
      const labelW = leftW - 64 - 34 - valueW - 16;
      t(ctx, row.label, PAD + 66, y + 2, { px: fit(ctx, row.label, 23, 18, labelW, 500), w: 500, color: B.soft, maxW: labelW });
      t(ctx, row.text, PAD + leftW - 32, y, { px: 27, w: 800, align: "right" });
    });
  } else {
    t(ctx, "세대수", PAD + 32, rowTop + 28, { px: 28, w: 800 });
    const px = fit(ctx, card.households, 132, 72, leftW - 64 - 80, 900, -6);
    const nw = bigNumber(ctx, card.households, PAD + 28, rowTop + rowH / 2 + px * 0.36, px, B.navy, -6);
    t(ctx, "세대", PAD + 28 + nw + 8, rowTop + rowH / 2 - px * 0.1, { px: 44, w: 800, color: B.teal });
  }
  // 오른쪽 남색 칸: 주차(지상 0대면 "전부 지하") 또는 사용승인·입주.
  if (card.side) {
    const side = card.side;
    const x = PAD + half + 16;
    box(ctx, x, rowTop, half, rowH, 28, B.navy);
    t(ctx, side.title, x + 32, rowTop + 28, { px: 28, w: 800, color: "rgba(255,255,255,0.82)" });
    if (side.big) {
      const unitW = side.unit ? tw(ctx, side.unit, 44, 800) + 8 : 0;
      const px = fit(ctx, side.big, 132, 64, half - 64 - unitW, 900, -6);
      // 큰 글 + 아래 줄을 한 덩이로 칸 가운데에 둔다.
      const capH = px * 0.72;
      const groupH = capH + (side.note ? 80 : 0);
      const baseline = rowTop + 76 + (rowH - 100 - groupH) / 2 + capH;
      const nw = bigNumber(ctx, side.big, x + 28, baseline, px, "#FFFFFF", -6);
      if (side.unit) t(ctx, side.unit, x + 28 + nw + 8, baseline - 50, { px: 44, w: 800, color: B.teal });
      if (side.note) {
        const noteY = baseline + 40;
        box(ctx, x + 32, noteY + 6, 22, 22, 6, B.teal);
        t(ctx, side.note, x + 66, noteY, { px: 28, w: 700, color: "#FFFFFF", maxW: half - 98 });
      }
    } else {
      // 지상·지하가 둘 다 있으면 합계 없이 두 줄로.
      side.rows.forEach(([label, value], index) => {
        const y = rowTop + 110 + index * 130;
        t(ctx, label, x + 32, y, { px: 28, w: 600, color: "rgba(255,255,255,0.78)" });
        t(ctx, value, x + 32, y + 40, { px: fit(ctx, value, 72, 44, half - 64, 900, -2), w: 900, color: "#FFFFFF", ls: -2 });
      });
    }
  }
  let y = rowTop + rowH + 16;
  // 공급 구성 막대(한 줄이면 꽉 찬 막대).
  if (card.supplyBar) {
    const rows = card.supplyBar;
    box(ctx, PAD, y, MAXW, 190, 28, B.card);
    t(ctx, "공급 구성", PAD + 32, y + 26, { px: 28, w: 800 });
    const barX = PAD + 32;
    const barW = MAXW - 64;
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    ctx.save();
    path(ctx, barX, y + 82, barW, 34, 17);
    ctx.clip();
    let at = barX;
    rows.forEach((row, index) => {
      const w = index === rows.length - 1 ? barX + barW - at : (barW * row.value) / total;
      ctx.fillStyle = B.slices[index % B.slices.length];
      ctx.fillRect(at, y + 82, w, 34);
      at += w;
    });
    ctx.restore();
    if (rows.length === 2) {
      t(ctx, rows[0].text, barX, y + 132, { px: 27, w: 800 });
      t(ctx, rows[1].text, barX + barW, y + 132, { px: 27, w: 800, color: B.teal, align: "right" });
    } else {
      let lx = barX;
      rows.forEach((row, index) => {
        if (index > 0) { box(ctx, lx, y + 140, 18, 18, 5, B.slices[index % B.slices.length]); lx += 26; }
        lx = Math.max(lx, barX);
        t(ctx, row.text, lx, y + 132, { px: 27, w: 800 });
        lx += tw(ctx, row.text, 27, 800) + 28;
      });
    }
    y += 190 + 16;
  }
  // 작은 칸 1 ~ 3개.
  if (card.tiles.length) {
    const n = card.tiles.length;
    const tileW = (MAXW - (n - 1) * 16) / n;
    card.tiles.forEach((tile, index) => {
      const x = PAD + index * (tileW + 16);
      box(ctx, x, y, tileW, 112, 24, B.card);
      t(ctx, tile.label, x + 28, y + 16, { px: 22, w: 600, color: B.soft });
      t(ctx, tile.value, x + 28, y + 50, { px: fit(ctx, tile.value, 36, 24, tileW - 56, 800, -1), w: 800, ls: -1, maxW: tileW - 56 });
    });
    y += 112 + 16;
  }
  if (card.sourceLine) y = t(ctx, card.sourceLine, PAD, y - 4, { px: 20, color: B.soft, lh: 1.35 });
  foot(ctx, card.disclosure);
  return y > bottom + 20;
}

// ── 3장: 현장에서 확인할 점(제목만, 2열 칸) ──
function drawChecks(ctx: Ctx, card: ComplexChecksCard, logo: HTMLCanvasElement) {
  ctx.fillStyle = B.bg;
  ctx.fillRect(0, 0, W, H);
  head(ctx, logo, card.badge);
  t(ctx, card.kicker, PAD, 150, { px: 34, w: 700, color: B.teal });
  t(ctx, card.heading, PAD, 196, { px: 84, w: 900, ls: -3 });
  const top = 330;
  const bottom = footTop(ctx, card.disclosure) - 28;
  const rows = Math.ceil(card.items.length / 2);
  const rowH = (bottom - top - (rows - 1) * 16) / rows;
  const tileW = (MAXW - 16) / 2;
  let overflow = false;
  card.items.forEach((item, index) => {
    const x = PAD + (index % 2) * (tileW + 16);
    const y = top + Math.floor(index / 2) * (rowH + 16);
    box(ctx, x, y, tileW, rowH, 28, B.card);
    t(ctx, String(index + 1), x + 32, y + 22, { px: 76, w: 900, color: B.teal, ls: -2 });
    let px = 36;
    while (px > 28 && th(ctx, item, { px, w: 700, maxW: tileW - 64, lh: 1.3 }) > rowH - 140) px -= 2;
    const h = th(ctx, item, { px, w: 700, maxW: tileW - 64, lh: 1.3 });
    overflow ||= h > rowH - 130;
    t(ctx, item, x + 32, y + rowH - 32 - h, { px, w: 700, maxW: tileW - 64, lh: 1.3 });
  });
  foot(ctx, card.disclosure);
  return overflow;
}

// ── 매물 표지(사진 없음): 거래·종류 → 매물 이름 → 큰 가격 → 명시사항 표 → 아래 띠 ──
function listingBody(ctx: Ctx, card: ListingCoverCard, s: number, draw: boolean) {
  const bottom = footTop(ctx, card.disclosure) - 24;
  const textAt = (value: string, x: number, y: number, opt: TextOpt) => (draw ? t(ctx, value, x, y, opt) : y + th(ctx, value, opt));
  let y = textAt(card.chip, PAD, 150, { px: Math.round(32 * s), w: 800, color: B.teal });
  y = textAt(card.name, PAD, y + 6, { px: Math.round(64 * s), w: 800, lh: 1.2, ls: -1 });
  const priceTop = y + 24;
  const pricePx = fit(ctx, card.price, Math.round(112 * s), 56, MAXW - 72, 900, -4);
  const priceH = pricePx * 1.25 + 64;
  if (draw) {
    box(ctx, PAD, priceTop, MAXW, priceH, 28, B.card);
    t(ctx, card.price, PAD + 36, priceTop + 32, { px: pricePx, w: 900, ls: -4, lh: 1.25, maxW: MAXW - 72 });
  }
  const tableTop = priceTop + priceH + 16;
  const px = Math.round(27 * s);
  const labelW = Math.round(170 * s);
  let at = tableTop + 22;
  const rowsH: number[] = card.rows.map((row) => Math.max(th(ctx, row.value, { px, w: 600, maxW: MAXW - 64 - labelW, lh: 1.32 }), px * 1.32) + 18);
  const tableH = rowsH.reduce((sum, h) => sum + h, 0) + 44 - 18 + 18;
  if (draw) box(ctx, PAD, tableTop, MAXW, tableH, 28, B.card);
  card.rows.forEach((row, index) => {
    if (draw) {
      t(ctx, row.label, PAD + 32, at, { px, w: 700, color: B.soft, maxW: labelW - 12, lh: 1.32 });
      t(ctx, row.value, PAD + 32 + labelW, at, { px, w: 600, maxW: MAXW - 64 - labelW, lh: 1.32 });
      if (index < card.rows.length - 1) { ctx.fillStyle = B.faint; ctx.fillRect(PAD + 32, at + rowsH[index] - 9, MAXW - 64, 2); }
    }
    at += rowsH[index];
  });
  return { end: tableTop + tableH, bottom };
}
function drawListing(ctx: Ctx, card: ListingCoverCard, logo: HTMLCanvasElement) {
  ctx.fillStyle = B.bg;
  ctx.fillRect(0, 0, W, H);
  head(ctx, logo, card.badge);
  let scale = 1;
  for (const s of [1, 0.95, 0.9, 0.85, 0.8]) {
    scale = s;
    const { end, bottom } = listingBody(ctx, card, s, false);
    if (end <= bottom) break;
  }
  const { end, bottom } = listingBody(ctx, card, scale, true);
  foot(ctx, card.disclosure);
  return end > bottom;
}

// 카드 묶음 → PNG data 주소(blob 주소를 쓰지 않음). overflow가 참이면 화면이 그림을 내보내지 않는다.
export async function renderBlogCards(canvas: HTMLCanvasElement, cards: BlogCard[]): Promise<BlogCardResult> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) throw new Error("canvas");
  const coverCard = cards.find((card): card is ComplexCoverCard => card.key === "cover");
  const [logo, photo] = await Promise.all([loadClearLogo(), loadPhoto(coverCard?.image ?? null), document.fonts?.ready]);
  const images: BlogCardImage[] = [];
  let overflow = false;
  for (const [index, card] of cards.entries()) {
    ctx.clearRect(0, 0, W, H);
    if (card.key === "cover") overflow = drawCover(ctx, card, logo, photo) || overflow;
    else if (card.key === "info") overflow = drawInfo(ctx, card, logo) || overflow;
    else if (card.key === "checks") overflow = drawChecks(ctx, card, logo) || overflow;
    else overflow = drawListing(ctx, card, logo) || overflow;
    const count = cards.length > 1 ? ` ${index + 1}/${cards.length}장` : "";
    images.push({ key: card.key, label: card.label, dataUrl: canvas.toDataURL("image/png"), alt: `카드 그림${count}: ${card.label}` });
  }
  return { images, overflow };
}
