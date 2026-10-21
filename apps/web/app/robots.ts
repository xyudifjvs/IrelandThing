import type { MetadataRoute } from "next";
import { sitePolicy } from "./_lib/seo";

export default function robots(): MetadataRoute.Robots {
  const { origin, indexable } = sitePolicy();
  // Crawlers must be able to read noindex on staging and account pages.
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/authorize", "/token", "/revoke"],
    },
    ...(indexable && origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}
