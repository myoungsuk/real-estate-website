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
  image: { src: string; alt: string } | null;
  facts: Array<{ label: string; value: string }>;
  highlights: Array<{ title: string; description: string }>;
  sources: Array<{ label: string; url: string }>;
  confirmedAt: string | null;
}

export const complexes = complexData as ComplexContent[];
export const publishedComplexes = complexes.filter((complex) => complex.status === "published");

export function getComplexFact(complex: ComplexContent, label: string) {
  return complex.facts.find((fact) => fact.label === label)?.value ?? "확인 중";
}
