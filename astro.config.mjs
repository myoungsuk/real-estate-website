import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const configuredSite = process.env.PUBLIC_SITE_URL;
const allowIndexing = process.env.PUBLIC_ALLOW_INDEXING === "true";

if (allowIndexing && !configuredSite) {
  throw new Error(
    "PUBLIC_ALLOW_INDEXING=true로 빌드하려면 PUBLIC_SITE_URL에 실제 공개 주소를 입력해야 합니다.",
  );
}

const site = configuredSite ?? "https://leaders-city-happy-realty.workers.dev";

export default defineConfig({
  output: "static",
  site,
  integrations: [sitemap()],
});
