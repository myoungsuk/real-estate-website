import externalContentData from "../data/external-links.json";
import homeContentData from "../data/home-content.json";

export interface ContentImage {
  src: string;
  alt: string;
}

export type ExternalContentType = "blog" | "youtube";
export type ExternalContentStatus = "draft" | "published";
export type YoutubeContentFormat = "video" | "short";

export interface ExternalContent {
  id: string;
  type: ExternalContentType;
  youtubeFormat?: YoutubeContentFormat;
  status: ExternalContentStatus;
  title: string;
  summary: string;
  url: string;
  publishedAt: string | null;
  thumbnail: ContentImage | null;
}

export interface HomeContent {
  broker: {
    eyebrow: string;
    headline: string;
    lead: string;
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

export function getPublishedExternalContentsByIds(ids: string[]) {
  const byId = new Map(publishedExternalContents.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter((item): item is ExternalContent => Boolean(item));
}

export function formatContentDate(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(`${value}T00:00:00+09:00`));
}
