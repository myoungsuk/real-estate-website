import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  YOUTUBE_TEMPLATE_SUMMARY_HEAD,
  getYoutubeCardSummary,
  getYoutubeCardTitle,
  getYoutubeFormatLabel,
  getYoutubeVideoId,
  isTemplateYoutubeSummary,
  stripTrailingHashtags,
} from "../src/lib/youtube-card.mjs";
import { buildExternalContentItem, parseYouTubeFeed, YOUTUBE_CHANNEL_ID } from "../scripts/sync/external-content.mjs";

// 공개 화면의 유튜브 카드(2026-11-25 사용자 승인 "유튜브 추천대로"·"유튜브 전부 추천대로"):
// 제목 끝 해시태그 묶음은 화면에서만 떼고, 자동 받기가 넣은 틀 문장 설명은 그리지 않고, '일반 영상'/'Shorts' 딱지를 단다.
const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const youtubeAtom = await readSource("tests/fixtures/external-sync/youtube-atom.xml");

const video = (extra = {}) => ({
  id: "youtube-aaaaaaaaaaa",
  type: "youtube",
  youtubeFormat: "video",
  status: "published",
  title: "가상숲1단지 둘러보기",
  summary: "운영자가 적은 설명",
  url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
  publishedAt: "2026-11-24",
  thumbnail: null,
  ...extra,
});

test("제목 끝 해시태그 묶음만 떼고, 가운데 해시태그·물결은 남기며, 떼고 나서 비면 원래 제목", () => {
  // 실제 공개 제목과 같은 꼴(붙여 쓴 묶음·띄어 쓴 묶음·대문자 SHORTS)
  assert.equal(stripTrailingHashtags("가상숲 4블록 74B매매/ 신축아파트 / 즉시입주가능 #SHORTS #가상숲#가상부동산"), "가상숲 4블록 74B매매/ 신축아파트 / 즉시입주가능");
  assert.equal(stripTrailingHashtags("에어컨 5대가 공짜 /가상숲 74B 타입매매#shorts #가상숲 #가상부동산"), "에어컨 5대가 공짜 /가상숲 74B 타입매매");
  assert.equal(stripTrailingHashtags("가상숲 월요장터로 장보러 오세요~#shorts #가상숲#가상숲5블록"), "가상숲 월요장터로 장보러 오세요~", "물결은 제목의 일부라 남김(시안 그림과 다름)");
  assert.equal(stripTrailingHashtags("입주시까지 !! #shorts"), "입주시까지 !!");
  assert.equal(stripTrailingHashtags("#가상숲 이야기 첫 편"), "#가상숲 이야기 첫 편", "앞·가운데 해시태그는 그대로");
  assert.equal(stripTrailingHashtags("가상숲 #가운데 해시태그 뒤에 글"), "가상숲 #가운데 해시태그 뒤에 글");
  assert.equal(stripTrailingHashtags("#가상숲 #shorts"), "#가상숲 #shorts", "해시태그뿐이면 원래 제목");
  assert.equal(stripTrailingHashtags("해시태그 없는 제목"), "해시태그 없는 제목");
  assert.equal(stripTrailingHashtags("  앞뒤 빈칸  "), "앞뒤 빈칸");
  assert.equal(stripTrailingHashtags(undefined), "");
});

test("카드 제목은 유튜브만 해시태그를 떼고, 블로그·인스타그램 제목은 그대로", () => {
  assert.equal(getYoutubeCardTitle(video({ title: "가상숲 둘러보기 #shorts" })), "가상숲 둘러보기");
  assert.equal(getYoutubeCardTitle({ type: "blog", title: "블로그 글 #태그" }), "블로그 글 #태그");
  assert.equal(getYoutubeCardTitle({ type: "instagram", title: "인스타 #태그" }), "인스타 #태그");
});

test("유튜브 설명은 틀 문장뿐이면 그리지 않고, 직접 쓴 설명은 그대로", () => {
  assert.equal(getYoutubeCardSummary(video()), "운영자가 적은 설명");
  assert.equal(getYoutubeCardSummary(video({ summary: `${YOUTUBE_TEMPLATE_SUMMARY_HEAD}가상숲 둘러보기” 영상을 확인해 보세요.` })), null);
  assert.equal(getYoutubeCardSummary(video({ summary: `  ${YOUTUBE_TEMPLATE_SUMMARY_HEAD}가상숲” Shorts를 확인해 보세요.` })), null, "앞 빈칸이 있어도 틀 문장");
  assert.equal(getYoutubeCardSummary(video({ summary: "" })), null);
  assert.equal(getYoutubeCardSummary(video({ summary: undefined })), null);
  // 승인 범위는 자동 받기 틀 문장("공식 YouTube 채널에서 “…”")만이다. 예전 옮김 때 적은 다른 문장은 숨기지 않는다.
  assert.equal(getYoutubeCardSummary(video({ summary: "공식 유튜브 영상에서 가상숲 내용을 확인할 수 있습니다." })), "공식 유튜브 영상에서 가상숲 내용을 확인할 수 있습니다.");
});

// 틀 문장은 자동 받기(scripts/sync/external-content.mjs)가 만든다. 그 문장이 바뀌면 카드가 틀 문장을 다시 그리게 되므로 여기서 묶는다.
test("자동 받기가 만든 유튜브 틀 문장은 카드가 틀 문장으로 알아본다(만드는 곳과 알아보는 곳이 어긋나면 떨어짐)", () => {
  const [candidate] = parseYouTubeFeed(youtubeAtom, { channelId: YOUTUBE_CHANNEL_ID });
  const built = buildExternalContentItem(candidate, null);
  assert.equal(built.type, "youtube");
  assert.equal(built.summary.startsWith(YOUTUBE_TEMPLATE_SUMMARY_HEAD), true);
  assert.equal(isTemplateYoutubeSummary(built.summary), true);
  assert.equal(getYoutubeCardSummary(built), null, "새로 받은 영상은 설명 줄이 없음");
});

test("형식 딱지는 /youtube/ 고르기 단추와 같은 말이고, 유튜브가 아니면 없음", () => {
  assert.equal(getYoutubeFormatLabel(video()), "일반 영상");
  assert.equal(getYoutubeFormatLabel(video({ youtubeFormat: "short" })), "Shorts");
  assert.equal(getYoutubeFormatLabel(video({ youtubeFormat: undefined })), null);
  assert.equal(getYoutubeFormatLabel({ type: "blog" }), null);
});

test("미리 재생 영상 ID는 원문 주소에서 꺼내고, 꺼내지 못하면 null", () => {
  assert.equal(getYoutubeVideoId(video()), "aaaaaaaaaaa");
  assert.equal(getYoutubeVideoId(video({ url: "https://youtu.be/bbbbbbbbbbb" })), "bbbbbbbbbbb");
  assert.equal(getYoutubeVideoId(video({ url: "https://www.youtube.com/shorts/ccccccccccc" })), "ccccccccccc");
  assert.equal(getYoutubeVideoId(video({ url: "https://www.youtube.com/channel/x" })), null);
  assert.equal(getYoutubeVideoId(video({ url: "주소 아님" })), null);
  assert.equal(getYoutubeVideoId({ type: "blog", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }), null);
});

test("공개 영상 자료: 해시태그를 뗀 제목은 비지 않고, 원본 제목에서 끝 묶음만 줄어든다", async () => {
  const items = JSON.parse(await readSource("src/data/external-links.json")).filter((item) => item.type === "youtube" && item.status === "published");
  assert.ok(items.length > 0);
  for (const item of items) {
    const shown = getYoutubeCardTitle(item);
    assert.ok(shown.length > 0, item.id);
    assert.ok(item.title.trim().startsWith(shown), `${item.id}: 보이는 제목은 원래 제목의 앞부분`);
    if (shown !== item.title.trim()) assert.doesNotMatch(shown, /#[^\s#]+\s*$/u, `${item.id}: 뗀 뒤 끝에 해시태그가 남지 않음`);
  }
  assert.ok(items.some((item) => getYoutubeCardTitle(item) !== item.title), "끝 해시태그가 있는 영상이 있음(2026-11-25 기준 85개 중 23개)");
});

test("홈 유튜브 칸과 유튜브 카드는 같은 규칙 파일·같은 미리 재생 코드를 쓴다", async () => {
  const [card, homeLead, home, hover, homeStyles] = await Promise.all([
    readSource("src/components/ExternalContentList.astro"),
    readSource("src/components/HomeYoutubeLead.astro"),
    readSource("src/pages/index.astro"),
    readSource("src/components/YoutubeHoverPreview.astro"),
    readSource("src/styles/home.css"),
  ]);
  assert.match(card, /import \{ getYoutubeCardSummary, getYoutubeCardTitle, getYoutubeFormatLabel, getYoutubeVideoId \} from "\.\.\/lib\/youtube-card\.mjs";/u);
  assert.match(homeLead, /import \{ getYoutubeCardTitle, getYoutubeFormatLabel, getYoutubeVideoId \} from "\.\.\/lib\/youtube-card\.mjs";/u);
  for (const source of [card, homeLead]) {
    assert.match(source, /import YoutubeHoverPreview from "\.\/YoutubeHoverPreview\.astro";/u);
    assert.match(source, /<YoutubeHoverPreview \/>/u);
    assert.doesNotMatch(source, /lib\/youtube-hover-preview/u);
  }
  // 미리 재생 스크립트와 카드 스크립트는 다른 파일을 import하지 않는다. import가 있으면 Astro가 HTML 밖 .js로 빼서
  // 홈에 요청이 늘고 LCP가 늦어진다(2026-11-25 잰 값: 따로 받는 .js 2개일 때 홈 LCP 2400 ~ 2475ms, 한계 2500ms).
  for (const source of [hover, card]) assert.doesNotMatch(source.match(/<script>[^]*<\/script>/u)[0], /^\s*import\s/mu);
  assert.doesNotMatch(card, /function getYoutubeVideoId/u, "영상 ID 규칙은 한 곳");
  // 홈: 일반 영상 최신 6개(Shorts 없음), 큰 영상 1개 + 목록 5개, 큰 영상·목록 모두 미리 재생
  assert.match(home, /const homeYoutubeContents = publishedYoutubeVideoContents\.slice\(0, 6\);/u);
  assert.match(home, /<HomeYoutubeLead items=\{homeYoutubeContents\} \/>/u);
  assert.match(homeLead, /<div class="home-blog home-yt" data-youtube-hover-preview="true">/u);
  assert.match(homeLead, /<article class="home-blog__lead" data-content-item>/u);
  assert.match(homeLead, /<li class="home-blog__row" data-content-item>/u);
  assert.equal((homeLead.match(/data-youtube-preview-frame/gu) ?? []).length, 2, "큰 영상·목록 모두 미리 재생 칸");
  assert.doesNotMatch(homeLead, /getYoutubeCardSummary|summary/u, "홈 유튜브 칸은 설명·요약을 넣지 않음");
  assert.doesNotMatch(homeLead, /loading="eager"|fetchpriority/u, "홈 유튜브 그림은 먼저 받지 않음(첫 화면 그림이 아님)");
  assert.equal((homeLead.match(/loading="lazy"/gu) ?? []).length, 2);
  // 재생 표시는 왼쪽 아래 모서리(썸네일 가격 글자를 가리지 않음)
  assert.match(homeStyles, /\.home-yt__play \{[^}]*bottom: 12px;[^}]*left: 12px;/u);
  // 미리 재생 규칙(DESIGN.md "움직임"): 정밀 포인터·움직임 줄이기 아님·0.3초·youtube-nocookie
  assert.match(hover, /\(hover: hover\) and \(pointer: fine\)/u);
  assert.match(hover, /prefers-reduced-motion: reduce/u);
  assert.match(hover, /media\.closest<HTMLElement>\("\[data-content-item\]"\)/u);
  assert.match(hover, /youtube-nocookie\.com\/embed/u);
  assert.match(hover, /\}, 300\)/u);
  assert.match(hover, /embedUrl\.searchParams\.set\("mute", "1"\)/u);
});
