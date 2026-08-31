import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildListingReviewQueue,
  reconcileListingReviewState,
  updateListingReviewStateForAdmin,
  validateListingReviewPolicy,
  validateListingReviewState,
} from "../src/lib/listing-review.mjs";

const listing = (id) => ({ id, title: `매물 ${id}`, propertyType: "아파트" });

test("경고 일수가 승인되지 않은 null 정책은 정상이며 재확인·자동 종료를 만들지 않는다", () => {
  const policy = { schemaVersion: 1, bankWarningDays: null, manualWarningDays: null };
  const state = {
    schemaVersion: 1,
    updatedAt: "2026-08-31",
    items: {
      "1": { source: "bank", lastSeenAt: "2026-01-01", lastReviewedAt: null },
      "2": { source: "manual", lastSeenAt: null, lastReviewedAt: null },
    },
  };
  const queue = buildListingReviewQueue([listing("1"), listing("2")], state, policy, "2026-08-31");
  assert.equal(queue.enabled, false);
  assert.equal(queue.needsReview, 0);
  assert.equal(queue.items.every((item) => item.needsReview === false), true);
  assert.deepEqual(queue.items.map(({ id }) => id), ["1", "2"]);
});

test("승인된 정책이 있을 때만 출처별 기준일로 재확인 필요를 계산한다", () => {
  const policy = { schemaVersion: 1, bankWarningDays: 7, manualWarningDays: 30 };
  const state = {
    schemaVersion: 1,
    updatedAt: "2026-08-31",
    items: {
      "1": { source: "bank", lastSeenAt: "2026-08-24", lastReviewedAt: null },
      "2": { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-08-02" },
      "3": { source: "manual", lastSeenAt: null, lastReviewedAt: null },
    },
  };
  const queue = buildListingReviewQueue([listing("1"), listing("2"), listing("3")], state, policy, "2026-08-31");
  assert.equal(queue.enabled, true);
  assert.deepEqual(queue.items.map(({ id, needsReview }) => [id, needsReview]), [
    ["1", true],
    ["2", false],
    ["3", true],
  ]);
});

test("Bank 정상 동기화는 현재 ID만 lastSeenAt을 갱신하고 직접 확인일을 보존한다", () => {
  const listings = [listing("1"), listing("2"), listing("3")];
  const currentState = {
    schemaVersion: 1,
    updatedAt: "2026-08-30",
    items: {
      "1": { source: "bank", lastSeenAt: "2026-08-30", lastReviewedAt: null },
      "2": { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-08-20" },
      "9": { source: "manual", lastSeenAt: null, lastReviewedAt: null },
    },
  };
  const next = reconcileListingReviewState({
    listings,
    bankState: { items: [{ naverId: "1" }, { naverId: "3" }] },
    currentState,
    checkedAt: "2026-08-31",
  });
  assert.deepEqual(next.items, {
    "1": { source: "bank", lastSeenAt: "2026-08-31", lastReviewedAt: null },
    "2": { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-08-20" },
    "3": { source: "bank", lastSeenAt: "2026-08-31", lastReviewedAt: null },
  });
  assert.equal(listings.length, 3);
});

test("관리자 저장은 목록과 재확인 상태를 한 스냅샷으로 맞추고 선택한 직접 매물만 확인일을 갱신한다", () => {
  const currentState = {
    schemaVersion: 1,
    updatedAt: "2026-08-30",
    items: {
      "1": { source: "bank", lastSeenAt: "2026-08-30", lastReviewedAt: null },
      "2": { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-08-20" },
      "9": { source: "manual", lastSeenAt: null, lastReviewedAt: null },
    },
  };
  const next = updateListingReviewStateForAdmin({
    listings: [listing("1"), listing("2"), listing("3")],
    currentState,
    updatedAt: "2026-08-31",
    reviewedManualIds: ["2", "3"],
  });
  assert.deepEqual(next, {
    schemaVersion: 1,
    updatedAt: "2026-08-31",
    items: {
      "1": { source: "bank", lastSeenAt: "2026-08-30", lastReviewedAt: null },
      "2": { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-08-31" },
      "3": { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-08-31" },
    },
  });
  const imported = updateListingReviewStateForAdmin({
    listings: [listing("1"), listing("2"), listing("4")],
    currentState,
    updatedAt: "2026-08-31",
    bankIds: ["1", "4"],
  });
  assert.deepEqual(imported.items["4"], { source: "bank", lastSeenAt: "2026-08-31", lastReviewedAt: null });
  assert.deepEqual(imported.items["2"], currentState.items["2"]);
  assert.equal(Object.hasOwn(imported.items, "9"), false);
});

test("재확인 상태는 고정 필드·날짜·Naver ID·출처 관계를 fail closed 검증한다", () => {
  assert.throws(() => validateListingReviewPolicy({ schemaVersion: 1, bankWarningDays: 0, manualWarningDays: null }), /1일부터/u);
  assert.throws(() => validateListingReviewState({
    schemaVersion: 1,
    updatedAt: "2026-08-31",
    items: {
      "1": { source: "manual", lastSeenAt: null, lastReviewedAt: null, privateNote: "금지" },
    },
  }), /형식/u);
  assert.throws(() => validateListingReviewState({
    schemaVersion: 1,
    updatedAt: "2026-08-31",
    items: {
      "1": { source: "bank", lastSeenAt: "2026-09-01", lastReviewedAt: null },
    },
  }), /갱신일보다 늦/u);
});

test("저장소의 재확인 상태는 현재 공개 목록과 Bank ID를 정확히 분류한다", async () => {
  const [rawListings, rawBankState, rawReviewState, rawPolicy] = await Promise.all([
    readFile(new URL("../src/data/naver-listings.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/bank-listing-sync-state.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/listing-review-state.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/listing-review-policy.json", import.meta.url), "utf8"),
  ]);
  const listings = JSON.parse(rawListings);
  const bankState = JSON.parse(rawBankState);
  const reviewState = JSON.parse(rawReviewState);
  const policy = JSON.parse(rawPolicy);
  const listingIds = new Set(listings.items.map(({ id }) => id));
  const bankIds = new Set(bankState.items.map(({ naverId }) => naverId));
  validateListingReviewPolicy(policy);
  validateListingReviewState(reviewState, { listingIds, bankIds });
  assert.equal(reviewState.updatedAt, listings.checkedAt);
  assert.deepEqual(policy, { schemaVersion: 1, bankWarningDays: null, manualWarningDays: null });
});
