const removableComplexSeparators = /[\s.\-·]+/gu;
const nonComplexNameCharacters = /[^\p{Script=Hangul}a-z0-9]/gu;

export function normalizeComplexText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(removableComplexSeparators, "")
    .replace(nonComplexNameCharacters, "");
}

export function getComplexMatchCandidates(complex) {
  const values = [complex?.name, ...(Array.isArray(complex?.aliases) ? complex.aliases : [])];
  const seen = new Set();
  return values
    .map((value, index) => ({ value: normalizeComplexText(value), index }))
    .filter(({ value }) => value && !seen.has(value) && seen.add(value))
    .sort((first, second) => second.value.length - first.value.length || first.index - second.index)
    .map(({ value }) => value);
}

export function matchComplexByListingTitle(title, complexes) {
  const normalizedTitle = normalizeComplexText(title);
  if (!normalizedTitle || !Array.isArray(complexes)) return undefined;

  const matches = complexes.flatMap((complex, complexIndex) =>
    getComplexMatchCandidates(complex)
      .filter((candidate) => normalizedTitle.startsWith(candidate))
      .map((candidate, candidateIndex) => ({ complex, complexIndex, candidateIndex, length: candidate.length })),
  );
  if (matches.length === 0) return undefined;

  matches.sort((first, second) =>
    second.length - first.length
    || first.complexIndex - second.complexIndex
    || first.candidateIndex - second.candidateIndex,
  );
  const longestLength = matches[0].length;
  const longestComplexes = [...new Set(matches.filter((match) => match.length === longestLength).map((match) => match.complex))];
  return longestComplexes.length === 1 ? longestComplexes[0] : undefined;
}
