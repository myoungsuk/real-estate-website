// 단계 P 실거래가 시험 도우미: 고정 표본 읽기, 많은 행 XML 만들기, 요청을 기록하는 가짜 fetcher.
// 큰 응답(예: 2,350건)은 저장소에 넣지 않고 여기서 만든다. 값은 모두 가상이다.
import { readFile } from "node:fs/promises";

// 인증키 유출 검사용 가짜 키 표식(테스트 체크리스트 7a장). 실제 키가 아니다.
export const FAKE_SERVICE_KEY = "ZZKEY-7F3A-0000000000000000";

const FIXTURE_DIR = new URL("./fixtures/realprice/", import.meta.url);

export function readRealpriceFixture(name) {
  return readFile(new URL(name, FIXTURE_DIR), "utf8");
}

const escapeXml = (value) => String(value).replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");

// 칸 객체 목록으로 정상 틀 응답 XML을 만든다.
export function realpriceXml({ resultCode = "000", resultMsg = "OK", items = [], totalCount = items.length, pageNo = 1, numOfRows = 1000 } = {}) {
  const itemXml = items.map((fields) => `<item>${Object.entries(fields).map(([name, value]) => `<${name}>${escapeXml(value)}</${name}>`).join("")}</item>`).join("");
  return `<response><header><resultCode>${resultCode}</resultCode><resultMsg>${resultMsg}</resultMsg></header><body><items>${itemXml}</items><numOfRows>${numOfRows}</numOfRows><pageNo>${pageNo}</pageNo><totalCount>${totalCount}</totalCount></body></response>`;
}

// 결과 코드만 있는 응답(오류·자료 없음, 추정 모양).
export function realpriceHeaderOnlyXml(resultCode, resultMsg = "ERROR") {
  return `<response><header><resultCode>${resultCode}</resultCode><resultMsg>${resultMsg}</resultMsg></header></response>`;
}

// 서로 다른 가상 매매 항목 n번째. 같은 n이면 같은 값이다.
export function saleDetailItem(n, overrides = {}) {
  return {
    aptDong: String(100 + (n % 20)),
    aptNm: `가상단지${(n % 7) + 1}`,
    aptSeq: `30110-${9100 + (n % 7)}`,
    buildYear: String(2000 + (n % 20)),
    cdealDay: " ",
    cdealType: " ",
    dealAmount: (20_000 + n).toLocaleString("en-US"),
    dealDay: String((n % 28) + 1),
    dealMonth: "10",
    dealYear: "2026",
    dealingGbn: n % 2 === 0 ? "중개거래" : "직거래",
    excluUseAr: `${59 + (n % 30)}.${String(n % 100).padStart(2, "0")}`,
    floor: String((n % 25) + 1),
    jibun: String(100 + (n % 7)),
    rgstDate: " ",
    sggCd: "30110",
    umdNm: "가상동",
    ...overrides,
  };
}

// totalCount 건을 pageSize씩 나눈 쪽별 XML 목록(예: 2,350건 → 1,000·1,000·350).
export function pagedSaleResponses({ total = 2350, pageSize = 1000 } = {}) {
  const pages = [];
  for (let start = 0, pageNo = 1; start < total; start += pageSize, pageNo += 1) {
    const items = [];
    for (let n = start; n < Math.min(total, start + pageSize); n += 1) items.push(saleDetailItem(n));
    pages.push(realpriceXml({ items, totalCount: total, pageNo, numOfRows: pageSize }));
  }
  return pages;
}

// 받은 요청을 모두 기록하는 가짜 fetcher. respond(url, { pageNo, init, call })는 Response 또는 던질 오류를 돌려준다.
export function recordingFetcher(respond, sink = []) {
  const calls = [];
  const fetcher = async (input, init = {}) => {
    const url = String(input);
    const parsed = new URL(url);
    const entry = { url, pageNo: Number(parsed.searchParams.get("pageNo")), init };
    calls.push(entry);
    sink.push(url);
    return respond(url, { ...entry, call: calls.length });
  };
  return { fetcher, calls };
}

export const xmlResponse = (text, init = {}) => new Response(text, { status: 200, headers: { "Content-Type": "text/xml;charset=UTF-8" }, ...init });
