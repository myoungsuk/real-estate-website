// 실거래가 홍보물 카드 그림(P1-e, 2026-11-24 사용자 답으로 새 모양: 4모양·4건까지 한 장·출처 상자 뺌·상호 크게·흐름 줄 그대로).
// canvas 1080×1350에 그리고 toDataURL('image/png')로 내려받는다(설계서 22.10절). 그림 자료는 src/lib/work/realprice-promo.mjs의
// promoCards()가 만들고, 이 파일은 그리기만 한다(서버 요청·브라우저 저장 없음). 신고가는 색만이 아니라 "▲ 신고가" 글자로 알린다.
// 모양: 기본(흰 바탕·남색 줄) · 깔끔 카드(회색 바탕에 흰 둥근 칸) · 잡지(위 띠가 로고 산호색) · 다크(남색 바탕·밝은 산호색 금액).
import { PROMO_CARD_SIZE, priceSplit } from "./work/realprice-promo.mjs";
import { sparkGeometry } from "./work/realprice-insight-view.mjs";
// 줄 나누기·글·가로줄·로고 자르기는 업무 카드 공통 파일(보드 45번 C)에서 가져온다.
import { CARD_COLORS, font, hline, loadLogo, text, width, type Logo, type Pen } from "./work-card-draw";

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
type CardItem = { name: string; dong: string; kind: string; high: boolean; presale: boolean; up: string; price: Price; priceText: string; area: string; floor: string; date: string; prev: string; flow?: Flow | null };
type Office = { name: string; representative: string; address: string; mobile: string; registrationNumber: string };
export type PromoStyle = "basic" | "clean" | "magazine" | "dark";
export type PromoCard = {
  title: string;
  allHigh: boolean;
  areaLabel: string;
  range: string;
  items: CardItem[];
  basis: string;
  style: PromoStyle;
  office: Office;
};

const W = PROMO_CARD_SIZE.width;
const H = PROMO_CARD_SIZE.height;
const PAD = 76;
const TOP = 68;
const BOTTOM = 56;
const MAXW = W - PAD * 2;
const C = CARD_COLORS;
const HIGH_LABEL = "▲ 신고가";
const PRESALE_LABEL = "분양권";
const CORAL = "#F06951"; // 로고의 산호색

type Theme = {
  bg: string; ink: string; soft: string; edge: string; strip: string; price: string;
  high: string; highInk: string; up: string; pre: string; preInk: string;
  chip: string | null; chipInk: string; spark: string; sparkArea: string; rule: string | null;
  panel: string | null; band: string | null; markPlate: boolean;
};
const BASE: Theme = {
  bg: C.paper, ink: C.ink, soft: C.soft, edge: C.edge, strip: C.paper2, price: C.navy,
  high: "#B3261E", highInk: "#FFFFFF", up: "#B3261E", pre: "#E4EBF3", preInk: C.navy,
  chip: C.navy, chipInk: "#FFFFFF", spark: C.navy, sparkArea: "rgba(19, 42, 62, 0.09)", rule: C.navy,
  panel: null, band: null, markPlate: false,
};
export const PROMO_THEMES: Record<PromoStyle, Theme> = {
  basic: BASE,
  clean: { ...BASE, bg: "#EEF1F4", edge: "#E3E7EB", strip: "#F3F5F7", chip: null, chipInk: C.navy, rule: null, panel: "#FFFFFF" },
  magazine: { ...BASE, chip: C.ink, rule: null, band: CORAL },
  dark: {
    ...BASE, bg: C.navy, ink: "#FFFFFF", soft: "#B7C3CF", edge: "rgba(255, 255, 255, 0.16)", strip: "rgba(255, 255, 255, 0.08)", price: "#FFB49F",
    high: "#FF8A73", highInk: "#1A0A06", up: "#FF9A85", pre: "rgba(255, 255, 255, 0.16)", preInk: "#E8EEF4",
    chip: "#FFB49F", chipInk: "#1A0A06", spark: "#FFB49F", sparkArea: "rgba(255, 180, 159, 0.18)", rule: "rgba(255, 255, 255, 0.5)", markPlate: true,
  },
};

// 둥근 네모(공통 rect는 모서리 2px 고정이라 이 카드에서만 따로 둔다. 거래 완료 알림·매물 안내지 카드는 그대로).
function box(pen: Pen, x: number, y: number, w: number, h: number, r: number, fill: string) {
  if (!pen.draw) return;
  const { ctx } = pen;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fill();
}

// 한 줄 글(오른쪽 맞춤 가능). 칸보다 길면 글자를 85%까지 줄이고, 그래도 길면 끝을 "…"로 줄인다. 쓴 폭을 돌려준다.
// 말줄임한 글 수(배율 고르기에서 키운 배율이 글을 더 자르는지 볼 때만 씀).
let cuts = 0;
function line(pen: Pen, value: string, x: number, y: number, px: number, { weight = 400, color = C.ink as string, align = "left" as CanvasTextAlign, maxW = MAXW } = {}) {
  const { ctx } = pen;
  let size = px;
  while (size > Math.round(px * 0.85) && width(pen, value, size, weight) > maxW) size -= 1;
  let shown = value;
  if (width(pen, shown, size, weight) > maxW) {
    cuts += 1;
    while (shown.length > 1 && width(pen, `${shown}…`, size, weight) > maxW) shown = shown.slice(0, -1);
    shown = `${shown.trimEnd()}…`;
  }
  const used = width(pen, shown, size, weight);
  if (pen.draw) {
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(shown, x, y);
  }
  pen.minPx = Math.min(pen.minPx, size);
  return used;
}

// 딱지(분양권·▲ 신고가): 글자 + 둥근 바탕. 폭을 돌려준다.
function badge(pen: Pen, label: string, x: number, midY: number, px: number, fill: string, ink: string) {
  const padX = Math.round(px * 0.5);
  const h = Math.round(px * 1.55);
  const w = width(pen, label, px, 800) + padX * 2;
  box(pen, x, midY - h / 2, w, h, Math.round(px * 0.3), fill);
  line(pen, label, x + padX, midY + 1, px, { weight: 800, color: ink, maxW: w });
  return w;
}
const badgesOf = (item: CardItem, t: Theme) => [
  ...(item.presale ? [{ label: PRESALE_LABEL, fill: t.pre, ink: t.preInk }] : []),
  ...(item.high ? [{ label: HIGH_LABEL, fill: t.high, ink: t.highInk }] : []),
];
function badgesWidth(pen: Pen, list: ReturnType<typeof badgesOf>, px: number) {
  return list.reduce((sum, b) => sum + width(pen, b.label, px, 800) + Math.round(px * 0.5) * 2 + 12, 0);
}

// 흐름선(보드 63번): 거래 있는 달만 잇고, 끝점은 진한 점, 직전 거래 달은 빈 점, maxLine이면 앞선 최고 금액 높이에 점선.
function spark(pen: Pen, t: Theme, flow: Flow, x: number, y: number, w: number, h: number, { maxLine = false, lw = 4, r = 6 } = {}) {
  const geo = sparkGeometry(flow.series, { width: w, height: h, padX: r + 2, padTop: maxLine ? 40 : r + 2, padBottom: r + 2, maxWon: maxLine ? flow.maxWon : null, prevYm: flow.prevYm });
  if (!geo || !pen.draw) return;
  const { ctx } = pen;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = t.sparkArea;
  ctx.fill(new Path2D(geo.area));
  ctx.strokeStyle = t.spark;
  ctx.lineWidth = lw;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(new Path2D(geo.line));
  if (maxLine && geo.maxY !== null) {
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = t.soft;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(r + 2, geo.maxY);
    ctx.lineTo(w - r - 2, geo.maxY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = font(28);
    ctx.fillStyle = t.soft;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText("앞선 최고", r + 2, geo.maxY - 10);
    pen.minPx = Math.min(pen.minPx, 28);
  }
  if (geo.prev) {
    ctx.beginPath();
    ctx.arc(geo.prev.x, geo.prev.y, r * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = t.bg === C.navy ? C.navy : C.paper;
    ctx.fill();
    ctx.strokeStyle = t.soft;
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(geo.end.x, geo.end.y, r, 0, Math.PI * 2);
  ctx.fillStyle = t.spark;
  ctx.fill();
  ctx.restore();
}

// 재기만 하고 그리지 않는다(아래 칸 높이·깔끔 카드 흰 칸 높이를 먼저 잴 때).
function measure<T>(pen: Pen, fn: () => T): T {
  const was = pen.draw;
  pen.draw = false;
  try { return fn(); } finally { pen.draw = was; }
}

// 머리: 칩 "대전 동구 아파트 실거래가"(받은 시각은 카드에 넣지 않고 글에만, 2026-11-24 사용자 답 "이것도 뺌") → 제목 → 계약일 범위 → 흐름 기준 줄. 잡지는 이 머리 뒤를 산호색 띠로 칠한다.
function head(pen: Pen, card: PromoCard, t: Theme, s: number) {
  const draw = () => {
    let y = TOP;
    const chipPx = Math.round(30 * s);
    const chipH = Math.round(chipPx * 1.75);
    let chipW = width(pen, card.areaLabel, chipPx, 800);
    if (t.chip) {
      chipW += 40;
      box(pen, PAD, y, chipW, chipH, 10, t.chip);
      line(pen, card.areaLabel, PAD + 20, y + chipH / 2 + 1, chipPx, { weight: 800, color: t.chipInk });
    } else {
      line(pen, card.areaLabel, PAD, y + chipH / 2 + 1, chipPx, { weight: 800, color: t.chipInk });
    }
    y += chipH + Math.round(26 * s);
    y = text(pen, card.title, PAD, y, { px: Math.round(66 * s), weight: 800, color: t.ink, lh: 1.14 });
    y = text(pen, card.range, PAD, y + 6 * s, { px: Math.round(30 * s), color: t.band ? C.ink : t.soft });
    if (card.basis) y = text(pen, card.basis, PAD, y, { px: Math.round(25 * s), color: t.band ? C.ink : t.soft });
    return y;
  };
  if (!t.band) return draw();
  const bottom = measure(pen, draw) + Math.round(34 * s);
  box(pen, 0, 0, W, bottom, 0, t.band);
  draw();
  return bottom;
}

// 금액: 큰 숫자 + 작은 단위(오른쪽 맞춤). 월세는 아래 줄에 월 임대료. 쓴 폭과 아래 끝을 돌려준다.
function price(pen: Pen, item: CardItem, t: Theme, right: number, midY: number, px: number) {
  const { num, unit } = priceSplit(item.price.main);
  const unitPx = Math.round(px * 0.54);
  const unitW = unit ? width(pen, unit, unitPx, 700) + 6 : 0;
  const numW = width(pen, num, px, 800);
  if (unit) line(pen, unit, right, midY + px * 0.12, unitPx, { weight: 700, color: t.price, align: "right", maxW: unitW });
  line(pen, num, right - unitW, midY, px, { weight: 800, color: t.price, align: "right", maxW: numW + 2 });
  let w = numW + unitW;
  let bottom = midY + px * 0.6;
  if (item.price.monthly) {
    const mPx = Math.round(px * 0.56);
    w = Math.max(w, width(pen, item.price.monthly, mPx, 800));
    line(pen, item.price.monthly, right, bottom + mPx * 0.7, mPx, { weight: 800, color: t.price, align: "right", maxW: w + 2 });
    bottom += mPx * 1.4;
  }
  return { w, bottom };
}

const metaOf = (item: CardItem) => [item.dong, item.presale ? null : item.kind, `전용 ${item.area}`, item.floor, `${item.date} 계약`].filter(Boolean).join(" · ");

// 여러 건(2 ~ 4건): 줄마다 단지 이름 + 딱지 / 오른쪽 금액 → 동·종류·면적·층·계약일 / 오른쪽 ▲ 오름 폭 → 회색 흐름 줄(흐름선·직전·최고가 대비·3개월).
function rows(pen: Pen, card: PromoCard, t: Theme, s: number, y0: number) {
  const inset = t.panel ? 36 : 0;
  const x0 = PAD + inset;
  const x1 = W - PAD - inset;
  const draw = () => {
    let y = y0 + (t.panel ? 6 : 0);
    if (t.rule) { hline(pen, y0, t.rule, 5); y += 3; }
    const padY = Math.round((card.items.length >= 4 ? 18 : 26) * s);
    const namePx = Math.round(42 * s), badgePx = Math.round(26 * s), pricePx = Math.round(50 * s), metaPx = Math.round(28 * s), stripPx = Math.round(27 * Math.min(s, 1)); // 회색 흐름 줄은 키우지 않는다(깔끔 카드 안쪽 폭에서 글 끝이 잘리지 않게)
    card.items.forEach((item, index) => {
      const top = y + padY;
      const mid = top + namePx * 0.62;
      const p = price(pen, item, t, x1, mid, pricePx);
      const marks = badgesOf(item, t);
      const marksW = badgesWidth(pen, marks, badgePx);
      const nameW = line(pen, item.name, x0, mid, namePx, { weight: 800, color: t.ink, maxW: Math.max(120, x1 - x0 - p.w - 24 - marksW) });
      let bx = x0 + nameW + 12;
      for (const b of marks) bx += badge(pen, b.label, bx, mid, badgePx, b.fill, b.ink) + 12;
      let ly = Math.max(top + namePx * 1.24, p.bottom) + metaPx * 0.2;
      const upW = item.up ? width(pen, item.up, metaPx, 800) : 0;
      line(pen, metaOf(item), x0, ly + metaPx * 0.6, metaPx, { color: t.soft, maxW: x1 - x0 - upW - (upW ? 16 : 0) });
      if (item.up) line(pen, item.up, x1, ly + metaPx * 0.6, metaPx, { weight: 800, color: t.up, align: "right", maxW: upW + 2 });
      ly += metaPx * 1.35;
      if (item.flow) {
        const h = Math.round(stripPx * 1.35 + 16 * s);
        ly += 10 * s;
        box(pen, x0, ly, x1 - x0, h, 12, t.strip);
        const sparkW = item.flow.chart ? Math.round(150 * s) : 0;
        if (sparkW) spark(pen, t, item.flow, x0 + 10, ly + 6, sparkW, h - 12, { lw: 3.5, r: 5 });
        line(pen, item.flow.strip, x0 + (sparkW ? sparkW + 28 : 20), ly + h / 2 + 1, stripPx, { color: t.ink, maxW: x1 - x0 - (sparkW ? sparkW + 48 : 40) });
        ly += h;
      }
      y = ly + padY;
      if (index < card.items.length - 1) { if (pen.draw) { pen.ctx.fillStyle = t.edge; pen.ctx.fillRect(x0, y - 1, x1 - x0, 2); } }
    });
    return y + (t.panel ? 6 : 0);
  };
  if (!t.panel) return draw();
  const bottom = measure(pen, draw);
  box(pen, PAD, y0, MAXW, bottom - y0, 34, t.panel);
  return draw();
}

// 한 건: 제목에 단지 이름이 있어 줄에서는 다시 쓰지 않는다. 딱지·설명 → 큰 금액·▲ → 직전 거래 → 큰 흐름선(앞선 최고 점선) → 칸 3개.
// grow: 아래 칸 위에 남는 자리(1배 크기일 때만)만큼 흐름선을 키워 빈 곳을 남기지 않는다.
function one(pen: Pen, card: PromoCard, t: Theme, s: number, y0: number, grow = 0) {
  const item = card.items[0];
  let y = y0;
  if (t.rule) { hline(pen, y, t.rule, 5); y += 3; }
  y += Math.round(30 * s);
  const marks = badgesOf(item, t);
  const metaPx = Math.round(32 * s);
  let x = PAD;
  for (const b of marks) x += badge(pen, b.label, x, y + metaPx * 0.7, Math.round(28 * s), b.fill, b.ink) + 14;
  line(pen, [...metaOf(item).split(" · "), ...(item.flow?.sub ?? [])].join(" · "), x, y + metaPx * 0.7, metaPx, { color: t.soft, maxW: W - PAD - x });
  y += metaPx * 1.6;
  const pricePx = Math.round(100 * s);
  const { num, unit } = priceSplit(item.price.main);
  const numW = line(pen, num, PAD, y + pricePx * 0.62, pricePx, { weight: 800, color: t.price });
  if (unit) line(pen, unit, PAD + numW + 8, y + pricePx * 0.74, Math.round(40 * s), { weight: 700, color: t.price });
  if (item.up) line(pen, item.up, W - PAD, y + pricePx * 0.74, Math.round(36 * s), { weight: 800, color: t.up, align: "right", maxW: 360 });
  y += pricePx * 1.24;
  if (item.price.monthly) y = text(pen, item.price.monthly, PAD, y, { px: Math.round(52 * s), weight: 800, color: t.price });
  const flow = item.flow;
  if (!flow) {
    if (item.high) y = text(pen, `같은 단지·같은 전용면적 앞선 최고 ${item.prev}`, PAD, y + 8 * s, { px: Math.round(32 * s), color: t.soft });
    return y;
  }
  if (flow.prevLine) y = text(pen, `○ ${flow.prevLine}`, PAD, y + 4 * s, { px: Math.round(30 * s), color: t.soft });
  if (flow.chart) {
    const h = Math.round(200 * s) + grow;
    spark(pen, t, flow, PAD, y + 14 * s, MAXW, h, { maxLine: flow.maxWon !== null, lw: 5, r: 9 });
    y += h + 26 * s;
  } else y += 16 * s;
  const cellH = Math.round(120 * s);
  const gap = 16;
  const cw = (MAXW - gap * (flow.stats.length - 1)) / flow.stats.length;
  flow.stats.forEach(({ label, value }, index) => {
    const cx = PAD + index * (cw + gap);
    box(pen, cx, y, cw, cellH, 14, t.panel ? "#FFFFFF" : t.strip);
    line(pen, label, cx + 24, y + cellH * 0.32, Math.round(27 * s), { color: t.soft, maxW: cw - 40 });
    line(pen, value, cx + 24, y + cellH * 0.68, Math.round(40 * s), { weight: 800, color: t.ink, maxW: cw - 40 });
  });
  return y + cellH;
}

// 사무소 집 모양만 쓴다: 로고에서 글자(아래 42%) 위쪽의 그림 부분 경계를 찾아 자른다. 로고 파일이 바뀌어도 위치를 다시 찾는다.
type Mark = { image: HTMLCanvasElement; x: number; y: number; w: number; h: number };
let markCache: { from: Logo; mark: Mark } | null = null;
function markOf(logo: Logo): Mark {
  if (markCache?.from === logo) return markCache.mark;
  const ctx = logo.image.getContext("2d");
  let mark: Mark = { image: logo.image, x: logo.x, y: logo.y, w: logo.w, h: logo.h };
  if (ctx) {
    const hMax = Math.round(logo.image.height * 0.58);
    const data = ctx.getImageData(0, 0, logo.image.width, hMax).data;
    let x0 = logo.image.width, y0 = hMax, x1 = -1, y1 = -1;
    for (let y = 0; y < hMax; y += 1) {
      for (let x = 0; x < logo.image.width; x += 1) {
        const at = (y * logo.image.width + x) * 4;
        if (data[at] < 200 || data[at + 1] < 200 || data[at + 2] < 200) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 > x0 && y1 > y0) mark = { image: logo.image, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  markCache = { from: logo, mark };
  return mark;
}

// 아래 칸: 집 모양 + 상호(크고 굵게) / 대표·등록번호(작게) + 연락처(크게) / 소재지(작게). 사무소 명시사항 5항목이 모두 들어간다.
// 출처 상자는 두지 않는다(2026-11-24 사용자 답 "완전히 뺌"). 본문 글자를 줄여도 아래 칸 글자는 줄이지 않는다.
function foot(pen: Pen, card: PromoCard, t: Theme, logo: Logo) {
  const o = card.office;
  const markW = 76;
  const tx = PAD + markW + 20;
  const body = (top: number) => {
    let y = top + 28;
    const nameMid = y + 42 * 0.62;
    line(pen, o.name, tx, nameMid, 42, { weight: 800, color: t.ink, maxW: W - PAD - tx });
    y += 42 * 1.3;
    const phoneW = width(pen, o.mobile, 40, 800);
    line(pen, `대표 ${o.representative} · 등록번호 ${o.registrationNumber}`, tx, y + 20, 25, { color: t.soft, maxW: W - PAD - tx - phoneW - 20 });
    line(pen, o.mobile, W - PAD, y + 20, 40, { weight: 800, color: t.ink, align: "right", maxW: phoneW + 2 });
    y += 46;
    y = text(pen, o.address, tx, y, { px: 24, color: t.soft, maxW: W - PAD - tx, lh: 1.4 });
    if (pen.draw) {
      const m = markOf(logo);
      const mh = Math.round(markW * m.h / m.w);
      const my = top + 28 + Math.max(0, (42 * 1.3 + 46 - mh) / 2) - 4;
      if (t.markPlate) box(pen, PAD - 8, my - 8, markW + 16, mh + 16, 16, "#FFFFFF");
      pen.ctx.drawImage(m.image, m.x, m.y, m.w, m.h, PAD, my, markW, mh);
    }
    return y;
  };
  const h = measure(pen, () => body(0));
  const top = H - BOTTOM - h;
  if (pen.draw) { pen.ctx.fillStyle = t.panel ? "#D7DCE1" : t.edge; pen.ctx.fillRect(PAD, top, MAXW, 2); }
  body(top);
  return top;
}

export type CardResult = { dataUrl: string; overflow: boolean; minBodyPx: number };

// 그리기: 아래 칸 위로 본문이 넘치면 본문 글자를 5%씩 줄인다(80%까지). 그래도 넘치면 overflow로 알린다.
export async function renderPromoCard(canvas: HTMLCanvasElement, card: PromoCard): Promise<CardResult> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const [logo] = await Promise.all([loadLogo(), document.fonts?.ready]);
  const t = PROMO_THEMES[card.style] ?? PROMO_THEMES.basic;
  // s: 본문 배율. 1보다 크면(여러 건이 자리를 덜 차지할 때) 거래 줄만 키우고 위 칸은 1배 그대로 둔다.
  const layout = (pen: Pen, s: number, grow = 0) => {
    const hs = Math.min(1, s);
    const y = head(pen, card, t, hs) + Math.round(26 * hs);
    return card.items.length === 1 ? one(pen, card, t, s, y, grow) : rows(pen, card, t, s, y);
  };
  const probe: Pen = { ctx, draw: false, minPx: 999, dy: 0, pad: PAD, maxW: MAXW };
  const footTop = foot(probe, card, t, logo);
  let scale = 1;
  let bottom = 0;
  // 여러 건은 아래 칸 위에 자리가 남으면 1.45배까지 키운다(3 + 2장처럼 줄이 적은 장의 빈 곳을 줄임). 넘치면 0.8배까지 줄인다.
  const scales = card.items.length > 1 ? [1.45, 1.35, 1.25, 1.15, 1.05, 1, 0.95, 0.9, 0.85, 0.8] : [1, 0.95, 0.9, 0.85, 0.8];
  // 키운 배율은 1배보다 글을 더 자르면(말줄임이 늘면) 쓰지 않는다(금액 옆 설명 줄의 계약일이 잘리지 않게).
  cuts = 0;
  layout(probe, 1);
  const baseCuts = cuts;
  for (const s of scales) {
    cuts = 0;
    const end = layout(probe, s);
    if (s > 1 && cuts > baseCuts) continue;
    scale = s;
    bottom = end;
    if (bottom <= footTop - 20) break;
  }
  // 한 건 카드가 1배로 들어가고 자리가 남으면 흐름선을 최대 240px 키운다(아래 칸과 60px 띄움).
  const grow = card.items.length === 1 && scale === 1 ? Math.min(240, Math.max(0, footTop - 60 - bottom)) : 0;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);
  const pen: Pen = { ctx, draw: true, minPx: 999, dy: 0, pad: PAD, maxW: MAXW };
  bottom = layout(pen, scale, grow);
  foot(pen, card, t, logo);
  return { dataUrl: canvas.toDataURL("image/png"), overflow: bottom > footTop - 20, minBodyPx: pen.minPx };
}
