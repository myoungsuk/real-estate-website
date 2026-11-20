// 관리자 업무 도구 카드 그림의 공통 그리기 조각(보드 45번 C, 2026-11-20 운영자 결정 "공통 파일"). 실거래가 홍보물 카드와 거래 완료 알림이 함께 쓴다.
// work-realprice-card.ts에 있던 함수를 그대로 옮겼다. 옮기기 전후 실거래가 카드 PNG가 바이트까지 같음을 확인했다.
// 서버 요청·브라우저 저장 없음. 로고는 같은 출처 파일이라 canvas가 오염되지 않아 toDataURL을 쓸 수 있다.

// 색은 DESIGN.md 그대로: 흰 종이, 남색 제목, 회색 테두리, 아래 칸 옅은 회색.
export const CARD_COLORS = Object.freeze({ paper: "#FFFFFF", edge: "#E1E4E8", ink: "#141414", navy: "#132A3E", soft: "#46494F", paper2: "#F1F3F5", rule: "#D5D9DE" });
export const CARD_FONT = 'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
export const LOGO_SRC = "/images/brand/leaders-city-happy-logo.webp";
export const font = (px: number, weight = 400) => `${weight} ${px}px ${CARD_FONT}`;

// pad·maxW는 그 카드의 좌우 여백과 본문 폭(가로줄·글 폭의 기본값). draw가 false면 재기만 한다.
export type Pen = { ctx: CanvasRenderingContext2D; draw: boolean; minPx: number; dy: number; pad: number; maxW: number };
export type Logo = { image: HTMLCanvasElement; x: number; y: number; w: number; h: number };
export type TextOptions = { px: number; weight?: number; color?: string; align?: CanvasTextAlign; maxW?: number; lh?: number };

// 줄 나누기: 띄어쓰기에서 나누고(낱말 안에서 끊지 않음), 한 낱말이 칸보다 길면 글자 단위로 나눈다.
export function wrap(ctx: CanvasRenderingContext2D, value: string, maxW: number) {
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

// 글 한 덩이를 (x, y) 위에서부터 쓰고 다음 y를 돌려준다. pen.draw가 false면 재기만 한다.
export function text(pen: Pen, value: string, x: number, y: number, { px, weight = 400, color = CARD_COLORS.ink, align = "left", maxW = pen.maxW, lh = 1.35 }: TextOptions) {
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
export const width = (pen: Pen, value: string, px: number, weight = 400) => { pen.ctx.font = font(px, weight); return pen.ctx.measureText(value).width; };
export function rect(pen: Pen, x: number, y: number, w: number, h: number, { fill = "", stroke = "", lw = 2 } = {}) {
  if (!pen.draw) return;
  const { ctx } = pen;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, 2); else ctx.rect(x, y, w, h);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}
export function hline(pen: Pen, y: number, color: string = CARD_COLORS.edge, lw = 2) {
  if (!pen.draw) return;
  pen.ctx.fillStyle = color;
  pen.ctx.fillRect(pen.pad, y - lw / 2, pen.maxW, lw);
}

// 공식 로고: 흰 여백을 잘라 쓰고, 거의 흰 바탕(240 이상)은 종이 흰색으로 맞춘다(흰 카드 위에 옅은 네모가 보이지 않게). 같은 출처 파일이라 canvas가 오염되지 않는다.
let logoPromise: Promise<Logo> | null = null;
export function loadLogo() {
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
