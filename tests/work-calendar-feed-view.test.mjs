// '계약 일정' 화면 휴대폰 캘린더 구독 칸(단계 3 C-b)의 순수 함수 시험. 주소는 가상 값이다.
import test from "node:test";
import assert from "node:assert/strict";
import { currentFeed, feedErrorText, feedQrHowText, feedUsedText, googleCalendarUrl, webcalUrl } from "../src/lib/work/calendar-feed-view.mjs";

const URL_A = "https://leaderscityhappy.com/api/calendar/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.ics";

test("iPhone 넣기는 webcal:// 주소, Google 넣기는 webcal 주소를 cid로 담은 Google 캘린더 사이트 주소", () => {
  assert.equal(webcalUrl(URL_A), "webcal://leaderscityhappy.com/api/calendar/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.ics");
  const google = new URL(googleCalendarUrl(URL_A));
  assert.equal(google.origin, "https://calendar.google.com");
  assert.equal(google.pathname, "/calendar/r");
  assert.equal(google.searchParams.get("cid"), webcalUrl(URL_A));
  assert.deepEqual([...google.searchParams.keys()], ["cid"]);
});

test("살아 있는 주소가 여럿이면 가장 새것 하나, 없으면 null. 받아 간 적 없으면 그렇게 쓴다", () => {
  assert.equal(currentFeed([]), null);
  assert.equal(currentFeed(null), null);
  assert.equal(currentFeed([{ id: "a", createdAt: "2026-11-20T00:00:00.000Z" }, { id: "b", createdAt: "2026-11-22T00:00:00.000Z" }]).id, "b");
  assert.equal(feedUsedText(null), "아직 받아 가지 않음");
  assert.equal(feedUsedText("2026-11-22T15:30:00.000Z"), "11월 23일(월)", "한국 날짜");
});

test("해시 키 없음(503 WORK_CONFIG_MISSING)은 구독 설정 누락으로 알리고, 그 밖은 손님 화면 문장을 쓴다", () => {
  assert.match(feedErrorText("WORK_CONFIG_MISSING"), /구독 주소 설정 누락/u);
  assert.match(feedErrorText("CSRF_INVALID"), /보안 확인이 만료/u);
  assert.match(feedErrorText(null), /요청을 처리하지 못했습니다/u);
});

test("QR 안내 한 줄: iPhone용·Android용이 다르고, 어느 쪽도 주소나 '반드시 된다'는 말을 담지 않는다", () => {
  assert.equal(feedQrHowText("ios"), "iPhone 카메라로 이 QR을 비추고, 화면에 뜨는 안내를 눌러 구독을 더하세요.");
  assert.match(feedQrHowText("google"), /^Android 휴대폰 카메라로 이 QR을 비추면 브라우저에서 Google 캘린더 사이트가 열립니다\./u);
  for (const kind of ["ios", "google"]) assert.doesNotMatch(feedQrHowText(kind), /https?:|webcal:|반드시|자동으로/u);
});
