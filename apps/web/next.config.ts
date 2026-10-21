import type { NextConfig } from "next";
const config: NextConfig = {
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
