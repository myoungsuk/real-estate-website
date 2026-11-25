// 관리자 '블로그·유튜브·인스타그램' 화면의 블로그 전용 칸 — 글 앞부분 요약·분류(2026-11-25).
// 가짜 관리 API(e2e/support/admin-content-mock.mjs)로만 돈다. 자료는 모두 지어낸 값이다(가상숲1단지).
import { expect, test } from "@playwright/test";
import * as content from "./support/admin-content-mock.mjs";

const blogUrl = (logNo) => `https://blog.naver.com/PostView.naver?blogId=p5468300&logNo=${logNo}`;
const TEMPLATE = (title) => `리더스시티행복한부동산 공식 블로그에서 “${title}” 관련 내용을 확인해 보세요.`;
const EXCERPT = "가상숲1단지 주변을 한 바퀴 걸으며 본 것을 차례로 적었습니다. 정문에서 역까지는 걸어서 가 보았고, 단지 안 산책길과 놀이터도 둘러봤습니다.";
const FULL = { id: "naver-blog-224000000001", type: "blog", status: "published", title: "가상숲1단지 둘러보기", summary: TEMPLATE("가상숲1단지 둘러보기"), excerpt: EXCERPT, category: "부동산공부", url: blogUrl("224000000001"), publishedAt: "2026-11-24", thumbnail: null };
const CATEGORY_ONLY = { id: "naver-blog-224000000002", type: "blog", status: "published", title: "가상숲1단지 전세 안내", summary: TEMPLATE("가상숲1단지 전세 안내"), category: "아파트/분양권", url: blogUrl("224000000002"), publishedAt: "2026-11-23", thumbnail: null };
const PLAIN = { id: "naver-blog-224000000003", type: "blog", status: "published", title: "가상 임대차 신고 정리", summary: "운영자가 적은 설명", url: blogUrl("224000000003"), publishedAt: "2026-11-22", thumbnail: null };
const VIDEO = { id: "youtube-aaaaaaaaaaa", type: "youtube", youtubeFormat: "video", status: "published", title: "가상 영상", summary: "가상 영상 설명", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", publishedAt: "2026-11-21", thumbnail: null };
const ITEMS = [FULL, CATEGORY_ONLY, PLAIN, VIDEO];

async function open(page, width) {
  const calls = await content.setup(page, { width, contents: { "external-links": ITEMS } });
  // 이 화면은 한 자원만 저장한다(PUT /content/external-links, 본문 { sha, data }). 공용 가짜 API는 묶음 저장만 적으므로 여기서 받아 적는다.
  calls.saved = [];
  await page.route("**/api/admin/v1/content/external-links", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON();
    calls.saved.push(body);
    return route.fulfill(content.envelope({ resource: "external-links", commitSha: "e2".repeat(20), contentSha: "c0".repeat(20), resourceDigest: "d1".repeat(32), savedAt: content.NOW.toISOString() }));
  });
  await page.goto("/admin/external-links/");
  await expect(page.locator("[data-admin-write-gate]")).toHaveClass(/admin-inline-notice--ready/u);
  await expect(page.locator(`[data-external-edit="${FULL.id}"]`)).toBeEnabled();
  return calls;
}

async function save(page, calls) {
  await page.locator("[data-external-form] button[type=submit]").click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "검증 후 최종 저장" }).click();
  await expect(page.locator("[data-external-status-message]")).toContainText("GitHub 저장이 완료됐습니다");
  expect(calls.saved).toHaveLength(1);
  expect(calls.writes, "묶음 저장은 쓰지 않음").toHaveLength(0);
  return calls.saved[0].data;
}

const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("관리자 블로그 요약·분류 1280px: 저장된 값이 칸에 뜨고, 비운 칸은 키째 빠지며 다른 항목은 그대로다", async ({ page }) => {
  const calls = await open(page, 1280);
  const excerpt = page.getByLabel("글 앞부분 요약");
  const category = page.getByLabel("분류", { exact: true });
  const notice = page.locator("[data-external-excerpt-notice]");

  // 새 글 상태: 두 칸이 보이고 비어 있다.
  await expect(excerpt).toBeVisible();
  await expect(excerpt).toHaveValue("");
  await expect(notice).toBeHidden();

  await page.locator(`[data-external-edit="${FULL.id}"]`).click();
  await expect(excerpt).toHaveValue(EXCERPT);
  await expect(category).toHaveValue("부동산공부");
  await expect(notice).toBeHidden();

  // 금액·동 번호는 알리기만 한다.
  await excerpt.fill("가상숲1단지 103동 전용 84㎡가 3억 2,000만원에 나왔습니다.");
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("요약에 금액으로 보이는 숫자가 있습니다.");
  await expect(notice).toContainText("요약에 동 번호가 있습니다.");

  // 요약을 비우고 분류를 고친다.
  await excerpt.fill("");
  await expect(notice).toBeHidden();
  await category.fill("  세금  ");
  expect(await noOverflow(page)).toBe(true);

  const data = await save(page, calls);
  expect(data).toHaveLength(ITEMS.length);
  const saved = data.find((item) => item.id === FULL.id);
  expect("excerpt" in saved, "비운 요약은 키째 빠짐").toBe(false);
  expect(saved.category).toBe("세금");
  expect(Object.keys(saved)).toEqual(["id", "type", "status", "title", "summary", "category", "url", "publishedAt", "thumbnail"]);
  expect(saved.summary).toBe(FULL.summary);
  for (const other of [CATEGORY_ONLY, PLAIN, VIDEO]) expect(data.find((item) => item.id === other.id)).toEqual(other);
  expect(calls.validates.length).toBeGreaterThanOrEqual(1);
});

test("관리자 블로그 요약·분류 360px: 두 칸이 없던 글에 적으면 한 줄로 정리해 넣고, 화면이 가로로 넘치지 않는다", async ({ page }) => {
  const calls = await open(page, 360);
  const excerpt = page.getByLabel("글 앞부분 요약");
  const category = page.getByLabel("분류", { exact: true });

  await page.locator(`[data-external-edit="${PLAIN.id}"]`).click();
  await expect(excerpt).toHaveValue("");
  await expect(category).toHaveValue("");
  await excerpt.fill("첫 줄에 적은 글입니다.\n둘째 줄에   이어 적은 글입니다.");
  await category.fill("부동산공부");
  await excerpt.scrollIntoViewIfNeeded();
  expect(await noOverflow(page)).toBe(true);

  const data = await save(page, calls);
  const saved = data.find((item) => item.id === PLAIN.id);
  expect(saved.excerpt).toBe("첫 줄에 적은 글입니다. 둘째 줄에 이어 적은 글입니다.");
  expect(saved.category).toBe("부동산공부");
  expect(Object.keys(saved)).toEqual(["id", "type", "status", "title", "summary", "excerpt", "category", "url", "publishedAt", "thumbnail"]);
  expect(data.find((item) => item.id === FULL.id)).toEqual(FULL);
});

test("관리자 블로그 요약·분류: 둘 다 비우면 두 칸이 없는 글이 되고, 원문 링크를 바꾸면 알린다", async ({ page }) => {
  const calls = await open(page, 390);
  const excerpt = page.getByLabel("글 앞부분 요약");
  const category = page.getByLabel("분류", { exact: true });
  const notice = page.locator("[data-external-excerpt-notice]");
  const url = page.getByLabel("원문 링크");

  await page.locator(`[data-external-edit="${FULL.id}"]`).click();
  await url.fill(blogUrl("224000000009"));
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText("원문 링크를 바꿨습니다. 요약·분류가 새 글의 것인지 확인해 주세요.");
  await url.fill(FULL.url);
  await expect(notice).toBeHidden();

  await excerpt.fill("   ");
  await category.fill("");
  const data = await save(page, calls);
  const saved = data.find((item) => item.id === FULL.id);
  expect(Object.keys(saved)).toEqual(["id", "type", "status", "title", "summary", "url", "publishedAt", "thumbnail"]);
  expect(JSON.stringify(saved).includes('""'), "빈 문자열을 저장하지 않음").toBe(false);
});

test("관리자 블로그 요약·분류: 블로그가 아닌 종류에서는 두 칸이 숨고 저장에도 넘어가지 않는다", async ({ page }) => {
  const calls = await open(page, 1280);
  const excerpt = page.getByLabel("글 앞부분 요약");
  const category = page.getByLabel("분류", { exact: true });

  await page.locator('[data-external-category="youtube"]').click();
  await page.locator(`[data-external-edit="${VIDEO.id}"]`).click();
  await expect(excerpt).toBeHidden();
  await expect(category).toBeHidden();

  // 블로그 글을 고치다가 종류를 유튜브로 바꾸면 칸이 숨고, 적혀 있던 값도 넘어가지 않는다.
  await page.locator('[data-external-category="blog"]').click();
  await page.locator(`[data-external-edit="${FULL.id}"]`).click();
  await expect(excerpt).toBeVisible();
  await page.getByLabel("종류").selectOption("youtube");
  await expect(excerpt).toBeHidden();
  await expect(category).toBeHidden();
  await page.getByLabel("원문 링크").fill("https://www.youtube.com/watch?v=bbbbbbbbbbb");
  await page.getByLabel("콘텐츠 ID").fill("youtube-bbbbbbbbbbb");

  const data = await save(page, calls);
  const saved = data.find((item) => item.id === "youtube-bbbbbbbbbbb");
  expect(saved.type).toBe("youtube");
  expect("excerpt" in saved).toBe(false);
  expect("category" in saved).toBe(false);
});
