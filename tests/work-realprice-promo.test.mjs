// 실거래가 홍보물(P1-e) 순수 함수(src/lib/work/realprice-promo.mjs). TK-38: 글 4가지의 자동 첨부·동 번호 0·층 숫자·금액, 해제 거래 빼기.
// 거래는 모두 가상 단지이고 사무소 정보는 공개 office.json이다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { REALPRICE_IDS_MAX, parseTradeIds } from "../worker/realprice-query.mjs";
import { REALPRICE_START_MONTHS } from "../worker/realprice-store.mjs";
import {
  PROMO_COMPARE_FROM,
  PROMO_HIGH_RULE,
  PROMO_HIGH_RULE_SHORT,
  PROMO_IDS_MAX,
  PROMO_LIMITS,
  PROMO_NOTICE,
  PROMO_SOURCE,
  disclosureProblems,
  isPromoSelectable,
  parsePromoIds,
  promoBlockReason,
  promoCards,
  promoFileName,
  promoHref,
  promoNumbers,
  promoSelection,
  promoTexts,
  promoTitle,
  receivedText,
  selectionText,
  textCount,
} from "../src/lib/work/realprice-promo.mjs";

const office = JSON.parse(await readFile(new URL("../src/data/office.json", import.meta.url), "utf8"));
const key = (kind, ymd, n) => `${kind}:${ymd}:${String(n).padStart(20, "0")}:0`;
const RECEIVED = "2026-11-20T00:50:00.000Z"; // 한국 시각 2026. 11. 20. 09:50
const sale = (over) => ({ kind: "sale", priceWon: null, depositWon: null, monthlyRentWon: null, dealingGbn: "broker", cancelled: false, recordHigh: false, prevMaxWon: null, jibun: "123-4", ...over });
const HIGH = sale({ tradeKey: key("sale", "202611", 1), aptName: "가상숲1단지", umdName: "천동", areaM2: 84.97, floor: 15, aptDong: "101", dealDate: "2026-11-12", priceWon: 520_000_000, recordHigh: true, prevMaxWon: 495_000_000 });
const HIGH2 = sale({ tradeKey: key("sale", "202611", 2), aptName: "가상숲2단지", umdName: "천동", areaM2: 59.98, floor: 7, aptDong: "203동", dealDate: "2026-11-08", priceWon: 385_000_000, recordHigh: true, prevMaxWon: 370_000_000 });
const PLAIN = sale({ tradeKey: key("sale", "202610", 3), aptName: "가상들마을", umdName: "신흥동", areaM2: 101.62, floor: -1, aptDong: "", dealDate: "2026-10-30", priceWon: 610_000_000 });
const MONTHLY = { tradeKey: key("rent", "202611", 4), kind: "rent", aptName: "가상숲2단지", umdName: "천동", areaM2: 59.98, floor: 4, aptDong: "205", dealDate: "2026-11-02", priceWon: null, depositWon: 50_000_000, monthlyRentWon: 850_000, dealingGbn: null, cancelled: false, recordHigh: false, prevMaxWon: null };
const JEONSE = { ...MONTHLY, tradeKey: key("rent", "202611", 5), depositWon: 300_000_000, monthlyRentWon: 0, floor: 11, dealDate: "2026-11-01" };
const PRESALE = { ...sale({}), tradeKey: key("presale", "202611", 6), kind: "presale", aptName: "가상센트럴", umdName: "가양동", areaM2: 84.99, floor: 22, aptDong: "", dealDate: "2026-11-05", priceWon: 455_000_000 };
const THREE = [HIGH, HIGH2, PLAIN];
const input = (items, extra = {}) => ({ items, receivedAt: RECEIVED, office, ...extra });

// 넣지 않을 것: 동 번호(101동·203동·아파트 동 칸 값), 호수, 지번, 평 단위, 생활 편의·거리 표현(근거 없는 광고 문구)
const FORBIDDEN = [/\d+\s?동(?![구\w])/u, /\d+\s?호/u, /123-4/u, /평(?![가균])/u, /역세권|학세권|숲세권|편의시설|도보|직선거리|학군|조망/u];
const withoutAddress = (text) => text.replaceAll(office.address, "");

test("서버 상수와 같은 값: 고를 수 있는 수, 거래 ID 형식(worker parseTradeIds와 같은 답), 신고가 비교 시작 연월", () => {
  assert.equal(PROMO_IDS_MAX, REALPRICE_IDS_MAX);
  assert.equal(PROMO_COMPARE_FROM, REALPRICE_START_MONTHS.sale);
  const cases = [
    [HIGH.tradeKey, true],
    [`${HIGH.tradeKey},${MONTHLY.tradeKey},${HIGH.tradeKey}`, true],
    ["sale:202611:xyz:0", false],
    [`${HIGH.tradeKey},`, false],
    [Array.from({ length: 7 }, (_, n) => key("sale", "202611", n)).join(","), false],
    [`${HIGH.tradeKey}' OR '1'='1`, false],
  ];
  for (const [ids, ok] of cases) {
    const search = `?ids=${encodeURIComponent(ids)}`;
    const mine = parsePromoIds(search);
    let server = null;
    try { server = parseTradeIds(new URLSearchParams(search)); } catch { server = null; }
    assert.equal(mine.error === null, ok, ids);
    assert.deepEqual(mine.error === null ? mine.ids : null, server, `화면과 서버가 같은 답: ${ids}`);
  }
  assert.deepEqual(parsePromoIds(""), { ids: [], error: "none" });
  assert.deepEqual(parsePromoIds(`?ids=${HIGH.tradeKey}&ids=${HIGH2.tradeKey}`), { ids: [], error: "invalid" });
});

test("목록 고르기: 해제 거래는 고를 수 없고, 주소는 같은 ID를 합쳐 최대 6건까지만 만든다", () => {
  assert.equal(isPromoSelectable(HIGH), true);
  assert.equal(isPromoSelectable({ ...HIGH, cancelled: true }), false, "해제된 거래는 고를 수 없음");
  assert.equal(isPromoSelectable({ ...HIGH, tradeKey: "x" }), false);
  assert.equal(promoHref([HIGH.tradeKey, HIGH2.tradeKey, HIGH.tradeKey]), `/admin/work/realprice/promo/?ids=${HIGH.tradeKey},${HIGH2.tradeKey}`);
  assert.equal(promoHref([]), null);
  assert.equal(promoHref(Array.from({ length: 7 }, (_, n) => key("sale", "202611", n))), null);
  assert.equal(selectionText(0), "홍보물에 넣을 거래를 고르세요(최대 6건)");
  assert.equal(selectionText(2), "고른 거래 2건");
  assert.equal(selectionText(6), "고른 거래 6건(최대 6건)");
});

test("TK-38 글 4가지(가상 거래 3건): 출처·받은 시각·계약일 기준·신고 기한·해제 제외·명시사항 5항목, 동 번호 0, 층 숫자 그대로, 금액이 자료와 같음", () => {
  const texts = promoTexts(input(THREE));
  assert.deepEqual(Object.keys(texts), ["threads", "instagram", "blog", "kakao"]);
  for (const [kind, text] of Object.entries(texts)) {
    assert.ok(text.includes(PROMO_SOURCE), `${kind}: 출처`);
    const short = kind === "threads" || kind === "kakao";
    assert.ok(text.includes(short ? "11. 20. 09:50 받음" : "2026. 11. 20. 09:50 받은 자료"), `${kind}: 받은 시각(한국 시각)`);
    assert.ok(/계약일 기준/u.test(text) && /신고 기한/u.test(text) && /해제/u.test(text), `${kind}: 계약일 기준·신고 기한·해제 제외 안내`);
    for (const field of ["legalName", "address", "mobile", "registrationNumber", "representative"]) assert.ok(text.includes(office[field]), `${kind}: 명시사항 ${field}`);
    for (const pattern of FORBIDDEN) assert.doesNotMatch(withoutAddress(text), pattern, `${kind}: ${pattern}`);
    for (const money of ["5억 2,000만 원", "3억 8,500만 원", "6억 1,000만 원"]) assert.ok(text.includes(money), `${kind}: 금액 ${money}`);
    assert.ok(text.includes("15층") && text.includes("7층") && text.includes("지하 1층"), `${kind}: 층 숫자 그대로`);
    assert.ok(text.includes("84.97㎡") && text.includes("59.98㎡"), `${kind}: 전용면적`);
    assert.ok(text.includes(short ? PROMO_HIGH_RULE_SHORT : PROMO_HIGH_RULE), `${kind}: 신고가가 있으면 판정 기준과 비교 범위`);
    assert.ok(text.includes("2006년 1월 이후"), `${kind}: 비교 범위`);
  }
  assert.match(PROMO_HIGH_RULE, /2006년 1월 이후 매매와 비교/u);
  assert.match(texts.instagram, /#대전동구 #실거래가 #천동 #신흥동$/u, "해시태그는 #대전동구 #실거래가 #(법정동)만");
  assert.match(texts.blog, /^제목: 대전 동구 아파트 실거래 3건\(2026년 10 ~ 11월 계약\)/u);
  assert.match(texts.blog, /중개사무소 명칭: .+\n소재지: .+\n연락처: .+\n등록번호: .+\n대표 성명: .+$/u, "블로그 끝 명시사항 5줄");
  assert.ok(texts.threads.startsWith("[대전 동구 아파트 실거래가] 실거래 3건(2026년 10 ~ 11월 계약)"));
  assert.ok(textCount("threads", texts.threads).count <= PROMO_LIMITS.threads, "스레드 500자 안");
  assert.ok(!textCount("instagram", texts.instagram).over, "인스타그램 2,200자·해시태그 30개 안");
});

test("금액 모양: 매매·분양권은 거래 금액, 전세는 보증금, 월세는 보증금 / 월세. 숫자 목록은 글과 그림이 같은 값을 쓰는지 대조할 때 쓴다", () => {
  const items = [MONTHLY, JEONSE, PRESALE];
  const texts = promoTexts(input(items));
  for (const text of Object.values(texts)) {
    assert.ok(text.includes("보증금 5,000만 / 월 85만 원"), "월세");
    assert.ok(text.includes("보증금 3억 원"), "전세");
    assert.ok(text.includes("분양권") && text.includes("4억 5,500만 원"), "분양권");
    assert.doesNotMatch(text, /신고가/u, "신고가가 없으면 '신고가' 말을 쓰지 않음");
  }
  assert.deepEqual(promoNumbers([MONTHLY]), ["보증금 5,000만 / 월 85만 원", "59.98㎡", "4층", "2026. 11. 2."]);
  const cards = promoCards(input(items));
  const drawn = cards.flatMap((card) => card.items.flatMap((item) => [item.priceText, item.area, item.floor, item.date]));
  assert.deepEqual(drawn, promoNumbers(items), "그림 숫자 = 글 숫자");
});

test("대장 조건 4: recordHigh가 null(판정 준비 전·첫 상한 날)이면 카드와 글에 '신고가' 말을 쓰지 않고 평소 거래 틀로 쓴다", () => {
  const pending = [{ ...HIGH, recordHigh: null, prevMaxWon: null }, { ...HIGH2, recordHigh: null, prevMaxWon: null }];
  const selection = promoSelection({ items: pending, missing: [], receivedAt: RECEIVED });
  assert.equal(selection.highOff, true);
  assert.match(selection.notices.join(" "), /신고가 판정을 할 수 없어/u);
  const texts = promoTexts(input(selection.items));
  for (const [kind, text] of Object.entries(texts)) assert.doesNotMatch(text, /신고가/u, kind);
  assert.equal(promoTitle(selection.items), "실거래 2건");
  assert.equal(promoTitle([pending[0]]), "가상숲1단지 매매");
  const card = promoCards(input(selection.items))[0];
  assert.equal(JSON.stringify(card).includes("신고가"), false, "카드 자료에도 없음");
  assert.equal(card.highRule, "");
  // 신고가가 true여도 앞선 최고가가 없으면 신고가로 쓰지 않는다(지어내지 않음).
  assert.doesNotMatch(promoTexts(input([{ ...HIGH, prevMaxWon: null }])).blog, /신고가/u);
});

test("대장 조건 3: 고른 뒤 해제로 바뀐 거래·찾지 못한 거래는 빼고 'n건을 뺐습니다'로 알린다. 모두 빠지면 만들지 않는다", () => {
  const data = { items: [HIGH, { ...HIGH2, cancelled: true }, PLAIN], missing: [key("sale", "202611", 9), key("rent", "202611", 8)], receivedAt: RECEIVED };
  const selection = promoSelection(data);
  assert.deepEqual(selection.items.map((item) => item.tradeKey), [HIGH.tradeKey, PLAIN.tradeKey]);
  assert.deepEqual([selection.cancelledCount, selection.missingCount], [1, 2]);
  assert.equal(selection.notices[0], "해제된 거래 1건을 뺐습니다.");
  assert.match(selection.notices[1], /^찾지 못한 거래 2건을 뺐습니다\./u);
  for (const text of Object.values(promoTexts(input(selection.items)))) assert.ok(!text.includes("가상숲2단지"), "해제 거래는 글에 없음");
  const none = promoSelection({ items: [{ ...HIGH, cancelled: true }], missing: [], receivedAt: null });
  assert.deepEqual([none.items, none.receivedAt], [[], null]);
  assert.match(promoBlockReason(input(none.items, { receivedAt: none.receivedAt })), /넣을 거래가 없습니다/u);
  assert.equal(promoTexts(input([])), null);
  assert.deepEqual(promoCards(input([])), []);
});

test("DEC-WT-23: 명시사항 5항목이 하나라도 비면 만들지 않는다. 받은 시각을 모르면 만들지 않는다(지어내지 않음)", () => {
  assert.deepEqual(disclosureProblems(office), []);
  assert.deepEqual(disclosureProblems({ ...office, mobile: " ", registrationNumber: undefined }), ["연락처", "등록번호"]);
  const blocked = input(THREE, { office: { ...office, representative: "" } });
  assert.match(promoBlockReason(blocked), /^사무소 명시사항\(대표 성명\)이 비어 있어/u);
  assert.equal(promoTexts(blocked), null);
  assert.deepEqual(promoCards(blocked), []);
  assert.match(promoBlockReason(input(THREE, { receivedAt: null })), /받은 시각을 확인하지 못해/u);
  assert.equal(promoBlockReason(input(THREE)), null);
});

test("스레드 500자: 1건은 자세히, 여러 건은 한 줄씩, 넘으면 거래 줄을 '그림에 정리' 한 줄로 줄인다", () => {
  const one = promoTexts(input([HIGH])).threads;
  assert.match(one, /^\[대전 동구 아파트 실거래가\] 가상숲1단지 매매 신고가\n\n가상숲1단지\(천동\) 매매 5억 2,000만 원\n전용 84\.97㎡ · 15층 · 계약 2026\. 11\. 12\.\n신고가 · 같은 단지·같은 전용면적 앞선 최고 4억 9,500만 원/u);
  const six = [HIGH, HIGH2, PLAIN, MONTHLY, JEONSE, PRESALE].map((item) => ({ ...item, aptName: `${item.aptName}센트럴파크리버뷰` }));
  const threads = promoTexts(input(six)).threads;
  assert.ok([...threads].length <= PROMO_LIMITS.threads, `${[...threads].length}자`);
  assert.match(threads, /거래 6건\(계약일 2026\. 10\. 30\. ~ 2026\. 11\. 12\.\)은 그림에 정리했습니다\./u);
  assert.equal(textCount("threads", "가".repeat(501)).over, true);
  assert.equal(textCount("instagram", Array.from({ length: 31 }, (_, n) => `#t${n}`).join(" ")).over, true, "해시태그 31개");
  assert.deepEqual(textCount("blog", "가나다"), { count: 3, limit: null, tags: 0, over: false, label: "3자" });
});

test("카드: 3건씩 최대 2장, 여러 장이면 제목 끝 ' · 1/2장', 아래 칸은 출처·받은 시각·안내·명시사항, 신고가가 있는 장만 판정 기준", () => {
  assert.equal(promoCards(input(THREE)).length, 1);
  const six = [HIGH, HIGH2, PLAIN, MONTHLY, JEONSE, PRESALE];
  const cards = promoCards(input(six));
  assert.deepEqual(cards.map((card) => card.title), ["실거래 6건 · 1/2장", "실거래 6건 · 2/2장"]);
  assert.deepEqual(cards.map((card) => card.items.length), [3, 3]);
  assert.deepEqual(cards.map((card) => Boolean(card.highRule)), [true, false], "신고가 없는 장은 판정 기준 줄 없음");
  for (const card of cards) {
    assert.equal(card.source, `출처 ${PROMO_SOURCE}`);
    assert.equal(card.received, `2026. 11. 20. 09:50 받은 자료. ${PROMO_NOTICE}`);
    assert.deepEqual(card.disclosure, [`${office.legalName} · 대표 ${office.representative}`, office.address, `연락처 ${office.mobile} · 등록번호 ${office.registrationNumber}`]);
    assert.equal(card.allHigh, false, "여러 장이면 줄마다 신고가 표");
    for (const item of card.items) assert.equal(Object.hasOwn(item, "aptDong"), false, "카드에 동 번호 칸 없음");
  }
  const allHigh = promoCards(input([HIGH, HIGH2]))[0];
  assert.deepEqual([allHigh.title, allHigh.allHigh], ["매매 신고가 2건", true]);
  assert.equal(promoCards(input([HIGH]))[0].title, "가상숲1단지 매매 신고가");
  assert.equal(JSON.stringify(cards).match(/\d+\s?동(?![구\w])/u), null, "카드 자료 전체에 동 번호 0");
});

test("파일 이름은 날짜만(realprice-YYYYMMDD.png, 두 장이면 -1·-2), 받은 시각은 한국 시각", () => {
  assert.equal(promoFileName("2026-11-20"), "realprice-20261120.png");
  assert.equal(promoFileName("2026-11-20", 1, 2), "realprice-20261120-2.png");
  assert.equal(receivedText("2026-11-19T15:05:00.000Z"), "2026. 11. 20. 00:05");
});
