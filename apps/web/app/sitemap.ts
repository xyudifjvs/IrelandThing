import type { MetadataRoute } from "next";
import { publicPages, sitePolicy } from "./_lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const { origin, indexable } = sitePolicy();
  return indexable && origin
    ? Object.keys(publicPages).map((path) => ({
        url: new URL(path, origin).href,
      }))
    : [];
}
