// 휴지통 화면(단계 2, /admin/work/trash/)과 지우기 화면 4곳의 휴지통 글을 만드는 순수 함수. 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// 시안 2026-11-22 14:42:41 "이 시안대로"(손님 화면 고리 + 업무 도구 처음 바로가기, 메뉴에는 넣지 않음). 응답 칸 이름은 worker/work-trash.mjs와 같다.
// 묶음 이름(label)에는 손님 이름·메모 첫머리가 들어 있으므로 화면에만 보이고 주소·브라우저 저장소·로그에 넣지 않는다.

export const TRASH_KEEP_DAYS = 7; // 서버 TRASH_KEEP_DAYS와 같음
export const TRASH_PAGE_SIZE = 50; // 서버 기본·최대
export const TRASH_SCHEMA_VERSION = 7; // 휴지통 구조(migrations/work/0007_trash.sql)
export const TRASH_PURGE_WORD = "영구 삭제"; // DELETE /work/trash/:batchId 의 confirm 글자
// 사진(file)은 바로 찍기 PR(F-a·F-b)에서 더했다. 서버 묶음 kind 이름은 file 하나이고 손님 사진과 계약서 사본(단계 4)이 함께 든다.
// 그래서 종류 거르기·여러 가지가 섞인 수는 "사진·계약서 사본"으로 쓰고, 파일 한 개 묶음은 묶음 이름으로 둘 중 어느 것인지 가려 쓴다(trashKindTag).
export const TRASH_KINDS = Object.freeze(["customer", "deal", "note", "event", "ledger", "task", "file"]);
const FILES_NAME = "사진·계약서 사본";
export const TRASH_KIND_LABELS = Object.freeze({ customer: "손님", deal: "거래", note: "메모", event: "일정", ledger: "장부 줄", task: "할 일", file: FILES_NAME });
// worker/work-trash.mjs BATCH_SOURCES.file이 계약서 사본 묶음 이름 앞에 붙이는 말(손님 사진은 설명 글이나 "사진 · …"으로 시작)
const COPY_LABEL_PREFIX = "계약서 사본 · ";
const fileWord = (label) => (String(label ?? "").startsWith(COPY_LABEL_PREFIX) ? "계약서 사본" : "사진");
/** 목록 줄의 종류 표시. 파일 한 개 묶음은 "사진"·"계약서 사본" 가운데 하나 @param {{ kind: string, label?: string }} item */
export function trashKindTag(item) {
  return item?.kind === "file" ? fileWord(item.label) : TRASH_KIND_LABELS[item?.kind] ?? "자료";
}
// 파일 수의 이름: 파일 한 개 묶음이면 그 종류, 손님·거래 묶음이면 둘이 섞일 수 있어 "사진·계약서 사본"
const unitFor = (item) => (unit) => (unit[0] === "files" && item?.kind === "file" ? ["files", fileWord(item.label), unit[2]] : unit);

// 지우기 확인 칸 첫 문장(지시서 4.1). 화면 4곳이 같은 글을 쓴다.
export const TRASH_MOVE_NOTICE = "휴지통으로 옮깁니다. 7일 안에 되살릴 수 있고, 그 뒤 자동으로 영구 삭제됩니다.";
// 백업 안내. 숫자를 넣지 않아 처리방침 기간이 바뀌어도 화면을 고치지 않는다(2026-11-22 대장 판단).
export const TRASH_BACKUP_NOTICE = "영구 삭제한 뒤에도 백업에는 개인정보 처리방침에 적힌 기간 동안 남았다가 지워집니다.";
// 손님이 자기 자료를 지워 달라고 할 때(손님 카드·휴지통 사용법, 날개-2 안)
export const TRASH_ERASE_REQUEST = "손님이 자기 자료를 지워 달라고 하면: 손님 카드에서 지운 뒤 휴지통에서 그 묶음을 '영구 삭제'까지 하세요. 휴지통에 두면 7일 동안 남습니다.";

/** @typedef {{ customers?: number, deals?: number, parties?: number, events?: number, notes?: number, tasks?: number, ledger?: number, files?: number, links?: number, appointments?: number }} TrashCountsView */

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const KOREA_OFFSET_MS = 9 * 60 * 60 * 1000;

/** ISO 시각 → 한국 시각 조각. 읽지 못하면 null @param {unknown} iso */
function koreaParts(iso) {
  const time = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(time)) return null;
  const at = new Date(time + KOREA_OFFSET_MS);
  return { month: at.getUTCMonth() + 1, day: at.getUTCDate(), weekday: WEEKDAYS[at.getUTCDay()], hour: at.getUTCHours(), minute: at.getUTCMinutes() };
}
const two = (value) => String(value).padStart(2, "0");

/** "11. 18.(수) 10:12"(지운 때) @param {string} iso */
export function trashDeletedText(iso) {
  const at = koreaParts(iso);
  return at ? `${at.month}. ${at.day}.(${at.weekday}) ${two(at.hour)}:${two(at.minute)}` : "";
}
/** "11월 25일(수)"(되살릴 수 있는 마지막 날·영구 삭제가 시작되는 날) @param {string} iso */
export function trashDayText(iso) {
  const at = koreaParts(iso);
  return at ? `${at.month}월 ${at.day}일(${at.weekday})` : "";
}
/** 지운 뒤 알림 끝 문장 "11월 25일(수)까지 휴지통에서 되살릴 수 있습니다." 응답에 휴지통 값이 없으면 "" @param {{ purgeAfter?: string } | null | undefined} trash */
export function trashUntilText(trash) {
  const day = trashDayText(trash?.purgeAfter ?? "");
  return day ? `${day}까지 휴지통에서 되살릴 수 있습니다.` : "";
}

/**
 * 남은 날 칸. daysLeft는 서버가 한국 날짜로 센 값(0 아래로 내려가지 않음). 1일 이하는 '!'와 빨간 왼쪽 줄(late).
 * @param {{ daysLeft: number, purgeAfter: string }} item
 */
export function trashLeftText(item) {
  const days = Number.isInteger(item?.daysLeft) ? Math.max(0, item.daysLeft) : 0;
  if (days === 0) return { big: "! 곧 영구 삭제", small: "7일이 지나 다음 새벽 정리 때 지워집니다", late: true };
  const small = `${trashDayText(item.purgeAfter)}부터 영구 삭제`;
  return { big: `${days === 1 ? "! " : ""}${days}일 남음`, small, late: days <= 1 };
}

/** 받침이 있으면 true(한글 끝 글자 기준) @param {string} word */
function hasBatchim(word) {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 !== 0;
}
/** 종류 이름 + 이/가 @param {string} kind */
const kindSubject = (kind) => {
  const name = TRASH_KIND_LABELS[kind] ?? "자료";
  return `${name}${hasBatchim(name) ? "이" : "가"}`;
};

// 묶음 안 수 → 글. 순서는 되살리는 순서와 같다(손님 → 거래 → 참여자 → 일정 → 메모 → 할 일 → 장부 줄).
const COUNT_UNITS = Object.freeze([
  ["customers", "손님", "명"], ["deals", "거래", "건"], ["parties", "참여자", "줄"], ["events", "일정", "개"],
  ["notes", "메모", "개"], ["tasks", "할 일", "개"], ["ledger", "장부 줄", "개"], ["files", FILES_NAME, "장"],
]);
const MAIN_COUNT = Object.freeze({ customer: "customers", deal: "deals" });
const countPart = ([key, name, unit], count) => `${name} ${count.toLocaleString("ko-KR")}${unit}`;

/**
 * 줄의 '함께:' 글. 손님·거래 묶음은 그 손님·거래 자신과 참여자 줄을 빼고 센다(참여자 줄만 남았으면 그것만).
 * 메모·일정·장부 줄·할 일 묶음은 그 한 개를 센다(시안 그대로). 셀 것이 없으면 "".
 * @param {{ kind: string, label?: string, counts: TrashCountsView }} item
 */
export function trashCountsText(item) {
  const counts = item?.counts ?? {};
  const main = MAIN_COUNT[item?.kind];
  const parts = COUNT_UNITS.filter(([key]) => key !== main && key !== "parties" && (counts[key] ?? 0) > 0).map(unitFor(item)).map((unit) => countPart(unit, counts[unit[0]]));
  if (parts.length === 0 && (counts.parties ?? 0) > 0 && (counts[main] ?? 0) === 0) parts.push(countPart(COUNT_UNITS[2], counts.parties));
  return parts.join(" · ");
}
/** 영구 삭제 칸의 '모두 지워지는 것' 글(묶음 자신을 넣어 모두 셈, 참여자 줄은 연결이라 뺌) @param {{ kind?: string, label?: string, counts: TrashCountsView }} item */
export function trashPurgeWhatText(item) {
  const counts = item?.counts ?? {};
  const parts = COUNT_UNITS.filter(([key]) => key !== "parties" && (counts[key] ?? 0) > 0).map(unitFor(item)).map((unit) => countPart(unit, counts[unit[0]]));
  if (parts.length === 0 && (counts.parties ?? 0) > 0) parts.push(countPart(COUNT_UNITS[2], counts.parties));
  return parts.join(", ");
}
/** '되살리면 …' 줄(끊었던 메모·장부 줄 연결). 없으면 "" @param {{ counts: TrashCountsView }} item */
export function trashLinksText(item) {
  const links = item?.counts?.links ?? 0;
  return links > 0 ? `되살리면 지울 때 끊었던 메모·장부 줄 연결 ${links.toLocaleString("ko-KR")}개도 다시 잇습니다(그사이 고치지 않은 것만).` : "";
}
/**
 * 되살리기를 한 번 했는데 남은 묶음인지. 손님·거래 묶음은 그 손님·거래가 이미 돌아와 0이면 남은 것이다.
 * 그 밖에는 화면이 기억한 '남음'(되살리기 응답 remaining > 0)으로 판단한다.
 * @param {{ kind: string, counts: TrashCountsView }} item @param {boolean} [remembered]
 */
export function isTrashPartial(item, remembered = false) {
  const main = MAIN_COUNT[item?.kind];
  return remembered || (Boolean(main) && (item?.counts?.[main] ?? 0) === 0);
}
export const TRASH_PARTIAL_TEXT = "함께였던 거래나 손님을 먼저 되살린 뒤 다시 누르세요.";
/** 되살릴 수 없는 묶음(restorable=false) 까닭 @param {{ purgeAfter: string }} item */
export function trashBlockedText(item) {
  return `자료 구조가 바뀌기 전에 지운 것이라 되살릴 수 없습니다. 영구 삭제만 할 수 있고, 두면 ${trashDayText(item.purgeAfter)}부터 저절로 지워집니다.`;
}

/** 목록 위 'n개 보는 중' 줄 @param {number} count @param {{ kind?: string, more?: boolean }} [options] */
export function trashStripText(count, { kind = "", more = false } = {}) {
  const what = kind ? `${TRASH_KIND_LABELS[kind] ?? "자료"} 묶음` : "지운 묶음";
  return `${what} ${count.toLocaleString("ko-KR")}개${more ? " 이상" : ""} · 지운 때 최근 순`;
}
/** 0건 글. 종류로 걸렀으면 그 종류 이름 @param {string} kind */
export function trashEmptyText(kind) {
  if (!kind) return { title: "지운 자료가 없습니다", body: "지운 자료는 7일 동안 여기에 있습니다." };
  return { title: `지운 ${kindSubject(kind)} 없습니다`, body: "다른 종류는 '모두'에서 볼 수 있습니다." };
}

// ── 되살리기 결과 ──
const RESTORED_UNITS = Object.freeze([
  ["customers", "손님", "명"], ["deals", "거래", "건"], ["events", "일정", "개"], ["notes", "메모", "개"], ["tasks", "할 일", "개"], ["ledger", "장부 줄", "개"], ["files", FILES_NAME, "장"],
]);
// 건너뛴 줄의 대상(응답 skipped[].table)
const SKIP_SUBJECTS = Object.freeze({
  customers: ["손님", "명"], deals: ["거래", "건"], parties: ["참여자", "줄"], events: ["일정", "개"], notes: ["메모", "개"], tasks: ["할 일", "개"], ledger: ["장부 줄", "개"], files: [FILES_NAME, "장"],
  noteCustomer: ["메모", "개"], noteDeal: ["메모", "개"], ledgerDeal: ["장부 줄", "개"],
  // 서버가 표 이름 그대로 보내도 같은 말로(2026-11-22 대장 안내와 worker/work-trash.mjs VIEW_KEY가 달라 둘 다 받음)
  deal_parties: ["참여자", "줄"], deal_events: ["일정", "개"], ledger_entries: ["장부 줄", "개"],
});
const AGAIN = "되살린 뒤 이 묶음에서 다시 '되살리기'를 누르세요.";
/** 건너뛴 까닭 한 줄(대상은 굵게 따로) @param {{ table: string, reason: string }} skip */
function skipReasonText({ table, reason }) {
  if (reason === "exists") return "같은 자료가 이미 있어 그대로 두었습니다.";
  if (reason === "relinked") return table === "noteDeal"
    ? "지운 뒤 다른 거래에 이미 붙여 두어서 그대로 두었습니다."
    : "지운 뒤 다른 손님에게 이미 붙여 두어서 그대로 두었습니다.";
  if (reason === "changed") return "지운 뒤 고쳐져서 거래에 다시 잇지 않았습니다. 매출장부에서 직접 이어 주세요.";
  if (reason === "deal_missing") return `함께였던 거래가 지금 없어(휴지통에 있을 수 있음) 남겨 두었습니다. 그 거래를 ${AGAIN}`;
  if (reason === "customer_missing") return `함께였던 손님이 지금 없어(휴지통에 있을 수 있음) 남겨 두었습니다. 그 손님을 ${AGAIN}`;
  if (reason === "note_missing") return `그 메모가 지금 없어(휴지통에 있을 수 있음) 연결을 남겨 두었습니다. 그 메모를 ${AGAIN}`;
  if (reason === "entry_missing") return `그 장부 줄이 지금 없어(휴지통에 있을 수 있음) 연결을 남겨 두었습니다. 그 장부 줄을 ${AGAIN}`;
  return "되살리지 않고 그대로 두었습니다.";
}

/**
 * 되살리기 응답 → 알림 글. lead(첫 문장), lines(건너뛴 까닭·연결 없이 되살린 메모, 대상은 굵게), state(일부면 warn).
 * @param {string} label 묶음 이름
 * @param {{ restored?: Record<string, number>, skipped?: { table: string, reason: string, count: number }[], remaining?: number }} result
 * @param {string} [kind] 묶음 종류. file이면 묶음 이름으로 "사진"·"계약서 사본"을 가려 쓴다
 */
export function restoreResultText(label, result, kind = "") {
  const restored = result?.restored ?? {};
  const item = { kind, label };
  const back = RESTORED_UNITS.filter(([key]) => (restored[key] ?? 0) > 0).map(unitFor(item)).map((unit) => countPart(unit, restored[unit[0]]));
  const links = restored.links ?? 0;
  const lines = (result?.skipped ?? []).filter((skip) => (skip?.count ?? 0) > 0).map((skip) => {
    const subject = SKIP_SUBJECTS[skip.table] ?? ["자료", "개"];
    const [name, unit] = skip.table === "files" && kind === "file" ? [fileWord(label), subject[1]] : subject;
    return { subject: `${name} ${skip.count.toLocaleString("ko-KR")}${unit}`, text: skipReasonText(skip) };
  });
  const unlinked = restored.notesUnlinked ?? 0;
  if (unlinked > 0) lines.push({ subject: `메모 ${unlinked.toLocaleString("ko-KR")}개`, text: "이을 손님·거래가 지금 없어 그 연결만 비우고 되살렸습니다." });
  const name = `'${label}'`;
  let lead;
  if (back.length === 0) lead = lines.length > 0 ? `${name}에서 되살린 것이 없습니다. 아래 까닭을 보세요.` : `${name}에서 되살린 것이 없습니다.`;
  else {
    const what = `${back.join(", ")}${hasBatchim(back.at(-1)) ? "이" : "가"}`;
    const linked = links > 0 ? `${what} 돌아왔고 연결 ${links.toLocaleString("ko-KR")}개도 원래대로 이었습니다.` : `${what} 돌아왔습니다.`;
    lead = `✓ ${name}을(를) 되살렸습니다. ${linked}${lines.length > 0 ? " 다만 아래는 그대로 두었습니다." : ""}`;
  }
  return { lead, lines, state: lines.length > 0 || back.length === 0 ? "warn" : "success", remaining: (result?.remaining ?? 0) > 0 };
}

// 되살린 뒤 알림의 고리(묶음 id만 있고 손님 id는 없으므로 손님 카드 대신 그 종류의 목록 화면). 메모는 손님 카드나 메모 창고 어느 쪽으로 갔는지 몰라 고리를 두지 않는다.
const RESTORED_LINKS = Object.freeze({
  customer: ["손님 목록 열기", "/admin/work/customers/"],
  deal: ["손님 목록 열기", "/admin/work/customers/"],
  event: ["손님 목록 열기", "/admin/work/customers/"],
  ledger: ["매출장부 열기", "/admin/work/ledger/"],
  task: ["할 일 열기", "/admin/work/tasks/"],
  // 사진·계약서 사본은 손님 카드에 있지만 되살리기 응답에 손님 id가 없어 손님 목록으로(지시서 4.1, 대장 판단)
  file: ["손님 목록 열기", "/admin/work/customers/"],
});
// 거래 없는 일정(달력에서 넣은 일정)도 종류는 '일정'(event)이고 events에 함께 센다. 응답의 counts.appointments가 1 이상이면 달력으로 간다(날개-2 서버 응답).
const APPOINTMENT_RESTORED_LINK = Object.freeze(["달력 열기", "/admin/work/calendar/"]);
/** @param {string} kind @param {TrashCountsView} [counts] @returns {{ text: string, href: string } | null} */
export function restoredLink(kind, counts) {
  const link = kind === "event" && (counts?.appointments ?? 0) > 0 ? APPOINTMENT_RESTORED_LINK : RESTORED_LINKS[kind];
  return link ? { text: link[0], href: link[1] } : null;
}

/** 영구 삭제 끝 알림 @param {string} label */
export const purgeResultText = (label) => `✓ '${label}' 묶음을 영구 삭제했습니다. 되살릴 수 없습니다. ${TRASH_BACKUP_NOTICE}`;
/** 영구 삭제 칸 제목 @param {string} label */
export const purgeAskTitle = (label) => `'${label}' 묶음을 영구 삭제할까요?`;
/** 영구 삭제 칸 본문 @param {{ counts: TrashCountsView }} item */
export function purgeAskText(item) {
  const what = trashPurgeWhatText(item);
  return `${what ? `${what} — ` : ""}모두 지금 바로 지워지고 되살릴 수 없습니다. 손님이 바로 지워 달라고 했을 때 씁니다.`;
}
/** 넣은 글자가 '영구 삭제'와 같은지(앞뒤 빈칸만 무시) @param {string} value */
export const isPurgeWord = (value) => String(value ?? "").trim() === TRASH_PURGE_WORD;

/** 휴지통 화면 상태(꺼짐·구조 옛날) 글 @param {"WORK_DISABLED" | "WORK_SCHEMA_OUTDATED"} code */
export function trashStateText(code) {
  if (code === "WORK_DISABLED") {
    return { title: "업무 도구가 켜지지 않았습니다", body: "휴지통은 운영자가 업무 자료 저장을 켜야 볼 수 있습니다. 꺼져 있는 동안에도 7일이 지난 묶음은 새벽에 저절로 영구 삭제됩니다." };
  }
  return { title: "자료 구조 갱신 전입니다", body: `업무 자료 구조(${TRASH_SCHEMA_VERSION}번)가 아직 적용되지 않았습니다. 배포 담당에게 '휴지통 구조 적용'을 확인해 달라고 알려 주세요.` };
}

/** 휴지통 전용 오류 글(나머지는 손님 화면 문장 fallback) @param {string | null} code @param {string} fallback @param {"restore" | "purge"} [action] */
export function trashErrorText(code, fallback, action = "restore") {
  /** @type {Record<string, string>} */
  const texts = {
    NOT_FOUND: "이미 되살렸거나 영구 삭제된 묶음입니다(다른 관리자 화면에서 먼저 했을 수 있습니다). 목록을 새로 불러왔습니다.",
    TRASH_SCHEMA_CHANGED: "자료 구조가 바뀌기 전에 지운 묶음이라 되살릴 수 없습니다. 영구 삭제만 할 수 있습니다. 목록을 새로 불러왔습니다.",
    CONFIRMATION_MISMATCH: `'${TRASH_PURGE_WORD}'를 띄어쓰기까지 똑같이 넣어 주세요.`,
  };
  const text = (code && texts[code]) || fallback;
  return `${action === "purge" ? "영구 삭제하지 못했습니다." : "되살리지 못했습니다."} ${text}`;
}
/** 목록을 다시 읽어야 하는 오류(다른 화면이 먼저 되살렸거나 지움·구조 바뀜) @param {string | null} code */
export const isTrashStale = (code) => code === "NOT_FOUND" || code === "TRASH_SCHEMA_CHANGED";

/** 목록 요청 값: 커서·개수만(종류 거르기는 화면에서, 묶음 이름은 넣지 않음) @param {{ cursor?: string | null }} [options] */
export function trashListQuery({ cursor = null } = {}) {
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  query.set("limit", String(TRASH_PAGE_SIZE));
  return query;
}

/** 지운 뒤 알림 "✓ 메모를 휴지통으로 옮겼습니다." @param {string} what 메모·장부 줄·할 일 */
export const movedToTrashText = (what) => `✓ ${what}${hasBatchim(what) ? "을" : "를"} 휴지통으로 옮겼습니다.`;
/** 지운 뒤 알림의 '되살리기' 결과 @param {string} what */
export const undoneText = (what) => `✓ ${what}${hasBatchim(what) ? "을" : "를"} 되살렸습니다.`;
