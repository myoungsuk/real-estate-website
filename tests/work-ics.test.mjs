import assert from "node:assert/strict";
import test from "node:test";
import {
  ICS_ALARM_OPTIONS,
  buildIcsCalendar,
  createIcsUid,
  escapeIcsText,
  foldIcsLine,
  icsFileName,
  validateAlarmKeys,
} from "../src/lib/work/ics.mjs";

const NOW = new Date("2026-11-16T01:30:00Z");
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const build = (events, extra = {}) => buildIcsCalendar({ events, contractDate: "2026-11-16", now: NOW, ...extra });
const unfold = (text) => text.replace(/\r\n /gu, "");

test("T0-91 모든 줄이 CRLF로 끝난다", async () => {
  const text = await build([{ kind: "transactionReport", date: "2026-12-15", title: "거래신고 기한(가상단지 101동)", description: "법정 기한: 계약일부터 30일 이내" }]);
  assert.ok(text.endsWith("\r\n"));
  assert.equal(text.replace(/\r\n/gu, "").includes("\n"), false);
  assert.equal(text.replace(/\r\n/gu, "").includes("\r"), false);
  assert.match(text, /^BEGIN:VCALENDAR\r\nVERSION:2\.0\r\nPRODID:-\/\/leaderscityhappy\/\/work-tools\/\/KO\r\n/u);
});

test("T0-92 한글 40자 제목을 75옥텟 안에서 UTF-8 경계로 접는다", async () => {
  const title = "가나다라마바사아자차".repeat(4);
  assert.equal([...title].length, 40);
  assert.equal(encoder.encode(title).length, 120);
  const text = await build([{ kind: "contract", date: "2026-11-16", title }]);
  const lines = text.split("\r\n").filter(Boolean);
  for (const line of lines) {
    const bytes = encoder.encode(line);
    assert.ok(bytes.length <= 75, `${bytes.length}옥텟: ${line}`);
    assert.doesNotThrow(() => decoder.decode(bytes));
  }
  assert.ok(lines.some((line) => line.startsWith(" ")), "접힌 줄이 있어야 한다");
  assert.ok(unfold(text).includes(`SUMMARY:${title}\r\n`));

  const folded = foldIcsLine(`SUMMARY:${"한".repeat(30)}`);
  for (const part of folded.split("\r\n")) assert.ok(encoder.encode(part).length <= 75);
  assert.equal(folded.replace(/\r\n /gu, ""), `SUMMARY:${"한".repeat(30)}`);
});

test("T0-92 이어지는 줄은 앞 공백을 포함해 정확히 75옥텟까지 채운다", async () => {
  const line = `SUMMARY:${"a".repeat(200)}`;
  const parts = foldIcsLine(line).split("\r\n");
  assert.equal(parts[0].length, 75, "첫 줄은 75옥텟");
  for (const part of parts.slice(1, -1)) {
    assert.ok(part.startsWith(" "), "이어지는 줄은 공백 1칸으로 시작");
    assert.equal(encoder.encode(part).length, 75, "이어지는 줄도 공백 포함 75옥텟");
  }
  assert.ok(encoder.encode(parts.at(-1)).length <= 75);
  assert.equal(parts.map((part, index) => (index === 0 ? part : part.slice(1))).join(""), line);

  const description = "b".repeat(400);
  const text = await build([{ kind: "contract", date: "2026-11-16", title: "계약일", description }]);
  const descriptionLines = text.split("\r\n");
  const start = descriptionLines.findIndex((item) => item.startsWith("DESCRIPTION:"));
  assert.equal(encoder.encode(descriptionLines[start]).length, 75);
  assert.equal(encoder.encode(descriptionLines[start + 1]).length, 75);
  assert.ok(descriptionLines[start + 1].startsWith(" "));

  const mixed = foldIcsLine(`SUMMARY:${"a".repeat(66)}한글`);
  const [first, second] = mixed.split("\r\n");
  assert.equal(encoder.encode(first).length, 74, "3바이트 글자가 75옥텟을 넘기면 그 앞에서 접는다");
  assert.equal(second, " 한글");
});

test("T0-93 TEXT 값의 쉼표·세미콜론·역슬래시·줄바꿈을 이스케이프한다", async () => {
  assert.equal(escapeIcsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const text = await build([{ kind: "contract", date: "2026-11-16", title: "계약,확인;메모\\끝", description: "첫 줄\n둘째 줄" }]);
  const unfolded = unfold(text);
  assert.ok(unfolded.includes("SUMMARY:계약\\,확인\\;메모\\\\끝\r\n"));
  assert.ok(unfolded.includes("DESCRIPTION:첫 줄\\n둘째 줄\r\n"));
  const titleWithBreak = unfold(await build([{ kind: "contract", date: "2026-11-16", title: "계약일\n가상단지" }]));
  assert.ok(titleWithBreak.includes("SUMMARY:계약일 가상단지\r\n"), "제목은 한 줄 값이라 줄바꿈을 공백으로 바꾼다");
});

test("T0-94 하루 종일 일정은 DTEND가 다음 날이다", async () => {
  const text = await build([{ kind: "transactionReport", date: "2026-12-15", title: "거래신고 기한" }]);
  assert.match(text, /DTSTART;VALUE=DATE:20261215\r\n/u);
  assert.match(text, /DTEND;VALUE=DATE:20261216\r\n/u);
  assert.match(text, /DTSTAMP:20261116T013000Z\r\n/u);
  const yearEnd = await build([{ kind: "balance", date: "2026-12-31", title: "잔금" }]);
  assert.match(yearEnd, /DTEND;VALUE=DATE:20270101\r\n/u);
});

test("T0-95·T0-96 같은 입력이면 같은 UID, 제목이 다르면 다른 UID", async () => {
  const first = await createIcsUid({ kind: "transactionReport", contractDate: "2026-11-16", title: "거래신고 기한" });
  const second = await createIcsUid({ kind: "transactionReport", contractDate: "2026-11-16", title: "거래신고 기한" });
  const other = await createIcsUid({ kind: "transactionReport", contractDate: "2026-11-16", title: "거래신고 기한(가상단지 102동)" });
  assert.match(first, /^[0-9a-f]{32}@leaderscityhappy\.com$/u);
  assert.equal(first, second, "T0-95");
  assert.notEqual(first, other, "T0-96");
  const events = [{ kind: "contract", date: "2026-11-16", title: "계약일" }];
  const textA = await build(events);
  const textB = await build(events, { now: new Date("2026-11-17T00:00:00Z") });
  assert.equal(/UID:(.+)\r\n/u.exec(textA)[1], /UID:(.+)\r\n/u.exec(textB)[1], "T0-95 생성 시각이 달라도 UID 같음");
});

test("T0-97·T0-98 알림 시점 변환과 최대 2개 제한", async () => {
  assert.equal(ICS_ALARM_OPTIONS["day-before-18"].trigger, "-PT6H");
  assert.equal(ICS_ALARM_OPTIONS["same-day-09"].trigger, "PT9H");
  assert.equal(ICS_ALARM_OPTIONS["three-days-before-09"].trigger, "-P2DT15H");
  const text = await build([{ kind: "contract", date: "2026-11-16", title: "계약일" }], { alarmKeys: ["day-before-18", "same-day-09"] });
  assert.equal((text.match(/BEGIN:VALARM/gu) ?? []).length, 2);
  assert.match(text, /TRIGGER:-PT6H\r\n/u);
  assert.match(text, /TRIGGER:PT9H\r\n/u);
  const three = await build([{ kind: "contract", date: "2026-11-16", title: "계약일" }], { alarmKeys: ["three-days-before-09"] });
  assert.match(three, /TRIGGER:-P2DT15H\r\n/u);
  assert.throws(() => validateAlarmKeys(["day-before-18", "same-day-09", "three-days-before-09"]), /최대 2개/u, "T0-98");
  await assert.rejects(
    () => build([{ kind: "contract", date: "2026-11-16", title: "계약일" }], { alarmKeys: Object.keys(ICS_ALARM_OPTIONS) }),
    /최대 2개/u,
  );
});

test("T0-99·T0-100 파일 이름과 내용에 손님 정보가 들어가지 않는다", async () => {
  assert.equal(icsFileName("2026-11-16"), "work-schedule-20261116.ics", "T0-99");
  const text = await build([
    { kind: "transactionReport", date: "2026-12-15", title: "거래신고 기한(가상단지 101동)", description: "거래신고\n법정 기한: 계약일부터 30일 이내" },
  ]);
  const summaryAndDescription = unfold(text).split("\r\n").filter((line) => /^(SUMMARY|DESCRIPTION):/u.test(line)).join("\n");
  assert.doesNotMatch(summaryAndDescription, /01[016789]-?\d{3,4}-?\d{4}/u, "T0-100 전화번호 없음");
  assert.doesNotMatch(summaryAndDescription, /ZZTEST-7F3A|가상 손님/u, "T0-100 손님 이름 없음");
});
