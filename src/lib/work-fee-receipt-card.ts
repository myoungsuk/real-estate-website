// 중개보수 영수증 그림(보드 45번 A). canvas 1080×1350에 그리고 toDataURL('image/png')로 내려받는다.
// 항목은 src/lib/work/fee-receipt.mjs의 buildFeeReceipt() 결과를 그대로 쓴다(그림·글·A4가 같은 값).
// 색·글꼴은 실거래가 홍보물 카드(work-realprice-card.ts)와 같은 값을 쓴다.
// 긴 받는 분·물건 표시로 줄이 늘면 먼저 재어 보고 글자를 줄여, 안내 상자가 늘 테두리 안에 들어가게 한다.
export type FeeReceipt = {
  title: string;
  rows: [string, string][];
  officeRows: [string, string][];
  received: string;
  notice: string;
};

export const RECEIPT_CARD_SIZE = Object.freeze({ width: 1080, height: 1350 });

const W = RECEIPT_CARD_SIZE.width;
const H = RECEIPT_CARD_SIZE.height;
const PAD = 80;
const BOTTOM = H - 48; // 안쪽 테두리(24px + 선) 위
const C = { paper: "#FFFFFF", edge: "#E1E4E8", ink: "#141414", navy: "#132A3E", soft: "#46494F", paper2: "#F1F3F5" };
const FONT = 'Pretendard, "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
const font = (px: number, weight = 400) => `${weight} ${px}px ${FONT}`;

// 너비를 넘으면 띄어쓰기에서 줄을 바꾼다(주소의 "105호"가 둘로 갈리지 않게). 한 낱말이 한 줄보다 길면 글자 단위로 자른다.
function lines(ctx: CanvasRenderingContext2D, value: string, maxW: number) {
  const out: string[] = [];
  let line = "";
  for (const word of value.split(/(?<= )/u)) {
    if (line && ctx.measureText(line + word.trimEnd()).width > maxW) {
      out.push(line.trimEnd());
      line = "";
    }
    if (ctx.measureText(word.trimEnd()).width <= maxW) {
      line += word;
      continue;
    }
    for (const char of word) {
      if (line && ctx.measureText(line + char).width > maxW) {
        out.push(line.trimEnd());
        line = "";
      }
      line += char;
    }
  }
  if (line.trim()) out.push(line.trimEnd());
  return out.length ? out : [""];
}

function rule(ctx: CanvasRenderingContext2D, y: number, color = C.edge, lw = 2) {
  ctx.fillStyle = color;
  ctx.fillRect(PAD, y, W - PAD * 2, lw);
}

// 라벨 | 값 표. draw가 false면 재기만 한다. 돌려주는 값: 다음 y. 값이 비면 손으로 적을 밑줄만 남긴다.
function table(ctx: CanvasRenderingContext2D, draw: boolean, rows: [string, string][], y: number, { px, labelW, gap }: { px: number; labelW: number; gap: number }) {
  const valueX = PAD + labelW;
  const valueW = W - PAD - valueX;
  for (const [label, value] of rows) {
    ctx.font = font(px, label === "합계" ? 800 : 500);
    const valueLines = value ? lines(ctx, value, valueW) : [""];
    if (draw) {
      ctx.fillStyle = label === "합계" ? C.navy : C.ink;
      valueLines.forEach((line, index) => ctx.fillText(line, valueX, y + px + index * px * 1.35));
      ctx.font = font(px, 700);
      ctx.fillStyle = C.soft;
      ctx.fillText(label, PAD, y + px);
      if (!value) {
        ctx.fillStyle = C.soft;
        ctx.fillRect(valueX, y + px + 10, valueW, 2);
      }
    }
    y += valueLines.length * px * 1.35 + gap;
  }
  return y;
}

// 본문을 배율 s로 놓는다. 돌려주는 값: 안내 상자 위 y.
function layout(ctx: CanvasRenderingContext2D, draw: boolean, receipt: FeeReceipt, s: number) {
  if (draw) {
    ctx.font = font(64, 800);
    ctx.fillStyle = C.navy;
    ctx.textAlign = "center";
    ctx.fillText(receipt.title, W / 2, 168);
    ctx.textAlign = "left";
    rule(ctx, 212, C.navy, 4);
  }
  let y = table(ctx, draw, receipt.rows, 252, { px: Math.round(36 * s), labelW: 230, gap: Math.round(22 * s) });
  const receivedPx = Math.round(34 * s);
  if (draw) {
    ctx.font = font(receivedPx, 700);
    ctx.fillStyle = C.ink;
    ctx.fillText(receipt.received, PAD, y + receivedPx + 6);
  }
  y += receivedPx + 48 * s;
  if (draw) rule(ctx, y);
  return table(ctx, draw, receipt.officeRows, y + 28 * s, { px: Math.round(26 * s), labelW: 270, gap: Math.round(12 * s) });
}

export async function renderFeeReceiptCard(canvas: HTMLCanvasElement, receipt: FeeReceipt): Promise<string> {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  await document.fonts?.ready;
  ctx.textBaseline = "alphabetic";

  const NOTICE_H = 76;
  let s = 1;
  while (s > 0.6 && layout(ctx, false, receipt, s) + 16 + NOTICE_H > BOTTOM) s -= 0.05;

  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = C.edge;
  ctx.lineWidth = 4;
  ctx.strokeRect(24, 24, W - 48, H - 48);
  const bodyBottom = layout(ctx, true, receipt, s);

  const noticeTop = Math.min(Math.max(bodyBottom + 16, H - 150), BOTTOM - NOTICE_H);
  ctx.fillStyle = C.paper2;
  ctx.fillRect(PAD, noticeTop, W - PAD * 2, NOTICE_H);
  ctx.font = font(28, 700);
  ctx.fillStyle = C.navy;
  ctx.textAlign = "center";
  ctx.fillText(receipt.notice, W / 2, noticeTop + 48);
  ctx.textAlign = "left";
  return canvas.toDataURL("image/png");
}
