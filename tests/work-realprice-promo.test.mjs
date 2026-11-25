// 실거래가 홍보물(P1-e) 순수 함수(src/lib/work/realprice-promo.mjs). TK-38: 글 4가지의 자동 첨부(스레드는 2026-11-25부터 그림에만)·동 번호 0·층 숫자·금액, 해제 거래 빼기.
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
  PROMO_NOTICE_SHORT,
  PROMO_ONE_CARD_MAX,
  PROMO_SOURCE,
  PROMO_STYLES,
  PROMO_STYLE_DEFAULT,
  PROMO_TEXT_TAIL,
  disclosureProblems,
  isPromoStyle,
  priceSplit,
  promoPages,
  promoUpText,
  isPromoSelectable,
  parsePromoIds,
  promoBlockReason,
  promoAreaLabel,
  promoCards,
  promoRegion,
  promoRegionTags,
  promoFileName,
  promoHref,
  promoNumbers,
  promoSelection,
  promoTexts,
  promoTitle,
  receivedText,
  PROMO_HASHTAGS_MAX,
  PROMO_PLACES,
  PROMO_TEXT_KINDS,
  hashtags,
  promoSteps,
  selectionText,
  takeButtonView,
  takeResultText,
  takeVisible,
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
  assert.equal(selectionText(0), "홍보물에 넣을 거래를 담으세요(최대 6건)");
  assert.equal(selectionText(2), "담은 거래 2건");
  assert.equal(selectionText(6), "담은 거래 6건(최대 6건)");
});

test("P1-f 다 담기: 보이는 순서대로 해제·이미 담은 거래를 건너뛰고 남은 자리만큼(6건 넘지 않음), 단추 글자는 보이는 수·남은 자리·담은 수에 맞춤", () => {
  const trades = Array.from({ length: 9 }, (_, n) => sale({ tradeKey: key("sale", "202611", 10 + n), aptName: `가상숲${n}단지`, umdName: "천동", areaM2: 84.97, floor: 3, dealDate: "2026-11-10", priceWon: 300_000_000 }));
  const cancelled = { ...trades[1], cancelled: true };
  const visible = [trades[0], cancelled, ...trades.slice(2)];
  const none = new Set();
  assert.deepEqual(takeButtonView(visible, none), { text: "위에서 6건 담기", disabled: false }, "보이는 8건 > 남은 자리 6");
  const first = takeVisible(visible, none);
  assert.deepEqual(first.add.map((item) => item.tradeKey), [trades[0], ...trades.slice(2, 7)].map((item) => item.tradeKey), "해제 1건은 건너뛰고 6건");
  assert.equal(first.skippedCancelled, 1);
  assert.equal(takeResultText(6, 1, 6), "6건을 담았습니다. 해제 거래 1건은 건너뛰었습니다. 담은 거래 6건(최대 6건).");
  const full = new Set(first.add.map((item) => item.tradeKey));
  assert.deepEqual(takeButtonView(visible, full), { text: "6건 담음", disabled: true });
  assert.deepEqual(takeVisible(visible, full).add, [], "다 차면 더 담지 않음");
  const three = new Set([trades[0].tradeKey, trades[2].tradeKey, trades[3].tradeKey]);
  assert.deepEqual(takeButtonView(visible, three), { text: "위에서 3건 더 담기", disabled: false });
  assert.deepEqual(takeVisible(visible, three).add.map((item) => item.tradeKey), trades.slice(4, 7).map((item) => item.tradeKey), "이미 담은 것은 건너뜀");
  assert.deepEqual(takeButtonView(trades.slice(0, 2), none), { text: "보이는 2건 담기", disabled: false }, "보이는 거래가 남은 자리보다 적음");
  assert.deepEqual(takeButtonView(trades.slice(0, 2), new Set([trades[0].tradeKey])), { text: "보이는 1건 더 담기", disabled: false });
  assert.deepEqual(takeButtonView([cancelled], none), { text: "담을 거래 없음", disabled: true }, "해제 거래만 보이면 꺼짐");
  assert.deepEqual(takeButtonView([trades[0]], new Set([trades[0].tradeKey])), { text: "보이는 거래 다 담음", disabled: true });
  assert.equal(takeResultText(2, 0, 5), "2건을 담았습니다. 담은 거래 5건.");
});

test("P1-f 해시태그: 고정 4개 → 거래 종류 → #신고가 → 법정동 3 → 전용면적 2 → 단지 이름 3, 겹치면 하나, 12개 안이고 넘치면 단지 이름을 지킴", () => {
  assert.deepEqual(hashtags(THREE), ["#대전동구", "#동구아파트", "#대전아파트", "#아파트실거래가", "#아파트매매", "#신고가", "#천동", "#신흥동", "#전용84", "#가상숲1단지", "#가상숲2단지", "#가상들마을"]);
  assert.deepEqual(hashtags([PLAIN]), ["#대전동구", "#동구아파트", "#대전아파트", "#아파트실거래가", "#아파트매매", "#신흥동", "#전용101", "#가상들마을"], "신고가가 아니면 #신고가 없음");
  const spaced = { ...PLAIN, aptName: "가상 숲(2단지)", umdName: "신흥동" };
  assert.deepEqual(hashtags([spaced]).at(-1), "#가상숲2단지", "띄어쓰기·괄호를 뺌");
  const mixed = [MONTHLY, JEONSE, PRESALE, HIGH, HIGH2, PLAIN];
  const tags = hashtags(mixed);
  assert.ok(tags.length <= PROMO_HASHTAGS_MAX, tags.join(" "));
  assert.deepEqual(tags.slice(4, 9), ["#아파트월세", "#아파트전세", "#분양권", "#아파트매매", "#신고가"], "거래 종류는 나온 순서대로 하나씩");
  assert.deepEqual(tags.slice(-3), ["#가상숲2단지", "#가상센트럴", "#가상숲1단지"], "단지 이름 3개는 지킴");
  assert.equal(new Set(tags).size, tags.length, "겹치지 않음");
  for (const tag of tags) assert.doesNotMatch(tag, /\d+동$|\d+호/u, `동 번호·호수 없음: ${tag}`);
});

test("TK-38 글 4가지(가상 거래 3건): 출처·받은 시각·계약일 기준·신고 기한·해제 제외·명시사항 5항목(스레드 글은 그림에만), 동 번호 0, 층 숫자 그대로, 금액이 자료와 같음", () => {
  const texts = promoTexts(input(THREE));
  assert.deepEqual(Object.keys(texts), ["threads", "instagram", "blog", "kakao"]);
  for (const [kind, text] of Object.entries(texts)) {
    const short = kind === "threads" || kind === "kakao";
    if (kind === "threads") {
      // 스레드 글은 출처·받은 시각·안내·사무소 명시사항을 넣지 않는다(2026-11-25 사용자 요청, 카드 그림에만).
      assert.ok(!text.includes(PROMO_SOURCE) && !text.includes("출처") && !text.includes("받음") && !text.includes("신고 기한"), "threads: 출처·받은 시각·안내 없음");
      for (const field of ["legalName", "address", "mobile", "registrationNumber", "representative"]) assert.ok(!text.includes(office[field]), `threads: 명시사항 ${field} 없음`);
    } else {
      assert.ok(text.includes(PROMO_SOURCE), `${kind}: 출처`);
      assert.ok(text.includes(short ? "11. 20. 09:50 받음" : "2026. 11. 20. 09:50 받은 자료"), `${kind}: 받은 시각(한국 시각)`);
      assert.ok(/계약일 기준/u.test(text) && /신고 기한/u.test(text) && /해제/u.test(text), `${kind}: 계약일 기준·신고 기한·해제 제외 안내`);
      for (const field of ["legalName", "address", "mobile", "registrationNumber", "representative"]) assert.ok(text.includes(office[field]), `${kind}: 명시사항 ${field}`);
    }
    for (const pattern of FORBIDDEN) assert.doesNotMatch(withoutAddress(text), pattern, `${kind}: ${pattern}`);
    for (const money of ["5억 2,000만 원", "3억 8,500만 원", "6억 1,000만 원"]) assert.ok(text.includes(money), `${kind}: 금액 ${money}`);
    assert.ok(text.includes("15층") && text.includes("7층") && text.includes("지하 1층"), `${kind}: 층 숫자 그대로`);
    assert.ok(text.includes("84.97㎡") && text.includes("59.98㎡"), `${kind}: 전용면적`);
    assert.ok(text.includes(short ? PROMO_HIGH_RULE_SHORT : PROMO_HIGH_RULE), `${kind}: 신고가가 있으면 판정 기준과 비교 범위`);
    assert.ok(text.includes("2006년 1월 이후"), `${kind}: 비교 범위`);
  }
  assert.match(PROMO_HIGH_RULE, /2006년 1월 이후 매매와 비교/u);
  assert.ok(texts.instagram.endsWith(`\n${hashtags(THREE).join(" ")}`), "인스타그램 끝에 해시태그 12개(P1-f)");
  assert.equal(textCount("instagram", texts.instagram).tags, 12);
  assert.match(texts.blog, /^제목: 대전 동구 아파트 실거래 3건\(2026년 10 ~ 11월 계약\)/u);
  assert.match(texts.blog, /중개사무소 명칭: .+\n소재지: .+\n연락처: .+\n등록번호: .+\n대표 성명: .+$/u, "블로그 끝 명시사항 5줄");
  // 스레드 3건: 머리 줄 → 빈 줄 → 거래 한 줄씩 → 빈 줄 → 신고가 판정 기준 한 줄. 글자까지 이 모양이다.
  assert.equal(texts.threads, [
    "[대전 동구 아파트 실거래가] 실거래 3건(2026년 10 ~ 11월 계약)",
    "",
    "- 가상숲1단지 매매 5억 2,000만 원, 전용 84.97㎡ 15층, 계약 11. 12. 신고가",
    "- 가상숲2단지 매매 3억 8,500만 원, 전용 59.98㎡ 7층, 계약 11. 8. 신고가",
    "- 가상들마을 매매 6억 1,000만 원, 전용 101.62㎡ 지하 1층, 계약 10. 30.",
    "",
    PROMO_HIGH_RULE_SHORT,
  ].join("\n"));
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
  assert.deepEqual(card.items.map((item) => item.up), ["", ""], "신고가가 아니면 ▲ 오름 폭도 없음");
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

test("스레드 500자: 1건은 자세히, 여러 건은 한 줄씩(6건도 들어감), 넘으면 거래 줄을 '그림에 정리' 한 줄로 줄인다", () => {
  const one = promoTexts(input([HIGH])).threads;
  assert.match(one, /^\[대전 동구 아파트 실거래가\] 가상숲1단지 매매 신고가\n\n가상숲1단지\(천동\) 매매 5억 2,000만 원\n전용 84\.97㎡ · 15층 · 계약 2026\. 11\. 12\.\n신고가 · 같은 단지·같은 전용면적 앞선 최고 4억 9,500만 원/u);
  assert.ok(one.endsWith(`\n\n${PROMO_HIGH_RULE}`), "1건 신고가: 끝은 판정 기준 한 줄");
  assert.equal(promoTexts(input([PLAIN])).threads, "[대전 동구 아파트 실거래가] 가상들마을 매매\n\n가상들마을(신흥동) 매매 6억 1,000만 원\n전용 101.62㎡ · 지하 1층 · 계약 2026. 10. 30.", "1건 신고가 아님: 머리 줄과 거래뿐");
  // 6건: 출처·명시사항을 뺀 뒤로는 14자 단지 이름 여섯 건도 한 줄씩 들어간다(그 전에는 '그림에 정리'로 줄었다).
  const six = [HIGH, HIGH2, PLAIN, MONTHLY, JEONSE, PRESALE].map((item) => ({ ...item, aptName: `${item.aptName}센트럴파크리버뷰` }));
  const sixLines = promoTexts(input(six)).threads.split("\n");
  assert.ok([...sixLines.join("\n")].length <= PROMO_LIMITS.threads, `${[...sixLines.join("\n")].length}자`);
  assert.deepEqual([sixLines[1], sixLines.filter((line) => line.startsWith("- ")).length, sixLines.slice(2, 8).every((line) => line.startsWith("- "))], ["", 6, true], "머리 줄 → 빈 줄 → 거래 6줄");
  assert.ok(sixLines[2].startsWith("- 가상숲1단지센트럴파크리버뷰 매매 5억 2,000만 원") && sixLines[5].includes("보증금 5,000만 / 월 85만 원"), "거래 줄에 금액");
  // 한 줄씩이 500자를 넘으면 먼저 거래 줄을 짧게('전용'·'계약' 낱말만 빼고 숫자는 그대로) 한다: 20자 단지 이름 월세 여섯 건(지하 층)도 한 줄씩 들어간다.
  const name20 = "가상더샵센트럴파크리버뷰포레스트3단지";
  const tight = [1, 2, 3, 4, 5, 6].map((n) => ({ ...MONTHLY, tradeKey: key("rent", "202611", 30 + n), aptName: name20, areaM2: 101.62, floor: -1, dealDate: `2026-11-1${n}`, depositWon: 150_000_000, monthlyRentWon: 1_250_000 }));
  const tightText = promoTexts(input(tight)).threads;
  const tightLines = tightText.split("\n").filter((line) => line.startsWith("- "));
  assert.ok([...tightText].length <= PROMO_LIMITS.threads, `${[...tightText].length}자`);
  assert.ok(tightLines.length === 6 && !tightText.includes("그림에 정리"), "짧은 거래 줄 6개");
  assert.equal(tightLines[0], `- ${name20} 월세 보증금 1억 5,000만 / 월 125만 원, 101.62㎡ 지하 1층, 11. 11.`, "숫자는 그대로, '전용'·'계약'만 뺌");
  // 같은 이름의 매매 신고가 여섯 건도 짧은 줄 + 판정 기준 한 줄로 들어간다.
  const tightHigh = tight.map((item) => ({ ...HIGH, tradeKey: item.tradeKey.replace("rent", "sale"), aptName: name20, areaM2: 101.62, floor: 15, dealDate: item.dealDate, priceWon: 1_125_500_000, prevMaxWon: 1_098_000_000 }));
  const tightHighText = promoTexts(input(tightHigh)).threads;
  assert.ok([...tightHighText].length <= PROMO_LIMITS.threads && tightHighText.split("\n").filter((line) => line.startsWith("- ")).length === 6, `${[...tightHighText].length}자`);
  assert.ok(tightHighText.endsWith(`\n\n${PROMO_HIGH_RULE_SHORT}`), "신고가 판정 기준 한 줄은 남음");
  // 그래도 500자를 넘는 긴 단지 이름(40자) 여섯 건은 거래 줄 대신 '그림에 정리' 한 줄로 줄인다(자르지 않음).
  const long = six.map((item) => ({ ...item, aptName: `${item.aptName}${"가".repeat(26)}` }));
  const threads = promoTexts(input(long)).threads;
  assert.ok([...threads].length <= PROMO_LIMITS.threads, `${[...threads].length}자`);
  assert.match(threads, /거래 6건\(계약일 2026\. 10\. 30\. ~ 2026\. 11\. 12\.\)은 그림에 정리했습니다\./u);
  assert.ok(!threads.includes("- "), "줄인 글에는 거래 줄이 없음");
  assert.equal(textCount("threads", "가".repeat(501)).over, true);
  assert.equal(textCount("instagram", Array.from({ length: 31 }, (_, n) => `#t${n}`).join(" ")).over, true, "해시태그 31개");
  assert.deepEqual(textCount("blog", "가나다"), { count: 3, limit: null, tags: 0, over: false, label: "3자" });
});

test("카드 장 수(2026-11-24 사용자 답 '4곳까지 1장'): 4건까지 한 장, 5건은 3 + 2, 6건은 3 + 3, 6건을 넘는 거래는 넣지 않음", () => {
  assert.equal(PROMO_ONE_CARD_MAX, 4);
  const six = [HIGH, HIGH2, PLAIN, MONTHLY, JEONSE, PRESALE];
  assert.deepEqual(promoPages([]), []);
  for (const n of [1, 2, 3, 4]) assert.deepEqual(promoPages(six.slice(0, n)).map((page) => page.length), [n], `${n}건은 한 장`);
  assert.deepEqual(promoPages(six.slice(0, 5)).map((page) => page.length), [3, 2]);
  assert.deepEqual(promoPages(six).map((page) => page.length), [3, 3]);
  assert.deepEqual(promoPages([...six, { ...PLAIN, tradeKey: key("sale", "202610", 9) }]).map((page) => page.length), [3, 3], "담기 최대 6건 그대로");
  const four = promoCards(input(six.slice(0, 4)));
  assert.deepEqual([four.length, four[0].title, four[0].items.length], [1, "실거래 4건", 4], "4건은 장 표시 없는 한 장");
  assert.deepEqual(promoCards(input(six.slice(0, 5))).map((card) => card.title), ["실거래 5건 · 1/2장", "실거래 5건 · 2/2장"]);
});

test("카드 모양 4가지(처음 '기본'): 모르는 모양은 기본으로 그린다. 모양은 그림 자료의 style 한 칸뿐이라 글·숫자는 같다", () => {
  assert.deepEqual(PROMO_STYLES.map(([value]) => value), ["basic", "clean", "magazine", "dark"]);
  assert.deepEqual(PROMO_STYLES.map(([, label]) => label), ["기본", "깔끔 카드", "잡지", "다크"]);
  assert.equal(PROMO_STYLE_DEFAULT, "basic");
  assert.deepEqual(["basic", "dark", "neon", "", undefined].map(isPromoStyle), [true, true, false, false, false]);
  assert.equal(promoCards(input(THREE))[0].style, "basic");
  assert.equal(promoCards(input(THREE, { style: "dark" }))[0].style, "dark");
  assert.equal(promoCards(input(THREE, { style: "neon" }))[0].style, "basic");
  const strip = (card) => ({ ...card, style: "" });
  assert.deepEqual(strip(promoCards(input(THREE, { style: "magazine" }))[0]), strip(promoCards(input(THREE))[0]));
});

test("카드 금액·딱지: 큰 숫자와 작은 단위로 나누고, '▲ 오름 폭'은 신고가(앞선 최고 매매가 대비)에만, 분양권은 딱지 표시", () => {
  assert.deepEqual(priceSplit("5억 8,750만 원"), { num: "5억 8,750", unit: "만 원" });
  assert.deepEqual(priceSplit("4억 원"), { num: "4억", unit: "원" });
  assert.deepEqual(priceSplit("가격 미상"), { num: "가격 미상", unit: "" });
  assert.equal(promoUpText(HIGH), "▲ 2,500만");
  assert.equal(promoUpText({ ...HIGH, priceWon: 711_000_000, prevMaxWon: 599_000_000 }), "▲ 1억 1,200만");
  assert.equal(promoUpText({ ...HIGH, priceWon: 600_000_000, prevMaxWon: 500_000_000 }), "▲ 1억");
  assert.equal(promoUpText(PLAIN), "", "신고가가 아니면 없음");
  assert.equal(promoUpText({ ...HIGH, prevMaxWon: null }), "", "앞선 최고가를 모르면 없음");
  assert.equal(promoUpText({ ...HIGH, priceWon: 495_000_000 }), "", "같거나 낮으면 없음");
  const [card] = promoCards(input([HIGH, PRESALE, PLAIN]));
  assert.deepEqual(card.items.map((item) => [item.high, item.presale, item.up]), [[true, false, "▲ 2,500만"], [false, true, ""], [false, false, ""]]);
});

test("카드: 여러 장이면 제목 끝 ' · 1/2장', 장마다 출처 두 줄(출처·받은 시각 / 계약일 기준 안내)과 사무소 명시사항 5항목(상호 크게). 신고가 판정 기준은 글에만", () => {
  assert.equal(promoCards(input(THREE)).length, 1);
  const six = [HIGH, HIGH2, PLAIN, MONTHLY, JEONSE, PRESALE];
  const cards = promoCards(input(six));
  assert.deepEqual(cards.map((card) => card.title), ["실거래 6건 · 1/2장", "실거래 6건 · 2/2장"]);
  assert.deepEqual(cards.map((card) => card.items.length), [3, 3]);
  for (const card of cards) {
    // 2026-11-25 사용자 요청 "출처랑 명함부분은 … 표에만 나오게끔": 2026-11-24에 뺐던 출처·받은 시각을 작은 글 두 줄로 되돌렸다(장마다 같은 글).
    assert.deepEqual(card.source, [`출처: ${PROMO_SOURCE}, 2026. 11. 20. 09:50 받음.`, PROMO_NOTICE_SHORT], "그림 출처 두 줄(받은 시각은 한국 시각, 연도까지)");
    assert.ok(/계약일 기준/u.test(card.source[1]) && /신고 기한/u.test(card.source[1]) && /해제/u.test(card.source[1]), "계약일 기준·신고 기한·해제 제외 안내");
    assert.equal(Object.hasOwn(card, "received"), false, "받은 시각은 출처 줄 안에만(따로 둔 칸 없음)");
    assert.deepEqual(card.office, { name: office.legalName, representative: office.representative, address: office.address, mobile: office.mobile, registrationNumber: office.registrationNumber });
    for (const gone of ["highRule", "disclosure"]) assert.equal(Object.hasOwn(card, gone), false, `그림 자료에 ${gone} 없음`);
    const drawn = JSON.stringify(card);
    for (const text of [PROMO_NOTICE, PROMO_HIGH_RULE, PROMO_HIGH_RULE_SHORT]) assert.equal(drawn.includes(text), false, "그림에는 긴 안내·판정 기준 글이 없음");
    assert.equal(card.allHigh, false, "여러 장이면 줄마다 신고가 표");
    for (const item of card.items) assert.equal(Object.hasOwn(item, "aptDong"), false, "카드에 동 번호 칸 없음");
  }
  const allHigh = promoCards(input([HIGH, HIGH2]))[0];
  assert.deepEqual([allHigh.title, allHigh.allHigh], ["매매 신고가 2건", true]);
  assert.equal(promoCards(input([HIGH]))[0].title, "가상숲1단지 매매 신고가");
  assert.equal(JSON.stringify(cards).match(/\d+\s?동(?![구\w])/u), null, "카드 자료 전체에 동 번호 0");
});

test("올릴 곳마다 글 끝에 붙일 것(PROMO_TEXT_TAIL): 스레드만 출처·명시사항을 빼고(그림에만), 세 곳은 그대로. 신고가 판정 기준은 글 4가지에 남는다", () => {
  assert.deepEqual(PROMO_TEXT_TAIL, { threads: { source: false, office: false }, instagram: { source: true, office: true }, blog: { source: true, office: true }, kakao: { source: true, office: true } });
  assert.deepEqual(Object.keys(PROMO_TEXT_TAIL).sort(), PROMO_TEXT_KINDS.map(([kind]) => kind).sort(), "글 종류와 같은 4가지");
  assert.ok(Object.isFrozen(PROMO_TEXT_TAIL) && Object.isFrozen(PROMO_TEXT_TAIL.threads), "표는 바꿀 수 없음");
  const texts = promoTexts(input([HIGH, PLAIN]));
  for (const [kind, text] of Object.entries(texts)) {
    const on = PROMO_TEXT_TAIL[kind];
    assert.equal(text.includes("국토교통부"), on.source, `${kind} 출처`);
    assert.equal(text.includes("09:50"), on.source, `${kind} 받은 시각`);
    assert.equal(/신고 기한|30일/u.test(text), on.source, `${kind} 신고 기한`);
    assert.equal(text.includes(office.mobile) && text.includes(office.registrationNumber), on.office, `${kind} 사무소 명시사항`);
    assert.ok(text.includes("2006년 1월 이후"), `${kind} 신고가 판정 기준`);
  }
  // 글에서 뺀 출처·명시사항은 그림에 장마다 있다(한 곳에는 꼭 나옴).
  for (const card of promoCards(input([HIGH, HIGH2, PLAIN, MONTHLY, JEONSE, PRESALE]))) {
    assert.ok(card.source.join(" ").includes(PROMO_SOURCE) && card.source.join(" ").includes("09:50"), "그림 출처·받은 시각");
    assert.deepEqual([card.office.name, card.office.mobile], [office.legalName, office.mobile], "그림 사무소 명시사항");
  }
  // 표의 값을 바꾸면 그 글만 바뀐다: 모두 끄면 네 글 모두 출처·명시사항이 없고, 스레드를 켜면 그 전(2026-11-24) 글처럼 붙는다.
  const off = { source: false, office: false };
  const none = promoTexts(input([HIGH, PLAIN]), { threads: off, instagram: off, blog: off, kakao: off });
  for (const [kind, text] of Object.entries(none)) {
    // 블로그 본문 첫 문장("국토교통부 실거래가 공개 자료에서 … 정리했습니다")은 꼬리가 아니라 그대로 남으므로 '출처:' 줄로 본다.
    assert.ok(!text.includes("출처:") && !text.includes(PROMO_SOURCE) && !text.includes(office.mobile) && !text.includes(office.registrationNumber), `${kind}: 모두 끔`);
    assert.ok(text.includes("5억 2,000만 원") && text.includes("6억 1,000만 원") && text.includes("2006년 1월 이후"), `${kind}: 거래와 판정 기준은 그대로`);
    assert.ok(!text.endsWith("\n") && !text.includes("\n\n\n"), `${kind}: 빈 줄이 남지 않음`);
  }
  assert.ok(none.instagram.endsWith(`\n${hashtags([HIGH, PLAIN]).join(" ")}`), "인스타그램 해시태그는 그대로");
  const on = promoTexts(input([HIGH, PLAIN]), { ...PROMO_TEXT_TAIL, threads: { source: true, office: true } });
  assert.ok(on.threads.includes(`출처: ${PROMO_SOURCE}, 11. 20. 09:50 받음. ${PROMO_NOTICE_SHORT}`) && on.threads.includes(office.mobile), "스레드를 켜면 출처 줄·명시사항");
  assert.ok([...on.threads].length <= PROMO_LIMITS.threads, "켜도 500자 안");
  for (const kind of ["instagram", "blog", "kakao"]) assert.equal(on[kind], texts[kind], `${kind}: 다른 글은 그대로`);
  const half = promoTexts(input([HIGH, PLAIN]), { ...PROMO_TEXT_TAIL, kakao: { source: true, office: false } }).kakao;
  assert.ok(half.includes("국토교통부") && !half.includes(office.mobile), "출처만 남기고 명시사항만 뺄 수도 있음");
});

// 거래 흐름 응답(보드 63번, 가상 값): FLOW는 흐름선·직전·앞선 최고가 모두 있는 거래, ONE_MONTH는 거래 있는 달이 하나뿐인 첫 거래.
const flowSeries = (values) => values.map((won, index) => ({ ym: `2026-${String(index + 1).padStart(2, "0")}`, medianWon: won, count: won === null ? 0 : 1 }));
const FLOW = (tradeKey) => ({ tradeKey, available: true, series: flowSeries([null, 480_000_000, null, 490_000_000, 495_000_000, null, null, null, null, null, 500_000_000, 520_000_000]), prev: { dealDate: "2026-10-05", floor: 9, priceWon: 500_000_000 }, prevMaxWon: 495_000_000, ratioPct: 105.1, recent3m: 4, households: null });
const ONE_MONTH = (tradeKey) => ({ tradeKey, available: true, series: flowSeries([null, null, null, null, null, null, null, null, null, null, null, 610_000_000]), prev: null, prevMaxWon: null, ratioPct: null, recent3m: 1, households: null });
const FULL_BASIS = "흐름 기준: 같은 단지·같은 전용면적 · 흐름선: 12개월 월별 가운데 값 · 최고·직전: 실제 거래";

test("흐름 기준 줄(TR-11 PR #156 권함 2, 2026-11-25): 카드에 흐름을 그린 거래가 있을 때만 출처 줄을 넣는 글(스레드 빼고 세 곳)의 출처 줄 바로 아래와 그림에, 그린 항목만", () => {
  const insights = { [HIGH.tradeKey]: FLOW(HIGH.tradeKey) };
  const texts = promoTexts(input(THREE, { insights }));
  // 스레드 글은 출처 줄을 넣지 않으므로 흐름 기준 줄도 없다(1건·3건·6건 모두 흐름이 없을 때의 글과 같다). 기준은 그림에 있다.
  assert.equal(texts.threads, promoTexts(input(THREE)).threads, "스레드 3건: 흐름이 있어도 같은 글");
  const single = promoTexts(input([HIGH], { insights }));
  assert.equal(single.threads, promoTexts(input([HIGH])).threads, "스레드 1건: 흐름이 있어도 같은 글");
  assert.doesNotMatch(`${texts.threads}\n${single.threads}`, /흐름 기준/u);
  // 표에서 스레드 출처를 켜면 그 전처럼 들어갈 때만 기준 줄이 붙는다(1건은 붙고, 3건은 500자를 넘어 빼고 거래 줄은 그대로).
  const threadsOn = { ...PROMO_TEXT_TAIL, threads: { source: true, office: true } };
  const singleOn = promoTexts(input([HIGH], { insights }), threadsOn).threads;
  assert.equal(promoTexts(input(THREE, { insights }), threadsOn).threads, promoTexts(input(THREE), threadsOn).threads, "켠 스레드 3건: 들어가지 않으면 기준 줄 없이");
  const checks = [...Object.entries(texts).filter(([kind]) => kind !== "threads").map(([kind, text]) => [kind, text, promoTexts(input(THREE))[kind]]), ["threads(표에서 켠 1건)", singleOn, promoTexts(input([HIGH]), threadsOn).threads]];
  for (const [kind, text, before] of checks) {
    const lines = text.split("\n");
    const at = lines.indexOf(FULL_BASIS);
    assert.ok(at > 0, `${kind}: 흐름 기준 줄 하나`);
    assert.equal(lines.filter((line) => line.startsWith("흐름 기준:")).length, 1, `${kind}: 한 번만`);
    // 바로 위가 출처 줄(스레드·카카오톡은 출처·안내 한 줄) 또는 계약일 기준 안내 줄이다.
    const above = lines[at - 1];
    assert.ok(above.startsWith(`출처: ${PROMO_SOURCE}`) || above === PROMO_NOTICE, `${kind}: 출처 줄 아래(${above})`);
    // 신고가 판정 기준·명시사항 줄은 그대로 남는다.
    assert.ok(text.includes(kind === "kakao" ? PROMO_HIGH_RULE_SHORT : PROMO_HIGH_RULE) || text.includes(PROMO_HIGH_RULE_SHORT), `${kind}: 신고가 기준 그대로`);
    for (const field of ["legalName", "address", "mobile", "registrationNumber", "representative"]) assert.ok(text.includes(office[field]), `${kind}: 명시사항 ${field}`);
    // 줄을 빼면 흐름이 없을 때의 글과 같다(다른 줄은 바꾸지 않음).
    assert.equal(lines.filter((_, index) => index !== at).join("\n"), before, `${kind}: 다른 줄 그대로`);
  }
  assert.ok(textCount("threads", singleOn).count <= PROMO_LIMITS.threads, "스레드 500자 안");
  // 거래 6건: 지금 스레드 글에는 기준 줄이 없고, 표에서 켜면 '그림에 정리' 한 줄로 줄인 글에 붙는다.
  const six = [HIGH, HIGH2, PLAIN, { ...PLAIN, tradeKey: "p2" }, { ...PLAIN, tradeKey: "p3" }, { ...PLAIN, tradeKey: "p4" }];
  assert.doesNotMatch(promoTexts(input(six, { insights })).threads, /흐름 기준/u, "스레드 6건에도 없음");
  const sixThreads = promoTexts(input(six, { insights }), threadsOn).threads;
  assert.ok(sixThreads.split("\n").includes(FULL_BASIS) && [...sixThreads].length <= PROMO_LIMITS.threads, "켠 스레드 요약 글에는 붙음");
  // 흐름을 받지 못했거나(빈 값·계산 못 함) 매매가 없으면 줄이 없다.
  for (const none of [{}, { [HIGH.tradeKey]: { tradeKey: HIGH.tradeKey, available: false, reason: "budget" } }, undefined]) {
    for (const [kind, text] of Object.entries(promoTexts(input(THREE, { insights: none })))) assert.doesNotMatch(text, /흐름 기준/u, `${kind}: 그린 흐름 없음`);
  }
  const rentOnly = promoTexts(input([MONTHLY], { insights: { [MONTHLY.tradeKey]: FLOW(MONTHLY.tradeKey) } }));
  for (const [kind, text] of Object.entries(rentOnly)) assert.doesNotMatch(text, /흐름 기준/u, `${kind}: 전월세는 흐름을 그리지 않음`);
  // 흐름선을 그리지 못한(거래 있는 달이 하나) 첫 거래만이면 3개월 거래 수 기준만 적는다(카드와 같은 promoBasisLine).
  const first = promoTexts(input([PLAIN], { insights: { [PLAIN.tradeKey]: ONE_MONTH(PLAIN.tradeKey) } }));
  for (const [kind, text] of Object.entries(first)) assert.equal(text.includes("흐름 기준: 같은 단지·같은 전용면적 · 최근 3개월: 계약일 기준 거래 수"), kind !== "threads", kind);
  // 글의 기준 줄은 카드 자료의 basis 칸과 같은 글이다(그림에는 2026-11-25부터 출처 두 줄 아래 작은 글로 그린다, 흐름을 그린 장에만).
  assert.equal(promoCards(input(THREE, { insights }))[0].basis, FULL_BASIS.replace("흐름 기준: ", ""));
  assert.equal(promoCards(input(THREE))[0].basis, "", "흐름을 그리지 않은 장에는 기준 줄이 없음");
  const twoPages = promoCards(input([PLAIN, MONTHLY, JEONSE, HIGH, HIGH2, PRESALE], { insights }));
  assert.deepEqual(twoPages.map((card) => card.basis !== ""), [false, true], "여러 장이면 흐름을 그린 장에만");
  assert.deepEqual(twoPages.map((card) => card.source), [twoPages[0].source, twoPages[0].source], "출처 두 줄은 장마다 같음");
});

test("파일 이름은 날짜만(realprice-YYYYMMDD.png, 두 장이면 -1·-2), 받은 시각은 한국 시각", () => {
  assert.equal(promoFileName("2026-11-20"), "realprice-20261120.png");
  assert.equal(promoFileName("2026-11-20", 1, 2), "realprice-20261120-2.png");
  assert.equal(receivedText("2026-11-19T15:05:00.000Z"), "2026. 11. 20. 00:05");
});

test("P1-f 홍보물 순서 글: 올릴 곳 4가지(인스타그램 먼저)마다 ① 그림 저장 ② 글 복사(글자 수·해시태그 수) ③ 붙여 넣기", () => {
  assert.deepEqual(PROMO_PLACES.map(([kind]) => kind), ["instagram", "threads", "blog", "kakao"], "인스타그램이 처음 골라진 곳");
  assert.deepEqual([...PROMO_PLACES.map(([kind]) => kind)].sort(), [...PROMO_TEXT_KINDS.map(([kind]) => kind)].sort(), "글 종류와 같은 4가지");
  const insta = promoSteps("instagram", { cardCount: 2, counted: { count: 1234, limit: 2200, tags: 12, over: false } });
  assert.equal(insta.image, "카드 그림 2장을 휴대폰에 저장합니다.");
  assert.equal(insta.text, "글을 복사합니다(해시태그 12개 포함, 2,200자 중 1,234자).");
  assert.match(insta.post, /^인스타그램 앱에서 새 게시물/u);
  const threads = promoSteps("threads", { counted: { count: 620, limit: 500, tags: 0, over: true } });
  assert.equal(threads.image, "카드 그림을 휴대폰에 저장합니다.", "한 장이면 장 수를 쓰지 않음");
  assert.equal(threads.text, "글을 복사합니다(500자 중 620자, 상한을 넘음).");
  assert.match(promoSteps("blog", { counted: { count: 900, limit: null, tags: 0, over: false } }).text, /\(900자\)/u, "상한이 없는 글은 글자 수만");
  assert.match(promoSteps("kakao", { counted: { count: 300, limit: null, tags: 0, over: false } }).image, /채팅에 사진으로 보냅니다/u);
  assert.equal(promoSteps("unknown", { counted: { count: 1, limit: null, tags: 0, over: false } }).post, insta.post, "모르는 곳은 인스타그램 순서");
});

test("TK-146 대전 5개 구(0008): 고정돼 있던 '대전 동구' 자리만 고른 거래의 구로 바꾸고(한 구면 그 구, 섞이면 '대전'), 구 이름을 새 자리에 넣지 않는다(2026-11-25 사용자 결정 \"홍보물에는 안 넣어도 돼\")", () => {
  const seo = [{ ...HIGH, lawdCd: "30170" }, { ...PLAIN, lawdCd: "30170" }];
  const mix = [{ ...HIGH, lawdCd: "30170" }, { ...PLAIN, lawdCd: "30200" }];
  assert.deepEqual([promoRegion(THREE), promoRegion(seo), promoRegion(mix), promoRegion([{ ...HIGH, lawdCd: "30110" }, PLAIN])], ["30110", "30170", null, "30110"], "구 코드가 없으면 동구(0008 전 응답 모양)");
  assert.deepEqual([promoAreaLabel(THREE), promoAreaLabel(seo), promoAreaLabel(mix)], ["대전 동구 아파트 실거래가", "대전 서구 아파트 실거래가", "대전 아파트 실거래가"]);
  assert.deepEqual([promoRegionTags(seo), promoRegionTags(mix)], [["#대전서구", "#서구아파트"], []]);
  assert.deepEqual(hashtags(seo).slice(0, 4), ["#대전서구", "#서구아파트", "#대전아파트", "#아파트실거래가"]);
  assert.ok(!hashtags(mix).some((tag) => /동구|서구|유성구/u.test(tag)), hashtags(mix).join(" "));
  const before = promoTexts(input(THREE));
  // 사무소 주소(명시사항, '대전광역시 동구 …')는 구와 상관없이 늘 붙으므로 빼고 센다.
  const strip = (texts) => Object.fromEntries(Object.entries(texts).map(([kind, text]) => [kind, text.replaceAll(office.address, "")]));
  const seoTexts = strip(promoTexts(input(seo)));
  const mixTexts = strip(promoTexts(input(mix)));
  const dongTexts = strip(promoTexts(input([HIGH, PLAIN])));
  for (const [kind, text] of Object.entries(seoTexts)) {
    assert.ok(!text.includes("동구"), `${kind}: 서구 거래에 동구 말 없음`);
    assert.equal((text.match(/서구/gu) ?? []).length, (dongTexts[kind].match(/동구/gu) ?? []).length, `${kind}: 동구가 나오던 자리 수만큼만 서구`);
  }
  for (const [kind, text] of Object.entries(mixTexts)) assert.ok(!/동구|서구|유성구/u.test(text), `${kind}: 섞이면 구 이름 없이 '대전'`);
  assert.match(seoTexts.blog, /^제목: 대전 서구 아파트 실거래 2건/u);
  assert.match(mixTexts.blog, /^제목: 대전 아파트 실거래 2건/u);
  assert.match(mixTexts.blog, /공개 자료에서 대전 아파트 거래를 정리했습니다/u);
  assert.equal(before.blog, promoTexts(input(THREE.map((item) => ({ ...item, lawdCd: "30110" })))).blog, "동구 거래는 0008 전과 같은 글");
  assert.deepEqual([promoCards(input(seo))[0].areaLabel, promoCards(input(mix))[0].areaLabel], ["대전 서구 아파트 실거래가", "대전 아파트 실거래가"]);
});
