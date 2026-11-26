// 홍보 그림 '카톡·문자로 보내기'·'그림 복사' 단추(2026-11-25, 중개날개 대조표 16절 4위). 실거래가 홍보물·미리보기 칸, 글 초안 카드, 홍보 종이, 매물 안내지가 함께 쓴다.
// - 공유: 손님 카드 '가려서 공유'(work-photo-section.ts)와 같이 navigator.canShare({ files })로 먼저 보고, 안 되는 브라우저에서는 단추를 두지 않는다.
// - 복사: navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]). ClipboardItem·clipboard.write가 없거나 PNG를 못 받으면 단추를 두지 않는다.
// - 그림은 이미 그린 data 주소를 누른 그 순간 동기로 풀어 File·Blob으로만 넘긴다(blob 주소를 만들지 않음, 공유 허락이 끊기지 않게). 서버·브라우저 저장소·화면 주소에 넣지 않는다.
// - 공유 창을 닫은 것(AbortError)은 알리지 않는다. 결과 글은 화면마다 있는 role="status" 칸으로 알린다(report).
import { cardCopyLabel, cardDoneLabel, cardImageBytes, cardShareLabel, cardShareText } from "./work/card-share.mjs";

export interface CardImage {
  dataUrl: string;
  fileName: string;
}
export type CardShareReport = (text: string, state: "success" | "error") => void;

const probeFile = () => new File([new Uint8Array(1)], "card.png", { type: "image/png" });

export function canShareCards(count = 1): boolean {
  try {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function"
      && navigator.canShare({ files: Array.from({ length: Math.max(1, count) }, probeFile) });
  } catch {
    return false;
  }
}

export function canCopyCard(): boolean {
  try {
    if (!window.isSecureContext || typeof ClipboardItem !== "function" || typeof navigator.clipboard?.write !== "function") return false;
    const supports = (ClipboardItem as unknown as { supports?: (type: string) => boolean }).supports;
    return typeof supports === "function" ? supports.call(ClipboardItem, "image/png") : true;
  } catch {
    return false;
  }
}

function decode(card: CardImage) {
  const decoded = cardImageBytes(card.dataUrl);
  if (!decoded) throw new Error("CARD_IMAGE_INVALID");
  return decoded;
}

function say(report: CardShareReport, result: string, options: { index?: number; count?: number }) {
  const message = cardShareText(result, options);
  if (message) report(message.text, message.state as "success" | "error");
}

// 여러 장이면 공유 창 하나로 모두 보낸다. 성공하면 true.
export async function shareCards(cards: CardImage[], report: CardShareReport): Promise<boolean> {
  const count = cards.length;
  try {
    const files = cards.map((card) => {
      const { type, bytes } = decode(card);
      return new File([bytes], card.fileName, { type });
    });
    await navigator.share({ files });
    say(report, "shared", { count });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return false;
    say(report, error instanceof DOMException && error.name === "NotAllowedError" ? "share-blocked" : "share-failed", { count });
    return false;
  }
}

export async function copyCard(card: CardImage, report: CardShareReport, { index = 0, count = 1 } = {}): Promise<boolean> {
  try {
    const { type, bytes } = decode(card);
    await navigator.clipboard.write([new ClipboardItem({ [type]: new Blob([bytes], { type }) })]);
    say(report, "copied", { index, count });
    return true;
  } catch {
    say(report, "copy-failed", { index, count });
    return false;
  }
}

function makeButton(label: string, kind: "share" | "copy") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "work-secondary-button";
  button.textContent = label;
  if (kind === "share") button.dataset.cardShare = "";
  else button.dataset.cardCopy = "";
  return button;
}

// 그림 목록(저장 단추와 같은 그림·같은 파일 이름)에 맞춰 되는 단추만 만든다: 보내기 하나(모두) + 장마다 복사. 안 되는 브라우저면 빈 배열.
export function createCardShareButtons(cards: CardImage[], report: CardShareReport): HTMLButtonElement[] {
  const count = cards.length;
  if (count === 0) return [];
  const buttons: HTMLButtonElement[] = [];
  if (canShareCards(count)) {
    const share = makeButton(cardShareLabel(count), "share");
    share.addEventListener("click", async () => {
      if (await shareCards(cards, report)) share.textContent = cardDoneLabel("share");
    });
    buttons.push(share);
  }
  if (canCopyCard()) {
    for (const [index, card] of cards.entries()) {
      const copy = makeButton(cardCopyLabel(index, count), "copy");
      copy.addEventListener("click", async () => {
        if (await copyCard(card, report, { index, count })) copy.textContent = cardDoneLabel("copy", { index, count });
      });
      buttons.push(copy);
    }
  }
  return buttons;
}

// 화면에 미리 둔 두 단추(그림 한 장)를 그 그림의 저장 링크에 묶는다. 저장 링크가 보이고 그림 주소가 있을 때만 보인다.
// 돌려주는 sync()를 저장 링크를 보이거나 숨길 때마다 부른다(그림 저장 단추와 같은 조건).
export function bindCardShare(share: HTMLButtonElement, copy: HTMLButtonElement, link: HTMLAnchorElement, report: CardShareReport): () => void {
  const current = (): CardImage | null => {
    const dataUrl = link.getAttribute("href");
    return !link.hidden && dataUrl ? { dataUrl, fileName: link.download } : null;
  };
  share.addEventListener("click", async () => {
    const card = current();
    if (card && await shareCards([card], report)) share.textContent = cardDoneLabel("share");
  });
  copy.addEventListener("click", async () => {
    const card = current();
    if (card && await copyCard(card, report)) copy.textContent = cardDoneLabel("copy");
  });
  return () => {
    const ready = current() !== null;
    share.textContent = cardShareLabel(1);
    copy.textContent = cardCopyLabel(0, 1);
    share.hidden = !ready || !canShareCards(1);
    copy.hidden = !ready || !canCopyCard();
  };
}
