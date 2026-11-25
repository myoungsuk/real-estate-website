// 공개 화면의 유튜브 카드(홈 유튜브 칸·/youtube/·단지 화면 관련 콘텐츠)가 보일 제목·설명·형식 딱지를 고르는 규칙을 한 곳에 둔다.
// 2026-11-25 사용자 승인 "유튜브 추천대로"·"유튜브 전부 추천대로": 제목 끝 해시태그 묶음은 화면에서만 떼고,
// 자동 받기가 넣은 틀 문장 설명은 그리지 않고, '일반 영상'/'Shorts' 딱지를 단다.
// 원본(src/data/external-links.json)은 바꾸지 않는다. 화면은 저장된 값 가운데 무엇을 보일지만 고른다.

// 자동 받기가 새 영상에 넣는 틀 문장의 머리("공식 YouTube 채널에서 “제목” 영상을 확인해 보세요.").
// 만드는 곳은 scripts/sync/external-content.mjs이고, 둘이 어긋나면 tests/youtube-card.test.mjs가 떨어진다.
export const YOUTUBE_TEMPLATE_SUMMARY_HEAD = "공식 YouTube 채널에서 “";

const text = (value) => (typeof value === "string" ? value.trim() : "");

// 제목 끝에 붙은 해시태그 묶음(#낱말이 붙어 있거나 띄어 이어진 것)만 뗀다.
// 가운데 해시태그와 묶음 바로 앞 글자(물결 "~", 느낌표 등)는 그대로 둔다. 떼고 나서 비면 원래 제목을 쓴다.
export function stripTrailingHashtags(title) {
  const value = text(title);
  const stripped = value.replace(/\s*(?:#[^\s#]+\s*)+$/u, "").trim();
  return stripped || value;
}

export function isTemplateYoutubeSummary(summary) {
  return text(summary).startsWith(YOUTUBE_TEMPLATE_SUMMARY_HEAD);
}

// 카드 제목: 유튜브는 끝 해시태그를 뗀 제목, 그 밖의 항목은 원래 제목 그대로.
export function getYoutubeCardTitle(item) {
  return item?.type === "youtube" ? stripTrailingHashtags(item.title) : item?.title;
}

// 카드 설명: 유튜브 설명이 틀 문장뿐이면 설명 줄을 그리지 않는다(null). 직접 쓴 설명은 그대로.
export function getYoutubeCardSummary(item) {
  const summary = text(item?.summary);
  return summary && !isTemplateYoutubeSummary(summary) ? summary : null;
}

// 형식 딱지: /youtube/의 고르기 단추와 같은 말.
export function getYoutubeFormatLabel(item) {
  if (item?.type !== "youtube") return null;
  if (item.youtubeFormat === "short") return "Shorts";
  if (item.youtubeFormat === "video") return "일반 영상";
  return null;
}

// 미리 재생에 쓰는 영상 ID(원문 주소에서 꺼냄). 꺼내지 못하면 null이고 그 카드는 미리 재생하지 않는다.
export function getYoutubeVideoId(item) {
  if (item?.type !== "youtube") return null;
  try {
    const url = new URL(item.url);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
    if (url.pathname === "/watch") return url.searchParams.get("v");
    const segments = url.pathname.split("/").filter(Boolean);
    return ["shorts", "live"].includes(segments[0]) ? segments[1] ?? null : null;
  } catch {
    return null;
  }
}
