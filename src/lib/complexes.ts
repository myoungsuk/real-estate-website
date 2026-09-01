import complexData from "../data/complexes.json";
import complexOverviewData from "../data/complexes-overview.json";
import {
  getComplexMatchCandidates as getMatchCandidates,
  matchComplexByListingTitle,
} from "./complex-matching.mjs";

export { normalizeComplexText } from "./complex-matching.mjs";

export type ComplexSourceKind = "official" | "public-data" | "operator" | "news";
export type ComplexAmenityVerification = "official" | "operator-confirmed" | "historical-plan" | "check-required";

export interface ComplexSource {
  id: string;
  publisher: string;
  label: string;
  url: string;
  kind: ComplexSourceKind;
  checkedAt: string;
  note?: string;
}

export interface ComplexOverview {
  eyebrow: string;
  title: string;
  description: string;
  note: string;
  confirmedAt: string;
  featuredComplexSlugs: string[];
  comparisonComplexSlugs: string[];
  stats: Array<{ label: string; value: string; description: string }>;
  reasons: Array<{ title: string; description: string }>;
  comparisonRows: Array<{ label: string; values: Record<string, string> }>;
  sharedCheckpoints: Array<{ title: string; description: string }>;
  relatedContentIds: string[];
  sources: ComplexSource[];
}

export interface ComplexContent {
  slug: string;
  areaSlug: string;
  areaName: string;
  eyebrow: string;
  mark: string;
  name: string;
  aliases: string[];
  seo: {
    title: string;
    description: string;
  };
  unitDataNote: string | null;
  status: "preparing" | "published";
  summary: string;
  introTitle: string;
  introduction: string[];
  image: { src: string; alt: string } | null;
  facts: Array<{ label: string; value: string }>;
  highlights: Array<{ title: string; description: string }>;
  unitGroups: Array<{ category: string; areaLabel: string; households: number; note?: string }>;
  supplySummary: Array<{ label: string; value: string; description?: string }>;
  livingSections: Array<{
    category: "transport" | "education" | "daily-life" | "nature";
    title: string;
    description: string;
  }>;
  amenityGroups: Array<{
    title: string;
    items: string[];
    verification: ComplexAmenityVerification;
    note?: string;
  }>;
  checkpoints: Array<{ title: string; description: string }>;
  faqs: Array<{ question: string; answer: string }>;
  relatedContentIds: string[];
  sources: ComplexSource[];
  confirmedAt: string | null;
}

export const complexOverview = complexOverviewData as ComplexOverview;
export const complexes = complexData as ComplexContent[];
export const publishedComplexes = complexes.filter((complex) => complex.status === "published");

export function getComplexBySlug(slug: string) {
  return complexes.find((complex) => complex.slug === slug);
}

export function getOrderedComplexes(slugs: string[]) {
  const seen = new Set<string>();
  return slugs
    .filter((slug) => !seen.has(slug) && seen.add(slug))
    .map(getComplexBySlug)
    .filter((complex): complex is ComplexContent => complex?.status === "published");
}

export function getComplexMatchCandidates(complex: ComplexContent) {
  return getMatchCandidates(complex);
}

export function matchPublishedComplexByListingTitle(title: string) {
  return matchComplexByListingTitle(title, publishedComplexes) as ComplexContent | undefined;
}

export const featuredComplexes = getOrderedComplexes(complexOverview.featuredComplexSlugs);
export const comparisonComplexes = getOrderedComplexes(complexOverview.comparisonComplexSlugs);

export function getComplexFact(complex: ComplexContent, label: string) {
  return complex.facts.find((fact) => fact.label === label)?.value ?? "확인 중";
}
