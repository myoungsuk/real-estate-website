// 글 초안 카드 그림. canvas 1080×1350 → toDataURL('image/png').
// 2026-11-25 사용자 결정(판 2 물음 7·8 "전부 추천대로"): 방향 A '사진이 주인공'. 칸·알약·도넛 대신 2px 줄과 큰 숫자로만 나누고,
// 모양 4가지(기본·깔끔 카드·잡지·다크)는 실거래가 홍보물과 이름·색을 맞춘다(색은 work-realprice-card.ts PROMO_THEMES를 그대로 읽음).
// 글 묶음은 src/lib/work/blog-cards.mjs가 공개 자료로만 만들고, 이 파일은 그리기만 한다(서버 요청·브라우저 저장 없음).
// - 표지 사진 자리(위 1080×760)에는 단지 사진 또는 화면이 받아 둔 AI 배경 그림(data 주소)을 넣는다. AI 그림이면 'AI 생성 이미지' 표시를 늘 그린다(끌 수 없음).
// - AI 그림에는 글자를 넣지 않는다. 숫자·이름·명시사항은 모두 이 코드가 그림 위·아래에 얹는다(사용자 결정 2).
// - 단지 사진·로고는 같은 출처 파일, AI 그림은 data 주소라 canvas가 오염되지 않는다. 공통 그리기(work-card-draw.ts)는 글꼴·줄 나누기·로고만 쓰고 고치지 않는다.
import { BLOG_CARD_SIZE } from "./work/blog-cards.mjs";
import { CARD_COLORS, font, loadLogo, wrap } from "./work-card-draw";
import { PROMO_THEMES, type PromoStyle } from "./work-realprice-card";

type Row = { label: string; value: number; text: string };
type CoverFact = { label: string; value: string; unit: string };
export type ComplexCoverCard = {
  key: "cover"; label: string; badge: string; image: string | null; imageAlt: string; big: string; unit: string; bigNote: string; titleLines: string[]; chips: string[];
  name: string; subtitle: string; facts: CoverFact[]; disclosure: string[];
};
export type ComplexInfoCard = {
  key: "info"; label: string; badge: string; name: string; subtitle: string; households: string;
  donut: { title: string; rows: Row[] } | null;
  side: { title: string; big: string | null; unit: string | null; note: string | null; rows: [string, string][] } | null;
  supplyBar: Row[] | null; tiles: { label: string; value: string }[]; sourceLine: string; disclosure: string[];
};
export type ComplexChecksCard = { key: "checks"; label: string; badge: string; kicker: string; heading: string; titleLines: string[]; lede: string; items: string[]; disclosure: string[] };
export type ListingCoverCard = { key: "listing"; label: string; badge: string; chip: string; name: string; price: string; rows: { key: string; label: string; value: string }[]; disclosure: string[] };
export type BlogCard = ComplexCoverCard | ComplexInfoCard | ComplexChecksCard | ListingCoverCard;
export type BlogCardImage = { key: string; label: string; dataUrl: string; alt: string };
export type BlogCardResult = { images: BlogCardImage[]; overflow: boolean };
export type BlogCardLook = PromoStyle;
// look: 카드 모양(처음 기본). coverImage: 표지 사진 자리에 넣을 AI 배경 그림(data:image/jpeg 주소). 없으면 단지 사진.
export type BlogCardOptions = { look?: BlogCardLook; coverImage?: string | null };

const W = BLOG_CARD_SIZE.width;
const H = BLOG_CARD_SIZE.height;
const PAD = 72;
const MAXW = W - PAD * 2;
const PHOTO_H = 760;
const FOOT_MIN = 164;
const LOGO_W = 112;
const LOGO_H = 90;
export const BLOG_AI_MARK = "AI 생성 이미지";

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string };
type Look = {
  bg: string; ink: string; soft: string; rule: string; acc: string; band: string | null; strip: string; plate: boolean; bars: string[];
};
// 홍보물 모양 값 → 이 카드의 칠(배경·글·강조·잡지 띠·다크 로고 판). 2px 줄은 밝은 모양이면 공통 줄 색, 다크면 홍보물 줄 색.
export function blogLook(look: BlogCardLook = "basic"): Look {
  const t = PROMO_THEMES[look] ?? PROMO_THEMES.basic;
  const dark = Boolean(t.markPlate);
  return {
    bg: t.bg,
    ink: t.ink,
    soft: t.soft,
    rule: dark ? "rgba(255, 255, 255, 0.18)" : CARD_COLORS.rule,
    acc: t.price,
    band: t.band,
    strip: dark ? "rgba(255, 255, 255, 0.08)" : CARD_COLORS.paper2,
    plate: dark,
    // 막대 칸 색(첫 칸 강조, 둘째 회청). 뜻은 범례 글자가 전한다(색만으로 전하지 않음).
    bars: dark ? [t.price, "rgba(255, 255, 255, 0.32)", "rgba(255, 255, 255, 0.6)", "rgba(255, 255, 255, 0.16)"] : [t.price, "#A9B5C1", "#5F7891", "#D5DCE3"],
  };
}

type TextOpt = { px: number; w?: number; color: string; align?: CanvasTextAlign; maxW?: number; lh?: number; ls?: number };
function setFont(ctx: Ctx, px: number, w: number, ls: number) {
  ctx.font = font(px, w);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${ls}px`;
}
const linesOf = (ctx: Ctx, value: string, maxW: number) => value.split("\n").flatMap((part) => wrap(ctx, part, maxW));
// 글 쓰기: 위쪽 y에서 시작해 다음 y를 돌려준다. 줄바꿈 기준은 띄어쓰기.
function t(ctx: Ctx, value: string, x: number, y: number, { px, w = 400, color, align = "left", maxW = MAXW, lh = 1.3, ls = 0 }: TextOpt, draw = true) {
  ctx.save();
  setFont(ctx, px, w, ls);
  const lines = linesOf(ctx, value, maxW);
  if (draw) {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    lines.forEach((line, index) => ctx.fillText(line, x, y + px * lh * (index + 0.5)));
  }
  ctx.restore();
  return y + lines.length * px * lh;
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
function fill(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}
// 숫자 + 단위(글자 아래선 기준). 돌려주는 값은 쓴 폭.
function numberUnit(ctx: Ctx, value: string, unit: string, x: number, baseline: number, px: number, unitPx: number, color: string, unitColor: string) {
  ctx.save();
  setFont(ctx, px, 900, -2);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(value, x, baseline);
  const nw = ctx.measureText(value).width;
  let uw = 0;
  if (unit) {
    setFont(ctx, unitPx, 800, 0);
    ctx.fillStyle = unitColor;
    ctx.fillText(unit, x + nw + 6, baseline);
    uw = ctx.measureText(unit).width + 6;
  }
  ctx.restore();
  return nw + uw;
}
// "1,957대" → ["1,957", "대"], 숫자로 시작하지 않으면 [글, ""].
function splitNumber(value: string): [string, string] {
  const match = value.match(/^([\d][\d,.]*)\s*(.*)$/u);
  return match ? [match[1], match[2]] : [value, ""];
}

// 로고: 공통 로고(흰 여백 자름). 밝은 바탕에서는 흰 바탕만 투명하게 바꾼 사본, 다크는 흰 판 위에 원본.
let clearLogo: Promise<HTMLCanvasElement> | null = null;
let plainLogo: Promise<HTMLCanvasElement> | null = null;
function logoCanvas(clear: boolean) {
  return loadLogo().then((logo) => {
    const out = document.createElement("canvas");
    out.width = logo.w;
    out.height = logo.h;
    const ctx = out.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(logo.image, logo.x, logo.y, logo.w, logo.h, 0, 0, logo.w, logo.h);
    if (!clear) return out;
    const image = ctx.getImageData(0, 0, logo.w, logo.h);
    const data = image.data;
    for (let at = 0; at < data.length; at += 4) {
      const low = Math.min(data[at], data[at + 1], data[at + 2]);
      if (low > 244) data[at + 3] = 0;
      else if (low > 225) data[at + 3] = Math.round((data[at + 3] * (244 - low)) / 19);
    }
    ctx.putImageData(image, 0, 0);
    return out;
  });
}
function loadBrand(plate: boolean) {
  if (plate) {
    plainLogo ??= logoCanvas(false).catch((error) => { plainLogo = null; throw error; });
    return plainLogo;
  }
  clearLogo ??= logoCanvas(true).catch((error) => { clearLogo = null; throw error; });
  return clearLogo;
}
// 사진(같은 출처 /images/ 또는 data 주소). 못 읽으면 null.
function loadPhoto(src: string | null) {
  if (!src) return Promise.resolve(null);
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}
function cover(ctx: Ctx, image: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / image.width, h / image.height);
  const sw = w / s;
  const sh = h / s;
  ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
}

// ── 아래 칸: 2px 위줄 + 사무소 명시사항(첫 줄 상호 굵게) + 오른쪽 로고. 돌려주는 값은 칸 위 끝 ──
const FOOT_TEXT_W = MAXW - LOGO_W - 28;
function footHeight(ctx: Ctx, lines: string[]) {
  let h = 0;
  lines.forEach((line, index) => {
    h = t(ctx, line, 0, h, { px: index === 0 ? 26 : 24, w: index === 0 ? 800 : 400, color: "", maxW: FOOT_TEXT_W, lh: 1.4 }, false);
  });
  return Math.max(FOOT_MIN, Math.ceil(h + 52));
}
function foot(ctx: Ctx, lines: string[], look: Look, logo: HTMLCanvasElement) {
  const h = footHeight(ctx, lines);
  const top = H - h;
  fill(ctx, 0, top, W, h, look.bg);
  fill(ctx, PAD, top, MAXW, 2, look.rule);
  let textH = 0;
  lines.forEach((line, index) => {
    textH = t(ctx, line, 0, textH, { px: index === 0 ? 26 : 24, w: index === 0 ? 800 : 400, color: "", maxW: FOOT_TEXT_W, lh: 1.4 }, false);
  });
  let y = top + 2 + (h - 2 - textH) / 2;
  lines.forEach((line, index) => {
    y = t(ctx, line, PAD, y, { px: index === 0 ? 26 : 24, w: index === 0 ? 800 : 400, color: index === 0 ? look.ink : look.soft, maxW: FOOT_TEXT_W, lh: 1.4 });
  });
  const scale = Math.min(LOGO_W / logo.width, LOGO_H / logo.height);
  const lw = logo.width * scale;
  const lh = logo.height * scale;
  const lx = W - PAD - lw;
  const ly = top + 2 + (h - 2 - lh) / 2;
  if (look.plate) {
    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(lx - 10, ly - 10, lw + 20, lh + 20, 10); else ctx.rect(lx - 10, ly - 10, lw + 20, lh + 20);
    ctx.fillStyle = "#FFFFFF";
    ctx.fill();
    ctx.restore();
  }
  ctx.drawImage(logo, lx, ly, lw, lh);
  return top;
}

// 'AI 생성 이미지' 표시: 사진 자리 오른쪽 아래, 어두운 판 위 흰 글자(어떤 그림 위에서도 읽힘).
function aiMark(ctx: Ctx) {
  const px = 26;
  const padX = 18;
  const w = tw(ctx, BLOG_AI_MARK, px, 700) + padX * 2;
  const h = 48;
  const x = W - 24 - w;
  const y = PHOTO_H - 24 - h;
  ctx.save();
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, 8); else ctx.rect(x, y, w, h);
  ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
  ctx.fill();
  ctx.restore();
  t(ctx, BLOG_AI_MARK, x + padX, y + (h - px * 1.3) / 2, { px, w: 700, color: "#FFFFFF", maxW: w });
}

// ── 1장: 표지(사진 가장자리까지 → 이름 → 한 줄 → 2px 줄 → 숫자 3개) ──
function drawCover(ctx: Ctx, card: ComplexCoverCard, look: Look, logo: HTMLCanvasElement, photo: HTMLImageElement | null, ai: boolean) {
  fill(ctx, 0, 0, W, H, look.bg);
  if (photo) cover(ctx, photo, 0, 0, W, PHOTO_H);
  else {
    fill(ctx, 0, 0, W, PHOTO_H, look.strip);
    t(ctx, "사진 없음", W / 2, PHOTO_H / 2 - 20, { px: 30, w: 600, color: look.soft, align: "center" });
  }
  if (photo && ai) aiMark(ctx);
  const bottom = H - footHeight(ctx, card.disclosure);
  const namePx = fit(ctx, card.name, 108, 72, MAXW, 900, -3);
  const layout = (draw: boolean) => {
    let y = t(ctx, card.name, PAD, 808, { px: namePx, w: 900, color: look.ink, ls: -3, lh: 1.12 }, draw);
    if (card.subtitle) y = t(ctx, card.subtitle, PAD, y + 20, { px: 34, w: 500, color: look.soft }, draw);
    return y;
  };
  const textEnd = layout(false);
  if (look.band) fill(ctx, 0, PHOTO_H, W, textEnd + 24 - PHOTO_H, look.band);
  layout(true);
  const factsTop = textEnd + 40;
  let overflow = false;
  if (card.facts.length > 0) {
    fill(ctx, PAD, factsTop, MAXW, 2, look.rule);
    const gap = 64;
    // 숫자 크기는 셋이 한 줄에 들어갈 때까지 줄인다(76 → 52).
    let px = 76;
    const widthAt = (size: number) => card.facts.reduce((sum, fact) => sum + Math.max(tw(ctx, fact.label, 26, 700), tw(ctx, fact.value, size, 900, -2) + 6 + tw(ctx, fact.unit, Math.round(size * 0.42), 800)), 0) + gap * (card.facts.length - 1);
    while (px > 52 && widthAt(px) > MAXW) px -= 4;
    let x = PAD;
    const labelY = factsTop + 2 + 30;
    const baseline = labelY + 26 * 1.3 + 8 + px * 0.78;
    for (const fact of card.facts) {
      t(ctx, fact.label, x, labelY, { px: 26, w: 700, color: look.soft, maxW: MAXW });
      const used = numberUnit(ctx, fact.value, fact.unit, x, baseline, px, Math.round(px * 0.42), look.ink, look.ink);
      x += Math.max(used, tw(ctx, fact.label, 26, 700)) + gap;
    }
    overflow = baseline + 16 > bottom || widthAt(px) > MAXW;
  } else {
    overflow = textEnd > bottom;
  }
  foot(ctx, card.disclosure, look, logo);
  return overflow;
}

// 막대 한 묶음(제목 → 꽉 찬 막대 → 범례). 돌려주는 값은 다음 y.
function bars(ctx: Ctx, title: string, rows: Row[], y: number, look: Look, draw: boolean) {
  const titleEnd = t(ctx, title, PAD, y, { px: 28, w: 800, color: look.ink }, draw);
  const barTop = titleEnd + 12;
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (draw && total > 0) {
    let at = PAD;
    rows.forEach((row, index) => {
      const w = index === rows.length - 1 ? PAD + MAXW - at : (MAXW * row.value) / total;
      fill(ctx, at, barTop, Math.max(0, w - (index === rows.length - 1 ? 0 : 3)), 26, look.bars[index % look.bars.length]);
      at += w;
    });
  }
  // 범례: 네모 + 이름 + 굵은 값. 한 줄에 다 들어가지 않으면 다음 줄로.
  let lx = PAD;
  let ly = barTop + 26 + 14;
  const lineH = 26 * 1.4;
  rows.forEach((row, index) => {
    const labelW = tw(ctx, `${row.label} `, 26, 400);
    const valueW = tw(ctx, row.text, 26, 800);
    const itemW = 18 + 10 + labelW + valueW;
    if (lx > PAD && lx + itemW > PAD + MAXW) {
      lx = PAD;
      ly += lineH;
    }
    if (draw) {
      fill(ctx, lx, ly + (lineH - 18) / 2, 18, 18, look.bars[index % look.bars.length]);
      t(ctx, `${row.label} `, lx + 28, ly, { px: 26, color: look.soft, lh: 1.4, maxW: MAXW });
      t(ctx, row.text, lx + 28 + labelW, ly, { px: 26, w: 800, color: look.ink, lh: 1.4, maxW: MAXW });
    }
    lx += itemW + 32;
  });
  return ly + lineH;
}

// ── 2장: 단지 정보(제목 → 한 줄 → 줄로 나눈 숫자 목록 → 막대 → 출처) ──
function infoRows(card: ComplexInfoCard) {
  const rows: { label: string; note: string; value: string; unit: string }[] = [{ label: "세대수", note: "", value: card.households, unit: "세대" }];
  const side = card.side;
  if (side?.big) {
    if (side.title === "주차") rows.push({ label: "주차", note: side.note ?? "", value: side.big, unit: side.unit ?? "대" });
    else rows.push({ label: side.title, note: "", ...(() => { const [value, unit] = splitNumber(side.big); return { value, unit }; })() });
    if (side.title !== "주차" && side.note) {
      const [value, unit] = splitNumber(side.note.replace(/개동$/u, " 개동"));
      rows.push({ label: "동 수", note: "", value, unit: unit.trim() });
    }
  } else if (side?.rows.length) {
    for (const [label, value] of side.rows) {
      const [number, unit] = splitNumber(value);
      rows.push({ label: `주차(${label})`, note: "", value: number, unit });
    }
  }
  for (const tile of card.tiles) {
    const [value, unit] = splitNumber(tile.value);
    rows.push({ label: tile.label, note: "", value, unit });
  }
  return rows;
}
function drawInfo(ctx: Ctx, card: ComplexInfoCard, look: Look, logo: HTMLCanvasElement) {
  fill(ctx, 0, 0, W, H, look.bg);
  const title = `${card.name} 한눈에`;
  const titlePx = fit(ctx, title, 84, 56, MAXW, 900, -2);
  const head = (draw: boolean) => {
    let y = t(ctx, title, PAD, 72, { px: titlePx, w: 900, color: look.ink, ls: -2, lh: 1.15 }, draw);
    if (card.subtitle) y = t(ctx, card.subtitle, PAD, y + 12, { px: 32, color: look.soft }, draw);
    return y;
  };
  const headEnd = head(false);
  if (look.band) fill(ctx, 0, 0, W, headEnd + 34, look.band);
  head(true);
  const bottom = H - footHeight(ctx, card.disclosure) - 24;
  const groups = [card.donut, card.supplyBar ? { title: "공급 구성", rows: card.supplyBar.map((row) => ({ ...row, text: row.text.replace(`${row.label} `, "") })) } : null]
    .filter((group): group is { title: string; rows: Row[] } => Boolean(group));
  // 아래(막대·출처) 높이를 먼저 재고, 숫자 목록은 남는 자리에 들어가는 줄까지만 싣는다(4줄을 넘지 않음).
  let lowerH = 0;
  for (const group of groups) lowerH = bars(ctx, group.title, group.rows, lowerH, look, false) + 28;
  const sourceH = card.sourceLine ? t(ctx, card.sourceLine, 0, 0, { px: 21, color: "", lh: 1.35 }, false) : 0;
  lowerH += sourceH;
  const listTop = Math.max(headEnd + 44, 272);
  const rowH = (px: number) => 16 + 14 + px * 0.92 + 2;
  const all = infoRows(card);
  let px = 76;
  let count = Math.min(4, all.length);
  while (count > 1 && listTop + rowH(px) * count + 2 + 28 + lowerH > bottom) {
    if (px > 60) px -= 8;
    else count -= 1;
  }
  const rows = all.slice(0, count);
  let y = listTop;
  for (const row of rows) {
    fill(ctx, PAD, y, MAXW, 2, look.rule);
    const mid = y + 2 + 16 + (px * 0.92) / 2;
    const noteGap = row.note ? 10 : 0;
    const labelW = tw(ctx, row.label, 32, 700);
    t(ctx, row.label, PAD, mid - 32 * 0.65, { px: 32, w: 700, color: look.soft, maxW: MAXW / 2 });
    if (row.note) t(ctx, row.note, PAD + labelW + noteGap, mid - 24 * 0.65 + 4, { px: 24, color: look.soft, maxW: MAXW / 2 - labelW - noteGap });
    const unitPx = Math.round(px * 0.42);
    const numW = tw(ctx, row.value, px, 900, -2);
    const unitW = row.unit ? tw(ctx, row.unit, unitPx, 800) + 6 : 0;
    const right = PAD + MAXW;
    const baseline = mid + px * 0.34;
    numberUnit(ctx, row.value, row.unit, right - numW - unitW, baseline, px, unitPx, look.ink, look.ink);
    y += rowH(px);
  }
  fill(ctx, PAD, y, MAXW, 2, look.rule);
  y += 2 + 28;
  for (const group of groups) y = bars(ctx, group.title, group.rows, y, look, true) + 28;
  if (card.sourceLine) y = t(ctx, card.sourceLine, PAD, y - 6, { px: 21, color: look.soft, lh: 1.35 });
  foot(ctx, card.disclosure, look, logo);
  return y > bottom + 24;
}

// ── 3장: 현장에서 확인할 점(제목 2줄 → 한 줄 → 번호 + 글, 줄로 나눔) ──
function drawChecks(ctx: Ctx, card: ComplexChecksCard, look: Look, logo: HTMLCanvasElement) {
  fill(ctx, 0, 0, W, H, look.bg);
  const heading = (card.titleLines?.length ? card.titleLines : [card.kicker, card.heading]).join("\n");
  const head = (draw: boolean) => {
    let y = t(ctx, heading, PAD, 72, { px: 84, w: 900, color: look.ink, ls: -2, lh: 1.15 }, draw);
    if (card.lede) y = t(ctx, card.lede, PAD, y + 12, { px: 32, color: look.soft }, draw);
    return y;
  };
  const headEnd = head(false);
  if (look.band) fill(ctx, 0, 0, W, headEnd + 34, look.band);
  head(true);
  const bottom = H - footHeight(ctx, card.disclosure) - 24;
  const top = Math.max(headEnd + 44, 330);
  const textW = MAXW - 92;
  let px = 40;
  const heightAt = (size: number) => card.items.reduce((sum, item) => sum + 2 + 26 * 2 + Math.max(t(ctx, item, 0, 0, { px: size, w: 700, color: "", maxW: textW, lh: 1.32 }, false), 52 * 1.1), 0);
  while (px > 30 && top + heightAt(px) > bottom) px -= 2;
  let y = top;
  card.items.forEach((item, index) => {
    fill(ctx, PAD, y, MAXW, 2, look.rule);
    const inner = y + 2 + 26;
    t(ctx, String(index + 1), PAD, inner - 4, { px: 52, w: 900, color: look.acc, lh: 1.1 });
    const end = t(ctx, item, PAD + 92, inner, { px, w: 700, color: look.ink, maxW: textW, lh: 1.32 });
    y = Math.max(end, inner + 52 * 1.1) + 26;
  });
  foot(ctx, card.disclosure, look, logo);
  return y > bottom;
}

// ── 매물 표지(사진 없음): 거래·종류 → 매물 이름 → 큰 가격 → 명시사항 줄 목록 ──
function listingBody(ctx: Ctx, card: ListingCoverCard, look: Look, s: number, draw: boolean) {
  const bottom = H - footHeight(ctx, card.disclosure) - 24;
  const head = (paint: boolean) => {
    let y = t(ctx, card.chip, PAD, 72, { px: Math.round(30 * s), w: 800, color: look.acc }, paint);
    y = t(ctx, card.name, PAD, y + 8, { px: Math.round(76 * s), w: 900, color: look.ink, lh: 1.15, ls: -2 }, paint);
    const pricePx = fit(ctx, card.price, Math.round(108 * s), 56, MAXW, 900, -3);
    y = t(ctx, card.price, PAD, y + 16, { px: pricePx, w: 900, color: look.acc, lh: 1.15, ls: -3 }, paint);
    return y;
  };
  const headEnd = head(false);
  if (draw && look.band) fill(ctx, 0, 0, W, headEnd + 30, look.band);
  if (draw) head(true);
  const px = Math.round(28 * s);
  const labelW = Math.round(220 * s);
  let y = headEnd + 40;
  card.rows.forEach((row) => {
    if (draw) fill(ctx, PAD, y, MAXW, 2, look.rule);
    const inner = y + 2 + Math.round(12 * s);
    if (draw) t(ctx, row.label, PAD, inner, { px, w: 700, color: look.soft, maxW: labelW - 16, lh: 1.32 });
    const end = t(ctx, row.value, PAD + labelW, inner, { px, w: 600, color: look.ink, maxW: MAXW - labelW, lh: 1.32 }, draw);
    const labelEnd = t(ctx, row.label, PAD, inner, { px, w: 700, color: "", maxW: labelW - 16, lh: 1.32 }, false);
    y = Math.max(end, labelEnd) + Math.round(12 * s);
  });
  if (draw) fill(ctx, PAD, y, MAXW, 2, look.rule);
  return { end: y + 2, bottom };
}
function drawListing(ctx: Ctx, card: ListingCoverCard, look: Look, logo: HTMLCanvasElement) {
  fill(ctx, 0, 0, W, H, look.bg);
  let scale = 1;
  for (const s of [1, 0.95, 0.9, 0.85, 0.8]) {
    scale = s;
    const { end, bottom } = listingBody(ctx, card, look, s, false);
    if (end <= bottom) break;
  }
  const { end, bottom } = listingBody(ctx, card, look, scale, true);
  foot(ctx, card.disclosure, look, logo);
  return end > bottom;
}

// 카드 묶음 → PNG data 주소(blob 주소를 쓰지 않음). overflow가 참이면 화면이 그림을 내보내지 않는다.
export async function renderBlogCards(canvas: HTMLCanvasElement, cards: BlogCard[], { look = "basic", coverImage = null }: BlogCardOptions = {}): Promise<BlogCardResult> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) throw new Error("canvas");
  const paint = blogLook(look);
  const coverCard = cards.find((card): card is ComplexCoverCard => card.key === "cover");
  const ai = Boolean(coverCard && coverImage);
  const [logo, photo] = await Promise.all([loadBrand(paint.plate), loadPhoto(coverCard ? coverImage ?? coverCard.image : null), document.fonts?.ready]);
  if (ai && !photo) throw new Error("ai-image");
  const images: BlogCardImage[] = [];
  let overflow = false;
  for (const [index, card] of cards.entries()) {
    ctx.clearRect(0, 0, W, H);
    if (card.key === "cover") overflow = drawCover(ctx, card, paint, logo, photo, ai) || overflow;
    else if (card.key === "info") overflow = drawInfo(ctx, card, paint, logo) || overflow;
    else if (card.key === "checks") overflow = drawChecks(ctx, card, paint, logo) || overflow;
    else overflow = drawListing(ctx, card, paint, logo) || overflow;
    const count = cards.length > 1 ? ` ${index + 1}/${cards.length}장` : "";
    const mark = card.key === "cover" && ai ? ` (표지 사진 자리는 ${BLOG_AI_MARK})` : "";
    images.push({ key: card.key, label: card.label, dataUrl: canvas.toDataURL("image/png"), alt: `카드 그림${count}: ${card.label}${mark}` });
  }
  return { images, overflow };
}
