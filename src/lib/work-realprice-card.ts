// 실거래가 홍보물 카드 그림(P1-e, 2026-11-20 운영자 승인 A안). canvas 1080×1350에 그리고 toDataURL('image/png')로 내려받는다(설계서 22.10절).
// 그림 자료는 src/lib/work/realprice-promo.mjs의 promoCards()가 만들고, 이 파일은 그리기만 한다(서버 요청·브라우저 저장 없음).
// 색은 DESIGN.md 그대로: 흰 종이, 남색 제목, 회색 테두리, 아래 칸 옅은 회색. 신고가는 색이 아니라 "▲ 신고가" 글자로 알린다.
import { PROMO_CARD_SIZE } from "./work/realprice-promo.mjs";
import { sparkGeometry } from "./work/realprice-insight-view.mjs";
// 줄 나누기·글·네모·가로줄·로고 자르기는 업무 카드 공통 파일(보드 45번 C)에서 가져온다.
import { CARD_COLORS, font, hline, loadLogo, rect, text, width, type Logo, type Pen } from "./work-card-draw";

type Price = { main: string; monthly: string | null };
type Flow = {
  series: { ym: string; medianWon: number | null }[];
  chart: boolean;
  maxWon: number | null;
  prevYm: string | null;
  prevLine: string;
  stats: { label: string; value: string }[];
  strip: string;
  sub: string[];
};
type CardItem = { name: string; dong: string; kind: string; high: boolean; price: Price; priceText: string; area: string; floor: string; date: string; prev: string; flow?: Flow | null };
export type PromoCard = {
  title: string;
  allHigh: boolean;
  areaLabel: string;
  range: string;
  items: CardItem[];
  source: string;
  received: string;
  highRule: string;
  basis: string;
  disclosure: string[];
};

const W = PROMO_CARD_SIZE.width;
const H = PROMO_CARD_SIZE.height;
const PAD = 72;
const MAXW = W - PAD * 2;
const C = CARD_COLORS;
const FOOT_PX = 30;
const HIGH_LABEL = "▲ 신고가";

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


// 거래 흐름(보드 63번) 흐름선: 거래 있는 달만 잇고, 끝점은 남색 점, 직전 거래 달은 빈 점, maxLine이면 앞선 최고 금액 높이에 점선.
function spark(pen: Pen, flow: Flow, x: number, y: number, w: number, h: number, { maxLine = false, lw = 3, r = 6 } = {}) {
  const geo = sparkGeometry(flow.series, { width: w, height: h, padX: r + 2, padTop: maxLine ? 40 : r + 2, padBottom: r + 2, maxWon: maxLine ? flow.maxWon : null, prevYm: flow.prevYm });
  if (!geo || !pen.draw) return y + h;
  const { ctx } = pen;
  ctx.save();
  ctx.translate(x, y);
  const area = new Path2D(geo.area);
  ctx.fillStyle = "rgba(19, 42, 62, 0.09)";
  ctx.fill(area);
  ctx.strokeStyle = C.navy;
  ctx.lineWidth = lw;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(new Path2D(geo.line));
  if (maxLine && geo.maxY !== null) {
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = C.soft;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r + 2, geo.maxY);
    ctx.lineTo(w - r - 2, geo.maxY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = font(28);
    ctx.fillStyle = C.soft;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("앞선 최고", r + 2, geo.maxY - 10);
    pen.minPx = Math.min(pen.minPx, 28);
  }
  if (geo.prev) {
    ctx.beginPath();
    ctx.arc(geo.prev.x, geo.prev.y, r * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = C.paper;
    ctx.fill();
    ctx.strokeStyle = C.soft;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(geo.end.x, geo.end.y, r, 0, Math.PI * 2);
  ctx.fillStyle = C.navy;
  ctx.fill();
  ctx.strokeStyle = C.paper;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
  return y + h;
}

// 칸 n개(앞선 최고·최고가 대비·최근 3개월 가운데 값이 있는 것만)
function statCells(pen: Pen, stats: Flow["stats"], y: number, s: number) {
  const h = Math.round(120 * s);
  const w = MAXW / stats.length;
  rect(pen, PAD, y, MAXW, h, { fill: C.paper2, stroke: C.edge });
  stats.forEach(({ label, value }, index) => {
    const x = PAD + w * index + 22;
    if (index && pen.draw) { pen.ctx.fillStyle = C.edge; pen.ctx.fillRect(PAD + w * index, y + 2, 2, h - 4); }
    text(pen, label, x, y + 14 * s, { px: Math.round(30 * s), color: C.soft, maxW: w - 32 });
    text(pen, value, x, y + 56 * s, { px: Math.round(40 * s), weight: 800, maxW: w - 32 });
  });
  return y + h;
}

// 1건 + 거래 흐름(2026-11-20 운영자 "권하는 조합" A안): 이름 → 동·준공·세대 → 금액 → 면적·층·계약일 → 직전 → 흐름선 → 칸 → 기준 줄.
function oneTradeFlow(pen: Pen, logo: Logo, card: PromoCard, s: number, flow: Flow) {
  const item = card.items[0];
  let y = header(pen, logo, card, s) + 28 * s + pen.dy;
  if (item.high) {
    const tag = highTag(pen, PAD, y, Math.round(32 * s));
    text(pen, item.kind, PAD + tag.w + 20, y + tag.h / 2 - 32 * s * 0.675, { px: Math.round(32 * s), weight: 700, color: C.navy });
    y += tag.h + 12 * s;
  } else {
    y = text(pen, item.kind, PAD, y, { px: Math.round(34 * s), weight: 700, color: C.navy }) + 4 * s;
  }
  y = text(pen, item.name, PAD, y, { px: namePx(pen, item.name, 78, s), weight: 800, color: C.navy, lh: 1.12 });
  y = text(pen, [item.dong, ...flow.sub].join(" · "), PAD, y + 2, { px: Math.round(34 * s), color: C.soft }) + 6 * s;
  y = priceBlock(pen, item, PAD, y, Math.round(104 * s)) + 2 * s;
  y = text(pen, `전용 ${item.area} · ${item.floor} · ${item.date} 계약`, PAD, y, { px: Math.round(36 * s), weight: 700 });
  if (flow.prevLine) y = text(pen, `○ ${flow.prevLine}`, PAD, y + 2, { px: Math.round(32 * s), color: C.soft });
  if (flow.chart) y = spark(pen, flow, PAD, y + 6 * s, MAXW, Math.round(130 * s), { maxLine: flow.maxWon !== null }) + 10 * s;
  else y += 14 * s;
  y = statCells(pen, flow.stats, y, s);
  if (card.basis) y = text(pen, card.basis, PAD, y + 8 * s, { px: Math.round(30 * s), color: C.soft });
  return y;
}

// 여러 건 + 거래 흐름(A안): 번호 + 단지 이름, 한 줄 설명, 오른쪽 금액(신고가는 ▲)·작은 흐름선, 아래 회색 줄(직전·최고가 대비·3개월).
function manyTradesFlow(pen: Pen, logo: Logo, card: PromoCard, s: number) {
  let y = header(pen, logo, card, s) + 24 * s;
  y = text(pen, card.title, PAD, y, { px: Math.round(64 * s), weight: 800, color: C.navy, lh: 1.15 });
  y = text(pen, card.range, PAD, y + 2, { px: Math.round(30 * s), color: C.soft });
  if (card.basis) y = text(pen, card.basis, PAD, y, { px: Math.round(30 * s), color: C.soft });
  y += 10 * s;
  const padY = Math.round(14 * s);
  const namePxN = Math.round(44 * s), linePx = Math.round(30 * s), pricePx = Math.round(54 * s);
  const sparkW = Math.round(200 * s), sparkH = Math.round(44 * s);
  card.items.forEach((item, index) => {
    hline(pen, y, index ? C.rule : C.navy, index ? 2 : 3);
    const top = y + padY;
    // 오른쪽 위: 금액(월세는 두 줄), 신고가는 금액 왼쪽에 ▲ 신고가 표.
    const priceW = Math.max(width(pen, item.price.main, item.price.monthly ? Math.round(pricePx * 0.82) : pricePx, 800), item.price.monthly ? width(pen, item.price.monthly, Math.round(pricePx * 0.55), 800) : 0);
    const ry = priceBlock(pen, item, W - PAD, top, pricePx, { align: "right", maxW: priceW + 4 });
    let tagW = 0;
    if (!card.allHigh && item.high) tagW = highTag(pen, W - PAD - priceW - 16 - (width(pen, HIGH_LABEL, linePx, 700) + linePx * 1.1), top + 8 * s, linePx).w + 16;
    // 왼쪽 위: 번호 + 단지 이름(금액·표 자리를 뺀 폭)
    const boxW = Math.round(44 * s);
    rect(pen, PAD, top + 6 * s, boxW, boxW, { fill: C.navy });
    if (pen.draw) {
      pen.ctx.font = font(Math.round(30 * s), 800);
      pen.ctx.fillStyle = C.paper;
      pen.ctx.textAlign = "center";
      pen.ctx.textBaseline = "middle";
      pen.ctx.fillText(String(index + 1), PAD + boxW / 2, top + 6 * s + boxW / 2 + 1);
    }
    const ly = text(pen, item.name, PAD + boxW + 14, top, { px: namePxN, weight: 800, color: C.navy, maxW: MAXW - boxW - 14 - priceW - tagW - 24, lh: 1.25 });
    // 둘째 줄: 왼쪽 설명, 오른쪽 작은 흐름선(흐름이 없으면 높은 거래만 앞선 최고 금액)
    let y2 = Math.max(ly, ry) + 2;
    const metaW = item.flow?.chart ? MAXW - sparkW - 24 : MAXW;
    const my = text(pen, `${item.dong} · ${item.kind} · 전용 ${item.area} · ${item.floor} · ${item.date} 계약`, PAD, y2, { px: linePx, maxW: metaW });
    let sy = y2;
    if (item.flow?.chart) sy = spark(pen, item.flow, W - PAD - sparkW, y2 - 4 * s, sparkW, sparkH, { lw: 3, r: 5 });
    else if (!item.flow && item.high) sy = text(pen, `앞선 최고 ${item.prev}`, W - PAD, my, { px: linePx, color: C.soft, align: "right", maxW: MAXW });
    y2 = Math.max(my, sy) + 6 * s;
    if (item.flow) {
      const stripH = Math.round(linePx * 1.35 + 14 * s);
      rect(pen, PAD, y2, MAXW, stripH, { fill: C.paper2 });
      text(pen, item.flow.strip, PAD + 14, y2 + 7 * s, { px: linePx, maxW: MAXW - 28 });
      y2 += stripH;
    }
    y = y2 + padY;
  });
  hline(pen, y, C.rule, 2);
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
  // 거래 흐름을 받은 거래가 있으면 A안 모양, 없으면 지금 모양(날개대장 조건 4).
  const first = card.items[0]?.flow ?? null;
  const layout = card.items.length === 1
    ? (first ? (pen: Pen, l: Logo, c: PromoCard, s: number) => oneTradeFlow(pen, l, c, s, first) : oneTrade)
    : (card.items.some((item) => item.flow) ? manyTradesFlow : manyTrades);
  const probe: Pen = { ctx, draw: false, minPx: 999, dy: 0, pad: PAD, maxW: MAXW };
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
  const pen: Pen = { ctx, draw: true, minPx: 999, dy, pad: PAD, maxW: MAXW };
  bottom = layout(pen, logo, card, scale);
  footer(pen, card);
  return { dataUrl: canvas.toDataURL("image/png"), overflow: bottom > footTop - 24, minBodyPx: pen.minPx };
}
