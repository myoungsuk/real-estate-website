// 대표 소개 그림(보드 20번, 2026-11-24 사용자 답 "어 그렇게 해" — 소개 01 흰 종이·06 초록 카드·10 사진 크게). canvas 1080×1350 → toDataURL('image/png').
// 글은 src/lib/work/intro-paper.mjs buildIntroView()가 office.json 확정 공개 정보로 만들고, 이 파일은 그리기만 한다(입력 칸·서버 요청·브라우저 저장 없음).
// 사진은 공개 승인 사진(대표·사무소 간판·상담실·리더스시티 4·5블록·신흥 SK뷰)만 쓴다. 모든 모양 아래에 사무소 명시사항 5항목(28px).
// view.copy(한 줄 글)는 '문구 고치기' 칸에서 고칠 수 있다(2판). 고친 글이 제 자리를 넘으면(아래 글과 겹치면) overflow로 알린다.
import { INTRO_CARD_SIZE } from "./work/intro-paper.mjs";
import { CARD_COLORS as C, text, type Pen } from "./work-card-draw";
import { drawCover, drawOfficeFooter, fitPx, loadImage, measureOfficeFooter, paintBackground } from "./work-paper-parts";

export type IntroShape = "white" | "green" | "photo";
export type IntroView = {
  brand: string;
  role: string;
  name: string;
  quote: string;
  place: string;
  hours: string;
  phone: string;
  sub: string[];
  copy: { white: string; green: string; photo: string };
  photos: { representative: string; storefront: string; strip: readonly (readonly string[])[] };
  disclosure: string[];
};
export type IntroResult = { dataUrl: string; overflow: boolean; minBodyPx: number };

const W = INTRO_CARD_SIZE.width;
const H = INTRO_CARD_SIZE.height;
const PAD = 72;
const MAXW = W - PAD * 2;
const RED = "#B3261E";
const GREEN = { deep: "#1F4A36", cream: "#F4EFE1", light: "#DDE7DF", ink: "#1D2A22", soft: "#4A544D", rule: "#CFC6AE" };

type Images = { representative: HTMLImageElement | null; storefront: HTMLImageElement | null; strip: (HTMLImageElement | null)[] };
type Ctx = { pen: Pen; view: IntroView; images: Images };

// 사진 칸: 사진이 없으면(읽기 실패) 옅은 회색 칸만.
function photoBox(pen: Pen, image: HTMLImageElement | null, box: { x: number; y: number; w: number; h: number }, fy = 0.5) {
  if (!pen.draw) return;
  if (image) drawCover(pen, image, box, { fy }); else { pen.ctx.fillStyle = C.paper2; pen.ctx.fillRect(box.x, box.y, box.w, box.h); }
}

// 사무소 아래 칸(아래에서 40px). 돌려준 값은 칸 위 끝.
function footer(pen: Pen, view: IntroView, { color = C.ink as string, soft = C.soft as string, rule = C.edge as string } = {}) {
  const top = H - 40 - measureOfficeFooter(pen, view.disclosure, MAXW);
  if (pen.draw) { pen.ctx.fillStyle = rule; pen.ctx.fillRect(PAD, top - 20, MAXW, 2); }
  drawOfficeFooter(pen, view.disclosure, { x: PAD, y: top, w: MAXW, color, soft });
  return top - 20;
}

// 사진 줄 4칸 + 이름. 다음 y.
function strip(pen: Pen, view: IntroView, images: Images, y: number, h: number, captionColor: string, weight = 500) {
  const gap = 18;
  const n = view.photos.strip.length;
  const w = (MAXW - gap * (n - 1)) / n;
  let bottom = y;
  view.photos.strip.forEach(([, label], index) => {
    const x = PAD + index * (w + gap);
    photoBox(pen, images.strip[index], { x, y, w, h });
    bottom = Math.max(bottom, text(pen, label, x, y + h + 10, { px: 24, weight, color: captionColor, maxW: w, lh: 1.3 }));
  });
  return bottom;
}

// 영업시간·연락 줄: 왼쪽 글 묶음, 오른쪽 전화(크게). 다음 y.
function contactRow(pen: Pen, left: string[], phone: string, y: number, { color = C.navy as string, soft = C.soft as string, phonePx = 60 } = {}) {
  const leftW = MAXW * 0.48;
  const phoneW = MAXW - leftW - 24;
  // 전화번호는 줄을 바꾸지 않는다(칸에 들 때까지 글자를 줄임).
  const px = fitPx(pen, phone, phoneW, phonePx, 40);
  let at = y;
  left.forEach((line) => { at = text(pen, line, PAD, at, { px: 26, color: soft, maxW: leftW, lh: 1.4 }); });
  const phoneTop = y + Math.max(0, (at - y - px * 1.2) / 2);
  const phoneBottom = text(pen, phone, W - PAD, phoneTop, { px, weight: 900, color, align: "right", maxW: phoneW + 40, lh: 1.2 });
  return Math.max(at, phoneBottom);
}

// ── 01 흰 종이 ──
function drawWhite({ pen, view, images }: Ctx) {
  paintBackground(pen, W, H, C.paper);
  const foot = footer(pen, view);
  const photo = { x: PAD, y: 72, w: 300, h: 380 };
  photoBox(pen, images.representative, photo, 0.2);
  const rx = photo.x + photo.w + 40;
  const rw = W - PAD - rx;
  let y = text(pen, `${view.brand} ${view.role}`, rx, photo.y + 8, { px: 28, color: C.soft, maxW: rw, lh: 1.35 });
  y = text(pen, view.name, rx, y + 4, { px: fitPx(pen, view.name, rw, 112, 72), weight: 900, color: C.navy, lh: 1.15 });
  y = text(pen, view.copy.white, rx, y + 10, { px: 40, weight: 800, maxW: rw, lh: 1.35 });
  const placeBottom = text(pen, view.place, rx, y + 10, { px: 26, color: C.soft, maxW: rw, lh: 1.35 });
  // 대표 말(소개글 셋째 문장): 왼쪽 빨간 줄
  const qTop = photo.y + photo.h + 50;
  // 한 줄 글이 길어 주소 줄이 대표 말 칸까지 내려오면 겹치므로 막는다.
  const crowded = placeBottom > qTop - 12;
  const qBottom = text(pen, view.quote, PAD + 30, qTop, { px: 36, weight: 500, maxW: MAXW - 30, lh: 1.5 });
  if (pen.draw) { pen.ctx.fillStyle = RED; pen.ctx.fillRect(PAD, qTop, 6, qBottom - qTop); }
  y = strip(pen, view, images, qBottom + 44, 170, C.soft);
  // 연락 칸(회색)
  const boxTop = y + 36;
  const inner = (p: Pen) => contactRow(p, [view.hours, ...view.sub], view.phone, boxTop + 26);
  const boxBottom = inner({ ...pen, draw: false }) + 26;
  if (pen.draw) { pen.ctx.fillStyle = C.paper2; pen.ctx.fillRect(PAD - 20, boxTop, MAXW + 40, boxBottom - boxTop); }
  // 회색 칸 안이라 왼쪽 글을 20px 안으로(칸이 좌우 20px 넓음) 들이지 않고 PAD에 맞춘다.
  inner(pen);
  return { bottom: crowded ? Infinity : boxBottom, limit: foot - 20 };
}

// ── 06 초록 카드 ──
function drawGreen({ pen, view, images }: Ctx) {
  const r = 150;
  const cx = PAD + r;
  const cy = 80 + r;
  const rx = cx + r + 44;
  const rw = W - PAD - rx;
  // 위 초록 칸 글 높이를 먼저 재서 칸 끝을 정한다.
  const top = (p: Pen) => {
    let y = text(p, `${view.brand} ${view.role}`, rx, cy - 140, { px: 28, color: GREEN.light, maxW: rw, lh: 1.35 });
    y = text(p, view.name, rx, y + 4, { px: fitPx(p, view.name, rw, 112, 72), weight: 900, color: GREEN.cream, lh: 1.15 });
    y = text(p, view.copy.green, rx, y + 12, { px: 36, weight: 700, color: "#FFFFFF", maxW: rw, lh: 1.4 });
    const ruleY = Math.max(y, cy + r) + 36;
    if (p.draw) { p.ctx.fillStyle = "rgba(221, 231, 223, 0.35)"; p.ctx.fillRect(PAD, ruleY, MAXW, 2); }
    return text(p, view.quote, PAD, ruleY + 28, { px: 32, color: GREEN.light, maxW: MAXW, lh: 1.5 });
  };
  const split = top({ ...pen, draw: false }) + 44;
  if (pen.draw) {
    pen.ctx.fillStyle = GREEN.cream;
    pen.ctx.fillRect(0, 0, W, H);
    pen.ctx.fillStyle = GREEN.deep;
    pen.ctx.fillRect(0, 0, W, split);
    // 둥근 대표 사진 + 크림색 테두리
    pen.ctx.save();
    pen.ctx.beginPath();
    pen.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    pen.ctx.clip();
    photoBox(pen, images.representative, { x: cx - r, y: cy - r, w: r * 2, h: r * 2 }, 0.2);
    pen.ctx.restore();
    pen.ctx.strokeStyle = GREEN.cream;
    pen.ctx.lineWidth = 6;
    pen.ctx.beginPath();
    pen.ctx.arc(cx, cy, r, 0, Math.PI * 2);
    pen.ctx.stroke();
  }
  top(pen);
  const foot = footer(pen, view, { color: GREEN.ink, soft: GREEN.soft, rule: GREEN.rule });
  let y = strip(pen, view, images, split + 40, 170, GREEN.deep, 700);
  if (pen.draw) { pen.ctx.fillStyle = GREEN.deep; pen.ctx.fillRect(PAD, y + 26, MAXW, 2); }
  y = contactRow(pen, [view.hours, view.place], view.phone, y + 50, { color: GREEN.deep, soft: GREEN.soft });
  return { bottom: y, limit: foot - 20 };
}

// ── 10 사진 크게 ──
function drawPhoto({ pen, view, images }: Ctx) {
  paintBackground(pen, W, H, C.paper);
  const foot = footer(pen, view);
  const photoH = 620;
  photoBox(pen, images.storefront, { x: 0, y: 0, w: W, h: photoH }, 0.35);
  if (pen.draw) {
    const grad = pen.ctx.createLinearGradient(0, photoH * 0.5, 0, photoH);
    grad.addColorStop(0, "rgba(10, 20, 30, 0)");
    grad.addColorStop(1, "rgba(10, 20, 30, 0.8)");
    pen.ctx.fillStyle = grad;
    pen.ctx.fillRect(0, 0, W, photoH);
  }
  const headPx = fitPx(pen, view.copy.photo, MAXW, 76, 52);
  const headTop = photoH - 40 - headPx * 1.15;
  // 한 줄에 들지 않으면(52px에도 넘침) 둘째 줄이 사진 아래 칸으로 내려가므로 막는다.
  const headLines = text(pen, view.copy.photo, PAD, headTop, { px: headPx, weight: 900, color: "#FFFFFF", lh: 1.15 });
  const crowded = headLines > headTop + headPx * 1.15 + 1;
  text(pen, view.place, PAD, headTop - 28 * 1.35 - 4, { px: 28, weight: 600, color: "#FFFFFF", lh: 1.35 });
  const photo = { x: PAD, y: photoH + 40, w: 200, h: 240 };
  photoBox(pen, images.representative, photo, 0.2);
  const rx = photo.x + photo.w + 36;
  const rw = W - PAD - rx;
  let y = text(pen, view.role, rx, photo.y, { px: 26, color: C.soft, maxW: rw, lh: 1.35 });
  y = text(pen, view.name, rx, y, { px: fitPx(pen, view.name, rw, 96, 64), weight: 900, color: C.navy, lh: 1.15 });
  y = text(pen, view.quote, rx, y + 10, { px: 30, maxW: rw, lh: 1.5 });
  y = Math.max(y, photo.y + photo.h) + 30;
  if (pen.draw) { pen.ctx.fillStyle = C.edge; pen.ctx.fillRect(PAD, y, MAXW, 2); }
  y = contactRow(pen, [view.hours], view.phone, y + 24);
  return { bottom: crowded ? Infinity : y, limit: foot - 16 };
}

const DRAW: Record<IntroShape, (c: Ctx) => { bottom: number; limit: number }> = { white: drawWhite, green: drawGreen, photo: drawPhoto };

export async function renderIntroCard(canvas: HTMLCanvasElement, shape: IntroShape, view: IntroView): Promise<IntroResult> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const soft = (src: string) => loadImage(src).catch(() => null);
  const [representative, storefront, strip] = await Promise.all([
    soft(view.photos.representative),
    shape === "photo" ? soft(view.photos.storefront) : Promise.resolve(null),
    shape === "photo" ? Promise.resolve([]) : Promise.all(view.photos.strip.map(([src]) => soft(src))),
    document.fonts?.ready,
  ]);
  const images: Images = { representative, storefront, strip };
  const pen: Pen = { ctx, draw: true, minPx: 999, dy: 0, pad: PAD, maxW: MAXW };
  ctx.clearRect(0, 0, W, H);
  const layout = DRAW[shape]({ pen, view, images });
  return { dataUrl: canvas.toDataURL("image/png"), overflow: layout.bottom > layout.limit, minBodyPx: pen.minPx };
}
