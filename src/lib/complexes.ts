import complexData from "../data/complexes.json";

export interface ComplexContent {
  slug: string;
  areaSlug: string;
  areaName: string;
  eyebrow: string;
  mark: string;
  name: string;
  status: "preparing" | "published";
  summary: string;
  introTitle: string;
  introduction: string[];
  source: string | null;
  confirmedAt: string | null;
}

export const complexes = complexData as ComplexContent[];
