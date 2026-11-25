// 글 초안 화면(P3)의 업무 API 호출. 응답 봉투·보안 토큰·로그인 만료 처리는 실거래가와 같은 work-realprice-client.ts를 쓴다.
// 입력값·글 본문·응답을 브라우저 저장소나 주소에 남기지 않는다.
import { getWorkSession, readWork, writeWork, WorkApiError } from "./work-realprice-client";

export { getWorkSession, WorkApiError };

export type BlogSourceType = "naver_listing" | "listing" | "complex";

export interface BlogSourceFacts {
  propertyType?: string;
  tradeType?: "sale" | "jeonse" | "monthly-rent";
  priceWon?: number | null;
  depositWon?: number | null;
  monthlyRentWon?: number | null;
  exclusiveM2?: number | null;
  landM2?: number | null;
  otherAreasM2?: number[];
  floor?: number | null;
  floorBand?: "저" | "중" | "고" | null;
  totalFloors?: number | null;
  direction?: string | null;
  summary: string;
  registeredAt?: string | null;
  areaName?: string | null;
  items?: { label: string; value: string }[];
  details?: Record<string, unknown[]>;
}

export interface BlogSource {
  type: BlogSourceType;
  id: string;
  title: string;
  category: string | null;
  blockedReason: string | null;
  facts: BlogSourceFacts;
}

export interface BlogStyle { id: string; label: string; note: string }

export interface BlogLimits {
  version: number;
  dailyCreateLimit: number | null;
  monthlyCostLimitMicroUsd: number | null;
  defaults: { dailyCreateLimit: number; monthlyCostLimitMicroUsd: number };
  ranges: { daily: [number, number]; monthly: [number, number] };
  usage: { day: string; todayCreates: number; monthCostMicroUsd: number };
}

// headings·checklist는 소제목이 있는 새 꼴 초안에만 있다(2026-11-23). headings는 paragraphs와 같은 길이이고 소제목이 없는 문단은 "".
// trimmed는 AI 글이 상한을 넘어 서버가 잘라 받았을 때만 true로 있다(2026-11-24).
export interface BlogResult { title: string; paragraphs: string[]; headings?: string[]; checklist?: string[]; hashtags: string[]; snsShort?: string; instagram?: string; threads?: string; factsUsed: string[]; trimmed?: boolean }
export interface BlogCheckItem { kind: string; text: string; where: string }

export interface BlogDraft {
  id: string;
  source: { type: BlogSourceType; id: string; title: string };
  sourcePublic: boolean;
  currentSource: BlogSource | null;
  status: "queued" | "in_progress" | "completed" | "failed" | "expired" | "unknown";
  closed: "confirmed" | "cancelled" | "auto" | null;
  errorCode: string | null;
  inputs: Record<string, unknown>;
  emphasisNumbers: string;
  needsLocation: boolean;
  result: BlogResult | null;
  checks: { blocks: BlogCheckItem[]; warnings: BlogCheckItem[] } | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  // 같이 만든 3편 묶음(2026-11-25). ids는 편 순서. 1편으로 만든 초안은 null.
  set?: BlogDraftSet | null;
}

export interface BlogDraftSet { n: number; of: number; ids: string[] }

export interface BlogDraftListItem {
  id: string;
  source: { type: BlogSourceType; id: string; title: string };
  status: BlogDraft["status"];
  closed: BlogDraft["closed"];
  errorCode: string | null;
  title: string | null;
  set?: BlogDraftSet | null;
  createdAt: string;
  closedAt: string | null;
}

export interface BlogDraftCreate {
  source: { type: BlogSourceType; id: string };
  style: string;
  inputs: Record<string, unknown>;
  emphasis: string;
  // 1 또는 3(2026-11-25 사용자 결정 4: 처음 값 3편). 3이면 응답에 drafts(편 순서)가 같이 온다.
  count?: 1 | 3;
}

// 카드 배경 그림(설계서 22.22절). 그림은 이번 응답에만 있고 화면 메모리에만 둔다(서버 저장·브라우저 저장소·blob 주소·화면 주소 없음).
export type BlogImageStyle = "watercolor" | "photo" | "pastel" | "pencil";
export type BlogImageQuality = "medium" | "high";
export interface BlogBackgroundsCreate { description: string; style: BlogImageStyle; quality: BlogImageQuality }
export interface BlogBackgrounds {
  images: { format: "jpeg"; width: number; height: number; base64: string }[];
  model: string;
  style: BlogImageStyle;
  quality: BlogImageQuality;
  defaultDescriptionUsed: boolean;
  costMicroUsd: number;
  costIsEstimate: boolean;
  usage: { inputTokens: number; outputTokens: number } | null;
}

export const readBlogSources = () => readWork<{ items: BlogSource[]; styles: BlogStyle[] }>("/blog/sources");
export const readBlogLimits = () => readWork<BlogLimits>("/blog/limits");
export const saveBlogLimits = (body: { version: number; dailyCreateLimit: number; monthlyCostLimitMicroUsd: number }) => writeWork<BlogLimits>("/blog/limits", "PUT", body);
export const listBlogDrafts = () => readWork<{ items: BlogDraftListItem[] }>("/blog/drafts");
export const readBlogDraft = (id: string) => readWork<{ draft: BlogDraft }>(`/blog/drafts/${encodeURIComponent(id)}`);
export const createBlogDraft = (body: BlogDraftCreate) => writeWork<{ draft: BlogDraft; drafts?: BlogDraft[] }>("/blog/drafts", "POST", body);
export const createBlogBackgrounds = (body: BlogBackgroundsCreate) => writeWork<BlogBackgrounds>("/blog/backgrounds", "POST", body);
export const closeBlogDraft = (id: string, action: "confirm" | "cancel") => writeWork<{ draft: BlogDraft }>(`/blog/drafts/${encodeURIComponent(id)}/${action}`, "POST", {});
