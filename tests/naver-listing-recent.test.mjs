import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NAVER_LISTING_RECENT_DAYS,
  countRecentNaverListings,
  naverListingBoardLineParts,
  recentNaverListingStartDate,
} from "../src/lib/naver-listing-recent.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("최근 등록 기간은 확인일 당일을 넣어 7일이다", () => {
  assert.equal(NAVER_LISTING_RECENT_DAYS, 7);
  assert.equal(recentNaverListingStartDate("2026-11-25"), "2026-11-19");
  // 달·해가 바뀌는 자리와 윤년
  assert.equal(recentNaverListingStartDate("2026-12-03"), "2026-11-27");
  assert.equal(recentNaverListingStartDate("2027-01-02"), "2026-12-27");
  assert.equal(recentNaverListingStartDate("2028-03-02"), "2028-02-25");
  assert.equal(recentNaverListingStartDate("2026-11-25", 1), "2026-11-25");
});

test("확인일이 날짜 꼴이 아니면 기간을 만들지 않고 0건으로 센다", () => {
  for (const bad of [null, undefined, "", "2026-11", "2026-02-30", "2026-13-01", "20261125", "2026-11-25T00:10:00+09:00", 20261125]) {
    assert.equal(recentNaverListingStartDate(bad), null, String(bad));
    assert.equal(countRecentNaverListings([{ registeredAt: "2026-11-25" }], bad), 0, String(bad));
  }
  assert.equal(recentNaverListingStartDate("2026-11-25", 0), null);
  assert.equal(recentNaverListingStartDate("2026-11-25", 1.5), null);
});

test("확인일 기준 7일 안에 등록된 매물만 센다(빌드한 날과 상관없음)", () => {
  const items = [
    { registeredAt: "2026-11-25" }, // 확인일 당일
    { registeredAt: "2026-11-23" },
    { registeredAt: "2026-11-19" }, // 기간 첫날
    { registeredAt: "2026-11-18" }, // 하루 차이로 밖
    { registeredAt: "2026-08-25" },
  ];
  assert.equal(countRecentNaverListings(items, "2026-11-25"), 3);
  // 같은 자료는 언제 세어도 같은 값이다(오늘 날짜를 읽지 않는다).
  assert.equal(countRecentNaverListings(items, "2026-11-25"), countRecentNaverListings(items, "2026-11-25"));
  // 확인일이 하루 늦으면 기간도 하루 밀린다.
  assert.equal(countRecentNaverListings(items, "2026-11-26"), 2);
  assert.equal(countRecentNaverListings(items, "2026-11-25", 8), 4);
});

test("등록일이 잘못됐거나 확인일보다 늦은 항목은 세지 않는다", () => {
  const items = [
    { registeredAt: "2026-11-26" }, // 확인일보다 늦음(콘텐츠 검사가 막는 값)
    { registeredAt: "" },
    { registeredAt: null },
    { registeredAt: "2026-11-31" },
    { registeredAt: "11.23" },
    { registeredAt: "2026-11-2" }, // 글자 순서로는 기간 안에 들지만 날짜 꼴이 아님
    { registeredAt: "2026-11-20T09:00:00" },
    {},
    null,
    { registeredAt: "2026-11-24" },
  ];
  assert.equal(countRecentNaverListings(items, "2026-11-25"), 1);
  assert.equal(countRecentNaverListings([], "2026-11-25"), 0);
  assert.equal(countRecentNaverListings(null, "2026-11-25"), 0);
});

test("제목 아래 줄은 매물 수 · 최근 7일 등록 · 확인 날짜 순서이고 상대 표현을 쓰지 않는다", () => {
  const parts = naverListingBoardLineParts({ total: 79, recentCount: 25, checkedAt: "2026-11-25" });
  assert.deepEqual(parts, ["네이버 공개 매물 79건", "최근 7일 등록 25건", "11월 25일 확인"]);
  assert.doesNotMatch(parts.join(" · "), /오늘|어제|이번 주|방금|실시간/u);
  // 등록일은 광고 등록기간 시작일(다시 등록 포함)이라 새로 나왔다는 뜻의 말을 쓰지 않는다.
  assert.doesNotMatch(parts.join(" · "), /새 |새로|신규/u);
  assert.deepEqual(
    naverListingBoardLineParts({ total: 5, recentCount: 1, checkedAt: "2026-01-02" }),
    ["네이버 공개 매물 5건", "최근 7일 등록 1건", "1월 2일 확인"],
  );
});

test("최근 등록이 0건이면 그 조각을 빼고 매물 수와 확인 날짜만 남긴다", () => {
  assert.deepEqual(
    naverListingBoardLineParts({ total: 45, recentCount: 0, checkedAt: "2026-11-17" }),
    ["네이버 공개 매물 45건", "11월 17일 확인"],
  );
  assert.deepEqual(
    naverListingBoardLineParts({ total: 0, recentCount: 0, checkedAt: "2026-11-17" }),
    ["네이버 공개 매물 0건", "11월 17일 확인"],
  );
  for (const bad of [-1, 1.5, Number.NaN, "3", null, undefined]) {
    assert.equal(naverListingBoardLineParts({ total: 45, recentCount: bad, checkedAt: "2026-11-17" }).length, 2, String(bad));
  }
});

test("지금 공개 매물 자료로 센 값이 줄에 그대로 들어간다", () => {
  const data = JSON.parse(read("src/data/naver-listings.json"));
  const startDate = recentNaverListingStartDate(data.checkedAt);
  assert.match(startDate, /^\d{4}-\d{2}-\d{2}$/u);
  const expected = data.items.filter((item) => item.registeredAt >= startDate && item.registeredAt <= data.checkedAt).length;
  const recentCount = countRecentNaverListings(data.items, data.checkedAt);
  assert.equal(recentCount, expected);
  const parts = naverListingBoardLineParts({ total: data.items.length, recentCount, checkedAt: data.checkedAt });
  assert.equal(parts.length, recentCount > 0 ? 3 : 2);
  assert.equal(parts[0], `네이버 공개 매물 ${data.items.length}건`);
});

test("홈 첫 화면은 이 함수로 줄을 만들고 빌드한 날을 읽지 않는다", () => {
  const hero = read("src/components/HomeWindowHero.astro");
  const frontmatter = hero.split("---")[1];
  assert.match(frontmatter, /countRecentNaverListings\(naverListings, naverListingsUpdatedAt\)/u);
  assert.match(frontmatter, /naverListingBoardLineParts\(/u);
  assert.doesNotMatch(frontmatter, /new Date\(|Date\.now\(/u);
  assert.match(hero, /class="hw__board-line"/u);
  // 조각은 통째로 다음 줄로 넘어가게 inline-block(360px에서 낱말 중간에 꺾이지 않게, 넓어지면 칸 안에서 접힘)
  assert.match(hero, /\.hw__board-line span \{\s*display: inline-block;/u);
});
