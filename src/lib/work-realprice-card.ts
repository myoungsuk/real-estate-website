// 실거래가 홍보물 카드 그림(P1-e, 2026-11-20 운영자 승인 A안). canvas 1080×1350에 그리고 toDataURL('image/png')로 내려받는다(설계서 22.10절).
// 그림 자료는 src/lib/work/realprice-promo.mjs의 promoCards()가 만들고, 이 파일은 그리기만 한다(서버 요청·브라우저 저장 없음).
// 색은 DESIGN.md 그대로: 흰 종이, 남색 제목, 회색 테두리, 아래 칸 옅은 회색. 신고가는 색이 아니라 "▲ 신고가" 글자로 알린다.
import { PROMO_CARD_SIZE } from "./work/realprice-promo.mjs";

type Price = { main: string; monthly: string | null };
type CardItem = { name: string; dong: string; kind: string; high: boolean; price: Price; priceText: string; area: string; floor: string; date: string; prev: string };
export type PromoCard = {
  title: string;
  allHigh: boolean;
  areaLabel: string;
  range: string;
  items: CardItem[];
  source: string;
  received: string;
  highRule: string;
  disclosure: string[];
};
type Pen = { ctx: CanvasRenderingContext2D; draw: boolean; minPx: number; dy: number };
type Logo = { image: HTMLCanvasElement; x: number; y: number; w: number; h: number };

const W = PROMO_CARD_SIZE.width;
const H = PROMO_CARD_SIZE.height;
const PAD = 72;
const MAXW = W - PAD * 2;
const C = { paper: "#FFFFFF", edge: "#E1E4E8", ink: "#141414", navy: "#132A3E", soft: "#46494F", paper2: "#F1F3F5", rule: "#D5D9DE" };
const FONT = 'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const FOOT_PX = 30;
const HIGH_LABEL = "▲ 신고가";
const LOGO_SRC = "/images/brand/leaders-city-happy-logo.webp";
const font = (px: number, weight = 400) => `${weight} ${px}px ${FONT}`;

// 줄 나누기: 띄어쓰기에서 나누고(낱말 안에서 끊지 않음), 한 낱말이 칸보다 길면 글자 단위로 나눈다.
function wrap(ctx: CanvasRenderingContext2D, value: string, maxW: number) {
  const lines: string[] = [];
  let current = "";
  for (const word of value.split(" ")) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxW) { current = next; continue; }
    if (current) lines.push(current);
    if (ctx.measureText(word).width <= maxW) { current = word; continue; }
    let part = "";
    for (const ch of word) {
      if (ctx.measureText(part + ch).width > maxW) { lines.push(part); part = ch; } else part += ch;
    }
    current = part;
  }
  if (current) lines.push(current);
  return lines;
}

type TextOptions = { px: number; weight?: number; color?: string; align?: CanvasTextAlign; maxW?: number; lh?: number };
// 글 한 덩이를 (x, y) 위에서부터 쓰고 다음 y를 돌려준다. pen.draw가 false면 재기만 한다.
function text(pen: Pen, value: string, x: number, y: number, { px, weight = 400, color = C.ink, align = "left", maxW = MAXW, lh = 1.35 }: TextOptions) {
  const { ctx } = pen;
  ctx.font = font(px, weight);
  const lines = wrap(ctx, value, maxW);
  if (pen.draw) {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    lines.forEach((line, index) => ctx.fillText(line, x, y + px * lh * (index + 0.5)));
  }
  pen.minPx = Math.min(pen.minPx, px);
  return y + lines.length * px * lh;
}
const width = (pen: Pen, value: string, px: number, weight = 400) => { pen.ctx.font = font(px, weight); return pen.ctx.measureText(value).width; };
function rect(pen: Pen, x: number, y: number, w: number, h: number, { fill = "", stroke = "", lw = 2 } = {}) {
  if (!pen.draw) return;
  const { ctx } = pen;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, 2); else ctx.rect(x, y, w, h);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
function hline(pen: Pen, y: number, color = C.edge, lw = 2) {
  if (!pen.draw) return;
  pen.ctx.fillStyle = color;
  pen.ctx.fillRect(PAD, y - lw / 2, MAXW, lw);
}
function highTag(pen: Pen, x: number, y: number, px: number) {
  const padX = Math.round(px * 0.55);
  const h = Math.round(px * 1.6);
  const w = width(pen, HIGH_LABEL, px, 700) + padX * 2;
  rect(pen, x, y, w, h, { fill: C.navy });
  if (pen.draw) {
    const { ctx } = pen;
    ctx.font = font(px, 700);
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(HIGH_LABEL, x + padX, y + h / 2 + 1);
  }
  pen.minPx = Math.min(pen.minPx, px);
  return { w, h };
}

// 공식 로고: 흰 여백을 잘라 쓰고, 거의 흰 바탕(240 이상)은 종이 흰색으로 맞춘다(흰 카드 위에 옅은 네모가 보이지 않게). 같은 출처 파일이라 canvas가 오염되지 않는다.
let logoPromise: Promise<Logo> | null = null;
function loadLogo() {
  logoPromise ??= new Promise<Logo>((resolve, reject) => {
    const image = new Image();
    image.onerror = () => { logoPromise = null; reject(new Error("logo")); };
    image.onload = () => {
      const off = document.createElement("canvas");
      off.width = image.naturalWidth;
      off.height = image.naturalHeight;
      const ctx = off.getContext("2d");
      if (!ctx) { reject(new Error("canvas")); return; }
      ctx.drawImage(image, 0, 0);
      const all = ctx.getImageData(0, 0, off.width, off.height);
      const data = all.data;
      let x0 = off.width, y0 = off.height, x1 = 0, y1 = 0;
      for (let y = 0; y < off.height; y += 1) {
        for (let x = 0; x < off.width; x += 1) {
          const at = (y * off.width + x) * 4;
          if (data[at] < 235 || data[at + 1] < 235 || data[at + 2] < 235) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      for (let at = 0; at < data.length; at += 4) {
        if (data[at] >= 240 && data[at + 1] >= 240 && data[at + 2] >= 240) { data[at] = 255; data[at + 1] = 255; data[at + 2] = 255; }
      }
      ctx.putImageData(all, 0, 0);
      if (x1 < x0) { x0 = 0; y0 = 0; x1 = off.width - 1; y1 = off.height - 1; }
      resolve({ image: off, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    };
    image.src = LOGO_SRC;
  });
  return logoPromise;
}

// 아래 칸: 출처·받은 시각과 안내, 신고가가 있는 장만 판정 기준, 사무소 명시사항 5항목.
function footer(pen: Pen, card: PromoCard) {
  const body = (y0: number) => {
    let y = y0 + 34;
    y = text(pen, card.source, PAD, y, { px: FOOT_PX, color: C.soft });
    y = text(pen, card.received, PAD, y, { px: FOOT_PX, color: C.soft });
    if (card.highRule) y = text(pen, card.highRule, PAD, y, { px: FOOT_PX, color: C.soft });
    y += 14;
    hline(pen, y, C.rule, 2);
    y += 14;
    y = text(pen, card.disclosure[0], PAD, y, { px: FOOT_PX, weight: 700 });
    for (const line of card.disclosure.slice(1)) y = text(pen, line, PAD, y, { px: FOOT_PX });
    return y + 34;
  };
  const was = pen.draw;
  pen.draw = false;
  const h = body(0);
  pen.draw = was;
  const top = H - h;
  rect(pen, 0, top, W, H - top, { fill: C.paper2 });
  if (pen.draw) { pen.ctx.fillStyle = C.edge; pen.ctx.fillRect(0, top, W, 2); }
  body(top);
  return top;
}

// 머리 줄: 로고 + "대전 동구 아파트 실거래가"
function header(pen: Pen, logo: Logo, card: PromoCard, s: number) {
  const y = 56;
  const logoH = Math.round(104 * s);
  if (pen.draw) pen.ctx.drawImage(logo.image, logo.x, logo.y, logo.w, logo.h, PAD, y, Math.round(logoH * logo.w / logo.h), logoH);
  const px = Math.round(34 * s);
  text(pen, card.areaLabel, W - PAD, y + logoH / 2 - px * 0.675, { px, weight: 700, color: C.soft, align: "right", maxW: 560 });
  const lineY = y + logoH + 26;
  hline(pen, lineY);
  return lineY;
}

// 금액(매매·분양권·전세는 한 줄, 월세는 보증금 / 월세 두 줄)
function priceBlock(pen: Pen, item: CardItem, x: number, y: number, px: number, { align = "left" as CanvasTextAlign, maxW = MAXW } = {}) {
  if (item.price.monthly) {
    const next = text(pen, item.price.main, x, y, { px: Math.round(px * 0.82), weight: 800, align, maxW, lh: 1.15 });
    return text(pen, item.price.monthly, x, next, { px: Math.round(px * 0.55), weight: 800, align, maxW, lh: 1.25 });
  }
  return text(pen, item.price.main, x, y, { px, weight: 800, align, maxW, lh: 1.15 });
}

// 칸 3개(전용면적·층·계약일)
function cells(pen: Pen, item: CardItem, y: number, s: number) {
  const h = Math.round(148 * s);
  const w = MAXW / 3;
  rect(pen, PAD, y, MAXW, h, { stroke: C.edge });
  ([["전용면적", item.area], ["층", item.floor], ["계약일", item.date]] as const).forEach(([label, value], index) => {
    const x = PAD + w * index + 28;
    if (index && pen.draw) { pen.ctx.fillStyle = C.edge; pen.ctx.fillRect(PAD + w * index, y + 18, 2, h - 36); }
    text(pen, label, x, y + 22 * s, { px: Math.round(30 * s), color: C.soft, maxW: w - 40 });
    text(pen, value, x, y + 70 * s, { px: Math.round(42 * s), weight: 700, maxW: w - 40 });
  });
  return y + h;
}

// 단지 이름: 한 줄에 들어갈 때까지 글자를 줄이고(최소 64px), 그래도 길면 줄을 바꾼다.
function namePx(pen: Pen, name: string, px: number, s: number) {
  let size = Math.round(px * s);
  while (size > Math.round(64 * s) && width(pen, name, size, 800) > MAXW) size -= 2;
  return size;
}

function oneTrade(pen: Pen, logo: Logo, card: PromoCard, s: number) {
  const item = card.items[0];
  let y = header(pen, logo, card, s) + 36 * s + pen.dy;
  if (item.high) {
    const tag = highTag(pen, PAD, y, Math.round(34 * s));
    text(pen, item.kind, PAD + tag.w + 20, y + tag.h / 2 - 34 * s * 0.675, { px: Math.round(34 * s), weight: 700, color: C.navy });
    y += tag.h + 22 * s;
  } else {
    y = text(pen, item.kind, PAD, y, { px: Math.round(36 * s), weight: 700, color: C.navy }) + 10 * s;
  }
  y = text(pen, item.name, PAD, y, { px: namePx(pen, item.name, 84, s), weight: 800, color: C.navy, lh: 1.15 });
  y = text(pen, item.dong, PAD, y + 4, { px: Math.round(40 * s), color: C.soft }) + 18 * s;
  y = priceBlock(pen, item, PAD, y, Math.round(124 * s)) + 22 * s;
  y = cells(pen, item, y, s) + 20 * s;
  if (item.high) y = text(pen, `같은 단지·같은 전용면적 앞선 최고 ${item.prev}`, PAD, y, { px: Math.round(34 * s), color: C.soft });
  return y;
}

// 여러 건: 왼쪽 단지·면적·층·계약일, 오른쪽 금액·앞선 최고. 모두 신고가인 한 장은 제목이 "매매 신고가 n건"이라 줄마다 표를 달지 않는다.
function manyTrades(pen: Pen, logo: Logo, card: PromoCard, s: number) {
  let y = header(pen, logo, card, s) + 30 * s;
  y = text(pen, card.title, PAD, y, { px: Math.round(66 * s), weight: 800, color: C.navy, lh: 1.15 });
  y = text(pen, card.range, PAD, y + 4, { px: Math.round(32 * s), color: C.soft }) + 22 * s;
  const rightW = Math.round(390 * s);
  const leftW = MAXW - rightW - 24;
  const pricePx = Math.round(56 * s), subPx = Math.round(28 * s), metaPx = Math.round(31 * s), padY = Math.round(22 * s);
  card.items.forEach((item, index) => {
    hline(pen, y, index ? C.edge : C.navy, index ? 2 : 3);
    const top = y + padY;
    let ly = text(pen, `${item.name} ${item.dong}`, PAD, top, { px: Math.round(44 * s), weight: 800, color: C.navy, maxW: leftW, lh: 1.2 });
    ly = text(pen, `${item.kind} · 전용 ${item.area} · ${item.floor}`, PAD, ly, { px: metaPx, color: C.soft, maxW: leftW });
    ly = text(pen, `계약 ${item.date}`, PAD, ly, { px: metaPx, color: C.soft, maxW: leftW });
    let ry = top;
    if (!card.allHigh && item.high) {
      const tag = highTag(pen, W - PAD - (width(pen, HIGH_LABEL, subPx, 700) + subPx * 1.1), ry, subPx);
      ry += tag.h + 6;
    }
    ry = priceBlock(pen, item, W - PAD, ry, pricePx, { align: "right", maxW: rightW });
    if (item.high) ry = text(pen, `앞선 최고 ${item.prev}`, W - PAD, ry + 2, { px: subPx, color: C.soft, align: "right", maxW: rightW });
    y = Math.max(ly, ry) + padY;
  });
  hline(pen, y, C.edge, 2);
  return y;
}

export type CardResult = { dataUrl: string; overflow: boolean; minBodyPx: number };

// 그리기: 아래 칸 위로 본문이 넘치면 본문 글자를 5%씩 줄인다(80%까지). 그래도 넘치면 overflow로 알린다.
export async function renderPromoCard(canvas: HTMLCanvasElement, card: PromoCard): Promise<CardResult> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const [logo] = await Promise.all([loadLogo(), document.fonts?.ready]);
  const layout = card.items.length === 1 ? oneTrade : manyTrades;
  const probe: Pen = { ctx, draw: false, minPx: 999, dy: 0 };
  const footTop = footer(probe, card);
  let scale = 1;
  let bottom = 0;
  for (const s of [1, 0.95, 0.9, 0.85, 0.8]) {
    scale = s;
    bottom = layout(probe, logo, card, s);
    if (bottom <= footTop - 24) break;
  }
  // 1건 카드는 남는 세로 공간의 절반만큼 본문을 내려 위아래 여백을 맞춘다(최대 70px).
  const dy = card.items.length === 1 ? Math.max(0, Math.min(70, (footTop - 24 - bottom) / 2)) : 0;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  const pen: Pen = { ctx, draw: true, minPx: 999, dy };
  bottom = layout(pen, logo, card, scale);
  footer(pen, card);
  return { dataUrl: canvas.toDataURL("image/png"), overflow: bottom > footTop - 24, minBodyPx: pen.minPx };
}
