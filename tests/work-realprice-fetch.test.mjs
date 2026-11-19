// 단계 P 실거래가 받기 부품(P1-a) 시험: 응답 읽기·한 달 받기·오류 코드와 다음 차례·칸 변환·거래 ID·첫 확인 스크립트.
// 실제 공공데이터포털은 부르지 않는다. 모든 요청은 가짜 fetcher가 받고, 받은 주소는 맨 끝 시험(TK-32·TK-31)이 다시 검사한다.
import test from "node:test";
import assert from "node:assert/strict";
import { RealpriceResponseError, REALPRICE_MAX_BODY_BYTES, parseRealpriceXml, readRealpriceBody } from "../worker/realprice-parse.mjs";
import {
  REALPRICE_APIS,
  REALPRICE_ENDPOINTS,
  RT_ACCESS_DENIED,
  RT_COUNT_MISMATCH,
  RT_DAILY_LIMIT,
  RT_KEY_EXPIRED,
  RT_KEY_INVALID,
  RT_REQUEST_INVALID,
  RT_RESPONSE_INVALID,
  RT_SERVICE_GONE,
  RT_UPSTREAM_FAILED,
  buildRealpriceRequestUrl,
  classifyResultCode,
  fetchRealpriceMonth,
  fetchRealpriceTotalCount,
  planRealpriceRetry,
} from "../worker/realprice-fetch.mjs";
import { REALPRICE_ROW_LIMITS, buildTradeRows, toAreaX100, toShortDate, toWon, tradeSignatureSource } from "../worker/realprice-rows.mjs";
import { defaultProbePlan, isInsideRepo, runRealpriceProbe } from "../scripts/realprice-probe.mjs";
import {
  FAKE_SERVICE_KEY,
  pagedSaleResponses,
  readRealpriceFixture,
  realpriceHeaderOnlyXml,
  realpriceXml,
  recordingFetcher,
  saleDetailItem,
  xmlResponse,
} from "./realprice-fixtures.mjs";

// 이 파일의 모든 가짜 fetcher가 받은 주소와 받기 결과. 맨 끝 시험이 키·주소를 검사한다.
const requestedUrls = [];
const collectedResults = [];
const NOW = new Date("2026-11-19T03:00:00.000Z"); // 한국 시각 2026-11-19 12:00

const fixtureFetcher = (text) => recordingFetcher(() => xmlResponse(text), requestedUrls);

async function month(options) {
  const result = await fetchRealpriceMonth({ api: "sale", dealYmd: "202610", serviceKey: FAKE_SERVICE_KEY, ...options });
  collectedResults.push(result);
  return result;
}

const ROW_COLUMNS = [
  "trade_key", "kind", "deal_ymd", "deal_date", "umd_nm", "jibun", "apt_seq", "apt_nm", "area_x100", "floor", "build_year",
  "price_won", "deposit_won", "monthly_rent_won", "dealing_gbn", "cancelled", "cancelled_on", "registered_on", "apt_dong", "extra_json",
];

// ── 응답 읽기(realprice-parse.mjs) ──

test("응답 읽기: 정상 틀의 머리·몸통·항목을 읽고 공백 한 칸 값은 값 없음(null)으로 본다", async () => {
  const page = parseRealpriceXml(await readRealpriceFixture("sale-detail-normal.xml"));
  assert.equal(page.envelope, "response");
  assert.equal(page.resultCode, "000");
  assert.equal(page.resultMsg, "OK");
  assert.deepEqual([page.totalCount, page.pageNo, page.numOfRows], [3, 1, 1000]);
  assert.equal(page.items.length, 3);
  assert.equal(page.items[0].bonbun, "0101", "읽기 단계에서는 모든 칸을 읽고, 버리는 것은 칸 변환이 한다");
  assert.equal(page.items[1].aptDong, null);
  assert.equal(page.items[2].dealAmount, "8,000", "앞뒤 공백을 지움");
  assert.equal(page.items[2].jibun, null);
});

test("응답 읽기: 맨 앞 XML 선언·BOM·CRLF 줄바꿈은 같은 결과로 읽는다", async () => {
  const normal = await readRealpriceFixture("sale-detail-normal.xml");
  const expected = parseRealpriceXml(normal);
  assert.deepEqual(parseRealpriceXml(await readRealpriceFixture("sale-detail-declaration.xml")), expected);
  assert.deepEqual(parseRealpriceXml(`﻿<?xml version="1.0" encoding="UTF-8"?>\r\n${normal.replace(/\r?\n/gu, "\r\n")}`), expected);
});

test("응답 읽기: XML 기본 문자 참조 5개와 숫자 문자 참조만 푼다", async () => {
  const page = parseRealpriceXml(await readRealpriceFixture("sale-detail-entities.xml"));
  assert.equal(page.items[0].aptNm, "가상&숲(1)단지");
  const all = parseRealpriceXml(realpriceXml({ items: [{ aptNm: "x" }] }).replace("<aptNm>x</aptNm>", "<aptNm>&lt;&gt;&amp;&quot;&apos;&#44032;&#xAC00;</aptNm>"));
  assert.equal(all.items[0].aptNm, `<>&"'가가`);
  const greater = parseRealpriceXml(realpriceXml({ items: [{ aptNm: "x" }] }).replace("<aptNm>x</aptNm>", "<aptNm>가상 > 단지</aptNm>"));
  assert.equal(greater.items[0].aptNm, "가상 > 단지", "글자 안의 >는 XML 규칙상 허용");
});

test("응답 읽기: 속성·CDATA·중첩·주석·DOCTYPE·깨진 태그·모르는 문자 참조는 RT_RESPONSE_INVALID로 버린다(TK-17)", async () => {
  const ok = realpriceXml({ items: [{ aptNm: "가상단지", dealYear: "2026" }] });
  const broken = {
    "닫히지 않은 태그": ok.replace("</response>", ""),
    "짝이 안 맞는 닫는 태그": ok.replace("</aptNm>", "</aptNmX>"),
    "속성": ok.replace("<item>", '<item a="1">'),
    "머리 칸 속성": ok.replace("<resultCode>", '<resultCode x="1">'),
    "CDATA": ok.replace("<aptNm>가상단지</aptNm>", "<aptNm><![CDATA[가상단지]]></aptNm>"),
    "중첩 항목": ok.replace("<item><aptNm>", "<item><item><aptNm>").replace("</item>", "</item></item>"),
    "칸 안의 칸": ok.replace("<aptNm>가상단지</aptNm>", "<aptNm><b>가상</b></aptNm>"),
    "주석": ok.replace("<items>", "<items><!-- 주석 -->"),
    "DOCTYPE": `<!DOCTYPE response>${ok}`,
    "처리 지시(중간)": ok.replace("<body>", "<body><?pi x?>"),
    "모르는 문자 참조": ok.replace("가상단지", "가상&nbsp;단지"),
    "맨 & 기호": ok.replace("가상단지", "가상 & 단지"),
    "허용하지 않는 숫자 참조": ok.replace("가상단지", "가상&#0;단지"),
    "같은 칸 두 번": ok.replace("<dealYear>2026</dealYear>", "<dealYear>2026</dealYear><dealYear>2025</dealYear>"),
    "글자와 칸이 섞임": ok.replace("<items>", "<items>글자"),
    "items 안의 다른 칸": ok.replace("<items>", "<items><row></row>"),
    "뿌리 두 개": `${ok}<response></response>`,
    "모르는 뿌리": "<html><body>오류</body></html>",
    "숫자가 아닌 totalCount": ok.replace("<totalCount>1</totalCount>", "<totalCount>1a</totalCount>"),
    "결과 코드 없음": ok.replace("<resultCode>000</resultCode>", ""),
    "빈 문자열": "",
    "XML 아님": "Unauthorized",
  };
  for (const [name, text] of Object.entries(broken)) {
    assert.throws(() => parseRealpriceXml(text), (error) => error instanceof RealpriceResponseError && error.code === RT_RESPONSE_INVALID && error.message === RT_RESPONSE_INVALID, name);
  }
});

test("응답 읽기: 0건 응답(빈 items·스스로 닫는 items·결과 코드 03)과 오류 응답 두 모양(추정 모양)", async () => {
  for (const name of ["sale-detail-zero-total.xml", "sale-detail-zero-items-selfclosing.xml"]) {
    const page = parseRealpriceXml(await readRealpriceFixture(name));
    assert.deepEqual([page.resultCode, page.totalCount, page.items], ["000", 0, []], name);
  }
  const code03 = parseRealpriceXml(await readRealpriceFixture("sale-detail-code-03.xml"));
  assert.deepEqual([code03.resultCode, code03.items, code03.totalCount], ["03", null, null]);
  assert.equal(parseRealpriceXml(await readRealpriceFixture("error-in-header-22.xml")).resultCode, "22");
  assert.deepEqual(parseRealpriceXml(await readRealpriceFixture("error-envelope-30.xml")), { envelope: "service-error", reasonCode: "30" });
});

test("응답 읽기: 본문 5MB 상한을 Content-Length와 실제 읽은 길이 둘 다로 지킨다(TK-17)", async () => {
  const exact = await readRealpriceBody(new Response("a".repeat(REALPRICE_MAX_BODY_BYTES)));
  assert.equal(exact.length, REALPRICE_MAX_BODY_BYTES);
  const chunk = new Uint8Array(1024 * 1024).fill(0x61);
  let sent = 0;
  const overStream = new ReadableStream({
    pull(controller) {
      if (sent >= 5) {
        controller.enqueue(new Uint8Array([0x61]));
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += 1;
    },
  });
  await assert.rejects(readRealpriceBody(new Response(overStream)), RealpriceResponseError, "Content-Length 없이 5MB + 1바이트");
  await assert.rejects(readRealpriceBody(new Response("<response/>", { headers: { "Content-Length": String(REALPRICE_MAX_BODY_BYTES + 1) } })), RealpriceResponseError, "Content-Length만 넘음");
  await assert.rejects(readRealpriceBody(new Response(new Uint8Array([0xff, 0xfe, 0x00]))), RealpriceResponseError, "UTF-8 아님");
});

// ── 한 달 받기(realprice-fetch.mjs) ──

test("TK-09: 가상 매매 XML 1쪽을 받아 설계서 22.4절 표대로 행을 만들고 표에 없는 칸은 남기지 않는다", async () => {
  const { fetcher, calls } = fixtureFetcher(await readRealpriceFixture("sale-detail-normal.xml"));
  const result = await month({ fetcher });
  assert.deepEqual([result.ok, result.totalCount, result.items.length, result.calls, calls.length], [true, 3, 3, 1, 1]);
  const { rows, droppedCount, cleared } = await buildTradeRows({ kind: "sale", dealYmd: "202610", items: result.items });
  assert.equal(droppedCount, 0);
  assert.deepEqual(cleared, { aptDong: 0, extraJson: 0 });
  const byDate = Object.fromEntries(rows.map((row) => [row.deal_date, row]));
  const pick = (row) => [row.deal_date, row.area_x100, row.price_won, row.floor, row.cancelled, row.cancelled_on, row.dealing_gbn, row.registered_on, row.apt_dong, row.build_year, row.jibun];
  assert.deepEqual(pick(byDate["2026-10-03"]), ["2026-10-03", 8497, 425000000, 12, 0, null, "broker", "2026-10-30", "101", 2019, "101"]);
  assert.deepEqual(pick(byDate["2026-10-09"]), ["2026-10-09", 5999, 390000000, -1, 1, "2026-10-15", "direct", null, null, 2019, "101"]);
  assert.deepEqual(pick(byDate["2026-10-31"]), ["2026-10-31", 3960, 80000000, null, 0, null, null, null, null, null, ""]);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row), ROW_COLUMNS, "정해진 칸만");
    assert.equal(row.kind, "sale");
    assert.equal(row.deal_ymd, "202610");
    assert.equal(row.umd_nm, "가상동");
    assert.equal(row.extra_json, "{}");
    assert.deepEqual([row.deposit_won, row.monthly_rent_won], [null, null]);
    assert.match(row.trade_key, /^sale:202610:[0-9a-f]{20}:\d+$/u);
    assert.ok(row.trade_key.length >= 20 && row.trade_key.length <= 60, "0003 trade_key 길이 20 ~ 60");
  }
  const stored = JSON.stringify(rows.map(({ trade_key: _key, ...values }) => values)); // 거래 ID의 16진수와 우연히 겹치지 않게 뺌
  for (const dropped of ["가상로", "0101", "개인", "대전 동구", "99999", "00007", "9999999"]) assert.ok(!stored.includes(dropped), `버린 칸 값 ${dropped}`);
});

test("TK-18: 정상 결과 코드 000(새 형식)과 00(옛 형식)을 둘 다 정상으로 읽는다", async () => {
  for (const name of ["sale-detail-normal.xml", "sale-detail-code-00.xml"]) {
    const { fetcher } = fixtureFetcher(await readRealpriceFixture(name));
    const result = await month({ fetcher });
    assert.equal(result.ok, true, name);
    assert.ok(result.items.length > 0, name);
  }
  assert.deepEqual([classifyResultCode("000"), classifyResultCode("00"), classifyResultCode(" 0 ")], [{ outcome: "ok" }, { outcome: "ok" }, { outcome: "ok" }]);
});

test("0건 달: 빈 items·스스로 닫는 items·결과 코드 03(추정 모양)은 모두 정상 0건이다", async () => {
  for (const name of ["sale-detail-zero-total.xml", "sale-detail-zero-items-selfclosing.xml", "sale-detail-code-03.xml"]) {
    const { fetcher } = fixtureFetcher(await readRealpriceFixture(name));
    const result = await month({ fetcher });
    assert.deepEqual([result.ok, result.totalCount, result.items, result.calls], [true, 0, [], 1], name);
  }
});

test("TK-10: totalCount 2,350건을 1,000·1,000·350건 3쪽으로 받고, 2쪽이 5xx면 그 달 전체를 실패로 돌려준다", async () => {
  const pages = pagedSaleResponses({ total: 2350, pageSize: 1000 });
  const { fetcher, calls } = recordingFetcher((url, { pageNo }) => xmlResponse(pages[pageNo - 1]), requestedUrls);
  const result = await month({ fetcher });
  assert.deepEqual([result.ok, result.totalCount, result.items.length, result.calls], [true, 2350, 2350, 3]);
  assert.deepEqual(calls.map((call) => call.pageNo), [1, 2, 3]);
  for (const call of calls) assert.equal(new URL(call.url).searchParams.get("numOfRows"), "1000");
  const { rows, droppedCount } = await buildTradeRows({ kind: "sale", dealYmd: "202610", items: result.items });
  assert.deepEqual([rows.length, droppedCount, new Set(rows.map((row) => row.trade_key)).size], [2350, 0, 2350]);

  const failing = recordingFetcher((url, { pageNo }) => (pageNo === 2 ? new Response("busy", { status: 503 }) : xmlResponse(pages[pageNo - 1])), requestedUrls);
  const failed = await month({ fetcher: failing.fetcher });
  assert.deepEqual(failed, { ok: false, code: RT_UPSTREAM_FAILED, httpStatus: 503, calls: 2 }, "실패 결과에는 코드·HTTP 상태·호출 수만");
  assert.deepEqual(failing.calls.map((call) => call.pageNo), [1, 2], "실패 뒤 3쪽을 부르지 않음");
  assert.deepEqual(planRealpriceRetry(failed.code, NOW), { code: RT_UPSTREAM_FAILED, scope: "month", retryAt: "2026-11-19T03:30:00.000Z", warning: false });
});

test("TK-10: 공공데이터포털이 쪽 크기를 1,000보다 작게 막아도 totalCount까지 쪽을 더 받는다", async () => {
  const total = 2350;
  const capped = 100;
  const items = Array.from({ length: total }, (_, n) => saleDetailItem(n));
  const { fetcher, calls } = recordingFetcher((url, { pageNo }) => xmlResponse(realpriceXml({ items: items.slice((pageNo - 1) * capped, pageNo * capped), totalCount: total, pageNo, numOfRows: capped })), requestedUrls);
  const result = await month({ fetcher });
  assert.deepEqual([result.ok, result.items.length, result.calls, calls.length], [true, total, 24, 24]);
});

test("TK-15: 모은 항목 수가 totalCount와 다르거나 받는 도중 totalCount가 바뀌면 RT_COUNT_MISMATCH", async () => {
  const three = [0, 1, 2].map((n) => saleDetailItem(n));
  const cases = {
    "덜 옴(다음 쪽이 비어 있음)": (url, { pageNo }) => xmlResponse(realpriceXml({ items: pageNo === 1 ? three : [], totalCount: 5, pageNo })),
    "더 옴": () => xmlResponse(realpriceXml({ items: three, totalCount: 2 })),
    "다음 쪽이 결과 코드 03": (url, { pageNo }) => xmlResponse(pageNo === 1 ? realpriceXml({ items: three, totalCount: 5, numOfRows: 3 }) : realpriceHeaderOnlyXml("03", "NODATA_ERROR")),
    "도중에 totalCount가 바뀜": (url, { pageNo }) => xmlResponse(realpriceXml({ items: three, totalCount: pageNo === 1 ? 6 : 7, pageNo, numOfRows: 3 })),
  };
  for (const [name, respond] of Object.entries(cases)) {
    const { fetcher } = recordingFetcher(respond, requestedUrls);
    const result = await month({ fetcher });
    assert.equal(result.ok, false, name);
    assert.equal(result.code, RT_COUNT_MISMATCH, name);
  }
  const huge = recordingFetcher(() => xmlResponse(realpriceXml({ items: three, totalCount: 30_001 })), requestedUrls);
  const tooMany = await month({ fetcher: huge.fetcher });
  assert.deepEqual([tooMany.code, tooMany.calls], [RT_COUNT_MISMATCH, 1], "쪽 수 상한(30쪽 × 1,000건)을 넘으면 더 부르지 않음");
  assert.deepEqual(planRealpriceRetry(RT_COUNT_MISMATCH, NOW).scope, "month");
});

const RESULT_CODE_EXPECTATIONS = [
  [["01", "02", "04", "05", "99", "23"], RT_UPSTREAM_FAILED, "month", "2026-11-19T03:30:00.000Z", false],
  [["10", "11"], RT_REQUEST_INVALID, "kind", "2026-11-19T09:00:00.000Z", true],
  [["12"], RT_SERVICE_GONE, "kind", "2026-11-20T03:00:00.000Z", true],
  [["20"], RT_ACCESS_DENIED, "kind", "2026-11-19T04:00:00.000Z", true],
  [["21", "29", "30", "32", "33"], RT_KEY_INVALID, "all", "2026-11-19T04:00:00.000Z", false],
  [["22", "022"], RT_DAILY_LIMIT, "all", "2026-11-19T15:10:00.000Z", false],
  [["31"], RT_KEY_EXPIRED, "all", "2026-11-19T04:00:00.000Z", false],
  [["77", "INFO-200"], RT_UPSTREAM_FAILED, "month", "2026-11-19T03:30:00.000Z", false],
];

test("TK-17: 결과 코드별 바꾼 코드와 다음 차례(머리의 resultCode, 추정 모양)", async () => {
  const template = await readRealpriceFixture("error-in-header-22.xml");
  for (const [codes, expected, scope, retryAt, warning] of RESULT_CODE_EXPECTATIONS) {
    for (const code of codes) {
      const { fetcher } = fixtureFetcher(template.replace("<resultCode>22</resultCode>", `<resultCode>${code}</resultCode>`));
      const result = await month({ fetcher });
      assert.deepEqual(result, { ok: false, code: expected, httpStatus: 200, calls: 1 }, `코드 ${code}`);
      assert.deepEqual(planRealpriceRetry(result.code, NOW), { code: expected, scope, retryAt, warning }, `코드 ${code} 다음 차례`);
    }
  }
});

test("TK-17: 오류 봉투(OpenAPI_ServiceResponse, 추정 모양)의 returnReasonCode도 같은 표로 바꾼다", async () => {
  const template = await readRealpriceFixture("error-envelope-30.xml");
  const envelope = (code) => template.replace("<returnReasonCode>30</returnReasonCode>", `<returnReasonCode>${code}</returnReasonCode>`);
  for (const [code, expected] of [["30", RT_KEY_INVALID], ["22", RT_DAILY_LIMIT], ["20", RT_ACCESS_DENIED], ["12", RT_SERVICE_GONE], ["99", RT_UPSTREAM_FAILED], ["00", RT_RESPONSE_INVALID]]) {
    const { fetcher } = fixtureFetcher(envelope(code));
    const result = await month({ fetcher });
    assert.equal(result.code, expected, `봉투 코드 ${code}`);
  }
  const { fetcher } = fixtureFetcher(envelope("03"));
  assert.deepEqual(await month({ fetcher }), { ok: true, api: "sale", dealYmd: "202610", totalCount: 0, items: [], calls: 1 }, "봉투의 03도 정상 0건");
});

test("TK-17: HTTP 상태·주소 이동·연결 실패·15초 초과·깨진 응답·5MB 초과를 표대로 바꾼다", async () => {
  const statusCases = [
    [401, RT_KEY_INVALID, "all"], [403, RT_KEY_INVALID, "all"], [429, RT_DAILY_LIMIT, "all"],
    [400, RT_REQUEST_INVALID, "kind"], [404, RT_REQUEST_INVALID, "kind"],
    [500, RT_UPSTREAM_FAILED, "month"], [503, RT_UPSTREAM_FAILED, "month"], [302, RT_UPSTREAM_FAILED, "month"],
  ];
  for (const [status, expected, scope] of statusCases) {
    const { fetcher, calls } = recordingFetcher(() => new Response(status === 302 ? null : "본문", { status, headers: status === 302 ? { Location: "https://example.invalid/" } : {} }), requestedUrls);
    const result = await month({ fetcher });
    assert.deepEqual(result, { ok: false, code: expected, httpStatus: status, calls: 1 }, `HTTP ${status}`);
    assert.equal(planRealpriceRetry(result.code, NOW).scope, scope, `HTTP ${status} 범위`);
    assert.equal(calls[0].init.redirect, "manual", "주소 이동을 따라가지 않음");
    assert.ok(calls[0].init.signal instanceof AbortSignal, "요청마다 시간 제한 신호");
  }

  const throwing = recordingFetcher((url) => {
    throw new TypeError(`fetch failed: ${url}`);
  }, requestedUrls);
  assert.deepEqual(await month({ fetcher: throwing.fetcher }), { ok: false, code: RT_UPSTREAM_FAILED, httpStatus: null, calls: 1 }, "연결 실패(오류 메시지에 주소가 있어도 담지 않음)");

  const hanging = recordingFetcher((url, { init }) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  }), requestedUrls);
  assert.deepEqual(await month({ fetcher: hanging.fetcher, timeoutMs: 30 }), { ok: false, code: RT_UPSTREAM_FAILED, httpStatus: null, calls: 1 }, "시간 초과");

  const brokenBodies = {
    "깨진 XML": "<response><header><resultCode>000",
    "속성": realpriceXml({ items: [saleDetailItem(1)] }).replace("<item>", '<item a="1">'),
    "CDATA": realpriceXml({ items: [saleDetailItem(1)] }).replace("<aptNm>", "<aptNm><![CDATA[").replace("</aptNm>", "]]></aptNm>"),
    "중첩": realpriceXml({ items: [saleDetailItem(1)] }).replace("<item>", "<item><item>").replace("</item>", "</item></item>"),
    "정상 코드인데 몸통 없음": realpriceHeaderOnlyXml("000", "OK"),
    "결과 코드 03인데 항목 있음": realpriceXml({ resultCode: "03", items: [saleDetailItem(1)] }),
  };
  for (const [name, body] of Object.entries(brokenBodies)) {
    const { fetcher } = fixtureFetcher(body);
    assert.deepEqual(await month({ fetcher }), { ok: false, code: RT_RESPONSE_INVALID, httpStatus: 200, calls: 1 }, name);
  }
  const oversized = recordingFetcher(() => new Response("<response/>", { status: 200, headers: { "Content-Length": String(REALPRICE_MAX_BODY_BYTES + 1) } }), requestedUrls);
  assert.deepEqual(await month({ fetcher: oversized.fetcher }), { ok: false, code: RT_RESPONSE_INVALID, httpStatus: 200, calls: 1 }, "5MB 초과");
});

test("TK-17: 다음 차례 계산 — 하루 한도는 한국 시각 다음 날 00:10, 경고는 종류 단위 오류 3가지만", () => {
  assert.equal(planRealpriceRetry(RT_DAILY_LIMIT, new Date("2026-11-19T14:59:00.000Z")).retryAt, "2026-11-19T15:10:00.000Z", "한국 23:59 → 다음 날 00:10");
  assert.equal(planRealpriceRetry(RT_DAILY_LIMIT, new Date("2026-11-19T15:05:00.000Z")).retryAt, "2026-11-20T15:10:00.000Z", "한국 00:05 → 그다음 날 00:10");
  assert.equal(planRealpriceRetry(RT_DAILY_LIMIT, new Date("2026-12-31T16:00:00.000Z")).retryAt, "2027-01-01T15:10:00.000Z", "해 넘김");
  const warned = [RT_UPSTREAM_FAILED, RT_RESPONSE_INVALID, RT_COUNT_MISMATCH, RT_REQUEST_INVALID, RT_SERVICE_GONE, RT_ACCESS_DENIED, RT_KEY_INVALID, RT_KEY_EXPIRED, RT_DAILY_LIMIT]
    .filter((code) => planRealpriceRetry(code, NOW).warning);
  assert.deepEqual(warned, [RT_REQUEST_INVALID, RT_SERVICE_GONE, RT_ACCESS_DENIED]);
  assert.deepEqual(planRealpriceRetry("RT_SOMETHING_NEW", NOW), { code: "RT_SOMETHING_NEW", scope: "month", retryAt: "2026-11-19T03:30:00.000Z", warning: false }, "모르는 코드는 그 달만 30분");
});

test("건수만 받기: 매매 일반 API를 numOfRows=1로 1번 불러 totalCount만 돌려준다(DEC-WT-32)", async () => {
  const { fetcher, calls } = fixtureFetcher(await readRealpriceFixture("sale-basic-count.xml"));
  const result = await fetchRealpriceTotalCount({ api: "saleBasic", dealYmd: "202610", serviceKey: FAKE_SERVICE_KEY, fetcher });
  collectedResults.push(result);
  assert.deepEqual(result, { ok: true, api: "saleBasic", dealYmd: "202610", totalCount: 57, calls: 1 });
  const url = new URL(calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, REALPRICE_APIS.saleBasic.url);
  assert.equal(url.searchParams.get("numOfRows"), "1");
  const failing = recordingFetcher(() => new Response("", { status: 401 }), requestedUrls);
  const failed = await fetchRealpriceTotalCount({ api: "saleBasic", dealYmd: "202610", serviceKey: FAKE_SERVICE_KEY, fetcher: failing.fetcher });
  collectedResults.push(failed);
  assert.deepEqual(failed, { ok: false, code: RT_KEY_INVALID, httpStatus: 401, calls: 1 });
});

test("요청 주소: 4개 상수 밖의 API 종류·잘못된 연월은 요청 전에 막고, Decoding 키는 한 번만 인코딩한다", async () => {
  const { fetcher, calls } = recordingFetcher(() => xmlResponse(""), requestedUrls);
  for (const api of ["other", "../sale", "__proto__", "constructor", ""]) {
    await assert.rejects(fetchRealpriceMonth({ api, dealYmd: "202610", serviceKey: FAKE_SERVICE_KEY, fetcher }), (error) => error instanceof TypeError && !error.message.includes(FAKE_SERVICE_KEY), api);
  }
  for (const dealYmd of ["202613", "202600", "2026-10", "20261", 202610]) {
    await assert.rejects(fetchRealpriceMonth({ api: "sale", dealYmd, serviceKey: FAKE_SERVICE_KEY, fetcher }), TypeError, String(dealYmd));
  }
  await assert.rejects(fetchRealpriceMonth({ api: "sale", dealYmd: "202610", serviceKey: " ", fetcher }), TypeError, "빈 키");
  assert.equal(calls.length, 0, "막힌 경우에는 바깥 요청 0번");

  const decodingKey = "ZZKEY+7F3A/0000==";
  const url = new URL(buildRealpriceRequestUrl({ api: "rent", serviceKey: decodingKey, dealYmd: "202610", pageNo: 2 }));
  assert.equal(url.searchParams.get("serviceKey"), decodingKey);
  assert.ok(url.search.includes("serviceKey=ZZKEY%2B7F3A%2F0000%3D%3D"), "한 번만 인코딩(%252B 같은 두 번 인코딩 없음)");
  assert.deepEqual([...url.searchParams.keys()], ["serviceKey", "LAWD_CD", "DEAL_YMD", "pageNo", "numOfRows"]);
  assert.deepEqual([url.searchParams.get("LAWD_CD"), url.searchParams.get("DEAL_YMD"), url.searchParams.get("pageNo"), url.searchParams.get("numOfRows")], ["30110", "202610", "2", "1000"]);
});

// ── 칸 변환·거래 ID(realprice-rows.mjs) ──

test("칸 변환: 면적은 문자열 자릿수로 반올림, 금액은 만 원 × 10,000, 날짜는 YY.MM.DD만", () => {
  assert.deepEqual(["84.97", "59.9876", "39.6", "84.975", "84.974", "100", "0.004", "0.005", " 59.92 "].map(toAreaX100), [8497, 5999, 3960, 8498, 8497, 10000, null, 1, 5992]);
  assert.deepEqual(["0", "0.0", "", " ", "abc", "-59.9", "59,9", null].map(toAreaX100), [null, null, null, null, null, null, null, null]);
  assert.deepEqual(["42,500", "  8,000", "0", "1.5", "-3", "", "12만"].map(toWon), [425000000, 80000000, 0, null, null, null, null]);
  assert.deepEqual(["26.10.30", "26.02.30", "2026.10.30", "26.1.3", " "].map(toShortDate), ["2026-10-30", null, null, null, null]);
});

test("칸 변환(D-5·D-7): 저장할 수 없는 항목은 이유별로 버리고, 길이 제한은 0003 상수대로 지킨다", async () => {
  const base = saleDetailItem(1);
  const long = (n) => "가".repeat(n);
  const items = [
    base,
    { ...base, dealMonth: "2", dealDay: "30" },
    { ...base, dealMonth: "9" },
    { ...base, excluUseAr: " " },
    { ...base, excluUseAr: "0" },
    { ...base, aptNm: " " },
    { ...base, dealAmount: "abc" },
    { ...base, aptNm: long(REALPRICE_ROW_LIMITS.aptNm + 1) },
    { ...base, umdNm: long(REALPRICE_ROW_LIMITS.umdNm + 1) },
    { ...base, jibun: "1".repeat(REALPRICE_ROW_LIMITS.jibun + 1) },
    { ...base, aptSeq: "9".repeat(REALPRICE_ROW_LIMITS.aptSeq + 1) },
    { ...base, dealDay: "2", umdNm: long(REALPRICE_ROW_LIMITS.umdNm), aptNm: long(REALPRICE_ROW_LIMITS.aptNm) },
    { ...base, dealDay: "3", aptDong: "1".repeat(REALPRICE_ROW_LIMITS.aptDong + 1) },
  ];
  // 2월 30일은 달력에 없는 날, 9월은 요청한 달(202610)이 아닌 날이다.
  const result = await buildTradeRows({ kind: "sale", dealYmd: "202610", items });
  assert.deepEqual(REALPRICE_ROW_LIMITS, { aptNm: 80, umdNm: 30, jibun: 20, aptSeq: 20, aptDong: 20, extraJson: 1000 });
  assert.deepEqual(result.dropped, { invalidDate: 1, outOfMonth: 1, missingArea: 2, missingAptNm: 1, invalidPrice: 1, tooLong: 4 });
  assert.equal(result.droppedCount, 10);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.cleared, { aptDong: 1, extraJson: 0 });
  assert.ok(result.rows.some((row) => [...row.umd_nm].length === 30 && [...row.apt_nm].length === 80), "제한과 같은 길이는 남김(umd_nm 30)");
  assert.equal(result.rows.find((row) => row.deal_date === "2026-10-03").apt_dong, null, "apt_dong이 넘으면 행은 두고 NULL");

  const calendar = await buildTradeRows({ kind: "sale", dealYmd: "202602", items: [{ ...base, dealMonth: "2", dealDay: "30" }, { ...base, dealMonth: "2", dealDay: "28" }] });
  assert.deepEqual([calendar.dropped.invalidDate, calendar.rows.length], [1, 1], "달력에 없는 날(2월 30일)");

  const extra = await buildTradeRows({ kind: "rent", dealYmd: "202610", items: [{ ...base, deposit: "1,000", monthlyRent: "10", contractTerm: "9".repeat(1000) }] });
  assert.deepEqual([extra.rows[0].extra_json, extra.cleared.extraJson], ["{}", 1], "extra_json이 1,000자를 넘으면 비움");
});

test("칸 변환: 전월세는 보증금·월세와 덧붙임 5칸만 남기고, 해제·중개 구분은 늘 비어 있다", async () => {
  const screen = parseRealpriceXml(await readRealpriceFixture("rent-screen.xml"));
  const { rows, droppedCount } = await buildTradeRows({ kind: "rent", dealYmd: "202610", items: screen.items });
  assert.equal(droppedCount, 0);
  const jeonse = rows.find((row) => row.deal_date === "2026-10-05");
  const wolse = rows.find((row) => row.deal_date === "2026-10-20");
  assert.deepEqual([jeonse.deposit_won, jeonse.monthly_rent_won, jeonse.price_won, jeonse.apt_seq], [297680000, 0, null, null]);
  assert.equal(jeonse.extra_json, JSON.stringify({ contractTerm: "24.08~26.08", contractType: "신규" }));
  assert.deepEqual([wolse.deposit_won, wolse.monthly_rent_won], [50000000, 650000]);
  assert.equal(wolse.extra_json, JSON.stringify({ contractTerm: "26.11~28.10", contractType: "갱신", useRRRight: "사용", preDeposit: "4,500", preMonthlyRent: "60" }));
  for (const row of rows) {
    assert.deepEqual([row.kind, row.dealing_gbn, row.cancelled, row.cancelled_on, row.registered_on, row.apt_dong], ["rent", null, 0, null, null, null]);
    assert.match(row.trade_key, /^rent:202610:[0-9a-f]{20}:0$/u);
  }

  const doc = parseRealpriceXml(await readRealpriceFixture("rent-doc.xml"));
  const docRows = (await buildTradeRows({ kind: "rent", dealYmd: "202610", items: doc.items })).rows;
  assert.deepEqual(docRows.map((row) => row.apt_seq).sort(), ["30110-9001", "30110-9002"], "기술문서 예제의 aptSeq는 받음");
  for (const row of docRows) assert.deepEqual(Object.keys(row), ROW_COLUMNS);
  assert.ok(!JSON.stringify(docRows).includes("가상로") && !JSON.stringify(docRows).includes("roadnm"), "소문자 roadnm… 칸은 버림");
  await assert.rejects(buildTradeRows({ kind: "saleBasic", dealYmd: "202610", items: [] }), TypeError, "매매 일반은 저장하지 않음");
});

test("칸 변환: 분양권은 ownershipGbn만 덧붙이고, 단지명·면적이 빈 항목은 버린다(D-5)", async () => {
  const page = parseRealpriceXml(await readRealpriceFixture("presale.xml"));
  const { rows, droppedCount, dropped } = await buildTradeRows({ kind: "presale", dealYmd: "202610", items: page.items });
  assert.deepEqual([rows.length, droppedCount, dropped.missingArea], [2, 1, 1]);
  const byDate = Object.fromEntries(rows.map((row) => [row.deal_date, row]));
  assert.deepEqual([byDate["2026-10-12"].extra_json, byDate["2026-10-12"].dealing_gbn, byDate["2026-10-12"].price_won], ['{"ownershipGbn":"입"}', "direct", 352100000]);
  assert.deepEqual([byDate["2026-10-18"].extra_json, byDate["2026-10-18"].dealing_gbn], ["{}", "broker"]);
  for (const row of rows) assert.deepEqual([row.apt_seq, row.build_year, row.registered_on, row.area_x100], [null, null, null, 5987]);
  assert.ok(!JSON.stringify(rows).includes("대전 동구"), "sggNm·estateAgentSggNm은 버림");
});

test("TK-13·TK-14: 거래 ID — 똑같은 2건은 순번 0·1, 다시 받으면 같은 ID, 1건이 빠지면 1행만, 금액이 바뀌면 그 행만 다른 ID", async () => {
  const twin = saleDetailItem(5);
  const other = saleDetailItem(6);
  const keysOf = async (items) => (await buildTradeRows({ kind: "sale", dealYmd: "202610", items })).rows.map((row) => row.trade_key);
  const prefix = (key) => key.slice(0, key.lastIndexOf(":"));
  const first = await keysOf([twin, { ...twin }, other]);
  assert.equal(first.length, 3);
  const twinKeys = first.filter((key) => first.filter((candidate) => prefix(candidate) === prefix(key)).length === 2);
  assert.equal(twinKeys.length, 2, "같은 서명 2행");
  assert.deepEqual(twinKeys.map((key) => key.slice(key.lastIndexOf(":"))).sort(), [":0", ":1"]);
  assert.deepEqual(await keysOf([other, { ...twin }, twin]), first, "다시 받기(순서가 달라도) 같은 ID");
  const afterRemoval = await keysOf([twin, other]);
  assert.deepEqual(first.filter((key) => !afterRemoval.includes(key)), [twinKeys.find((key) => key.endsWith(":1"))], "1건이 빠지면 순번 1 한 행만 사라짐");
  const corrected = await keysOf([twin, { ...twin }, { ...other, dealAmount: "99,999" }]);
  const otherKey = first.find((key) => !twinKeys.includes(key));
  assert.deepEqual(first.filter((key) => !corrected.includes(key)), [otherKey], "금액 정정: 옛 ID 1개 지움");
  assert.equal(corrected.filter((key) => !first.includes(key)).length, 1, "새 ID 1개 넣음, 나머지는 그대로");

  // 같은 서명 안에서는 바뀌는 칸으로 정렬해 순번을 붙이므로 받는 순서와 상관없이 같은 행이 같은 순번을 받는다.
  const cancelled = { ...twin, cdealType: "O", cdealDay: "26.10.20" };
  const ordered = async (items) => (await buildTradeRows({ kind: "sale", dealYmd: "202610", items })).rows.map((row) => `${row.trade_key.slice(-1)}:${row.cancelled}`).sort();
  assert.deepEqual(await ordered([cancelled, twin]), await ordered([twin, cancelled]));
  assert.deepEqual(await ordered([cancelled, twin]), ["0:0", "1:1"]);
});

test("거래 ID 서명: 단지 고유번호가 없으면 법정동+지번+단지명, NFKC·공백 정리, 나중에 바뀌는 칸은 넣지 않음", async () => {
  const page = parseRealpriceXml(await readRealpriceFixture("sale-detail-empty-aptseq.xml"));
  const { rows } = await buildTradeRows({ kind: "sale", dealYmd: "202610", items: page.items });
  const noSeq = rows.find((row) => row.apt_seq === null);
  const withSeq = rows.find((row) => row.apt_seq !== null);
  assert.ok(noSeq && withSeq, "aptSeq 공백 한 칸은 NULL");
  assert.equal(tradeSignatureSource(noSeq), "sale|2026-10-04|가상동+101+가상숲1단지|8497|12|410000000");
  assert.equal(tradeSignatureSource(withSeq), "sale|2026-10-06|30110-9001|8497|12|420000000");
  const fullWidth = { ...noSeq, apt_nm: "가상숲１단지", umd_nm: " 가상동 " };
  assert.equal(tradeSignatureSource(fullWidth), tradeSignatureSource(noSeq), "전각 숫자·앞뒤 공백은 같은 서명");
  const changed = { ...withSeq, cancelled: 1, cancelled_on: "2026-10-20", registered_on: "2026-11-01", apt_dong: "102", dealing_gbn: "direct", extra_json: '{"a":"b"}' };
  assert.equal(tradeSignatureSource(changed), tradeSignatureSource(withSeq), "해제·등기·동·중개 구분·extra_json은 서명에 없음");
  const rent = { kind: "rent", deal_date: "2026-10-05", apt_seq: null, umd_nm: "가상동", jibun: "101", apt_nm: "가상숲1단지", area_x100: 8497, floor: null, deposit_won: 297680000, monthly_rent_won: 0 };
  assert.equal(tradeSignatureSource(rent), "rent|2026-10-05|가상동+101+가상숲1단지|8497||297680000|0");
});

// ── 첫 확인 스크립트(scripts/realprice-probe.mjs, TK-43용) ──

test("첫 확인 스크립트: 기본 계획은 16번, 출력에는 칸 이름·코드·건수·형식 모양만 있고 키·주소·본문은 없다", async () => {
  const plan = defaultProbePlan(NOW);
  assert.equal(plan.length, 16);
  assert.deepEqual(plan.filter((step) => step.api === "sale" && step.dealYmd.endsWith("06")).map((step) => step.dealYmd), ["200606", "200706", "200806", "200906", "201006", "201106", "201206", "201306", "201406", "201506"]);
  assert.ok(plan.some((step) => step.api === "rent" && step.dealYmd === "201101"));
  assert.deepEqual(plan.filter((step) => step.numOfRows === 9999).length, 1);
  assert.deepEqual([...new Set(plan.filter((step) => step.label.includes("지난달")).map((step) => step.dealYmd))], ["202610"]);
  assert.equal(defaultProbePlan(new Date("2026-01-05T00:00:00.000Z")).at(-1).dealYmd, "202512", "1월이면 지난해 12월");

  const fixtures = {
    sale: await readRealpriceFixture("sale-detail-normal.xml"),
    saleBasic: await readRealpriceFixture("sale-basic-count.xml"),
    rent: await readRealpriceFixture("rent-doc.xml"),
    presale: await readRealpriceFixture("presale.xml"),
    zero: await readRealpriceFixture("sale-detail-zero-total.xml"),
    envelope: await readRealpriceFixture("error-envelope-30.xml"),
  };
  const { fetcher, calls } = recordingFetcher((url) => {
    const params = new URL(url).searchParams;
    if (params.get("numOfRows") === "9999") return xmlResponse(fixtures.envelope);
    if (params.get("DEAL_YMD") === "201101") return xmlResponse(fixtures.zero);
    const api = Object.entries(REALPRICE_APIS).find(([, value]) => url.startsWith(`${value.url}?`))[0];
    return xmlResponse(fixtures[api]);
  }, requestedUrls);
  const report = await runRealpriceProbe({ serviceKey: FAKE_SERVICE_KEY, fetcher, now: NOW });
  assert.equal(calls.length, 16);
  assert.equal(report.results.length, 16);
  const serialized = JSON.stringify(report);
  assert.ok(!serialized.includes(FAKE_SERVICE_KEY) && !serialized.includes("serviceKey") && !serialized.includes("apis.data.go.kr"), "키·요청 주소 없음");
  assert.ok(!serialized.includes("가상숲1단지") && !serialized.includes("가상로"), "단지명·도로명 같은 본문 값 없음");
  const first = report.results[0];
  assert.deepEqual([first.httpStatus, first.outcome, first.resultCode, first.totalCount, first.itemCount], [200, "정상 틀", "000", 3, 3]);
  assert.ok(first.fieldNames.includes("aptSeq") && first.fieldNames.includes("roadNm"));
  assert.deepEqual(first.aptSeqEmpty, { empty: 0, of: 3 });
  assert.deepEqual(first.fields.excluUseAr.patterns, ["99.99 ×1", "99.9999 ×1", "99.9 ×1"]);
  assert.deepEqual(first.fields.dealingGbn.values, ["중개거래 ×1", "직거래 ×1"]);
  assert.equal(first.fields.aptNm.maxLength, 6);
  assert.equal(first.fields.aptNm.patterns, undefined, "단지명은 길이만");
  const zero = report.results.find((result) => result.dealYmd === "201101");
  assert.equal(zero.bodyShape, "response(header(resultCode,resultMsg),body(items,numOfRows,pageNo,totalCount))");
  const envelope = report.results.find((result) => result.requestedRows === 9999);
  assert.deepEqual([envelope.outcome, envelope.reasonCode, envelope.mapped.code], ["오류 봉투", "30", RT_KEY_INVALID]);
});

test("첫 확인 스크립트: Encoding 키(%)·빈 키는 부르기 전에 멈추고, 응답에 키가 섞여 오면 결과를 남기지 않는다", async () => {
  const { fetcher, calls } = recordingFetcher(() => xmlResponse(realpriceXml({ resultMsg: FAKE_SERVICE_KEY, items: [] })), requestedUrls);
  await assert.rejects(runRealpriceProbe({ serviceKey: "ZZKEY%2B7F3A", fetcher, now: NOW }), /Decoding 키/u);
  await assert.rejects(runRealpriceProbe({ serviceKey: "", fetcher, now: NOW }), /MOLIT_RT_SERVICE_KEY/u);
  assert.equal(calls.length, 0);
  await assert.rejects(runRealpriceProbe({ serviceKey: FAKE_SERVICE_KEY, fetcher, now: NOW, plan: [{ label: "한 번", api: "sale", dealYmd: "202610", numOfRows: 1000 }] }), (error) => /인증키가 섞여/u.test(error.message) && !error.message.includes(FAKE_SERVICE_KEY));
  assert.equal(isInsideRepo("/repo/root/out.json", "/repo/root"), true);
  assert.equal(isInsideRepo("/repo/root", "/repo/root"), true);
  assert.equal(isInsideRepo("/repo/root2/out.json", "/repo/root"), false);
  assert.equal(isInsideRepo("/elsewhere/out.json", "/repo/root"), false);
});

// ── 맨 끝: 이 파일에서 나간 모든 요청과 결과 ──

test("TK-32·TK-31(부분): 가짜 fetcher가 받은 요청 주소는 모두 4개 주소 안이고, 받기 결과에는 키 표식이 0건이다", () => {
  assert.ok(requestedUrls.length > 50, `검사한 요청 ${requestedUrls.length}개`);
  for (const value of requestedUrls) {
    const url = new URL(value);
    assert.ok(REALPRICE_ENDPOINTS.includes(`${url.origin}${url.pathname}`), `허용 주소 밖: ${url.origin}${url.pathname}`);
    assert.ok(!url.hostname.includes("rt.molit.go.kr"), "국토교통부 실거래가 공개시스템 화면 주소 없음");
    assert.equal(url.searchParams.get("LAWD_CD"), "30110");
  }
  assert.equal(REALPRICE_ENDPOINTS.length, 4);
  assert.ok(collectedResults.length > 40, `검사한 결과 ${collectedResults.length}개`);
  for (const result of collectedResults) {
    for (const text of [JSON.stringify(result), String(result), JSON.stringify(Object.entries(result))]) {
      assert.ok(!text.includes(FAKE_SERVICE_KEY), "키 표식 0건");
      assert.ok(!/serviceKey/iu.test(text), "serviceKey 0건");
    }
    if (!result.ok) assert.deepEqual(Object.keys(result).sort(), ["calls", "code", "httpStatus", "ok"], "실패 결과는 코드·HTTP 상태·호출 수만");
  }
});
