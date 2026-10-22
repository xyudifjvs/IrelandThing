import type { NextConfig } from "next";
import { sitePolicy } from "./app/_lib/seo";
const config: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const paths = sitePolicy().indexable
      ? [
          "/workspace/:path*",
          "/portal/:path*",
          "/checklist/:path*",
          "/api/:path*",
          "/login",
          "/account",
          "/security",
          "/invite",
          "/forgot-password",
          "/reset-password",
          "/authorize-assistant",
          "/authorize",
          "/token",
          "/revoke",
          "/testimonials",
        ]
      : ["/:path*"];
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      ...paths.map((source) => ({
        source,
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      })),
      {
        source: "/checklist/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
  transpilePackages: ["@weatherly/ui", "@weatherly/assistant-ui"],
  async rewrites() {
    const origin = process.env.API_INTERNAL_URL || "http://127.0.0.1:4000";
    return [
      { source: "/api/:path*", destination: `${origin}/api/:path*` },
      {
        source: "/.well-known/:path*",
        destination: `${origin}/.well-known/:path*`,
      },
      ...["authorize", "token", "revoke"].map((path) => ({
        source: `/${path}`,
        destination: `${origin}/${path}`,
      })),
    ];
  },
};
export default config;
