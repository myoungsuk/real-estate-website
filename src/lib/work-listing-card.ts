// 매물 안내지·비교표 카드 그림(보드 45번 D, 운영자 결정 2026-11-20 23:41:16 "A 매물 종이"). canvas 1080×1350 → toDataURL('image/png').
// 글은 src/lib/work/listing-paper.mjs가 만들고(명시사항 값은 buildDisclosure() 그대로), 이 파일은 그리기만 한다(서버 요청·브라우저 저장 없음).
// 줄 나누기·글·네모·가로줄·로고는 업무 카드 공통 파일(work-card-draw.ts)을 쓴다. 색은 DESIGN.md 그대로이고 '가장 낮은' 같은 표시는 없다.
// 1건: 머리 줄(로고 + "매물 안내") → 남색 칩(거래·종류) → 매물 이름 → 가격 → 면적·층·방향 칸 → 소개 한 줄 → 명시 항목 표 → 매물번호 줄 → 상담 칸 → 아래 칸 사무소 명시사항.
// 비교: 머리 줄 → 제목·확인일 → 매물 칸 2 ~ 3개(번호 + 이름) → 항목 줄(가격·면적·층·방향·방·욕실·입주·관리비·주차·사용승인일·소재지·종류·매물번호) → 상담 줄 → 아래 칸.
import { LISTING_CARD_SIZE } from "./work/listing-paper.mjs";
import { CARD_COLORS, hline, loadLogo, rect, text, width, type Logo, type Pen } from "./work-card-draw";

export type ListingSheet = {
  title: string;
  chip: string;
  name: string;
  price: string;
  boxes: [string, string][];
  summary: string;
  rows: { key: string; label: string; value: string }[];
  caption: string;
  phone: string;
  sub: string[];
  disclosure: string[];
};
export type CompareSheet = {
  title: string;
  heading: string;
  sub: string;
  columns: { no: string; name: string }[];
  rows: { key: string; label: string; values: string[] }[];
  phone: string;
  phoneSub: string[];
  disclosure: string[];
};
export type ListingCardResult = { dataUrl: string; overflow: boolean; minBodyPx: number };

const W = LISTING_CARD_SIZE.width;
const H = LISTING_CARD_SIZE.height;
const PAD = 72;
const MAXW = W - PAD * 2;
const C = CARD_COLORS;
const FOOT_PX = 28;
// 두 칸에 나눠 싣지 않고 한 줄을 다 쓰는 항목(길어지기 쉬움).
const WIDE = new Set(["location", "managementFee", "parking"]);

function header(pen: Pen, logo: Logo, title: string) {
  const y = 44;
  const logoH = 96;
  if (pen.draw) pen.ctx.drawImage(logo.image, logo.x, logo.y, logo.w, logo.h, PAD, y, Math.round(logoH * logo.w / logo.h), logoH);
  text(pen, title, W - PAD, y + logoH / 2 - 34 * 0.675, { px: 34, weight: 700, color: C.soft, align: "right", maxW: 560 });
  const lineY = y + logoH + 22;
  hline(pen, lineY);
  return lineY;
}

function footer(pen: Pen, disclosure: string[]) {
  const lines = (y0: number) => {
    let y = y0 + 30;
    y = text(pen, disclosure[0], PAD, y, { px: FOOT_PX, weight: 700 });
    for (const line of disclosure.slice(1)) y = text(pen, line, PAD, y, { px: FOOT_PX });
    return y + 30;
  };
  const was = pen.draw;
  pen.draw = false;
  const h = lines(0);
  pen.draw = was;
  const top = H - h;
  rect(pen, 0, top, W, H - top, { fill: C.paper2 });
  if (pen.draw) { pen.ctx.fillStyle = C.edge; pen.ctx.fillRect(0, top, W, 2); }
  lines(top);
  return top;
}

// 한 줄에 들어갈 때까지 글자를 줄인다(최소 min). 그래도 넘치면 text()가 감는다.
function fitPx(pen: Pen, value: string, start: number, min: number, maxW: number, weight: number) {
  let px = start;
  while (px > min && width(pen, value, px, weight) > maxW) px -= 2;
  return px;
}

// 남색 칩(흰 글자). 돌려준 값은 칩 아래 끝.
function chip(pen: Pen, label: string, x: number, y: number, px: number) {
  const padX = Math.round(px * 0.5);
  const h = Math.round(px * 1.6);
  const w = width(pen, label, px, 800) + padX * 2;
  rect(pen, x, y, w, h, { fill: C.navy });
  text(pen, label, x + padX, y + (h - px * 1.2) / 2, { px, weight: 800, color: C.paper, lh: 1.2 });
  return y + h;
}

// 상담 칸: 왼쪽 전화(크게), 오른쪽 카카오톡·홈페이지(작게, 오른쪽 정렬).
function callBox(pen: Pen, phone: string, sub: string[], top: number, s: number) {
  const innerX = PAD + 28;
  const subPx = Math.round(26 * s);
  const subW = Math.max(0, ...sub.map((line) => width(pen, line, subPx)));
  const phonePx = fitPx(pen, phone, Math.round(50 * s), Math.round(36 * s), MAXW - 56 - subW - 24, 900);
  const subH = sub.length * subPx * 1.4;
  const h = Math.max(phonePx * 1.2, subH) + 36;
  rect(pen, PAD, top, MAXW, h, { stroke: C.navy, lw: 2 });
  text(pen, phone, innerX, top + (h - phonePx * 1.2) / 2, { px: phonePx, weight: 900, color: C.navy, lh: 1.2, maxW: MAXW - 56 });
  let y = top + (h - subH) / 2;
  for (const line of sub) y = text(pen, line, W - PAD - 28, y, { px: subPx, color: C.soft, align: "right", lh: 1.4, maxW: subW + 1 });
  return top + h;
}

// 명시 항목 표: 한 줄 항목은 두 칸에 나눠 싣고, 소재지·관리비·주차는 한 줄을 다 쓴다.
function table(pen: Pen, rows: ListingSheet["rows"], top: number, s: number) {
  const px = Math.round(28 * s);
  const labelW = Math.round(160 * s);
  const gap = 40;
  const halfW = (MAXW - gap) / 2;
  const pad = Math.round(9 * s);
  if (pen.draw) { pen.ctx.fillStyle = C.navy; pen.ctx.fillRect(PAD, top, MAXW, 3); }
  let y = top + 3;
  const cell = (row: ListingSheet["rows"][number], x: number, w: number, at: number) => {
    const end = text(pen, row.value, x + labelW, at + pad, { px, weight: 600, maxW: w - labelW, lh: 1.3 });
    text(pen, row.label, x, at + pad, { px, weight: 700, color: C.soft, maxW: labelW - 8, lh: 1.3 });
    return end + pad;
  };
  const queue = [...rows];
  while (queue.length > 0) {
    const row = queue.shift()!;
    if (WIDE.has(row.key)) {
      y = cell(row, PAD, MAXW, y);
    } else {
      const partnerAt = queue.findIndex((next) => !WIDE.has(next.key));
      const partner = partnerAt >= 0 ? queue.splice(partnerAt, 1)[0] : null;
      const left = cell(row, PAD, halfW, y);
      const right = partner ? cell(partner, PAD + halfW + gap, halfW, y) : y;
      if (pen.draw) {
        pen.ctx.fillStyle = C.edge;
        pen.ctx.fillRect(PAD, Math.max(left, right), halfW, 1);
        if (partner) pen.ctx.fillRect(PAD + halfW + gap, Math.max(left, right), halfW, 1);
      }
      y = Math.max(left, right);
      continue;
    }
    if (pen.draw) { pen.ctx.fillStyle = C.edge; pen.ctx.fillRect(PAD, y, MAXW, 1); }
  }
  return y;
}

function sheetBody(pen: Pen, logo: Logo, sheet: ListingSheet, s: number) {
  let y = header(pen, logo, sheet.title) + Math.round(30 * s) + pen.dy;
  y = chip(pen, sheet.chip, PAD, y, Math.round(32 * s)) + Math.round(12 * s);
  const namePx = fitPx(pen, sheet.name, Math.round(72 * s), Math.round(52 * s), MAXW, 900);
  y = text(pen, sheet.name, PAD, y, { px: namePx, weight: 900, color: C.navy, lh: 1.15 });
  const pricePx = fitPx(pen, sheet.price, Math.round(96 * s), Math.round(52 * s), MAXW, 900);
  y = text(pen, sheet.price, PAD, y + Math.round(4 * s), { px: pricePx, weight: 900, lh: 1.15 });
  if (sheet.boxes.length > 0) {
    y += Math.round(18 * s);
    const gap = 16;
    const boxW = (MAXW - gap * (sheet.boxes.length - 1)) / sheet.boxes.length;
    const inner = boxW - 40;
    const labelPx = Math.round(26 * s);
    const valuePx = Math.min(...sheet.boxes.map(([, value]) => fitPx(pen, value, Math.round(40 * s), Math.round(28 * s), inner, 800)));
    const measure = (draw: boolean) => {
      const was = pen.draw;
      pen.draw = draw;
      let bottom = y;
      sheet.boxes.forEach(([label, value], index) => {
        const x = PAD + index * (boxW + gap) + 20;
        let at = text(pen, label, x, y + 14, { px: labelPx, weight: 700, color: C.soft, maxW: inner, lh: 1.3 });
        at = text(pen, value, x, at + 2, { px: valuePx, weight: 800, maxW: inner, lh: 1.25 });
        bottom = Math.max(bottom, at + 14);
      });
      pen.draw = was;
      return bottom;
    };
    const bottom = measure(false);
    sheet.boxes.forEach((_, index) => rect(pen, PAD + index * (boxW + gap), y, boxW, bottom - y, { stroke: C.edge, lw: 2 }));
    measure(pen.draw);
    y = bottom;
  }
  if (sheet.summary) y = text(pen, `“${sheet.summary}”`, PAD, y + Math.round(16 * s), { px: Math.round(30 * s), lh: 1.4 });
  y = table(pen, sheet.rows, y + Math.round(18 * s), s);
  y = text(pen, sheet.caption, PAD, y + Math.round(10 * s), { px: Math.round(23 * s), color: C.soft, lh: 1.4 });
  return callBox(pen, sheet.phone, sheet.sub, y + Math.round(18 * s), s);
}

function compareBody(pen: Pen, logo: Logo, sheet: CompareSheet, s: number) {
  let y = header(pen, logo, sheet.title) + Math.round(26 * s) + pen.dy;
  const headPx = fitPx(pen, sheet.heading, Math.round(58 * s), Math.round(44 * s), MAXW, 900);
  y = text(pen, sheet.heading, PAD, y, { px: headPx, weight: 900, color: C.navy, lh: 1.2 });
  y = text(pen, sheet.sub, PAD, y + 4, { px: Math.round(24 * s), color: C.soft, lh: 1.4 });
  y += Math.round(18 * s);
  const n = sheet.columns.length;
  const labelW = Math.round(150 * s);
  const colW = (MAXW - labelW) / n;
  const cellPad = 10;
  const inner = colW - cellPad * 2;
  // 머리 칸: 번호 네모 + 이름
  const badge = Math.round(40 * s);
  const namePx = Math.round(30 * s);
  let headBottom = y;
  sheet.columns.forEach((column, index) => {
    const x = labelW + PAD + index * colW + cellPad;
    rect(pen, x, y, badge, badge, { fill: C.navy });
    text(pen, column.no, x + badge / 2, y + (badge - badge * 0.6 * 1.2) / 2, { px: Math.round(badge * 0.6), weight: 800, color: C.paper, align: "center", lh: 1.2, maxW: badge });
    headBottom = Math.max(headBottom, text(pen, column.name, x, y + badge + 6, { px: namePx, weight: 900, color: C.navy, maxW: inner, lh: 1.2 }));
  });
  y = headBottom + 10;
  if (pen.draw) { pen.ctx.fillStyle = C.navy; pen.ctx.fillRect(PAD, y, MAXW, 3); }
  y += 3;
  for (const row of sheet.rows) {
    const isPrice = row.key === "price";
    const px = isPrice ? Math.round(36 * s) : Math.round(25 * s);
    const weight = isPrice ? 900 : 400;
    const top = y + Math.round(8 * s);
    let bottom = text(pen, row.label, PAD, top, { px: Math.round(24 * s), weight: 700, color: C.soft, maxW: labelW - 8, lh: 1.3 });
    row.values.forEach((value, index) => {
      const valuePx = isPrice ? fitPx(pen, value, px, Math.round(26 * s), inner, weight) : px;
      bottom = Math.max(bottom, text(pen, value, labelW + PAD + index * colW + cellPad, top, { px: valuePx, weight, maxW: inner, lh: 1.28 }));
    });
    y = bottom + Math.round(8 * s);
    if (pen.draw) { pen.ctx.fillStyle = C.edge; pen.ctx.fillRect(PAD, y, MAXW, 1); }
    y += 1;
  }
  return y;
}

// 비교표 상담 줄: 왼쪽 전화(크게), 오른쪽 카카오톡·홈페이지(한 줄씩 오른쪽 정렬). 아래 칸 바로 위에 붙이고 위 끝을 돌려준다.
function compareCall(pen: Pen, sheet: CompareSheet, footTop: number) {
  const px = 40;
  const subPx = 26;
  const subLh = 1.3;
  const subH = sheet.phoneSub.length * subPx * subLh;
  const h = Math.max(px * 1.2, subH);
  const top = footTop - 28 - h;
  const subW = MAXW - width(pen, sheet.phone, px, 900) - 24;
  text(pen, sheet.phone, PAD, top + (h - px * 1.2) / 2, { px, weight: 900, color: C.navy, lh: 1.2 });
  let y = top + (h - subH) / 2;
  for (const line of sheet.phoneSub) y = text(pen, line, W - PAD, y, { px: subPx, color: C.soft, align: "right", lh: subLh, maxW: subW });
  return top;
}

async function prepare(canvas: HTMLCanvasElement) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const [logo] = await Promise.all([loadLogo(), document.fonts?.ready]);
  return { ctx, logo };
}

function paint(ctx: CanvasRenderingContext2D) {
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
}

// 매물 1건: 아래 칸 위로 본문이 넘치면 본문 글자를 5%씩 줄인다(80%까지). 그래도 넘치면 overflow로 알린다. 남는 세로 공간은 절반만큼 본문을 내린다(최대 60px).
export async function renderListingCard(canvas: HTMLCanvasElement, sheet: ListingSheet): Promise<ListingCardResult> {
  const { ctx, logo } = await prepare(canvas);
  const probe: Pen = { ctx, draw: false, minPx: 999, dy: 0, pad: PAD, maxW: MAXW };
  const footTop = footer(probe, sheet.disclosure);
  let scale = 1;
  let bottom = 0;
  for (const s of [1, 0.95, 0.9, 0.85, 0.8]) {
    scale = s;
    bottom = sheetBody(probe, logo, sheet, s);
    if (bottom <= footTop - 24) break;
  }
  const dy = Math.max(0, Math.min(60, (footTop - 24 - bottom) / 2));
  paint(ctx);
  const pen: Pen = { ctx, draw: true, minPx: 999, dy, pad: PAD, maxW: MAXW };
  bottom = sheetBody(pen, logo, sheet, scale);
  footer(pen, sheet.disclosure);
  return { dataUrl: canvas.toDataURL("image/png"), overflow: bottom > footTop - 24, minBodyPx: pen.minPx };
}

// 비교 2 ~ 3건: 표가 상담 줄 위로 넘치면 같은 방식으로 줄인다.
export async function renderCompareCard(canvas: HTMLCanvasElement, sheet: CompareSheet): Promise<ListingCardResult> {
  const { ctx, logo } = await prepare(canvas);
  const probe: Pen = { ctx, draw: false, minPx: 999, dy: 0, pad: PAD, maxW: MAXW };
  const footTop = footer(probe, sheet.disclosure);
  const callTop = compareCall(probe, sheet, footTop);
  let scale = 1;
  let bottom = 0;
  for (const s of [1, 0.95, 0.9, 0.85, 0.8]) {
    scale = s;
    bottom = compareBody(probe, logo, sheet, s);
    if (bottom <= callTop - 20) break;
  }
  const dy = Math.max(0, Math.min(40, (callTop - 20 - bottom) / 2));
  paint(ctx);
  const pen: Pen = { ctx, draw: true, minPx: 999, dy, pad: PAD, maxW: MAXW };
  bottom = compareBody(pen, logo, sheet, scale);
  compareCall(pen, sheet, footTop);
  footer(pen, sheet.disclosure);
  return { dataUrl: canvas.toDataURL("image/png"), overflow: bottom > callTop - 20, minBodyPx: pen.minPx };
}

