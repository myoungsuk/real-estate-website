import { readFile } from "node:fs/promises";
import { validateAdDisclosureRules, validateContent, validateLegalRules } from "./content-validation.mjs";
import { validateReferencedPublicImages } from "./public-image-validation.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const content = {
  office: await readJson("../src/data/office.json"),
  listings: await readJson("../src/data/listings.json"),
  naverListings: await readJson("../src/data/naver-listings.json"),
  complexes: await readJson("../src/data/complexes.json"),
  complexOverview: await readJson("../src/data/complexes-overview.json"),
  externalLinks: await readJson("../src/data/external-links.json"),
  homeContent: await readJson("../src/data/home-content.json"),
  faq: await readJson("../src/data/faq.json"),
  reviews: await readJson("../src/data/reviews.json"),
  dealNews: await readJson("../src/data/deal-news.json"),
};

const legalRules = await readJson("../src/data/work/legal-rules.json");
const adDisclosureRules = await readJson("../src/data/work/ad-disclosure-rules.json");

const errors = [
  ...validateContent(content),
  ...await validateReferencedPublicImages(content),
  ...validateLegalRules(legalRules),
  ...validateAdDisclosureRules(adDisclosureRules),
];
if (errors.length > 0) {
  console.error(`콘텐츠 검증 실패 (${errors.length}건)`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log("콘텐츠 검증 통과");
}
