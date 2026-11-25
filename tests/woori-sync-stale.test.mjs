import assert from "node:assert/strict";
import test from "node:test";

import { isIsoDate, seoulDate, wooriSyncStallState } from "../scripts/check-woori-sync-stale.mjs";

const state = (items) => ({ schemaVersion: 1, updatedAt: "2026-11-25", items });

test("우리집부동산 매물을 오늘 받았으면 정상이고, 부동산뱅크·직접 등록 날짜는 보지 않는다", () => {
  assert.deepEqual(wooriSyncStallState(state({
    w1: { source: "woori", lastSeenAt: "2026-11-24", lastReviewedAt: null },
    w2: { source: "woori", lastSeenAt: "2026-11-25", lastReviewedAt: null },
    b1: { source: "bank", lastSeenAt: "2026-11-25", lastReviewedAt: null },
  }), "2026-11-25"), { status: "ok", lastSeenOn: "2026-11-25" });
});

test("마지막으로 받은 날이 어제면 멈춤으로 보고 그 날을 돌려준다(부동산뱅크가 오늘이어도)", () => {
  assert.deepEqual(wooriSyncStallState(state({
    w1: { source: "woori", lastSeenAt: "2026-11-24", lastReviewedAt: null },
    b1: { source: "bank", lastSeenAt: "2026-11-25", lastReviewedAt: null },
    m1: { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-11-25" },
  }), "2026-11-25"), { status: "stale", lastSeenOn: "2026-11-24" });
  assert.deepEqual(wooriSyncStallState(state({ w1: { source: "woori", lastSeenAt: "2026-11-21", lastReviewedAt: null } }), "2026-11-25"), { status: "stale", lastSeenOn: "2026-11-21" });
});

test("우리집부동산 매물이 0건이면 받은 날을 알 수 없어 이슈를 열지 않는다", () => {
  assert.deepEqual(wooriSyncStallState(state({ b1: { source: "bank", lastSeenAt: "2026-11-20", lastReviewedAt: null } }), "2026-11-25"), { status: "empty", lastSeenOn: null });
  assert.deepEqual(wooriSyncStallState(state({}), "2026-11-25"), { status: "empty", lastSeenOn: null });
  assert.deepEqual(wooriSyncStallState({}, "2026-11-25"), { status: "empty", lastSeenOn: null });
  assert.deepEqual(wooriSyncStallState(null, "2026-11-25"), { status: "empty", lastSeenOn: null });
});

test("잘못된 날짜는 받은 날로 치지 않고, 우리집부동산 매물이 있는데 날짜를 하나도 못 읽으면 멈춤(받은 날 모름)이다", () => {
  assert.deepEqual(wooriSyncStallState(state({
    w1: { source: "woori", lastSeenAt: "2026-11-24", lastReviewedAt: null },
    w2: { source: "woori", lastSeenAt: "2026-13-40", lastReviewedAt: null },
    w3: { source: "woori", lastSeenAt: "9999-99-99", lastReviewedAt: null },
  }), "2026-11-25"), { status: "stale", lastSeenOn: "2026-11-24" });
  assert.deepEqual(wooriSyncStallState(state({
    w1: { source: "woori", lastSeenAt: "어제", lastReviewedAt: null },
    w2: { source: "woori", lastSeenAt: null, lastReviewedAt: null },
    w3: { source: "woori", lastSeenAt: "2026-02-30", lastReviewedAt: null },
  }), "2026-11-25"), { status: "stale", lastSeenOn: null });
  // 오늘 날짜가 잘못되면 판정하지 않고 실패한다(Action이 빨갛게 끝남).
  assert.throws(() => wooriSyncStallState(state({}), "2026-11-31"), /오늘 날짜/u);
  assert.throws(() => wooriSyncStallState(state({}), ""), /오늘 날짜/u);
});

test("받은 날이 오늘보다 뒤면(시계 차이) 멈춤이 아니다", () => {
  assert.deepEqual(wooriSyncStallState(state({ w1: { source: "woori", lastSeenAt: "2026-11-26", lastReviewedAt: null } }), "2026-11-25"), { status: "ok", lastSeenOn: "2026-11-26" });
});

test("오늘은 한국 날짜로 잰다(UTC 04:00 예약 = 한국 13:00)", () => {
  assert.equal(seoulDate(new Date("2026-11-25T04:00:00Z")), "2026-11-25");
  assert.equal(seoulDate(new Date("2026-11-24T15:00:00Z")), "2026-11-25");
  assert.equal(seoulDate(new Date("2026-11-24T14:59:59Z")), "2026-11-24");
  assert.equal(isIsoDate("2026-11-25"), true);
  assert.equal(isIsoDate("2026-11-25T00:00"), false);
});
