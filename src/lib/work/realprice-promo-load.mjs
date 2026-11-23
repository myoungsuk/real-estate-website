import { promoBlockReason, promoSelection } from "./realprice-promo.mjs";

// 홍보물 화면(promo)과 실거래가 목록 오른쪽 미리보기 칸(D-3, 1221px 이상)이 같이 쓰는 세 규칙만 둔다(2026-11-23 대장 조건).
// ① 담은 거래는 화면 메모리 값을 믿지 않고 ids로 다시 읽는다(업무 API trades?ids=).
// ② 다시 읽은 거래 가운데 해제된 거래는 뺀다(promoSelection, 뺀 건수는 notices로 알림).
// ③ 사무소 명시사항이 비었거나 넣을 거래·받은 시각이 없으면 만들지 않는다(promoBlockReason).
// read는 화면이 넘기는 업무 API 읽기 함수(readWork)다. 실패는 그대로 던져 화면이 자기 문장으로 알린다.
export async function loadPromoTrades(read, ids, office) {
  const data = await read("/realprice/trades", `ids=${ids.join(",")}`);
  const selection = promoSelection(data);
  const input = { items: selection.items, receivedAt: selection.receivedAt, office };
  return { selection, input, blocked: promoBlockReason(input) };
}
