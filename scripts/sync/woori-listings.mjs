// 우리집부동산 공개 중개사 홈페이지(home.woori-house.co.kr/42957)가 화면에 쓰는 공개 매물 목록(JSON)을
// 엑셀 가져오기와 같은 16칸 줄로 바꾼다. 그 뒤 처리(건너뛰기·형식 검사·지우기)는 src/lib/admin/woori-listing-import.mjs를 그대로 쓴다.
// 2026-11-24 우리집부동산 회신: 개별 중개사 API는 없고, 로그인 없는 중개사 홈페이지를 안내함. 짧은 시간에 여러 번 부르면 IP를 막으므로 하루 1번만 부른다.
// 이 목록에는 호수가 없다. 쓰는 칸은 네이버 매물번호·종류·거래·단지 이름·동 번호·광고 층·총층·면적·가격·등록일뿐이다.
import { WOORI_LISTING_EXPECTED_HEADERS } from "../../src/lib/admin/woori-listing-import.mjs";

export const WOORI_PUBLIC_HOSTS = new Set(["home.woori-house.co.kr"]);
export const WOORI_PUBLIC_OFFICE_ID = "42957";
export const WOORI_PUBLIC_LIST_PATH = "/api/mm_list.aspx";
// 한 번에 받는 최대 건수. 지금 33건이고, 다음 쪽(next_page)이 있으면 받지 않고 실패로 멈춘다.
export const WOORI_PUBLIC_TOP_COUNT = 200;

export function wooriPublicListUrl() {
  const url = new URL(`https://home.woori-house.co.kr${WOORI_PUBLIC_LIST_PATH}`);
  url.search = new URLSearchParams({
    order_by: "",
    last_mm_num: "0",
    top_cnt: String(WOORI_PUBLIC_TOP_COUNT),
    prtn_uid: WOORI_PUBLIC_OFFICE_ID,
    sub_rlsttype_cd: "",
  }).toString();
  return url;
}

const REQUIRED_KEYS = Object.freeze([
  "naver_uid",
  "mm_uid",
  "RLSTTYPE_NM",
  "SUB_RLSTTYPE_NM",
  "DEALTYPE_NM",
  "BLDNM",
  "DONG_NM",
  "CORES_FLR_CNT",
  "TOT_FLR_CNT",
  "SPLY_SPC",
  "EXCLS_SPC",
  "DEAL_AMT",
  "WRRNT_AMT",
  "LEASE_AMT",
  "prcl_price",
  "premium_price",
  "optionPrice",
  "SVC_DATE_STRT",
  "PRCS_CD",
  "DEAL_CMPT_DATE",
]);

// 공개 홈페이지에 보이는 매물의 진행 코드. 2026-11-24 받은 33건이 모두 4였고 같은 날 엑셀 '진행상황'은 모두 '서비스중'이었다.
// 다른 코드가 오면 뜻을 모르므로 건너뛰지 않고 실행을 멈춘다(모르는 이유로 매물을 지우지 않음).
const IN_SERVICE_CODE = "4";

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).normalize("NFKC").replace(/\s+/gu, " ").trim();
}

function amount(value) {
  const digits = text(value).replace(/,/gu, "");
  if (!/^\d+$/u.test(digits)) return null;
  return Number(digits);
}

function withCommas(number) {
  return number.toLocaleString("en-US");
}

/**
 * 공개 목록 응답 글 → 매물 줄 배열. 모양이 다르면 던진다(그날 받기는 실패로 끝나고 파일은 그대로).
 * @param {string} body
 */
export function parseWooriPublicListResponse(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("우리집부동산 공개 매물 목록이 JSON이 아닙니다.");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("우리집부동산 공개 매물 목록의 모양이 다릅니다.");
  if (data.result !== true) throw new Error("우리집부동산 공개 매물 목록이 성공 응답이 아닙니다.");
  if (!Array.isArray(data.list_result)) throw new Error("우리집부동산 공개 매물 목록에 매물 배열이 없습니다.");
  if (data.next_page !== false) throw new Error("우리집부동산 공개 매물 목록에 다음 쪽이 있습니다. 한 번에 받는 건수를 늘려야 합니다.");
  if (data.list_result.length === 0) throw new Error("우리집부동산 공개 매물 목록이 비어 있습니다. 매물을 모두 지우지 않도록 멈춥니다.");
  if (data.list_result.length >= WOORI_PUBLIC_TOP_COUNT) throw new Error("우리집부동산 공개 매물이 한 번에 받는 건수만큼 차 있어 빠진 매물이 있을 수 있습니다.");
  data.list_result.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`우리집부동산 공개 매물 ${index + 1}번째 줄의 모양이 다릅니다.`);
    const missing = REQUIRED_KEYS.filter((key) => !(key in row));
    if (missing.length > 0) throw new Error(`우리집부동산 공개 매물 ${index + 1}번째 줄에 칸이 없습니다: ${missing.join(", ")}`);
    if (text(row.PRCS_CD) !== IN_SERVICE_CODE) throw new Error(`우리집부동산 공개 매물 ${index + 1}번째 줄의 진행 코드가 처음 보는 값입니다.`);
  });
  return data.list_result;
}

// 광고 층·총층 → 엑셀 상세주소 괄호와 같은 자리에 넣을 글. 총층을 알면 "7/22층"·"고/22층".
function floorText(row) {
  const floor = text(row.CORES_FLR_CNT);
  const total = text(row.TOT_FLR_CNT);
  const validTotal = /^\d{1,3}$/u.test(total) && Number(total) > 0 ? String(Number(total)) : null;
  if (/^\d{1,3}$/u.test(floor) && Number(floor) > 0) return validTotal ? `${Number(floor)}/${validTotal}층` : `${Number(floor)}층`;
  if (/^(고|중|저)$/u.test(floor)) return validTotal ? `${floor}/${validTotal}층` : floor;
  return "";
}

// 엑셀 '매물가'와 같은 글. 매매는 매매가, 분양권(매매가 0)은 분양가 + 프리미엄 + 옵션(2026-11-24 같은 날 엑셀 2건과 대조해 같음),
// 전세는 보증금, 월세는 "보증금/월세". 숫자가 아니면 빈 글을 넘겨 엑셀 모듈이 형식 오류로 막게 한다.
function priceText(row) {
  const trade = text(row.DEALTYPE_NM);
  if (trade === "월세") {
    const deposit = amount(row.WRRNT_AMT);
    const rent = amount(row.LEASE_AMT);
    return deposit === null || rent === null ? "" : `${withCommas(deposit)}/${withCommas(rent)}`;
  }
  if (trade === "전세") {
    const deposit = amount(row.WRRNT_AMT);
    return deposit === null ? "" : withCommas(deposit);
  }
  const sale = amount(row.DEAL_AMT);
  if (sale && sale > 0) return withCommas(sale);
  if (text(row.SUB_RLSTTYPE_NM).includes("분양권")) {
    const parts = [row.prcl_price, row.premium_price, row.optionPrice].map(amount);
    if (parts.some((part) => part === null)) return "";
    const total = parts.reduce((sum, part) => sum + part, 0);
    return total > 0 ? withCommas(total) : "";
  }
  return "";
}

function areaKind(row) {
  return text(row.RLSTTYPE_NM) === "아파트" || text(row.SUB_RLSTTYPE_NM).startsWith("아파트") ? "공급" : "계약";
}

/**
 * 공개 매물 줄 → 엑셀 가져오기와 같은 { headers, rows }.
 * 상세주소에는 동 번호와 광고 층만 넣는다(호수 없음).
 */
export function wooriPublicRowsToTable(rows) {
  const headers = [...WOORI_LISTING_EXPECTED_HEADERS];
  const tableRows = rows.map((row, index) => {
    const dong = text(row.DONG_NM);
    const detail = /^\d{1,4}$/u.test(dong) ? `${dong}동 (${floorText(row)})` : "";
    const record = {
      "번호": String(index + 1),
      "홍보방식": "",
      "우리집매물번호": text(row.mm_uid),
      "네이버매물번호": text(row.naver_uid),
      "매물종류": text(row.SUB_RLSTTYPE_NM),
      "거래종류": text(row.DEALTYPE_NM),
      "소재지": "",
      "매물명": text(row.BLDNM),
      "상세주소": detail,
      "면적1(㎡)": `[${areaKind(row)}] ${text(row.SPLY_SPC)}`,
      "면적2(㎡)": `[전용] ${text(row.EXCLS_SPC)}`,
      "매물가": priceText(row),
      "등록": text(row.SVC_DATE_STRT),
      "진행상황": "서비스중",
      "거래완료": text(row.DEAL_CMPT_DATE),
      "중개사메모": "",
    };
    return headers.map((header) => record[header]);
  });
  return { headers, rows: tableRows };
}
