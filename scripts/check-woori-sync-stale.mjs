// 우리집부동산 매물 자동 받기(사무소 PC 작업 스케줄러, 매일 09:20, scripts/run-woori-sync-local.mjs)가 오늘 master에 올라왔는지 본다(2026-11-25).
// PC가 꺼져 있거나 작업이 아예 돌지 않으면 PC 쪽 실패 이슈가 열리지 않으므로 .github/workflows/woori-sync-stall-alert.yml(매일 13:00 한국 시각)이 이 판정으로 이슈를 연다.
// 받은 날은 .github/listing-review-state.json의 우리집부동산 매물(source "woori") lastSeenAt 최댓값이다(받기마다 그날로 바뀜).
// 우리집부동산을 부르지 않고, 저장소의 그 파일 하나만 읽는다(워크플로는 이 파일과 상태 파일만 받음). 다른 모듈을 가져오지 않는다.
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** 달력에 있는 'YYYY-MM-DD'인지 @param {unknown} value */
export function isIsoDate(value) {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** 한국 날짜 'YYYY-MM-DD' @param {Date} now */
export function seoulDate(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * status: "ok"(오늘 받음) · "stale"(오늘 받은 기록 없음 → 이슈) · "empty"(우리집부동산 매물 0건이라 받은 날을 모름 → 로그만).
 * 우리집부동산 매물은 있는데 날짜가 모두 잘못됐으면 받은 날을 모르는 채 "stale"(lastSeenOn null)로 본다(상태 파일이 깨진 것도 알릴 일).
 * 받은 날이 오늘보다 뒤면(시계 차이) 멈춤이 아니므로 "ok"다.
 * @param {{ items?: Record<string, { source?: string, lastSeenAt?: string | null }> } | null | undefined} reviewState
 * @param {string} today 한국 날짜 'YYYY-MM-DD'
 * @returns {{ status: "ok" | "stale" | "empty", lastSeenOn: string | null }}
 */
export function wooriSyncStallState(reviewState, today) {
  if (!isIsoDate(today)) throw new Error("오늘 날짜가 올바르지 않습니다.");
  const woori = Object.values(reviewState?.items ?? {}).filter((item) => item?.source === "woori");
  if (woori.length === 0) return { status: "empty", lastSeenOn: null };
  const lastSeenOn = woori.map((item) => item.lastSeenAt).filter(isIsoDate).sort().at(-1) ?? null;
  return { status: lastSeenOn !== null && lastSeenOn >= today ? "ok" : "stale", lastSeenOn };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--state") options.statePath = argv[++index];
    else throw new Error(`모르는 인자입니다: ${argv[index]}`);
  }
  if (!options.statePath) throw new Error("사용법: node scripts/check-woori-sync-stale.mjs --state .github/listing-review-state.json");
  return options;
}

function main() {
  const { statePath } = parseArguments(process.argv.slice(2));
  const today = seoulDate(new Date());
  const { status, lastSeenOn } = wooriSyncStallState(JSON.parse(readFileSync(statePath, "utf8")), today);
  const lines = [`status=${status}`, `last_seen=${lastSeenOn ?? ""}`];
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, "utf8");
  if (status === "empty") console.log(`::notice::우리집부동산 매물이 0건이라 받은 날을 알 수 없어 이슈를 열지 않습니다(오늘 ${today}).`);
  else console.log(`우리집부동산 마지막으로 받은 날 ${lastSeenOn ?? "확인 못 함"}, 오늘 ${today}: ${status === "ok" ? "정상" : "오늘 받은 기록 없음"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
