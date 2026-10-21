import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sitePolicy,
  publicPages,
  publicMetadata,
  organizationData,
} from "../../apps/web/app/_lib/seo";
import sitemap from "../../apps/web/app/sitemap";
import robots from "../../apps/web/app/robots";
afterEach(() => vi.unstubAllEnvs());
describe("launch indexing policy", () => {
  it("requires production, explicit indexing permission and a canonical HTTPS public domain", () => {
    const env = {
      DEPLOYMENT_ENV: "production",
      SITE_INDEXING_ENABLED: "true",
      PUBLIC_SITE_URL: "https://weatherly-co.com",
    };
    expect(sitePolicy(env)).toEqual({
      origin: "https://weatherly-co.com",
      indexable: true,
    });
    for (const url of [
      "http://weatherly-co.com",
      "https://127.0.0.1",
      "https://10.0.0.1",
      "https://web-staging-be4e.up.railway.app",
      "https://weatherly.test",
      "https://weatherly.internal",
      "https://weatherly-co.com/path",
      "https://user:secret@weatherly-co.com",
      "https://weatherly-co.com:4000",
      "garbage",
    ])
      expect(sitePolicy({ ...env, PUBLIC_SITE_URL: url }).indexable, url).toBe(
        false,
      );
    expect(sitePolicy({ ...env, DEPLOYMENT_ENV: "staging" }).indexable).toBe(
      false,
    );
    expect(
      sitePolicy({ ...env, SITE_INDEXING_ENABLED: "false" }).indexable,
    ).toBe(false);
  });
  it("keeps staging crawlable for noindex discovery and emits no staging sitemap or organization", () => {
    vi.stubEnv("DEPLOYMENT_ENV", "staging");
    vi.stubEnv("PUBLIC_SITE_URL", "");
    vi.stubEnv("SITE_INDEXING_ENABLED", "true");
    expect(sitemap()).toEqual([]);
    expect(robots().sitemap).toBeUndefined();
    expect(organizationData()).toBeNull();
    expect(publicMetadata("/services").alternates).toBeUndefined();
    expect(publicMetadata("/services").robots).toMatchObject({ index: false });
  });
  it("publishes only public routes with distinct titles, canonical links and share images", () => {
    vi.stubEnv("DEPLOYMENT_ENV", "production");
    vi.stubEnv("PUBLIC_SITE_URL", "https://weatherly-co.com");
    vi.stubEnv("SITE_INDEXING_ENABLED", "true");
    const pages = sitemap();
    expect(pages).toHaveLength(7);
    expect(
      pages.some((x) => /login|workspace|portal\/|testimonials/.test(x.url)),
    ).toBe(false);
    expect(new Set(Object.values(publicPages).map((x) => x.title)).size).toBe(
      7,
    );
    const metadata = publicMetadata("/services");
    expect(metadata.alternates?.canonical).toBe(
      "https://weatherly-co.com/services",
    );
    expect(metadata.robots).toMatchObject({ index: true });
    expect(metadata.openGraph).toHaveProperty("images");
    expect(organizationData()).not.toHaveProperty("address");
  });
});
