import type { NextConfig } from "next";

const PUBLIC_BACKEND_URL = "https://rugby-video-analysis-api-free.onrender.com";

function isPrivateBackendTarget(url: string) {
  return (
    url.includes("localhost") ||
    url.includes("127.0.0.1") ||
    url.includes("0.0.0.0") ||
    url.includes(".internal") ||
    url.includes(".local")
  );
}

const configuredBackendUrl = process.env.BACKEND_INTERNAL_URL?.replace(/\/$/, "");
const backendInternalUrl = (
  process.env.VERCEL && (!configuredBackendUrl || isPrivateBackendTarget(configuredBackendUrl))
    ? PUBLIC_BACKEND_URL
    : configuredBackendUrl ?? "http://127.0.0.1:8000"
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
