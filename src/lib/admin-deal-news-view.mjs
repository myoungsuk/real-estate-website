// 관리자 '거래 완료 소식' 화면(/admin/deal-news/)의 글·값 만들기(순수 함수. 서버 요청·저장·브라우저 저장소 없음).
// 꼴 검사와 넣는 순간 판정은 src/lib/admin-deal-news.mjs가 맡고, 이 파일은 그 결과를 화면 문장으로 바꾸기만 한다(기준을 따로 두지 않음).
// 계약일·잔금·건수·올릴 수 있는 날은 이 파일의 함수 인자로만 지나가고 어디에도 남기지 않는다.
import { DEAL_NEWS_COUNT_MONTHS, DEAL_NEWS_MIN_COUNT, DEAL_NEWS_UMD_NAMES, DEAL_NEWS_WAIT_DAYS, judgeDealNewsName } from "./admin-deal-news.mjs";
import { dealNewsAreaText, dealNewsDealLabel } from "./deal-news.mjs";

// 실거래 단지 이름에서 괄호 안 글(지번·블록 표기 등)을 덜고 공백을 하나로 줄인 값. 예: "가상숲1단지(3블록 1203-1)" → "가상숲1단지".
// 덜어 낸 뒤에도 남는 숫자 꼴은 dealNewsNameProblem()이 까닭과 함께 막는다(검사를 느슨하게 하지 않음).
export function dealNewsTrimName(name) {
  if (typeof name !== "string") return "";
  let text = name.normalize("NFC");
  let previous;
  do {
    previous = text;
    text = text.replace(/[(（][^()（）]*[)）]/gu, " ");
  } while (text !== previous);
  return text.replace(/[()（）]/gu, " ").replace(/\s+/gu, " ").trim();
}

// "2026-12-16" → "2026년 12월 16일". 같은 해이면 연도를 뺀다("12월 16일").
export function dealNewsDateText(date, today = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(typeof date === "string" ? date : "");
  if (!match) return "";
  const monthDay = `${Number(match[2])}월 ${Number(match[3])}일`;
  return today.startsWith(`${match[1]}-`) ? monthDay : `${match[1]}년 ${monthDay}`;
}

// 판정의 막는 까닭을 화면 문장으로. 60일 조건은 풀리는 날을 함께 적는다.
export function dealNewsBlockerLines(judged, today) {
  return judged.blockers.map((blocker) => (blocker.code === "WAIT_DAYS" && judged.publishableFrom
    ? `${blocker.message.replace(/\.$/u, "")}(${dealNewsDateText(judged.publishableFrom, today)}부터).`
    : blocker.message));
}

// 올릴 수 있을 때 판정 상자의 한 줄.
export function dealNewsReadyLine(dealType) {
  return `올릴 수 있습니다. 잔금 끝남 · 계약일에서 ${DEAL_NEWS_WAIT_DAYS}일 지남${dealType === "sale" ? " · 실거래 자료 확인" : ""}`;
}

// 찾기 결과 한 칸의 작은 글: "천동 · 매매·전세 자료". 고른 거래 종류에 면적대가 없으면 그 뜻을 덧붙인다.
export function dealNewsHitNote(complex, dealType) {
  const kinds = ["sale", "jeonse", "monthly-rent"].filter((value) => (complex?.bands?.[value] ?? []).length > 0).map(dealNewsDealLabel);
  const base = `${complex?.umdName ?? ""} · ${kinds.join("·")} 자료`;
  return dealNewsBands(complex, dealType).length === 0 && dealType ? `${base} · ${dealNewsDealLabel(dealType)} 거래 없음` : base;
}

// 고른 단지·거래 종류의 전용면적대 목록(최근 6개월 실거래 자료에 있는 것).
export function dealNewsBands(complex, dealType) {
  const list = complex?.bands?.[dealType];
  return Array.isArray(list) ? list : [];
}

// 실거래 법정동이 동구 동네 목록에 있으면 그 이름, 없으면 ""(화면이 직접 고르게 함).
export function dealNewsUmdOf(umdName) {
  return DEAL_NEWS_UMD_NAMES.includes(umdName) ? umdName : "";
}

// "2026-05-25" ~ "2026-11-25" → "2026. 5. 25. ~ 11. 25."
function windowText(from, to) {
  const part = (date) => date.split("-").map(Number);
  const [fy, fm, fd] = part(from);
  const [ty, tm, td] = part(to);
  return `${fy}. ${fm}. ${fd}. ~ ${fy === ty ? "" : `${ty}. `}${tm}. ${td}.`;
}

// 건수 API 응답 → { tone: "ok" | "area", text, count }. count는 판정에 넘길 값(모르면 null).
export function dealNewsCountResult(data, { areaBand, dealType }) {
  if (!data || data.available !== true || !Number.isInteger(data.count)) {
    return { tone: "area", count: null, text: "오늘은 실거래 자료 읽기 한도에 닿아 건수를 셀 수 없습니다. 동네 이름으로 올리거나 내일 다시 확인해 주세요." };
  }
  const name = judgeDealNewsName({ propertyKind: "apartment", recentCount: data.count });
  const head = `최근 ${DEAL_NEWS_COUNT_MONTHS}개월(${windowText(data.basis.from, data.basis.to)}) 같은 단지·${dealNewsAreaText(areaBand)}·${dealNewsDealLabel(dealType)} ${data.count}건.`;
  const tail = name.canUse ? ` ${DEAL_NEWS_MIN_COUNT}건 이상이라 단지 이름을 쓸 수 있습니다.` : ` ${DEAL_NEWS_MIN_COUNT}건보다 적어 동네 이름으로 올립니다.`;
  const missing = data.coverage && data.coverage.complete === false && data.coverage.missingMonths?.length > 0
    ? ` 아직 받지 못한 달(${data.coverage.missingMonths.join(", ")})이 있어 실제보다 적을 수 있습니다.`
    : "";
  return { tone: name.canUse ? "ok" : "area", count: data.count, text: `${head}${tail}${missing}` };
}

// 지금 목록의 한 줄 상태: "지금 홈에 보이는 소식 3 / 5건"
export function dealNewsNowCount(published, max) {
  return `${published} / ${max}건`;
}
