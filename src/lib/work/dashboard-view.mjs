// 관리자 대시보드(/admin/, 사용자 선택 2026-11-23 A안 "숫자 띠 + 칸 넷")의 화면 문장. 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// 응답 꼴은 worker/work-dashboard.mjs의 GET /work/dashboard(칸마다 { ok: true, … } 또는 { ok: false, code }).
// 손님 이름·할 일 제목은 여기서 글자로만 다루고 주소에는 손님 UUID만 넣는다.
import { homeDateText } from "./tasks-view.mjs";
import { LEDGER_KIND_LABELS, LEDGER_PAYER_LABELS, wonText } from "./ledger-view.mjs";
import { priceParts } from "./realprice-view.mjs";

export const DASHBOARD_LINKS = Object.freeze({
  tasks: "/admin/work/tasks/",
  customers: "/admin/work/customers/",
  ledger: "/admin/work/ledger/",
  realprice: "/admin/work/realprice/",
  listings: "/admin/listings/",
});

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DAY_MS = 24 * 60 * 60 * 1000;
const dayIndex = (dateText) => Date.parse(`${dateText}T00:00:00.000Z`) / DAY_MS;

/** 'YYYY-MM-DD' → 요일 한 글자 @param {string} dateText */
export const weekdayOf = (dateText) => WEEKDAYS[new Date(`${dateText}T00:00:00.000Z`).getUTCDay()];

/** 머리 날짜: '11월 23일 월요일' @param {string} today */
export function dateTitle(today) {
  const [, month, day] = today.split("-").map(Number);
  return `${month}월 ${day}일 ${weekdayOf(today)}요일`;
}

/** '11.26(목)' @param {string} dateText */
export function shortDate(dateText) {
  const [, month, day] = dateText.split("-").map(Number);
  return `${month}.${day}(${weekdayOf(dateText)})`;
}

/** 할 일 줄의 날짜 글: 도구 모음 '오늘 할 일' 칸과 같은 '! n일 지남'·'오늘' @param {string} dueOn @param {string} today */
export function taskWhen(dueOn, today) {
  const text = homeDateText(dueOn, today);
  return { text, late: dueOn < today };
}

/** 일정 줄의 날짜 글: 지난 일정은 '! n일 지남', 오늘은 '오늘', 앞날은 'D-n' + '11.26(목)' @param {string} dueOn @param {string} today */
export function eventWhen(dueOn, today) {
  const days = dayIndex(dueOn) - dayIndex(today);
  if (days < 0) return { lead: `! ${-days}일 지남`, date: shortDate(dueOn), late: true };
  return { lead: days === 0 ? "오늘" : `D-${days}`, date: shortDate(dueOn), late: false };
}

/** 일정 줄 이름: 직접 넣은 일정은 그 제목, 나머지는 종류 이름 @param {{ kind: string, kindLabel: string, title: string }} item */
export const eventKindText = (item) => (item.kind === "custom" && item.title ? item.title : item.kindLabel);

/** 일정 줄의 손님: 한 명이면 이름, 여럿이면 '이름 외 n명', 없으면 빈 글 @param {{ customer: { displayName: string } | null, partyCount: number }} item */
export function eventPartyText(item) {
  if (!item.customer) return "";
  return item.partyCount > 1 ? `${item.customer.displayName} 외 ${item.partyCount - 1}명` : item.customer.displayName;
}

/** 일정 줄 고리: 손님이 있으면 그 손님 카드(주소에는 UUID만), 없으면 손님 목록 @param {{ customer: { id: string } | null }} item */
export const eventHref = (item) => (item.customer ? `/admin/work/customers/detail/?id=${encodeURIComponent(item.customer.id)}` : DASHBOARD_LINKS.customers);

/** 실거래 줄 금액 @param {number | null} priceWon */
export const tradePriceText = (priceWon) => priceParts({ kind: "sale", priceWon }).main;

/** 실거래 줄 면적: 정수로 내려 '84㎡' @param {number} areaM2 */
export const tradeAreaText = (areaM2) => `${Math.floor(Number(areaM2))}㎡`;

/** '2026-11' → '11월' @param {string} month */
export const monthLabel = (month) => `${Number(month.split("-")[1])}월`;

// 칸이 꺼졌거나 실패했을 때 칸 안 한 줄. canRetry: '다시 불러오기' 단추를 보일지.
const SECTION_CODES = Object.freeze({
  WORK_DISABLED: { text: "업무 도구가 켜지지 않아 보이지 않습니다.", canRetry: false, off: true },
  WORK_CONFIG_MISSING: { text: "업무 도구 설정이 빠져 있습니다. 홈페이지 담당자에게 알려 주세요.", canRetry: false, off: true },
  REALPRICE_DISABLED: { text: "실거래가가 켜지지 않아 보이지 않습니다.", canRetry: false, off: true },
  REALPRICE_CONFIG_MISSING: { text: "실거래가 설정이 빠져 있습니다. 홈페이지 담당자에게 알려 주세요.", canRetry: false, off: true },
  WORK_SCHEMA_OUTDATED: { text: "업무 자료 구조가 아직 준비되지 않았습니다. 홈페이지 담당자에게 알려 주세요.", canRetry: false, off: false },
  WORK_SCHEMA_AHEAD: { text: "업무 자료 구조가 프로그램보다 새것입니다. 잠시 뒤 새로고침해 주세요.", canRetry: true, off: false },
  RT_READ_BUDGET: { text: "오늘 실거래가 조회량이 상한에 닿았습니다. 한국 시각 오전 9시 뒤에 다시 보세요.", canRetry: false, off: false },
  AUDIT_UNAVAILABLE: { text: "작업 기록을 남기지 못해 보여 드리지 않았습니다.", canRetry: true, off: false },
});

/** 칸 상태 글 @param {string | null} code */
export function sectionState(code) {
  return SECTION_CODES[code ?? ""] ?? { text: "불러오지 못했습니다. 다른 칸은 그대로 볼 수 있습니다.", canRetry: true, off: false };
}

/** 응답 자체를 받지 못했을 때(네 칸 공통) 칸 안 글 @param {string | null} code */
export function loadFailedState(code) {
  if (code === "AUTH_REQUIRED") return { text: "관리자 로그인이 만료되었습니다. 새로고침해서 다시 로그인해 주세요.", canRetry: false, off: false };
  if (code === "WORK_DISABLED" || code === "REALPRICE_DISABLED") return sectionState(code);
  return { text: "대시보드를 불러오지 못했습니다. 잠시 뒤 다시 불러오세요.", canRetry: true, off: false };
}

// 계약 일정 수: 응답 total에는 끝내지 않은 지난 일정(30일 안)도 들어 있어, '14일 안' 숫자는 앞날(오늘 포함)만 센다. 지난 것은 곁말로만.
const upcomingCount = (events) => Math.max(0, events.total - events.overdue);

/**
 * 맨 위 숫자 띠 4칸(980px 이상에서만 보임). 칸이 꺼졌거나 실패했으면 값은 '—'이고 아래 글이 까닭이다.
 * @param {any} data GET /work/dashboard의 data
 */
export function kpiItems(data) {
  const failText = (section) => (sectionState(section.code).off ? "꺼짐" : "불러오지 못함");
  const tasks = data.tasks;
  const events = data.events;
  const money = data.money;
  const realprice = data.realprice;
  return [
    {
      key: "tasks", href: DASHBOARD_LINKS.tasks, label: "오늘 할 일",
      ...(tasks.ok
        ? { value: String(tasks.overdue + tasks.dueToday), unit: "건", sub: tasks.overdue > 0 ? `! 기한 지남 ${tasks.overdue}건` : "기한 지난 할 일 없음", warn: tasks.overdue > 0 }
        : { value: "—", unit: "", sub: failText(tasks), warn: false }),
    },
    {
      key: "events", href: DASHBOARD_LINKS.customers, label: "14일 안 계약 일정",
      ...(events.ok
        ? {
          value: String(upcomingCount(events)), unit: "건",
          sub: events.overdue > 0 ? `! 지난 일정 ${events.overdue}건` : events.items[0] ? `가장 가까운 일정 ${shortDate(events.items[0].dueOn)} ${eventKindText(events.items[0])}` : "잡힌 일정 없음",
          warn: events.overdue > 0,
        }
        : { value: "—", unit: "", sub: failText(events), warn: false }),
    },
    {
      key: "money", href: DASHBOARD_LINKS.ledger, label: money.ok ? `${monthLabel(money.month)} 미입금` : "이번 달 미입금",
      ...(money.ok
        ? {
          value: money.unpaidWon.toLocaleString("ko-KR"), unit: "원",
          sub: money.unpaidCount > 0 ? `! ${money.unpaidCount}줄 · 받을 금액 ${wonText(money.receivableWon)}` : `받을 금액 ${wonText(money.receivableWon)}`,
          warn: money.unpaidCount > 0,
        }
        : { value: "—", unit: "", sub: failText(money), warn: false }),
    },
    {
      key: "realprice", href: DASHBOARD_LINKS.realprice, label: "새 실거래 7일",
      ...(realprice.ok
        // 신고가 수는 '새 실거래 7일' 칸 아래지만 최근 30일 기준이라 '30일'을 붙인다(판정 준비 중 글은 그대로).
        ? { value: String(realprice.newCount), unit: "건", sub: `관심 단지 ${realprice.watchNewCount} · ${realprice.newHighCount === null ? "신고가 판정 준비 중" : `30일 신고가 ${realprice.newHighCount}`}`, warn: false }
        : { value: "—", unit: "", sub: failText(realprice), warn: false }),
    },
  ];
}

/** 칸 제목 옆 숫자 글 @param {"tasks" | "events" | "money" | "realprice"} key @param {any} section */
export function sectionCount(key, section) {
  if (!section.ok) return "";
  if (key === "tasks") return `오늘까지 ${section.overdue + section.dueToday}건`;
  if (key === "events") return `${shortDate(section.until)}까지 ${upcomingCount(section)}건${section.overdue > 0 ? ` · 지난 일정 ${section.overdue}건` : ""}`;
  if (key === "money") return `${monthLabel(section.month)} · 잔금일 기준`;
  return `새 거래 ${section.newCount}건 · 7일`;
}

/** 실거래 칸 목록 제목: 신고가가 보이는 줄보다 많을 때만 '(n건 중 m건)'을 붙인다 @param {any} section */
export function highListTitle(section) {
  const shown = Array.isArray(section.items) ? section.items.length : 0;
  const total = section.newHighCount;
  return Number.isInteger(total) && shown > 0 && total > shown ? `최근 30일 신고가(${total}건 중 ${shown}건)` : "최근 30일 신고가";
}

/** 칸이 비었을 때 글 @param {"tasks" | "events" | "money" | "realprice"} key @param {any} section */
export function emptyText(key, section) {
  if (key === "tasks") return "오늘까지 끝낼 할 일이 없습니다.";
  if (key === "events") return "14일 안에 잡힌 계약 일정이 없습니다. 일정은 손님 카드의 거래 칸에서 넣습니다.";
  if (key === "money") return `${monthLabel(section.month)}에 잔금일이 있는 장부 줄이 없습니다.`;
  return section.newHighCount === null ? "신고가는 매매 과거 자료를 다 받은 뒤 판정합니다." : "최근 30일 신고가가 없습니다.";
}

/** 이번 달 돈 칸의 세 숫자 @param {any} money */
export function moneyFigures(money) {
  return [
    { key: "receivable", label: "받을 금액", value: wonText(money.receivableWon), due: false },
    { key: "received", label: "입금", value: wonText(money.receivedWon), due: false },
    { key: "unpaid", label: "미입금", value: `${money.unpaidWon > 0 ? "! " : ""}${wonText(money.unpaidWon)}`, due: money.unpaidWon > 0 },
  ];
}

/** 기준일이 없어 합계에서 빠진 줄 알림. undatedCount는 이번 달 몫이 아니라 잔금일 없는 줄 전체 수라 그렇게 읽히게 쓴다. @param {any} money */
export const undatedText = (money) => (money.undatedCount > 0 ? `잔금일이 없는 장부 줄 ${money.undatedCount}건은 어느 달 합계에도 들어가지 않습니다.` : "");

/** 장부 줄 곁말: 낸 쪽 · 미입금 금액 @param {{ payerRole: string | null, unpaidWon: number }} item */
export function moneyItemMeta(item) {
  const roles = /** @type {Record<string, string>} */ (LEDGER_PAYER_LABELS);
  return [item.payerRole ? roles[item.payerRole] ?? "" : "", `미입금 ${wonText(item.unpaidWon)}`].filter(Boolean).join(" · ");
}

/** 장부 줄 종류 이름 @param {string} kind */
export const moneyKindText = (kind) => /** @type {Record<string, string>} */ (LEDGER_KIND_LABELS)[kind] ?? kind;

// 부동산뱅크 매물 자동 받기(.github/workflows/sync-bank-listings.yml, 매일 00:10 한국 시각)가 멈췄는지 보는 줄(2026-11-24 사용자 선택 "GitHub 이슈 + 대시보드 경고").
// 받은 날은 .github/listing-review-state.json의 부동산뱅크 매물 lastSeenAt이다(자동 받기·관리자 XLS 가져오기 때만 바뀌고, 매물이 그대로여도 날마다 바뀜).
// 화면은 빌드 때 받은 날을 싣고, 지금 시각과의 차이는 화면을 연 때 잰다(자동 받기가 실패하면 새로 빌드되지 않으므로).
export const BANK_SYNC_STALE_HOURS = 36;
const HOUR_MS = 60 * 60 * 1000;

// 우리집부동산 매물 자동 받기(사무소 PC 작업 스케줄러, 매일 09:20, scripts/run-woori-sync-local.mjs)도 같은 파일의 우리집부동산 매물(source "woori") lastSeenAt으로 본다(2026-11-25).
// 기준은 '오늘 받았나'다(사용자 결정 2026-11-25 "못키는 날도 있을텐데 그럴땐 뭐 대시보드에 오늘 못 받았다고 알림정도만 올려놔 그럼 보고 엑셀로 올리거나 컴퓨터 키겠지뭐").
// PC가 꺼진 날은 PC 쪽 실패 이슈도 열리지 않으므로 이 줄만 알린다. 받은 날이 어제여도 한국 시각 10:00 전이면 09:20 받기·배포를 기다리는 중이라 정상으로 본다.
export const WOORI_SYNC_DUE_TIME = "10:00";

/** 한 출처 매물 가운데 가장 늦은 받은 날. 그 출처 매물이 없으면 null @param {{ items?: Record<string, { source: string, lastSeenAt: string | null }> }} reviewState @param {string} source */
function sourceLastSeenOn(reviewState, source) {
  const dates = Object.values(reviewState?.items ?? {})
    .filter((item) => item?.source === source && /^\d{4}-\d{2}-\d{2}$/u.test(item.lastSeenAt ?? ""))
    .map((item) => /** @type {string} */ (item.lastSeenAt));
  return dates.length > 0 ? dates.sort().at(-1) ?? null : null;
}

/** 부동산뱅크 매물 가운데 가장 늦은 받은 날. 부동산뱅크 매물이 없으면 null @param {{ items?: Record<string, { source: string, lastSeenAt: string | null }> }} reviewState */
export const bankLastSeenOn = (reviewState) => sourceLastSeenOn(reviewState, "bank");

/** 우리집부동산 매물 가운데 가장 늦은 받은 날. 우리집부동산 매물이 없으면 null @param {{ items?: Record<string, { source: string, lastSeenAt: string | null }> }} reviewState */
export const wooriLastSeenOn = (reviewState) => sourceLastSeenOn(reviewState, "woori");

/**
 * 받은 날(한국 날짜)의 0시부터 36시간이 넘으면 멈춤으로 본다(00:10 실행·배포가 늦어지는 몫을 넉넉히 둠). 색만으로 알리지 않게 '!'와 '멈춤'을 글에 넣는다.
 * @param {string} lastSeenOn 'YYYY-MM-DD' @param {string} today 한국 날짜 'YYYY-MM-DD' @param {number} nowMs 지금 시각(밀리초)
 */
export function bankSyncState(lastSeenOn, today, nowMs) {
  const days = Math.max(0, dayIndex(today) - dayIndex(lastSeenOn));
  const ago = days === 0 ? "오늘" : days === 1 ? "어제" : `${days}일 전`;
  const stale = nowMs - Date.parse(`${lastSeenOn}T00:00:00.000+09:00`) > BANK_SYNC_STALE_HOURS * HOUR_MS;
  return stale
    ? { stale, text: `! 부동산뱅크 자동 받기 멈춤 · 마지막 ${shortDate(lastSeenOn)}(${ago})` }
    : { stale, text: `부동산뱅크 자동 받기 ${ago} · ${shortDate(lastSeenOn)}` };
}

/** 달력에 있는 'YYYY-MM-DD'인지 @param {unknown} value @returns {value is string} */
const isDateText = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(dayIndex(value)) && new Date(dayIndex(value) * DAY_MS).toISOString().slice(0, 10) === value;

/**
 * 우리집부동산: 받은 날이 오늘이면 정상, 어제면 한국 시각 10:00 전까지만 정상, 그 밖은 '오늘 못 받음'이다.
 * 색만으로 알리지 않게 '!'를 글 앞에 넣는다. 받은 날·오늘이 날짜가 아니면 받은 날을 모르는 채 '오늘 못 받음'으로 본다.
 * @param {string} lastSeenOn 'YYYY-MM-DD' @param {string} today 한국 날짜 'YYYY-MM-DD' @param {number} nowMs 지금 시각(밀리초)
 */
export function wooriSyncState(lastSeenOn, today, nowMs) {
  if (!isDateText(lastSeenOn) || !isDateText(today)) return { stale: true, text: "! 우리집부동산 오늘 못 받음 · 마지막 받은 날 모름" };
  const days = dayIndex(today) - dayIndex(lastSeenOn);
  const beforeDue = nowMs < Date.parse(`${today}T${WOORI_SYNC_DUE_TIME}:00.000+09:00`);
  if (days <= 0) return { stale: false, text: `우리집부동산 자동 받기 오늘 · ${shortDate(lastSeenOn)}` };
  if (days === 1 && beforeDue) return { stale: false, text: `우리집부동산 자동 받기 어제 · ${shortDate(lastSeenOn)}` };
  return { stale: true, text: `! 우리집부동산 오늘 못 받음 · 마지막 ${shortDate(lastSeenOn)}` };
}

// '오늘 못 받음'일 때만 그 줄 아래에 보이는 고리 글(엑셀 가져오기 칸이 있는 매물 등록 화면으로 감).
export const WOORI_SYNC_LATE_HELP_TEXT = "사무소 PC를 켜거나 '우리집부동산 엑셀 가져오기'로 올려 주세요";

// 우리집부동산 매물이 0건이면 받은 날이 남지 않아 받았는지 알 수 없다(공개 목록이 비면 자동 받기는 파일을 바꾸지 않고 실패한다).
export const WOORI_SYNC_NO_LISTINGS_TEXT = "우리집부동산 자동 받기 · 매물 0건이라 받은 날을 알 수 없음";
