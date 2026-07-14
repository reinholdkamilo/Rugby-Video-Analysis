import type { NextConfig } from "next";

const backendInternalUrl = (
  process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  env: {
    // Keep upload-control requests same-origin in hosted browsers. Only the
    // signed video-part PUTs go directly to Cloudflare R2.
    NEXT_PUBLIC_UPLOAD_API_URL:
      process.env.NEXT_PUBLIC_UPLOAD_API_URL ?? "/backend",
  },
  async rewrites() {
    return [
      {
        source: "/backend/:path*",
        destination: `${backendInternalUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
