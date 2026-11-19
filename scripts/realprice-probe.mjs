// 단계 P 실거래가 첫 확인(TK-43): 공공데이터포털 API 4개의 실제 응답 모양을 재고, 설계서 22.4·22.5·22.16절을 확정할 숫자만 남긴다.
// 운영자 PC에서 인증키를 발급받은 뒤 한 번 실행한다(호출 17번, 공공데이터포털 하루 한도 10,000번의 1% 미만).
//
// 실행 방법(인증키는 공공데이터포털 "일반 인증키(Decoding)"를 넣는다. 화면에 보이지 않게 입력되고, 끝나면 지운다)
//
//   PowerShell
//     $env:MOLIT_RT_SERVICE_KEY = Read-Host "인증키(Decoding)" -MaskInput
//     node scripts/realprice-probe.mjs --out "$HOME\Documents\realprice-probe.json"
//     Remove-Item Env:MOLIT_RT_SERVICE_KEY
//     (Windows PowerShell 5.1에는 -MaskInput이 없다. 빼고 실행하면 입력한 키가 화면에 보이므로 주위를 확인한다)
//
//   Git Bash
//     read -rs -p "인증키(Decoding): " MOLIT_RT_SERVICE_KEY; echo; export MOLIT_RT_SERVICE_KEY
//     node scripts/realprice-probe.mjs --out ~/Documents/realprice-probe.json
//     unset MOLIT_RT_SERVICE_KEY
//
// - 키는 환경변수 MOLIT_RT_SERVICE_KEY에서만 읽는다. 파일(.dev.vars 등)을 열지 않는다.
// - 출력(화면·결과 파일)에는 인증키·요청 주소·응답 본문이 없다. 칸 이름, 결과 코드, 건수, 칸별 최대 글자 수,
//   형식 모양(숫자는 9, 한글은 가로 바꿈), 몇 가지 구분 칸의 값 목록, 응답의 태그 구조만 남긴다.
//   그래도 결과 파일에 키가 들어 있으면 쓰지 않고 멈춘다.
// - 결과 파일은 저장소 밖에만 쓴다(저장소 안 경로를 주면 멈춤). 결과는 대화·협업 보드에 붙여도 되지만 인증키는 붙이지 않는다.
import { writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { REALPRICE_APIS, REALPRICE_REQUEST_TIMEOUT_MS, buildRealpriceRequestUrl, classifyResultCode, normalizeResultCode } from "../worker/realprice-fetch.mjs";
import { readRealpriceBody, readXmlTree, parseRealpriceXml } from "../worker/realprice-parse.mjs";

export const PROBE_KEY_ENV = "MOLIT_RT_SERVICE_KEY";
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

// 값 목록을 그대로 남겨도 되는 구분 칸(짧은 공개 구분값)과 형식 모양만 남기는 칸.
const ENUM_FIELDS = Object.freeze(["cdealType", "dealingGbn", "contractType", "useRRRight", "ownershipGbn", "landLeaseholdGbn", "slerGbn", "buyerGbn"]);
const PATTERN_FIELDS = Object.freeze([
  "aptSeq", "dealAmount", "deposit", "monthlyRent", "preDeposit", "preMonthlyRent", "excluUseAr", "floor", "buildYear",
  "dealYear", "dealMonth", "dealDay", "cdealDay", "rgstDate", "contractTerm", "jibun", "aptDong", "sggCd", "umdCd",
]);
const MAX_LIST = 12;

const previousMonth = (now) => {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const date = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth() - 1, 1));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

// 기본 호출 계획(17번): 매매 상세 2006 ~ 2015년 해마다 6월(aptSeq 빈 비율), 4종류 지난달, 전월세 2011-01(0건 달 모양), numOfRows 9999 1번,
// 쪽 번호 확인 1번(매매 상세 지난달을 10건씩 나눈 2쪽이 "sale 지난달" 1,000건 응답의 11 ~ 20번째와 같은지, 2026-11-19 B-1).
export const PAGE_CHECK_ROWS = 10;
export function defaultProbePlan(now = new Date()) {
  const recent = previousMonth(now);
  const plan = [];
  for (let year = 2006; year <= 2015; year += 1) plan.push({ label: `매매 상세 ${year}-06`, api: "sale", dealYmd: `${year}06`, numOfRows: 1000 });
  for (const api of ["sale", "saleBasic", "rent", "presale"]) plan.push({ label: `${api} 지난달`, api, dealYmd: recent, numOfRows: 1000 });
  plan.push({ label: "전월세 2011-01(0건 달 모양)", api: "rent", dealYmd: "201101", numOfRows: 1000 });
  plan.push({ label: "numOfRows 9999 시험", api: "sale", dealYmd: recent, numOfRows: 9999 });
  plan.push({ label: "쪽 번호 확인(매매 상세 지난달 2쪽, 10건씩)", api: "sale", dealYmd: recent, numOfRows: PAGE_CHECK_ROWS, pageNo: 2, compareWith: "sale 지난달" });
  return plan;
}

// 쪽 번호 확인: 작은 쪽(numOfRows건)의 2쪽을 같은 달 큰 쪽 응답과 견준다. 값은 남기지 않고 판정 문장만 남긴다.
export function comparePageCheck(pageItems, referenceItems, size = PAGE_CHECK_ROWS) {
  if (!Array.isArray(referenceItems) || referenceItems.length < size * 2) {
    return `비교할 자료 부족(큰 쪽 ${Array.isArray(referenceItems) ? referenceItems.length : 0}건, ${size * 2}건 이상 필요)`;
  }
  const text = JSON.stringify(pageItems ?? []);
  if (text === JSON.stringify(referenceItems.slice(size, size * 2))) return `2쪽 = 큰 쪽의 ${size + 1} ~ ${size * 2}번째(쪽 번호를 지킴)`;
  if (text === JSON.stringify(referenceItems.slice(0, size))) return "2쪽 = 1쪽(쪽 번호를 무시함)";
  return "어느 쪽과도 같지 않음(쪽 크기마다 정렬이 다를 수 있음, 추가 확인 필요)";
}

const shape = (value) => value.replace(/\d/gu, "9").replace(/[가-힣]/gu, "가").replace(/[A-Za-z]/gu, "A");

function skeleton(element) {
  if (element.children.length === 0) return element.name;
  const names = [];
  for (const child of element.children) {
    const text = skeleton(child);
    if (names.at(-1)?.text === text) names.at(-1).count += 1;
    else names.push({ text, count: 1 });
  }
  return `${element.name}(${names.map(({ text, count }) => (count > 1 ? `${text}×${count}` : text)).join(",")})`;
}

// 태그 구조만(값 없음). XML이 아니면 null.
function describeBody(text) {
  try {
    return skeleton(readXmlTree(text)).slice(0, 2000);
  } catch {
    return null;
  }
}

function summarizeItems(items) {
  const fields = {};
  for (const item of items) {
    for (const [name, value] of Object.entries(item)) {
      const field = (fields[name] ??= { present: 0, empty: 0, maxLength: 0, patterns: new Map(), values: new Map() });
      field.present += 1;
      if (value === null) {
        field.empty += 1;
        continue;
      }
      field.maxLength = Math.max(field.maxLength, [...value].length);
      if (PATTERN_FIELDS.includes(name)) field.patterns.set(shape(value), (field.patterns.get(shape(value)) ?? 0) + 1);
      if (ENUM_FIELDS.includes(name) && [...value].length <= 10) field.values.set(value, (field.values.get(value) ?? 0) + 1);
    }
  }
  const top = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_LIST).map(([value, count]) => `${value} ×${count}`);
  return Object.fromEntries(Object.keys(fields).sort().map((name) => {
    const field = fields[name];
    const summary = { present: field.present, empty: field.empty, maxLength: field.maxLength };
    if (field.patterns.size > 0) summary.patterns = top(field.patterns);
    if (field.values.size > 0) summary.values = top(field.values);
    return [name, summary];
  }));
}

const safeMessage = (value) => (typeof value === "string" && /^[A-Za-z0-9 _.\-]{1,80}$/u.test(value) ? value : value == null ? null : "(형식 밖, 남기지 않음)");

async function probeOne(step, { serviceKey, fetcher, timeoutMs, itemsByLabel }) {
  const result = { label: step.label, api: step.api, dataId: REALPRICE_APIS[step.api].dataId, dealYmd: step.dealYmd, requestedRows: step.numOfRows };
  const pageNo = step.pageNo ?? 1;
  if (pageNo !== 1) result.requestedPage = pageNo;
  let response;
  try {
    response = await fetcher(buildRealpriceRequestUrl({ api: step.api, serviceKey, dealYmd: step.dealYmd, pageNo, numOfRows: step.numOfRows }), {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/xml" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return { ...result, outcome: "연결 실패 또는 시간 초과", errorName: error?.name === "TimeoutError" || error?.name === "AbortError" ? error.name : "Error" };
  }
  result.httpStatus = response.status;
  result.contentType = (response.headers.get("Content-Type") ?? "").split(";")[0].slice(0, 40);
  let text;
  try {
    text = await readRealpriceBody(response);
  } catch {
    return { ...result, outcome: "본문 읽기 실패(5MB 초과·UTF-8 아님·끊김)" };
  }
  result.bodyBytes = new TextEncoder().encode(text).length;
  result.bodyShape = describeBody(text);
  if (result.bodyShape === null) return { ...result, outcome: "XML 아님" };
  let page;
  try {
    page = parseRealpriceXml(text);
  } catch {
    return { ...result, outcome: "읽기 함수가 거부함(RT_RESPONSE_INVALID)" };
  }
  if (page.envelope === "service-error") {
    return { ...result, outcome: "오류 봉투", reasonCode: normalizeResultCode(page.reasonCode), mapped: classifyResultCode(page.reasonCode) };
  }
  Object.assign(result, {
    outcome: "정상 틀",
    resultCode: page.resultCode && /^\d{1,3}$/u.test(page.resultCode) ? page.resultCode : "(숫자 아님)",
    resultMsg: safeMessage(page.resultMsg),
    mapped: classifyResultCode(page.resultCode),
    totalCount: page.totalCount,
    pageNo: page.pageNo,
    numOfRowsEcho: page.numOfRows,
    itemCount: page.items?.length ?? null,
  });
  // 항목 값은 결과에 넣지 않고, 쪽 번호 확인에서 견줄 때만 메모리에 둔다.
  if (page.items) itemsByLabel?.set(step.label, page.items);
  if (step.compareWith) result.pageCheck = comparePageCheck(page.items, itemsByLabel?.get(step.compareWith), step.numOfRows);
  if (page.items && page.items.length > 0) {
    result.fieldNames = [...new Set(page.items.flatMap((item) => Object.keys(item)))].sort();
    result.fields = summarizeItems(page.items);
    if (step.api === "sale" || result.fieldNames.includes("aptSeq")) {
      const empty = page.items.filter((item) => item.aptSeq == null).length;
      result.aptSeqEmpty = { empty, of: page.items.length };
    }
  }
  return result;
}

// 호출 계획대로 부르고 결과 객체를 돌려준다(파일은 쓰지 않음). 결과에 키가 들어 있으면 던진다.
export async function runRealpriceProbe({ serviceKey, fetcher = fetch, plan, now = new Date(), timeoutMs = REALPRICE_REQUEST_TIMEOUT_MS } = {}) {
  if (typeof serviceKey !== "string" || serviceKey.trim() === "") throw new Error(`인증키가 없습니다. 환경변수 ${PROBE_KEY_ENV}에 넣고 다시 실행하세요.`);
  if (serviceKey.includes("%")) throw new Error("인증키에 %가 들어 있습니다. 공공데이터포털의 Encoding 키가 아니라 Decoding 키를 넣으세요.");
  const steps = plan ?? defaultProbePlan(now);
  const results = [];
  const itemsByLabel = new Map();
  for (const step of steps) results.push(await probeOne(step, { serviceKey, fetcher, timeoutMs, itemsByLabel }));
  const report = { probedAt: now.toISOString(), lawdCd: "30110", calls: steps.length, results };
  const serialized = JSON.stringify(report);
  if (serialized.includes(serviceKey) || serialized.includes(encodeURIComponent(serviceKey)) || /serviceKey=/iu.test(serialized)) {
    throw new Error("결과에 인증키가 섞여 있어 남기지 않고 멈춥니다.");
  }
  return report;
}

function parseOut(argv) {
  const index = argv.indexOf("--out");
  return index >= 0 ? argv[index + 1] : undefined;
}

// 저장소 안 경로면 true.
export function isInsideRepo(path, repoRoot = REPO_ROOT) {
  const fromRepo = relative(resolve(repoRoot), resolve(path));
  return fromRepo === "" || (!fromRepo.startsWith("..") && !isAbsolute(fromRepo));
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    const out = parseOut(process.argv.slice(2));
    if (!out) throw new Error("결과 파일 경로를 --out으로 주세요(저장소 밖). 예: --out \"$HOME\\Documents\\realprice-probe.json\"");
    if (isInsideRepo(out)) throw new Error("결과 파일은 저장소 밖에 둡니다. 다른 경로를 주세요.");
    const report = await runRealpriceProbe({ serviceKey: process.env[PROBE_KEY_ENV] });
    await writeFile(resolve(out), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    for (const result of report.results) {
      console.log(`${result.label}: HTTP ${result.httpStatus ?? "-"}, ${result.outcome}, 코드 ${result.resultCode ?? result.reasonCode ?? "-"}, totalCount ${result.totalCount ?? "-"}, 받은 ${result.itemCount ?? "-"}건${result.pageCheck ? `, ${result.pageCheck}` : ""}`);
    }
    console.log(`결과 파일: ${resolve(out)} (호출 ${report.calls}번)`);
  } catch (error) {
    // 오류 메시지는 이 파일이 만든 고정 문장만 보인다(바깥 요청 오류는 위에서 이름만 남김).
    console.error(error instanceof Error ? error.message : "알 수 없는 오류");
    process.exitCode = 1;
  }
}
