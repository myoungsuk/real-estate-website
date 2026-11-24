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
  // 내용이 그대로인 날에도 재확인일은 갱신되므로 목록 갱신일과 같을 필요가 없다.
  validateListingReviewState(reviewState, { listingIds, bankIds });
  assert.deepEqual(policy, { schemaVersion: 1, bankWarningDays: null, manualWarningDays: null });
});

test("우리집부동산(woori) 표시는 부동산뱅크 받기가 지우지 않고, bank·manual은 지금처럼 다시 쓴다", () => {
  const listings = [listing("1"), listing("2"), listing("5"), listing("6")];
  const currentState = {
    schemaVersion: 1,
    updatedAt: "2026-11-24",
    items: {
      "1": { source: "bank", lastSeenAt: "2026-11-24", lastReviewedAt: null },
      "2": { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-11-20" },
      "5": { source: "woori", lastSeenAt: "2026-11-24", lastReviewedAt: null },
      "6": { source: "woori", lastSeenAt: "2026-11-24", lastReviewedAt: null },
    },
  };
  const next = reconcileListingReviewState({
    listings,
    // 6은 부동산뱅크에도 올라와 bank가 이긴다.
    bankState: { items: [{ naverId: "1" }, { naverId: "6" }] },
    currentState,
    checkedAt: "2026-11-25",
  });
  assert.deepEqual(next.items, {
    "1": { source: "bank", lastSeenAt: "2026-11-25", lastReviewedAt: null },
    "2": { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-11-20" },
    "5": { source: "woori", lastSeenAt: "2026-11-24", lastReviewedAt: null },
    "6": { source: "bank", lastSeenAt: "2026-11-25", lastReviewedAt: null },
  });
});

test("바꾼 재확인 함수는 우리집부동산 매물이 없으면 저장소의 실제 상태에서 예전 함수와 같은 결과를 낸다", async () => {
  const [rawListings, rawBankState, rawReviewState] = await Promise.all([
    readFile(new URL("../src/data/naver-listings.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/bank-listing-sync-state.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/listing-review-state.json", import.meta.url), "utf8"),
  ]);
  const listings = JSON.parse(rawListings).items;
  const listingIds = new Set(listings.map((item) => item.id));
  // 밤 받기에서는 받은 목록이 늘 공개 목록 안에 있다. 저장소 기준선에는 관리자가 내린 매물이 남아 있을 수 있어 공개 목록 안의 것만 쓴다.
  const rawBank = JSON.parse(rawBankState);
  const bankState = { ...rawBank, items: rawBank.items.filter((item) => listingIds.has(item.naverId)) };
  const reviewState = JSON.parse(rawReviewState);
  // 예전(우리집부동산 전) 함수를 그대로 옮긴 기준. 다음 날 받기에서 목록이 그대로일 때의 결과를 견준다.
  const legacy = ({ listings: nextListings, bankState: state, currentState, checkedAt }) => {
    const bankIds = new Set(state.items.map((item) => item.naverId));
    const previousItems = currentState?.items ?? {};
    return {
      schemaVersion: 1,
      updatedAt: checkedAt,
      items: Object.fromEntries([...new Set(nextListings.map((item) => item.id))].sort().map((id) => [id, bankIds.has(id)
        ? { source: "bank", lastSeenAt: checkedAt, lastReviewedAt: null }
        : {
            source: "manual",
            lastSeenAt: null,
            lastReviewedAt: previousItems[id]?.source === "manual" && /^\d{4}-\d{2}-\d{2}$/u.test(previousItems[id].lastReviewedAt ?? "")
              ? previousItems[id].lastReviewedAt
              : null,
          }])),
    };
  };
  assert.equal(Object.values(reviewState.items).some((item) => item.source === "woori"), false);
  for (const checkedAt of [reviewState.updatedAt, "2099-12-31"]) {
    const input = { listings, bankState, currentState: reviewState, checkedAt };
    assert.deepEqual(reconcileListingReviewState(input), legacy(input));
  }
});

test("관리자 저장은 wooriIds를 우리집부동산 매물로 적고, bankIds가 겹치면 bank가 이긴다", () => {
  const currentState = {
    schemaVersion: 1,
    updatedAt: "2026-11-20",
    items: {
      "1": { source: "bank", lastSeenAt: "2026-11-20", lastReviewedAt: null },
      "2": { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-11-19" },
      "5": { source: "woori", lastSeenAt: "2026-11-18", lastReviewedAt: null },
      "7": { source: "woori", lastSeenAt: "2026-11-18", lastReviewedAt: null },
    },
  };
  const next = updateListingReviewStateForAdmin({
    listings: [listing("1"), listing("2"), listing("5"), listing("8")],
    currentState,
    updatedAt: "2026-11-24",
    bankIds: ["1"],
    wooriIds: ["1", "2", "8"],
  });
  assert.deepEqual(next.items, {
    "1": { source: "bank", lastSeenAt: "2026-11-24", lastReviewedAt: null },
    "2": { source: "woori", lastSeenAt: "2026-11-24", lastReviewedAt: null },
    // 이번 파일에 없던 woori(5)는 목록에 남아 있으면 지난 확인일 그대로, 목록에서 빠진 7은 상태에서도 빠진다.
    "5": { source: "woori", lastSeenAt: "2026-11-18", lastReviewedAt: null },
    "8": { source: "woori", lastSeenAt: "2026-11-24", lastReviewedAt: null },
  });
  validateListingReviewState(next, { listingIds: ["1", "2", "5", "8"], bankIds: ["1"] });
  // 직접 등록 매물 저장(wooriIds 없음)은 woori 표시를 그대로 둔다.
  const manualSave = updateListingReviewStateForAdmin({ listings: [listing("5")], currentState, updatedAt: "2026-11-24" });
  assert.deepEqual(manualSave.items["5"], currentState.items["5"]);
});

test("우리집부동산 재확인 상태는 마지막 엑셀 날짜가 있어야 하고 직접 확인일은 둘 수 없다", () => {
  const state = (item) => ({ schemaVersion: 1, updatedAt: "2026-11-24", items: { "5": item } });
  assert.throws(() => validateListingReviewState(state({ source: "woori", lastSeenAt: null, lastReviewedAt: null })), /우리집부동산/u);
  assert.throws(() => validateListingReviewState(state({ source: "woori", lastSeenAt: "2026-11-24", lastReviewedAt: "2026-11-24" })), /우리집부동산/u);
  assert.throws(() => validateListingReviewState(state({ source: "woori", lastSeenAt: "2026-11-25", lastReviewedAt: null })), /갱신일보다 늦/u);
  assert.throws(() => validateListingReviewState(state({ source: "other", lastSeenAt: "2026-11-24", lastReviewedAt: null })), /출처/u);
  // Worker는 bank 표시에서 bankIds를 만든다: woori는 bank와 섞이지 않는다.
  assert.throws(() => validateListingReviewState(state({ source: "woori", lastSeenAt: "2026-11-24", lastReviewedAt: null }), { bankIds: ["5"] }), /일치하지/u);
  validateListingReviewState(state({ source: "woori", lastSeenAt: "2026-11-24", lastReviewedAt: null }), { listingIds: ["5"], bankIds: [] });
});

test("우리집부동산 매물은 직접 등록 경고 일수와 마지막 엑셀 날짜로 재확인을 계산한다", () => {
  const policy = { schemaVersion: 1, bankWarningDays: 7, manualWarningDays: 30 };
  const state = {
    schemaVersion: 1,
    updatedAt: "2026-11-24",
    items: {
      "5": { source: "woori", lastSeenAt: "2026-10-01", lastReviewedAt: null },
      "6": { source: "woori", lastSeenAt: "2026-11-20", lastReviewedAt: null },
    },
  };
  const queue = buildListingReviewQueue([listing("5"), listing("6")], state, policy, "2026-11-24");
  assert.deepEqual(queue.items.map(({ id, needsReview, referenceDate }) => [id, needsReview, referenceDate]), [
    ["5", true, "2026-10-01"],
    ["6", false, "2026-11-20"],
  ]);
  assert.equal(queue.woori, 2);
  assert.equal(queue.manual, 0);
});
