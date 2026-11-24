// 매물 가격표의 고르는 모양(보드 20번, 2026-11-24 사용자 답 "어 그렇게 해" — 가격표 01 흰 종이·06 초록 메뉴판·08 보라 밤·10 사진 크게).
// '기본'은 지금 안내지·비교표(work-listing-card.ts)를 그대로 쓰고, 이 파일은 새 모양만 그린다. 글은 listing-paper.mjs buildShapeSheet()가 만든다.
// - 모든 모양: 위에 매물마다 가격을 크게 → 상담 줄 → '매물 표시·광고 명시사항' 표(25 → 20px, 20px 아래로 줄이지 않음) → 사무소 명시사항 5항목(28px).
// - 표가 20px에도 자리에 들지 않으면 fits false를 돌려주고, 화면은 그림을 보이지 않는다(대장 조건 ①, 2026-11-24).
// - 사진은 담은 매물이 모두 같은 공개 단지일 때 그 단지의 공개 승인 사진만 쓴다. 아니면 건물 그림으로 대신한다(대장 조건 ④).
// - 서버 요청·브라우저 저장 없음. '가장 낮은' 같은 표시는 없다.
// - 새로 쓴 글(상담 줄·큰 제목·꼬리표 등)은 '문구 고치기' 칸에서 고친 글(paper-copy.mjs checkPaperCopy() 결과)을 쓴다. 빈 optional 칸은 그 줄을 뺀다(2판).
import { LISTING_CARD_SIZE } from "./work/listing-paper.mjs";
import { defaultPaperCopy } from "./work/paper-copy.mjs";
import { seededRandom } from "./work/paper-parts.mjs";
import { CARD_COLORS as C, font, loadLogo, text, type Logo, type Pen } from "./work-card-draw";
import { drawCover, drawDisclosureTable, drawOfficeFooter, fitPx, loadImage, measureOfficeFooter, type TableRow } from "./work-paper-parts";

export type ListingShape = "basic" | "white" | "green" | "night" | "photo";
export type ShapeSheet = {
  heading: string;
  sub: string;
  entries: { no: string; tradeLabel: string; title: string; line: string; price: string }[];
  columns: string[];
  rows: { key: string; label: string; values: string[] }[];
  recheck: string;
  photo: { src: string; alt: string; caption: string } | null;
  phone: string;
  closeTag: string | null;
  contact: string[];
  disclosure: string[];
};
export type ShapeResult = { dataUrl: string; fits: boolean; tablePx: number; minBodyPx: number };

const W = LISTING_CARD_SIZE.width;
const H = LISTING_CARD_SIZE.height;
const PAD = 64;
const MAXW = W - PAD * 2;
const TRADE_COLOR: Record<string, string> = { 매매: "#132A3E", 전세: "#2F6B4F", 월세: "#B3261E" };
const GREEN = { deep: "#1F4A36", cream: "#F4EFE1", gold: "#F2C14E", light: "#DDE7DF", dots: "#7FA08D" };
const NIGHT = { top: "#2B1E63", bottom: "#17113A", star: "#E9E3FF", moon: "#FFE08A", yellow: "#FFD84D", lilac: "#CFC4FF", box: "rgba(255, 255, 255, 0.08)", boxLine: "rgba(207, 196, 255, 0.55)", city: "#120D2E" };

// level: 표가 자리에 들지 않을 때 위 칸을 줄이는 단계(0 그대로 → 2 가장 작게). 표 글씨(20px 바닥)는 줄이지 않는다.
export type ListingCopy = Record<string, string>;
type Ctx = { pen: Pen; sheet: ShapeSheet; logo: Logo; photo: HTMLImageElement | null; level: number; copy: ListingCopy };
const LEVELS = [1, 0.86, 0.74];

// 가격 글: 칸에 들어갈 때까지 줄이고(start → 0.62배), 그래도 길면 ' / '(월세 보증금·월세 사이)에서 줄을 바꾼다. 다음 y를 돌려준다.
function priceText(pen: Pen, value: string, x: number, y: number, maxW: number, start: number, color: string, align: CanvasTextAlign) {
  const min = Math.round(start * 0.62);
  const px = fitPx(pen, value, maxW, start, min);
  pen.ctx.font = font(px, 900);
  const parts = value.split(" / ");
  if (pen.ctx.measureText(value).width <= maxW || parts.length < 2) return text(pen, value, x, y, { px, weight: 900, color, align, maxW, lh: 1.18 });
  const each = Math.min(...parts.map((part) => fitPx(pen, part, maxW, start, min)));
  let at = y;
  for (const part of parts) at = text(pen, part, x, at, { px: each, weight: 900, color, align, maxW, lh: 1.15 });
  return at;
}

// 가격 칸 폭: 글이 짧으면 그만큼만 쓰고(가운데 글 칸을 넓힘), 길면 max까지.
function priceWidth(pen: Pen, value: string, px: number, max: number) {
  pen.ctx.font = font(px, 900);
  return Math.round(Math.min(max, pen.ctx.measureText(value).width + 6));
}

// 표 아래쪽: 사무소 명시사항 3줄의 위 끝(아래에서 34px 띄움).
function footerTop(pen: Pen, inset = 0) {
  return (lines: string[]) => H - 34 - inset - measureOfficeFooter(pen, lines, MAXW - inset * 2);
}

// 명시사항 표 + 다시 확인 문장 + 사무소 아래 칸. panel이면 밝은 판 위에 싣는다(어두운 바탕 모양).
function tableAndFooter({ pen, sheet }: Ctx, top: number, { panel = "", ink = C.ink, soft = C.soft } = {}) {
  const inset = panel ? 28 : 0;
  const x = PAD + inset;
  const w = MAXW - inset * 2;
  const footTop = footerTop(pen, inset)(sheet.disclosure);
  if (panel && pen.draw) {
    pen.ctx.fillStyle = panel;
    roundRect(pen.ctx, PAD, top - inset + 6, MAXW, H - 20 - (top - inset + 6), 14);
    pen.ctx.fill();
  }
  const recheckPx = 22;
  const recheckH = Math.round(recheckPx * 1.4);
  const table = drawDisclosureTable(pen, { x, y: top + (panel ? 8 : 0), w, rows: sheet.rows as TableRow[], columns: sheet.columns, maxBottom: footTop - 22 - recheckH - 8 });
  text(pen, sheet.recheck, x, table.bottom + 8, { px: recheckPx, color: panel ? C.soft : soft, maxW: w, lh: 1.4 });
  if (pen.draw) { pen.ctx.fillStyle = panel ? C.edge : (soft === C.soft ? C.edge : "rgba(255,255,255,0.35)"); pen.ctx.fillRect(x, footTop - 14, w, 2); }
  drawOfficeFooter(pen, sheet.disclosure, { x, y: footTop, w, color: panel ? C.ink : ink, soft: panel ? C.soft : soft });
  return table;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

// ── 01 흰 종이 ──
function drawWhite(c: Ctx) {
  const { pen, sheet, logo, copy } = c;
  const n = sheet.entries.length;
  const k = LEVELS[c.level];
  if (pen.draw) { pen.ctx.fillStyle = C.paper; pen.ctx.fillRect(0, 0, W, H); }
  const logoH = 70;
  const logoW = Math.round(logoH * logo.w / logo.h);
  if (pen.draw) pen.ctx.drawImage(logo.image, logo.x, logo.y, logo.w, logo.h, W - PAD - logoW, 44, logoW, logoH);
  let y = text(pen, sheet.sub, PAD, 50, { px: 24, color: C.soft, maxW: MAXW - logoW - 24, lh: 1.35 });
  y = text(pen, sheet.heading, PAD, y + 4, { px: fitPx(pen, sheet.heading, MAXW - logoW - 24, Math.round(72 * k), 44), weight: 900, color: C.navy, lh: 1.15 });
  if (pen.draw) { pen.ctx.fillStyle = C.navy; pen.ctx.fillRect(PAD, y + 12, MAXW, 4); }
  y += 16;
  const rowPad = Math.round((n >= 3 ? 12 : 18) * k);
  for (const entry of sheet.entries) {
    const top = y + rowPad;
    const chipPx = 26;
    const chipW = Math.round(chipPx * 2.9);
    const chipH = Math.round(chipPx * 1.6);
    const priceW = priceWidth(pen, entry.price, 48, MAXW * 0.44);
    const midX = PAD + chipW + 18;
    const midW = MAXW - chipW - 18 - priceW - 16;
    const priceBottom = priceText(pen, entry.price, W - PAD, top, priceW, 48, C.navy, "right");
    let mid = text(pen, entry.title, midX, top, { px: 28, weight: 800, maxW: midW, lh: 1.3 });
    if (entry.line) mid = text(pen, entry.line, midX, mid, { px: 24, color: C.soft, maxW: midW, lh: 1.35 });
    if (pen.draw) {
      pen.ctx.fillStyle = TRADE_COLOR[entry.tradeLabel] ?? C.navy;
      pen.ctx.fillRect(PAD, top + 2, chipW, chipH);
    }
    text(pen, entry.tradeLabel, PAD + chipW / 2, top + 2 + (chipH - chipPx * 1.2) / 2, { px: chipPx, weight: 800, color: "#FFFFFF", align: "center", lh: 1.2 });
    y = Math.max(priceBottom, mid, top + chipH) + rowPad;
    if (pen.draw) { pen.ctx.fillStyle = C.edge; pen.ctx.fillRect(PAD, y, MAXW, 2); }
  }
  // 상담 줄: 회색 칸 안에 문구 + 전화
  const callTop = y + 16;
  const callH = 76;
  if (pen.draw) { pen.ctx.fillStyle = C.paper2; pen.ctx.fillRect(PAD, callTop, MAXW, callH); }
  if (copy.call) text(pen, copy.call, PAD + 28, callTop + (callH - 28 * 1.3) / 2, { px: fitPx(pen, copy.call, MAXW * 0.5, 28, 22, 600), weight: 600, maxW: MAXW * 0.5, lh: 1.3 });
  text(pen, sheet.phone, W - PAD - 28, callTop + (callH - 46 * 1.2) / 2, { px: 46, weight: 900, color: C.navy, align: "right", lh: 1.2 });
  return tableAndFooter(c, callTop + callH + 26);
}

// ── 06 초록 메뉴판 ──
function dotted(pen: Pen, x0: number, x1: number, y: number, color: string) {
  if (!pen.draw || x1 - x0 < 20) return;
  const { ctx } = pen;
  ctx.fillStyle = color;
  for (let x = x0; x < x1; x += 12) ctx.fillRect(x, y, 4, 4);
}
function drawGreen(c: Ctx) {
  const { pen, sheet, copy } = c;
  const n = sheet.entries.length;
  const k = LEVELS[c.level];
  if (pen.draw) { pen.ctx.fillStyle = GREEN.deep; pen.ctx.fillRect(0, 0, W, H); }
  let y = text(pen, sheet.sub, W / 2, 44, { px: 24, color: GREEN.light, align: "center", lh: 1.35 });
  y = text(pen, copy.head, W / 2, y + 4, { px: Math.round(76 * k), weight: 900, color: GREEN.cream, align: "center", lh: 1.15 });
  y = text(pen, sheet.heading, W / 2, y + 2, { px: 30, weight: 600, color: GREEN.light, align: "center", lh: 1.3 });
  y += n >= 3 ? 10 : 22;
  for (const entry of sheet.entries) {
    const top = y + Math.round((n >= 3 ? 8 : 14) * k);
    const labelPx = 38;
    const labelW = pen.draw ? (pen.ctx.font = font(labelPx, 800), pen.ctx.measureText(entry.tradeLabel).width) : 80;
    const priceW = Math.round(MAXW * 0.5);
    text(pen, entry.tradeLabel, PAD, top + 4, { px: labelPx, weight: 800, color: GREEN.cream, lh: 1.25 });
    const priceBottom = priceText(pen, entry.price, W - PAD, top, priceW, Math.round(56 * k), GREEN.gold, "right");
    pen.ctx.font = font(56, 900);
    const priceLeft = W - PAD - Math.min(priceW, pen.ctx.measureText(entry.price).width);
    dotted(pen, PAD + labelW + 18, priceLeft - 18, top + 42, GREEN.dots);
    const lineText = [entry.title, entry.line].filter(Boolean).join(" · ");
    y = text(pen, lineText, PAD, Math.max(priceBottom, top + labelPx * 1.25 + 8), { px: 24, color: GREEN.light, maxW: MAXW, lh: 1.35 });
  }
  if (pen.draw) { pen.ctx.fillStyle = "rgba(221, 231, 223, 0.35)"; pen.ctx.fillRect(PAD, y + 14, MAXW, 2); }
  const callTop = y + 26;
  pen.ctx.font = font(28, 600);
  const callW = copy.call ? pen.ctx.measureText(copy.call).width + 20 : 0;
  pen.ctx.font = font(46, 900);
  const phoneW = pen.ctx.measureText(sheet.phone).width;
  const startX = W / 2 - (callW + phoneW) / 2;
  if (copy.call) text(pen, copy.call, startX, callTop + 12, { px: 28, weight: 600, color: GREEN.light, maxW: callW, lh: 1.3 });
  text(pen, sheet.phone, startX + callW, callTop, { px: 46, weight: 900, color: GREEN.cream, lh: 1.2 });
  return tableAndFooter(c, callTop + 46 * 1.2 + 34, { panel: GREEN.cream });
}

// ── 08 보라 밤 ──
function nightSky(pen: Pen, h: number) {
  if (!pen.draw) return;
  const { ctx } = pen;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, NIGHT.top);
  grad.addColorStop(1, NIGHT.bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const random = seededRandom(5);
  ctx.fillStyle = NIGHT.star;
  for (let i = 0; i < 60; i += 1) {
    const x = random() * W;
    const y = random() * h * 0.9;
    const r = random() < 0.15 ? 2.4 : 1.3;
    ctx.globalAlpha = 0.4 + random() * 0.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 달(초승달): 노란 원에서 바탕색 원을 비켜 빼기
  const mx = W - 150;
  const my = 92;
  ctx.fillStyle = NIGHT.moon;
  ctx.beginPath(); ctx.arc(mx, my, 44, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = NIGHT.top;
  ctx.beginPath(); ctx.arc(mx + 20, my - 14, 40, 0, Math.PI * 2); ctx.fill();
  // 아래 건물 줄(창문 없는 어두운 그림자)
  ctx.fillStyle = NIGHT.city;
  let x = 0;
  const cityTop = h;
  while (x < W) {
    const bw = 50 + Math.floor(random() * 5) * 16;
    const bh = 60 + Math.floor(random() * 6) * 30;
    ctx.fillRect(x, cityTop - bh, bw - 6, bh + 40);
    x += bw;
  }
}
function drawNight(c: Ctx) {
  const { pen, sheet, copy } = c;
  const closeTag = copy.tag || null;
  const n = sheet.entries.length;
  const k = LEVELS[c.level];
  // 먼저 재서 건물 줄 높이(상담 줄 높이)를 정한다.
  const top = (p: Pen) => {
    let y = text(p, [copy.line, sheet.sub].filter(Boolean).join(" · "), PAD, 48, { px: 24, color: NIGHT.lilac, maxW: MAXW - 160, lh: 1.35 });
    y = text(p, sheet.heading, PAD, y + 4, { px: fitPx(p, sheet.heading, MAXW - 140, Math.round(72 * k), 44), weight: 900, color: NIGHT.yellow, lh: 1.15 });
    y += n >= 3 ? 12 : 22;
    for (const entry of sheet.entries) {
      const boxTop = y;
      const padY = Math.round((n >= 3 ? 12 : 18) * k);
      const chipPx = 26;
      const chipW = Math.round(chipPx * 2.9);
      const chipH = Math.round(chipPx * 1.6);
      const priceW = priceWidth(p, entry.price, 46, MAXW * 0.42);
      const midX = PAD + 24 + chipW + 16;
      const midW = MAXW - 48 - chipW - 16 - priceW - 12;
      const measureOnly: Pen = { ...p, draw: false };
      const priceBottomM = priceText(measureOnly, entry.price, W - PAD - 24, boxTop + padY, priceW, 46, "#FFFFFF", "right");
      let midM = text(measureOnly, entry.title, midX, boxTop + padY, { px: 26, weight: 800, maxW: midW, lh: 1.3 });
      if (entry.line) midM = text(measureOnly, entry.line, midX, midM, { px: 22, maxW: midW, lh: 1.35 });
      const boxH = Math.max(priceBottomM, midM, boxTop + padY + chipH) + padY - boxTop;
      if (p.draw) {
        p.ctx.fillStyle = NIGHT.box;
        roundRect(p.ctx, PAD, boxTop, MAXW, boxH, 14);
        p.ctx.fill();
        p.ctx.strokeStyle = NIGHT.boxLine;
        p.ctx.lineWidth = 2;
        p.ctx.stroke();
        p.ctx.fillStyle = NIGHT.lilac;
        roundRect(p.ctx, PAD + 24, boxTop + (boxH - chipH) / 2, chipW, chipH, 8);
        p.ctx.fill();
      }
      text(p, entry.tradeLabel, PAD + 24 + chipW / 2, boxTop + (boxH - chipH) / 2 + (chipH - chipPx * 1.2) / 2, { px: chipPx, weight: 800, color: NIGHT.bottom, align: "center", lh: 1.2 });
      priceText(p, entry.price, W - PAD - 24, boxTop + padY, priceW, 46, "#FFFFFF", "right");
      let mid = text(p, entry.title, midX, boxTop + padY, { px: 26, weight: 800, color: "#FFFFFF", maxW: midW, lh: 1.3 });
      if (entry.line) mid = text(p, entry.line, midX, mid, { px: 22, color: NIGHT.lilac, maxW: midW, lh: 1.35 });
      y = boxTop + boxH + (n >= 3 ? 10 : 14);
    }
    // 상담 줄: 노란 꼬리표(평일 닫는 시각, office.json에서) + 전화
    const callTop = y + 10;
    let x = PAD;
    if (closeTag) {
      p.ctx.font = font(26, 800);
      const tagW = p.ctx.measureText(closeTag).width + 32;
      if (p.draw) { p.ctx.fillStyle = NIGHT.yellow; roundRect(p.ctx, PAD, callTop + 8, tagW, 46, 6); p.ctx.fill(); }
      text(p, closeTag, PAD + 16, callTop + 8 + (46 - 26 * 1.2) / 2, { px: 26, weight: 800, color: NIGHT.bottom, lh: 1.2 });
      x = PAD + tagW + 20;
    }
    text(p, sheet.phone, x, callTop, { px: 52, weight: 900, color: "#FFFFFF", lh: 1.2 });
    return callTop + 52 * 1.2;
  };
  const callBottom = top({ ...pen, draw: false });
  nightSky(pen, callBottom + 30);
  top(pen);
  return tableAndFooter(c, callBottom + 50, { panel: "#FFFFFF" });
}

// ── 10 사진 크게 ──
// 사진이 없을 때 대신 그리는 건물 그림(하늘 + 아파트 세 동, 글자 없음).
function buildingArt(pen: Pen, box: { x: number; y: number; w: number; h: number }) {
  if (!pen.draw) return;
  const { ctx } = pen;
  const grad = ctx.createLinearGradient(0, box.y, 0, box.y + box.h);
  grad.addColorStop(0, "#9FC3E6");
  grad.addColorStop(1, "#DCE9F5");
  ctx.fillStyle = grad;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  const towers = [[0.08, 0.30, 0.62], [0.36, 0.26, 0.82], [0.64, 0.28, 0.7]];
  for (const [fx, fw, fh] of towers) {
    const tw = box.w * fw;
    const th = box.h * fh;
    const tx = box.x + box.w * fx;
    const ty = box.y + box.h - th;
    ctx.fillStyle = "#E9ECEF";
    ctx.fillRect(tx, ty, tw, th);
    ctx.fillStyle = "#C9CED4";
    ctx.fillRect(tx + tw * 0.82, ty, tw * 0.18, th);
    ctx.fillStyle = "#AEB8C2";
    for (let wy = ty + 24; wy < box.y + box.h - 20; wy += 30) {
      for (let wx = tx + 18; wx < tx + tw * 0.78; wx += 34) ctx.fillRect(wx, wy, 18, 12);
    }
  }
  ctx.fillStyle = "#8FB58A";
  ctx.fillRect(box.x, box.y + box.h - 24, box.w, 24);
}
function drawPhoto(c: Ctx) {
  const { pen, sheet, photo } = c;
  const n = sheet.entries.length;
  if (pen.draw) { pen.ctx.fillStyle = C.paper; pen.ctx.fillRect(0, 0, W, H); }
  const photoH = Math.round((n >= 3 ? 300 : n === 2 ? 380 : 460) * LEVELS[c.level]);
  const box = { x: 0, y: 0, w: W, h: photoH };
  if (photo) drawCover(pen, photo, box, { fy: 0.45 }); else buildingArt(pen, box);
  if (pen.draw) {
    // 확인일 줄(24px)이 밝은 사진·건물 그림 위에서도 읽히게 위쪽부터 어둡게 한다.
    const grad = pen.ctx.createLinearGradient(0, photoH * 0.2, 0, photoH);
    grad.addColorStop(0, "rgba(10, 20, 30, 0)");
    grad.addColorStop(0.45, "rgba(10, 20, 30, 0.45)");
    grad.addColorStop(1, "rgba(10, 20, 30, 0.85)");
    pen.ctx.fillStyle = grad;
    pen.ctx.fillRect(0, 0, W, photoH);
  }
  const headPx = fitPx(pen, sheet.heading, MAXW, 70, 46);
  const headTop = photoH - 30 - headPx * 1.15;
  text(pen, sheet.heading, PAD, headTop, { px: headPx, weight: 900, color: "#FFFFFF", lh: 1.15 });
  text(pen, sheet.sub, PAD, headTop - 24 * 1.35 - 2, { px: 24, color: "#FFFFFF", lh: 1.35 });
  // 매물 칸: 나란히 1 ~ 3칸, 위에 거래 색 띠
  const gap = 18;
  const cardW = (MAXW - gap * (n - 1)) / n;
  const top = photoH + 26;
  let bottom = top;
  const inner = (p: Pen) => sheet.entries.map((entry, index) => {
    const x = PAD + index * (cardW + gap);
    let y = top + 18;
    y = text(p, entry.tradeLabel, x + 18, y, { px: 26, weight: 800, color: TRADE_COLOR[entry.tradeLabel] ?? C.navy, lh: 1.3 });
    y = priceText(p, entry.price, x + 18, y + 2, cardW - 36, n >= 3 ? 40 : 48, C.navy, "left");
    y = text(p, entry.title, x + 18, y + 6, { px: 24, weight: 700, maxW: cardW - 36, lh: 1.3 });
    if (entry.line) y = text(p, entry.line, x + 18, y, { px: 22, color: C.soft, maxW: cardW - 36, lh: 1.35 });
    return y + 16;
  });
  bottom = Math.max(...inner({ ...pen, draw: false }));
  if (pen.draw) {
    sheet.entries.forEach((entry, index) => {
      const x = PAD + index * (cardW + gap);
      pen.ctx.fillStyle = C.paper2;
      pen.ctx.fillRect(x, top, cardW, bottom - top);
      pen.ctx.fillStyle = TRADE_COLOR[entry.tradeLabel] ?? C.navy;
      pen.ctx.fillRect(x, top, cardW, 6);
    });
  }
  inner(pen);
  const callTop = bottom + 18;
  const caption = photo ? sheet.photo?.caption ?? "" : "";
  if (caption) text(pen, caption, PAD, callTop + 14, { px: 22, color: C.soft, maxW: MAXW * 0.45, lh: 1.35 });
  text(pen, sheet.phone, W - PAD, callTop, { px: 48, weight: 900, color: C.navy, align: "right", lh: 1.2 });
  return tableAndFooter(c, callTop + 48 * 1.2 + 22);
}

const DRAW: Record<Exclude<ListingShape, "basic">, (c: Ctx) => { bottom: number; px: number; fits: boolean }> = { white: drawWhite, green: drawGreen, night: drawNight, photo: drawPhoto };

// 그리기. 사진을 읽지 못하면 건물 그림으로 대신한다(사진 주소는 같은 출처 공개 사진뿐).
// copy: 그 모양의 고친 글(checkPaperCopy() 결과). 없으면 처음 문구(꼬리표는 sheet.closeTag).
export async function renderListingShape(canvas: HTMLCanvasElement, shape: Exclude<ListingShape, "basic">, sheet: ShapeSheet, copy?: ListingCopy): Promise<ShapeResult> {
  const words = copy ?? { ...defaultPaperCopy("listing", shape, null), ...(shape === "night" ? { tag: sheet.closeTag ?? "" } : {}) };
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const [logo] = await Promise.all([loadLogo(), document.fonts?.ready]);
  let photo: HTMLImageElement | null = null;
  if (shape === "photo" && sheet.photo?.src) photo = await loadImage(sheet.photo.src).catch(() => null);
  let level = 0;
  for (; level < LEVELS.length - 1; level += 1) {
    const probe: Pen = { ctx, draw: false, minPx: 999, dy: 0, pad: PAD, maxW: MAXW };
    if (DRAW[shape]({ pen: probe, sheet, logo, photo, level, copy: words }).fits) break;
  }
  const pen: Pen = { ctx, draw: true, minPx: 999, dy: 0, pad: PAD, maxW: MAXW };
  ctx.clearRect(0, 0, W, H);
  const table = DRAW[shape]({ pen, sheet, logo, photo, level, copy: words });
  return { dataUrl: canvas.toDataURL("image/png"), fits: table.fits, tablePx: table.px, minBodyPx: pen.minPx };
}
