import externalContentData from "../data/external-links.json";
import homeContentData from "../data/home-content.json";

export interface ContentImage {
  src: string;
  alt: string;
}

export type ExternalContentType = "blog" | "youtube" | "instagram";
export type ExternalContentStatus = "draft" | "published";
export type YoutubeContentFormat = "video" | "short";

export interface ExternalContent {
  id: string;
  type: ExternalContentType;
  youtubeFormat?: YoutubeContentFormat;
  status: ExternalContentStatus;
  title: string;
  summary: string;
  // 블로그 글에만 두는 선택 칸: 글 앞부분 요약(1 ~ 300자)과 네이버 분류 이름. 규칙은 blog-excerpt.mjs.
  excerpt?: string;
  category?: string;
  url: string;
  publishedAt: string | null;
  thumbnail: ContentImage | null;
}

// 홈 매물 종이 아래 대표 소개 항목(2026-11-27 사용자 요청 "사무소 소개를 아랫걸로 바꿔 줄 수 있어?"·답 "4칸 목록으로"·"이모지 그대로"). icon은 비워도 된다.
export interface HomeBrokerPoint {
  icon: string;
  title: string;
  description: string;
}

export interface HomeContent {
  broker: {
    eyebrow: string;
    headline: string;
    points: HomeBrokerPoint[];
    portrait: ContentImage;
  };
  office: {
    eyebrow: string;
    title: string;
    description: string;
    image: ContentImage;
    badges: string[];
  };
  areaGuide: {
    eyebrow: string;
    title: string;
    description: string;
    cards: Array<{ title: string; description: string }>;
  };
}

export const homeContent = homeContentData as HomeContent;
export const externalContents = externalContentData as ExternalContent[];
export const publishedExternalContents = externalContents
  .filter((item) => item.status === "published")
  .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
export const publishedBlogContents = publishedExternalContents.filter((item) => item.type === "blog");
export const publishedYoutubeContents = publishedExternalContents.filter((item) => item.type === "youtube");
export const publishedYoutubeVideoContents = publishedYoutubeContents.filter((item) => item.youtubeFormat === "video");
export const publishedYoutubeShortsContents = publishedYoutubeContents.filter((item) => item.youtubeFormat === "short");
export const publishedInstagramContents = publishedExternalContents.filter((item) => item.type === "instagram");

export function getPublishedExternalContentsByIds(ids: string[]) {
  const byId = new Map(publishedExternalContents.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter((item): item is ExternalContent => Boolean(item));
}

export function formatContentDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T00:00:00+09:00`));
}
