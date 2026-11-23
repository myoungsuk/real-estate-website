// 홍보물 화면과 실거래가 오른쪽 미리보기 칸(D-3)이 같이 쓰는 세 규칙(src/lib/work/realprice-promo-load.mjs).
// ① ids로 다시 읽기 ② 해제 거래 빼기 ③ 사무소 명시사항 빈 칸이면 막기. 거래는 모두 가상 단지이고 사무소 정보는 공개 office.json이다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadPromoTrades } from "../src/lib/work/realprice-promo-load.mjs";
import { PROMO_DISCLOSURE_FIELDS, promoCards } from "../src/lib/work/realprice-promo.mjs";

const office = JSON.parse(await readFile(new URL("../src/data/office.json", import.meta.url), "utf8"));
const trade = (index, extra = {}) => ({
  tradeKey: `sale:202611:${String(index).padStart(20, "0")}:1`,
  kind: "sale",
  dealDate: "2026-11-20",
  umdName: "천동",
  aptName: `가상숲${index}단지`,
  areaM2: 84.97,
  floor: 10,
  buildYear: 2020,
  priceWon: 400_000_000 + index * 1_000_000,
  depositWon: null,
  monthlyRentWon: null,
  dealingGbn: "broker",
  cancelled: false,
  aptDong: null,
  recordHigh: false,
  prevMaxWon: null,
  ...extra,
});
const receivedAt = "2026-11-19T03:10:00Z";
// 가짜 읽기 함수: 부른 경로·조건을 적고 정해 둔 응답을 돌려준다.
function reader(answer) {
  const calls = [];
  const read = async (path, query) => {
    calls.push([path, query]);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { read, calls };
}

test("① 담은 거래는 trades?ids= 한 번으로 다시 읽고, 받은 값으로 만든다(화면 메모리 값을 쓰지 않음)", async () => {
  const items = [trade(1), trade(2, { priceWon: 512_000_000 })];
  const { read, calls } = reader({ items, missing: [], receivedAt, recordHighReady: true, warnings: [] });
  const loaded = await loadPromoTrades(read, items.map((item) => item.tradeKey), office);
  assert.deepEqual(calls, [["/realprice/trades", `ids=${items.map((item) => item.tradeKey).join(",")}`]]);
  assert.equal(loaded.blocked, null);
  assert.deepEqual(loaded.input.items.map((item) => item.priceWon), [401_000_000, 512_000_000]);
  assert.equal(loaded.input.receivedAt, receivedAt);
  assert.equal(loaded.input.office, office);
  assert.equal(promoCards(loaded.input).length, 1);
});

test("② 다시 읽은 거래 가운데 해제된 거래는 빼고 알린다, 모두 해제면 만들지 않는다", async () => {
  const items = [trade(1), trade(2, { cancelled: true }), trade(3)];
  const { read } = reader({ items, missing: ["sale:202611:00000000000000000009:1"], receivedAt, recordHighReady: true, warnings: [] });
  const loaded = await loadPromoTrades(read, items.map((item) => item.tradeKey), office);
  assert.deepEqual(loaded.selection.items.map((item) => item.aptName), ["가상숲1단지", "가상숲3단지"]);
  assert.equal(loaded.selection.cancelledCount, 1);
  assert.match(loaded.selection.notices.join(" "), /해제된 거래 1건을 뺐습니다\./u);
  assert.match(loaded.selection.notices.join(" "), /찾지 못한 거래 1건을 뺐습니다\./u);
  assert.equal(loaded.blocked, null);

  const all = reader({ items: [trade(1, { cancelled: true })], missing: [], receivedAt, recordHighReady: true, warnings: [] });
  const none = await loadPromoTrades(all.read, [trade(1).tradeKey], office);
  assert.deepEqual(none.input.items, []);
  assert.equal(none.input.receivedAt, null, "넣을 거래가 없으면 받은 시각도 쓰지 않음");
  assert.match(none.blocked, /홍보물에 넣을 거래가 없습니다/u);
});

test("③ 사무소 명시사항 5항목 가운데 하나라도 비면 막고, 받은 시각을 모르면 막는다", async () => {
  const answer = { items: [trade(1)], missing: [], receivedAt, recordHighReady: true, warnings: [] };
  for (const [key, label] of PROMO_DISCLOSURE_FIELDS) {
    const { read } = reader(answer);
    const loaded = await loadPromoTrades(read, [trade(1).tradeKey], { ...office, [key]: "  " });
    assert.match(loaded.blocked, new RegExp(`사무소 명시사항\\(${label}\\)이 비어 있어`, "u"), key);
    assert.deepEqual(promoCards(loaded.input), [], `${key}: 카드도 만들지 않음`);
  }
  const { read } = reader({ ...answer, receivedAt: null });
  const loaded = await loadPromoTrades(read, [trade(1).tradeKey], office);
  assert.match(loaded.blocked, /자료를 받은 시각을 확인하지 못해/u);
});

test("읽기 실패는 그대로 던져 화면이 자기 문장으로 알린다", async () => {
  const failure = new Error("offline");
  const { read } = reader(failure);
  await assert.rejects(loadPromoTrades(read, [trade(1).tradeKey], office), (error) => error === failure);
});
