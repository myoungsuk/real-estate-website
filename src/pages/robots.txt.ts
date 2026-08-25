import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const allowIndexing = import.meta.env.PUBLIC_ALLOW_INDEXING === "true";
  const sitemapUrl = new URL("sitemap-index.xml", site).toString();
  const body = allowIndexing
    ? `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/admin/\nSitemap: ${sitemapUrl}\n`
    : `User-agent: *\nDisallow: /\nSitemap: ${sitemapUrl}\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
