// 거래 완료 그림의 고르는 모양(보드 20번, 2026-11-24 사용자 답 "어 그렇게 해" — 거래완료 01 흰 종이·06 초록 카드·09 영수증·11 도장).
// '기본'은 지금 그림(work-done-card.ts)을 그대로 부른다. 글은 promo-paper.mjs의 buildDoneNotice()와 DONE_COPY만 쓰고, 이 파일은 그리기만 한다.
// - 날짜를 넣지 않는다(대장 조건: 신문 날짜·도장 달 포함). 동·층·호수·계약 날짜도 없다.
// - 가격은 notice.price가 있을 때만(화면에서 '가격 넣기'를 켰을 때만) 그린다.
// - 모든 모양 아래에 사무소 명시사항 5항목(28px, 지금 매물 안내지와 같은 크기)을 둔다.
// - 서버 요청·브라우저 저장 없음. 사진은 쓰지 않는다(계약서·도장·영수증은 그림).
// - 새로 쓴 글은 '문구 고치기' 칸에서 고친 글(paper-copy.mjs checkPaperCopy()가 검사한 copy)을 쓴다. 빈 optional 칸은 그 줄을 뺀다(2판, 2026-11-24 "문구도 수정할 수 있게").
import { DONE_CARD_SIZE, DONE_COPY } from "./work/promo-paper.mjs";
import { seededRandom } from "./work/paper-parts.mjs";
import { defaultPaperCopy, stampLines } from "./work/paper-copy.mjs";
import { CARD_COLORS as C, font, hline, loadLogo, text, type Logo, type Pen } from "./work-card-draw";
import { type DoneCardResult, type DoneNotice, renderDoneCard } from "./work-done-card";
import { drawContractDoc, drawOfficeFooter, drawStamp, fitPx, measureOfficeFooter, paintBackground } from "./work-paper-parts";

export type DoneShape = "basic" | "white" | "green" | "receipt" | "stamp";

const W = DONE_CARD_SIZE.width;
const H = DONE_CARD_SIZE.height;
const PAD = 72;
const MAXW = W - PAD * 2;
const RED = "#B3261E"; // DESIGN.md stamp-red(흰 종이 위 대비 6.54:1)
const GREEN = { deep: "#1F4A36", cream: "#F4EFE1", gold: "#F2C14E", ink: "#1D2A22", soft: "#4A544D", light: "#DDE7DF" };
const RECEIPT = { back: "#565C69", paper: "#FFFFFF", dash: "#9AA0A8", ink: "#1F2328", soft: "#555A61" };
const STAMP_PAPER = "#FBF6EC";
const SCALES = [1, 0.95, 0.9, 0.85, 0.8];

type Layout = { bottom: number; limit: number };
export type DoneCopy = Record<string, string>;
type Draw = (pen: Pen, notice: DoneNotice, s: number, logo: Logo, copy: DoneCopy) => Layout;

// 아래 칸: 사무소 명시사항 3줄. 아래에서 40px 띄우고, 위에 가는 줄을 긋는다. 돌려준 값은 줄 위 끝.
function officeFooter(pen: Pen, notice: DoneNotice, { color = C.ink as string, soft = C.soft as string, rule = C.edge as string } = {}) {
  const h = measureOfficeFooter(pen, notice.disclosure, MAXW);
  const top = H - 40 - h;
  if (pen.draw) { pen.ctx.fillStyle = rule; pen.ctx.fillRect(PAD, top - 22, MAXW, 2); }
  drawOfficeFooter(pen, notice.disclosure, { x: PAD, y: top, w: MAXW, color, soft });
  return top - 22;
}

// 가격 한 줄: 칸에 들어갈 때까지 줄이고(start → 0.7배), 그래도 길면 ' · '(월세의 보증금·월세 사이)에서 줄을 바꾼다.
function priceLine(pen: Pen, value: string, x: number, y: number, maxW: number, start: number, color: string, align: CanvasTextAlign = "left") {
  const min = Math.round(start * 0.7);
  const px = fitPx(pen, value, maxW, start, min);
  pen.ctx.font = font(px, 900);
  const parts = value.split(" · ");
  if (pen.ctx.measureText(value).width <= maxW || parts.length < 2) return text(pen, value, x, y, { px, weight: 900, color, maxW, align, lh: 1.2 });
  const each = Math.min(...parts.map((part) => fitPx(pen, part, maxW, start, min)));
  let at = y;
  for (const part of parts) at = text(pen, part, x, at, { px: each, weight: 900, color, maxW, align, lh: 1.2 });
  return at;
}

// ── 01 흰 종이 ──
const drawWhite: Draw = (pen, notice, s, logo, copy) => {
  const foot = officeFooter(pen, notice);
  const logoH = 92;
  if (pen.draw) pen.ctx.drawImage(logo.image, logo.x, logo.y, logo.w, logo.h, PAD, 64, Math.round(logoH * logo.w / logo.h), logoH);
  let y = 64 + logoH + Math.round(40 * s) + pen.dy;
  y = text(pen, `${notice.name} · ${notice.fact}`, PAD, y, { px: Math.round(32 * s), weight: 700, color: C.soft, lh: 1.35 });
  y = text(pen, copy.head, PAD, y + Math.round(6 * s), { px: Math.round(150 * s), weight: 900, color: C.navy, lh: 1.12 });
  const docW = Math.round(380 * s);
  const docX = W - PAD - docW + 20;
  const leftW = docX - PAD - 28;
  const docTop = y + Math.round(24 * s);
  const docH = drawContractDoc(pen, { x: docX, y: docTop, w: docW, deg: 6, seed: 11, stampLines: stampLines(copy) });
  if (notice.price) y = priceLine(pen, notice.price, PAD, y + Math.round(12 * s), leftW, Math.round(76 * s), RED);
  y += Math.round(26 * s);
  for (const line of [copy.line1, copy.line2].filter(Boolean)) y = text(pen, line, PAD, y, { px: Math.round(46 * s), weight: 800, maxW: leftW, lh: 1.35 });
  if (copy.sub) y = text(pen, copy.sub, PAD, y + Math.round(14 * s), { px: Math.round(32 * s), color: C.soft, maxW: leftW, lh: 1.45 });
  y = Math.max(y, docTop + docH + Math.round(40 * s));
  y = text(pen, notice.guard, PAD, y + Math.round(10 * s), { px: Math.round(28 * s), color: C.soft, lh: 1.45 });
  // 전화 줄: 가는 줄 아래 전화(크게) + 오른쪽에 카카오톡·홈페이지
  const phonePx = Math.round(68 * s);
  const subPx = 26;
  const subH = notice.sub.length * subPx * 1.4;
  const rowH = Math.max(phonePx * 1.2, subH);
  const rowTop = foot - Math.round(36 * s) - rowH;
  hline(pen, rowTop - Math.round(24 * s), C.navy, 3);
  text(pen, notice.mobile ?? notice.phone, PAD, rowTop + (rowH - phonePx * 1.2) / 2, { px: phonePx, weight: 900, color: C.navy, lh: 1.2 });
  let at = rowTop + (rowH - subH) / 2;
  for (const line of notice.sub) at = text(pen, line, W - PAD, at, { px: subPx, color: C.soft, align: "right", maxW: 420, lh: 1.4 });
  return { bottom: y, limit: rowTop - Math.round(24 * s) - 20 };
};

// ── 06 초록 카드 ──
const drawGreen: Draw = (pen, notice, s, _logo, copy) => {
  const docW = Math.round(360 * s);
  const docX = W - PAD - docW + 16;
  const topW = docX - PAD - 24;
  // 위 초록 칸 글(재고 그리기 둘 다 씀). 가격이 길어 내려가도 초록 칸이 따라 늘어 노란 글이 크림색 위에 오지 않게 한다.
  const top = (p: Pen) => {
    let at = 70 + pen.dy;
    at = text(p, brandOf(notice), PAD, at, { px: 30, weight: 700, color: GREEN.light, lh: 1.3 });
    at = text(p, copy.head, PAD, at + Math.round(24 * s), { px: Math.round(112 * s), weight: 900, color: GREEN.cream, maxW: Math.round(660 * s), lh: 1.15 });
    at = text(p, notice.name, PAD, at + Math.round(18 * s), { px: Math.round(44 * s), weight: 800, color: "#FFFFFF", maxW: topW, lh: 1.3 });
    at = text(p, notice.fact, PAD, at, { px: Math.round(32 * s), weight: 500, color: GREEN.light, maxW: topW, lh: 1.35 });
    if (notice.price) at = priceLine(p, notice.price, PAD, at + Math.round(14 * s), topW, Math.round(72 * s), GREEN.gold);
    return at;
  };
  const split = Math.max(Math.round(H * 0.5), Math.round(top({ ...pen, draw: false }) + 36));
  if (pen.draw) {
    pen.ctx.fillStyle = GREEN.cream;
    pen.ctx.fillRect(0, 0, W, H);
    pen.ctx.fillStyle = GREEN.deep;
    pen.ctx.fillRect(0, 0, W, split);
  }
  const foot = officeFooter(pen, notice, { color: GREEN.ink, soft: GREEN.soft, rule: "#CFC6AE" });
  const topBottom = top(pen);
  let y = topBottom;
  const docTop = Math.max(split - Math.round(200 * s), topBottom - Math.round(120 * s));
  const docH = drawContractDoc(pen, { x: docX, y: docTop, w: docW, deg: 5, seed: 21, stampLines: stampLines(copy) });
  y = split + Math.round(46 * s);
  const leftW = docX - PAD - 24;
  for (const line of [copy.line1, copy.line2].filter(Boolean)) y = text(pen, line, PAD, y, { px: Math.round(42 * s), weight: 800, color: GREEN.ink, maxW: leftW, lh: 1.4 });
  y = text(pen, notice.guard, PAD, y + Math.round(16 * s), { px: Math.round(28 * s), color: GREEN.soft, maxW: leftW, lh: 1.45 });
  y = Math.max(y, docTop + docH + 30);
  // 전화 줄: 왼쪽 전화(크게), 오른쪽 영업시간(office.json에서 만든 글을 ' · '에서 나눠 줄마다)
  const phonePx = Math.round(68 * s);
  const hours = (notice.hours ?? "").split(" · ").filter(Boolean);
  const hoursPx = 26;
  const hoursH = hours.length * hoursPx * 1.4;
  const rowH = Math.max(phonePx * 1.2, hoursH);
  const rowTop = foot - Math.round(34 * s) - rowH;
  text(pen, notice.mobile ?? notice.phone, PAD, rowTop + (rowH - phonePx * 1.2) / 2, { px: phonePx, weight: 900, color: GREEN.deep, lh: 1.2 });
  let at = rowTop + (rowH - hoursH) / 2;
  for (const line of hours) at = text(pen, line, W - PAD, at, { px: hoursPx, weight: 600, color: GREEN.soft, align: "right", maxW: 380, lh: 1.4 });
  return { bottom: y, limit: rowTop - 24 };
};

// 명시사항 첫 줄 "상호 · 대표 …"의 앞부분(상호)을 브랜드 자리에 쓴다. 따로 받지 않아 글이 한 곳에서만 온다.
function brandOf(notice: DoneNotice) {
  return String(notice.disclosure[0] ?? "").split(" · ")[0] ?? "";
}

// ── 09 영수증 ──
// 줄 하나: 왼쪽 이름, 오른쪽 값(길면 감아서 오른쪽 맞춤).
function receiptRow(pen: Pen, label: string, value: string, x: number, w: number, y: number, px: number) {
  const labelW = Math.round(px * 3.4);
  const bottom = text(pen, value, x + w, y, { px, weight: 700, color: RECEIPT.ink, align: "right", maxW: w - labelW, lh: 1.35 });
  text(pen, label, x, y, { px, color: RECEIPT.soft, lh: 1.35 });
  return bottom + Math.round(px * 0.25);
}
function dashed(pen: Pen, x: number, w: number, y: number) {
  if (!pen.draw) return;
  const { ctx } = pen;
  ctx.save();
  ctx.strokeStyle = RECEIPT.dash;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.stroke();
  ctx.restore();
}
// 막대 무늬(꾸밈, 숫자·글 없음). 씨앗 값으로 늘 같은 무늬.
function barcode(pen: Pen, cx: number, y: number, w: number, h: number) {
  if (!pen.draw) return;
  const random = seededRandom(9);
  const { ctx } = pen;
  ctx.fillStyle = RECEIPT.ink;
  let x = cx - w / 2;
  while (x < cx + w / 2 - 4) {
    const bar = 2 + Math.floor(random() * 3) * 2;
    ctx.fillRect(x, y, bar, h);
    x += bar + 3 + Math.floor(random() * 3) * 2;
  }
}
// 영수증 종이: 아래 끝이 톱니.
function receiptPaper(pen: Pen, x: number, y: number, w: number, bottom: number) {
  if (!pen.draw) return;
  const { ctx } = pen;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 12;
  ctx.fillStyle = RECEIPT.paper;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, bottom);
  const tooth = 22;
  const count = Math.round(w / tooth);
  const step = w / count;
  for (let i = count; i > 0; i -= 1) {
    ctx.lineTo(x + step * (i - 0.5), bottom + 14);
    ctx.lineTo(x + step * (i - 1), bottom);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
const drawReceipt: Draw = (pen, notice, s, logo, copy) => {
  paintBackground(pen, W, H, RECEIPT.back);
  const foot = officeFooter(pen, notice, { color: "#FFFFFF", soft: "#E3E6EA", rule: "#7B828F" });
  const paperW = Math.round(680 * s);
  const paperX = (W - paperW) / 2;
  const inX = paperX + 50;
  const inW = paperW - 100;
  const paperTop = 56 + pen.dy;
  const paperBottom = foot - 56;
  // 먼저 재고(종이 크기를 정하려고), 그다음 종이 → 글 순서로 그린다.
  const body = (p: Pen) => {
    let y = paperTop + 44;
    const logoH = Math.round(66 * s);
    const logoW = Math.round(logoH * logo.w / logo.h);
    if (p.draw) p.ctx.drawImage(logo.image, logo.x, logo.y, logo.w, logo.h, W / 2 - logoW / 2, y, logoW, logoH);
    y += logoH + 18;
    dashed(p, inX, inW, y + 10);
    y += 34;
    y = spacedText(p, copy.head, W / 2, y, Math.round(46 * s), inW);
    y += 16;
    dashed(p, inX, inW, y);
    y += 26;
    const px = Math.round(32 * s);
    const values = [notice.name, notice.area ?? "", notice.deal ?? "", notice.price ?? DONE_COPY.receipt.hidden, copy.state];
    // 줄 이름과 가격을 끈 때의 값은 구조라 고치지 않는다.
    DONE_COPY.receipt.labels.forEach((label, index) => { y = receiptRow(p, label, values[index], inX, inW, y, px); });
    y += 8;
    dashed(p, inX, inW, y);
    y = text(p, notice.guard, W / 2, y + 22, { px: Math.round(26 * s), color: RECEIPT.soft, align: "center", maxW: inW, lh: 1.45 });
    if (copy.thanks) y = text(p, copy.thanks, W / 2, y + 26, { px: Math.round(32 * s), weight: 700, color: RECEIPT.ink, align: "center", maxW: inW, lh: 1.3 });
    else y += 26;
    y = text(p, notice.mobile ?? notice.phone, W / 2, y + 4, { px: Math.round(54 * s), weight: 900, color: RECEIPT.ink, align: "center", maxW: inW, lh: 1.25 });
    const barH = Math.round(84 * s);
    barcode(p, W / 2, y + 18, Math.round(inW * 0.78), barH);
    y += 18 + barH;
    if (copy.bye) y = text(p, copy.bye, W / 2, y + 8, { px: 24, color: RECEIPT.soft, align: "center", maxW: inW, lh: 1.3 });
    return y + 30;
  };
  const end = body({ ...pen, draw: false });
  const bottom = Math.min(paperBottom, end);
  receiptPaper(pen, paperX, paperTop, paperW, bottom);
  body(pen);
  const r = Math.round(92 * s);
  // 도장은 종이 아래 오른쪽 모서리에 걸쳐 찍는다(전화번호를 가리지 않게).
  drawStamp(pen, { cx: paperX + paperW - 34, cy: bottom - Math.round(r * 0.55), r, deg: -12, lines: stampLines(copy) });
  return { bottom: end, limit: paperBottom };
};
// 글자 사이를 띄운 가운데 제목(서류 제목처럼). 다음 y를 돌려준다.
// 칸 폭(maxW)보다 넓으면 글자 사이를 0.45em → 0.1em까지 좁히고, 그래도 넓으면 글자를 줄인다(잘린 제목을 내지 않음).
function spacedText(pen: Pen, value: string, cx: number, y: number, start: number, maxW = Infinity) {
  const { ctx } = pen;
  const chars = [...value];
  let px = start;
  let gap = px * 0.45;
  const measure = () => chars.reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + gap * (chars.length - 1);
  ctx.font = font(px, 800);
  let total = measure();
  while (total > maxW && gap > px * 0.1) { gap -= px * 0.05; total = measure(); }
  while (total > maxW && px > 24) { px -= 1; gap = px * 0.1; ctx.font = font(px, 800); total = measure(); }
  if (pen.draw) {
    ctx.fillStyle = RECEIPT.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let x = cx - total / 2;
    for (const ch of chars) { ctx.fillText(ch, x, y + px * 0.65); x += ctx.measureText(ch).width + gap; }
  }
  pen.minPx = Math.min(pen.minPx, px);
  return y + px * 1.3;
}

// ── 11 도장 ──
// 원 둘레 글: 위쪽은 왼쪽에서 오른쪽으로 시계 방향, 아래쪽은 왼쪽에서 오른쪽으로 읽히게 반시계 방향. 각도가 maxAngle을 넘으면 false.
function arcText(pen: Pen, value: string, cx: number, cy: number, radius: number, px: number, top: boolean, color: string, maxAngle: number) {
  const { ctx } = pen;
  ctx.font = font(px, 800);
  const chars = [...value];
  const gap = px * 0.12;
  const widths = chars.map((ch) => ctx.measureText(ch).width + gap);
  const total = widths.reduce((a, b) => a + b, 0) / radius;
  if (total > maxAngle) return false;
  if (!pen.draw) return true;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let run = 0;
  chars.forEach((ch, index) => {
    const mid = (run + widths[index] / 2) / radius;
    const a = top ? -Math.PI / 2 - total / 2 + mid : Math.PI / 2 + total / 2 - mid;
    ctx.save();
    ctx.translate(cx + radius * Math.cos(a), cy + radius * Math.sin(a));
    ctx.rotate(top ? a + Math.PI / 2 : a - Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    run += widths[index];
  });
  ctx.restore();
  return true;
}
// 큰 도장 테두리와 가운데 글: 바깥 굵은 원(r) · 가는 원(0.93r) · 둘레 글 자리(0.72 ~ 0.88r) · 안쪽 가는 원(0.66r) · 도장 글(처음 "계약 / 완료").
// 도장 글이 안쪽 원(지름 1.32r)의 85%보다 넓으면 들 때까지 줄인다.
function bigStamp(pen: Pen, cx: number, cy: number, r: number, lines: string[]) {
  const { ctx } = pen;
  ctx.strokeStyle = RED;
  const thick = Math.max(4, r * 0.05);
  ctx.lineWidth = thick;
  ctx.beginPath(); ctx.arc(cx, cy, r - thick / 2, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = Math.max(2, r * 0.012);
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.93, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r * 0.66, 0, Math.PI * 2); ctx.stroke();
  let px = Math.round(r * 0.42);
  ctx.font = font(px, 900);
  const widest = () => Math.max(0, ...lines.map((line) => ctx.measureText(line).width));
  while (px > 24 && widest() > r * 1.32 * 0.85) { px -= 2; ctx.font = font(px, 900); }
  ctx.fillStyle = RED;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lh = px * 1.1;
  lines.forEach((line, index) => ctx.fillText(line, cx, cy + (index - (lines.length - 1) / 2) * lh));
}
const drawStampShape: Draw = (pen, notice, s, _logo, copy) => {
  paintBackground(pen, W, H, STAMP_PAPER);
  const foot = officeFooter(pen, notice, { rule: "#D9D0BE" });
  let y = 60 + pen.dy;
  y = text(pen, brandOf(notice), PAD, y, { px: 28, weight: 700, color: C.soft, lh: 1.3 });
  hline(pen, y + 14, "#D9D0BE", 2);
  // 큰 도장: 바깥 원 둘레 위에 단지 이름, 아래에 면적·거래, 가운데 "계약 / 완료". 단지 이름이 둘레에 안 들어가면 도장 위에 한 줄로 쓴다.
  const r = Math.round(300 * s);
  const cx = W / 2;
  let cy = y + 40 + r;
  const ring = Math.round(r * 0.8);
  const namePx = Math.round(46 * s);
  let nameOnArc = true;
  for (let px = namePx; px >= 32; px -= 2) {
    nameOnArc = arcText({ ...pen, draw: false }, notice.name, cx, cy, ring, px, true, RED, Math.PI * 0.95);
    if (nameOnArc) break;
  }
  if (!nameOnArc) {
    y = text(pen, notice.name, cx, y + 40, { px: Math.round(44 * s), weight: 800, color: RED, align: "center", lh: 1.3 });
    cy = y + 20 + r;
  }
  const deg = -8;
  if (pen.draw) {
    const { ctx } = pen;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.translate(-cx, -cy);
    ctx.globalAlpha = 0.92;
    bigStamp(pen, cx, cy, r, stampLines(copy));
    if (nameOnArc) {
      for (let px = namePx; px >= 32; px -= 2) if (arcText({ ...pen, draw: false }, notice.name, cx, cy, ring, px, true, RED, Math.PI * 0.95)) { arcText(pen, notice.name, cx, cy, ring, px, true, RED, Math.PI * 0.95); break; }
    }
    arcText(pen, notice.fact, cx, cy, ring, Math.round(36 * s), false, RED, Math.PI * 0.9);
    ctx.restore();
  }
  pen.minPx = Math.min(pen.minPx, 32);
  y = cy + r + Math.round(44 * s);
  if (notice.price) y = priceLine(pen, notice.price, cx, y, MAXW, Math.round(76 * s), C.navy, "center");
  if (copy.line1) y = text(pen, copy.line1, cx, y + Math.round(10 * s), { px: Math.round(40 * s), weight: 700, align: "center", lh: 1.4 });
  y = text(pen, notice.guard, cx, y + Math.round(10 * s), { px: Math.round(28 * s), color: C.soft, align: "center", lh: 1.45 });
  const phonePx = Math.round(68 * s);
  const phoneTop = foot - Math.round(30 * s) - phonePx * 1.2;
  text(pen, notice.mobile ?? notice.phone, cx, phoneTop, { px: phonePx, weight: 900, color: C.navy, align: "center", lh: 1.2 });
  return { bottom: y, limit: phoneTop - 16 };
};

const DRAW: Record<Exclude<DoneShape, "basic">, Draw> = { white: drawWhite, green: drawGreen, receipt: drawReceipt, stamp: drawStampShape };

// 그리기: 본문이 아래 칸(전화 줄) 위로 넘치면 글자를 5%씩 줄인다(80%까지). 그래도 넘치면 overflow로 알린다. 남는 자리는 절반만큼 내린다(최대 60px).
// copy: 그 모양의 고친 글(checkPaperCopy() 결과). 없으면 처음 문구. '기본'은 머리 줄 제목·도장 글·안내 글을 notice에 넣어 지금 그림을 그린다.
export async function renderDoneShape(canvas: HTMLCanvasElement, shape: DoneShape, notice: DoneNotice, copy?: DoneCopy): Promise<DoneCardResult> {
  const words = copy ?? defaultPaperCopy("done", shape, null);
  if (shape === "basic" || !DRAW[shape]) {
    const message = [notice.message[0], ...(words.consult ? [words.consult] : [])];
    return renderDoneCard(canvas, { ...notice, title: words.title ?? notice.title, stamp: words.stamp ?? notice.stamp, message });
  }
  const draw = DRAW[shape];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const [logo] = await Promise.all([loadLogo(), document.fonts?.ready]);
  const probe: Pen = { ctx, draw: false, minPx: 999, dy: 0, pad: PAD, maxW: MAXW };
  let scale = 1;
  let layout: Layout = { bottom: 0, limit: 0 };
  for (const s of SCALES) {
    scale = s;
    layout = draw(probe, notice, s, logo, words);
    if (layout.bottom <= layout.limit) break;
  }
  const dy = Math.max(0, Math.min(60, (layout.limit - layout.bottom) / 2));
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  const pen: Pen = { ctx, draw: true, minPx: 999, dy, pad: PAD, maxW: MAXW };
  layout = draw(pen, notice, scale, logo, words);
  return { dataUrl: canvas.toDataURL("image/png"), overflow: layout.bottom > layout.limit, minBodyPx: pen.minPx };
}
