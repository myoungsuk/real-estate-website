// 거래 완료 알림 카드 그림(보드 45번 C, 운영자 결정 2026-11-20 18:09 "① 가격 빼고 달·면적 흐리게"). canvas 1080×1350 → toDataURL('image/png').
// 글은 src/lib/work/promo-paper.mjs의 buildDoneNotice()가 만들고, 이 파일은 그리기만 한다(서버 요청·브라우저 저장 없음).
// 줄 나누기·글·네모·가로줄·로고는 업무 카드 공통 파일(work-card-draw.ts)을 실거래가 홍보물 카드와 함께 쓴다.
// 모양: 머리 줄(로고 + "거래 완료 알림") → 도장 "거래 완료"(빨강 테두리, DESIGN.md stamp-red) → 단지 이름 → "전용 n㎡대 · 거래 종류" → 안내 2줄 → 보호 문장 → 상담 칸 → 아래 칸 사무소 명시사항.
import { DONE_CARD_SIZE } from "./work/promo-paper.mjs";
import { CARD_COLORS, font, hline, loadLogo, rect, text, width, type Logo, type Pen } from "./work-card-draw";

export type DoneNotice = {
  title: string;
  stamp: string;
  name: string;
  fact: string;
  message: string[];
  guard: string;
  phone: string;
  sub: string[];
  disclosure: string[];
};
export type DoneCardResult = { dataUrl: string; overflow: boolean; minBodyPx: number };

const W = DONE_CARD_SIZE.width;
const H = DONE_CARD_SIZE.height;
const PAD = 72;
const MAXW = W - PAD * 2;
const C = CARD_COLORS;
const STAMP = "#B3261E"; // DESIGN.md stamp-red(종이 위 대비 6.54:1). 뜻은 글자 "거래 완료"가 전하고 색은 꾸밈.
const FOOT_PX = 30;

// 머리 줄: 로고 + 제목(실거래가 카드 머리 줄과 같은 크기)
function header(pen: Pen, logo: Logo, title: string) {
  const y = 56;
  const logoH = 104;
  if (pen.draw) pen.ctx.drawImage(logo.image, logo.x, logo.y, logo.w, logo.h, PAD, y, Math.round(logoH * logo.w / logo.h), logoH);
  text(pen, title, W - PAD, y + logoH / 2 - 34 * 0.675, { px: 34, weight: 700, color: C.soft, align: "right", maxW: 560 });
  const lineY = y + logoH + 26;
  hline(pen, lineY);
  return lineY;
}

// 도장: 빨강 테두리 네모 안 글자, 왼쪽 가운데를 축으로 4도 기울인다. 돌려준 값은 도장이 차지하는 아래 끝.
function stamp(pen: Pen, label: string, x: number, y: number, px: number) {
  const padX = Math.round(px * 0.43);
  const padY = Math.round(px * 0.18);
  const border = 6;
  const w = width(pen, label, px, 900) + padX * 2;
  const h = Math.round(px * 1.35) + padY * 2;
  if (pen.draw) {
    const { ctx } = pen;
    ctx.save();
    ctx.translate(x, y + h / 2);
    ctx.rotate((-4 * Math.PI) / 180);
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(border / 2, -h / 2 + border / 2, w - border, h - border, 4); else ctx.rect(border / 2, -h / 2 + border / 2, w - border, h - border);
    ctx.strokeStyle = STAMP;
    ctx.lineWidth = border;
    ctx.stroke();
    ctx.font = font(px, 900);
    ctx.fillStyle = STAMP;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, padX, 2);
    ctx.restore();
  }
  pen.minPx = Math.min(pen.minPx, px);
  // 기울기만큼 오른쪽 끝이 위로 올라가고 왼쪽은 그대로라 아래 끝은 h + w·sin(4°)의 절반쯤 내려온다.
  return y + h + Math.round((w * Math.sin((4 * Math.PI) / 180)) / 2);
}

// 단지 이름은 한 줄에 들어갈 때까지 줄이고(104 → 72px), 그래도 길면 두 줄로 감는다.
function namePx(pen: Pen, name: string, s: number) {
  let px = Math.round(104 * s);
  while (px > Math.round(72 * s) && width(pen, name, px, 900) > MAXW) px -= 4;
  return px;
}

// "전용 84㎡대 · 매매": 굵은 글꼴에서 ㎡의 위첨자가 '대'에 붙어 보여(사용자 결정 2026-11-20 18:33 "그림에서만 간격 띄우기") ㎡ 뒤만 띄워 그린다.
// 띄움 = ㎡까지의 잉크 오른쪽 끝이 글자 폭을 넘은 만큼 + '대' 잉크 왼쪽 여백만큼 당긴 것 + 0.08em. 글 묶음·alt 글자는 그대로다.
function factGap(ctx: CanvasRenderingContext2D, head: string, tail: string) {
  const left = ctx.measureText(head);
  const right = ctx.measureText(tail.slice(0, 1));
  const overhang = Math.max(0, left.actualBoundingBoxRight - left.width);
  const bearing = -right.actualBoundingBoxLeft; // 잉크가 글자 시작점보다 오른쪽에서 시작하면 양수
  const px = Number.parseFloat(ctx.font.match(/(\d+(?:\.\d+)?)px/u)?.[1] ?? "0");
  return Math.max(0, overhang - Math.max(0, bearing)) + px * 0.08;
}
function factText(pen: Pen, fact: string, y: number, px: number) {
  const at = fact.indexOf("㎡");
  if (at < 0 || at === fact.length - 1) return text(pen, fact, PAD, y, { px, weight: 800 });
  const head = fact.slice(0, at + 1);
  const tail = fact.slice(at + 1);
  const { ctx } = pen;
  ctx.font = font(px, 800);
  const gap = factGap(ctx, head, tail);
  if (ctx.measureText(head).width + gap + ctx.measureText(tail).width > MAXW) return text(pen, fact, PAD, y, { px, weight: 800 });
  text(pen, head, PAD, y, { px, weight: 800 });
  return text(pen, tail, PAD + ctx.measureText(head).width + gap, y, { px, weight: 800 });
}

function body(pen: Pen, logo: Logo, notice: DoneNotice, s: number) {
  let y = header(pen, logo, notice.title) + Math.round(44 * s) + pen.dy;
  y = stamp(pen, notice.stamp, PAD, y, Math.round(60 * s)) + Math.round(34 * s);
  y = text(pen, notice.name, PAD, y, { px: namePx(pen, notice.name, s), weight: 900, color: C.navy, lh: 1.12 });
  y = factText(pen, notice.fact, y + Math.round(10 * s), Math.round(50 * s));
  y += Math.round(30 * s);
  for (const line of notice.message) y = text(pen, line, PAD, y, { px: Math.round(40 * s), lh: 1.5 });
  y = text(pen, notice.guard, PAD, y + Math.round(14 * s), { px: Math.round(30 * s), color: C.soft, lh: 1.45 });
  // 상담 칸: 남색 테두리 안에 전화(크게)와 카카오톡·홈페이지 주소.
  const boxTop = y + Math.round(30 * s);
  const inner = PAD + 34;
  const innerW = MAXW - 68;
  const measure = (draw: boolean) => {
    const was = pen.draw;
    pen.draw = draw;
    let at = boxTop + 26;
    at = text(pen, notice.phone, inner, at, { px: Math.round(56 * s), weight: 900, color: C.navy, maxW: innerW, lh: 1.25 });
    for (const line of notice.sub) at = text(pen, line, inner, at, { px: Math.round(32 * s), color: C.soft, maxW: innerW, lh: 1.45 });
    pen.draw = was;
    return at + 26;
  };
  const boxBottom = measure(false);
  rect(pen, PAD, boxTop, MAXW, boxBottom - boxTop, { stroke: C.navy, lw: 2 });
  measure(pen.draw);
  return boxBottom;
}

// 아래 칸: 사무소 명시사항 5항목(3줄, 첫 줄 굵게). 실거래가 카드 아래 칸과 같은 크기·색.
function footer(pen: Pen, notice: DoneNotice) {
  const lines = (y0: number) => {
    let y = y0 + 34;
    y = text(pen, notice.disclosure[0], PAD, y, { px: FOOT_PX, weight: 700 });
    for (const line of notice.disclosure.slice(1)) y = text(pen, line, PAD, y, { px: FOOT_PX });
    return y + 34;
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

// 그리기: 아래 칸 위로 본문이 넘치면 본문 글자를 5%씩 줄인다(80%까지). 그래도 넘치면 overflow로 알린다. 남는 세로 공간은 절반만큼 본문을 내린다(최대 70px).
export async function renderDoneCard(canvas: HTMLCanvasElement, notice: DoneNotice): Promise<DoneCardResult> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const [logo] = await Promise.all([loadLogo(), document.fonts?.ready]);
  const probe: Pen = { ctx, draw: false, minPx: 999, dy: 0, pad: PAD, maxW: MAXW };
  const footTop = footer(probe, notice);
  let scale = 1;
  let bottom = 0;
  for (const s of [1, 0.95, 0.9, 0.85, 0.8]) {
    scale = s;
    bottom = body(probe, logo, notice, s);
    if (bottom <= footTop - 24) break;
  }
  const dy = Math.max(0, Math.min(70, (footTop - 24 - bottom) / 2));
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  const pen: Pen = { ctx, draw: true, minPx: 999, dy, pad: PAD, maxW: MAXW };
  bottom = body(pen, logo, notice, scale);
  footer(pen, notice);
  return { dataUrl: canvas.toDataURL("image/png"), overflow: bottom > footTop - 24, minBodyPx: pen.minPx };
}
