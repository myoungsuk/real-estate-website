// 홍보 그림 '카톡·문자로 보내기'(휴대폰 공유)·'그림 복사'의 단추 이름·알림 글과 data 주소 풀기(2026-11-25, 중개날개 대조표 16절 4위).
// 그림은 화면에서 만든 PNG data 주소뿐이다. 서버로 보내지 않고, blob 주소·브라우저 저장소·화면 주소에 넣지 않는다.
// 파일 이름은 같은 그림의 저장 단추가 쓰는 이름(날짜만 든 기존 규칙)을 그대로 받는다.

export const CARD_SHARE_LABEL = "카톡·문자로 보내기";
export const CARD_COPY_LABEL = "그림 복사";

// 여러 장이면 한 번에 모두 보낸다(공유 창 하나). 복사는 클립보드에 한 장만 들어가 장마다 단추를 둔다.
export function cardShareLabel(count = 1) {
  return count > 1 ? `${CARD_SHARE_LABEL}(${count}장)` : CARD_SHARE_LABEL;
}

export function cardCopyLabel(index = 0, count = 1) {
  return count > 1 ? `${index + 1}장 복사` : CARD_COPY_LABEL;
}

// 누른 뒤 단추에 남기는 짧은 표시(저장 단추의 '✓ 그림 저장함'과 같은 꼴).
export function cardDoneLabel(kind, { index = 0, count = 1 } = {}) {
  if (kind === "share") return "✓ 보냄";
  return count > 1 ? `✓ ${index + 1}장 복사함` : "✓ 복사함";
}

// 결과마다 알림 한 줄. 공유 창을 닫은 것(AbortError)은 오류가 아니라 알리지 않는다(null).
export function cardShareText(result, { index = 0, count = 1 } = {}) {
  const many = count > 1;
  switch (result) {
    case "shared":
      return { text: many ? `✓ 그림 ${count}장을 공유 창으로 보냈습니다.` : "✓ 그림을 공유 창으로 보냈습니다.", state: "success" };
    case "share-blocked":
      return { text: `공유 창을 열지 못했습니다. '${cardShareLabel(count)}'를 한 번 더 눌러 주세요.`, state: "error" };
    case "share-failed":
      return { text: "공유하지 못했습니다. 그림을 저장한 뒤 카카오톡·문자에서 골라 보내 주세요.", state: "error" };
    case "copied":
      return { text: `✓ ${many ? `${index + 1}번째 그림을` : "그림을"} 복사했습니다. 카카오톡·문자 입력칸에 붙여 넣으세요.`, state: "success" };
    case "copy-failed":
      return { text: "그림을 복사하지 못했습니다. 그림을 저장한 뒤 보내 주세요.", state: "error" };
    default:
      return null;
  }
}

// 'data:image/png;base64,…'를 바이트로 푼다(누른 그 순간 동기로 풀어 공유·복사 허락이 끊기지 않게 함). PNG가 아니면 null.
export function cardImageBytes(dataUrl) {
  const match = /^data:(image\/png);base64,([A-Za-z0-9+/]+={0,2})$/u.exec(String(dataUrl ?? ""));
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { type: match[1], bytes };
}
