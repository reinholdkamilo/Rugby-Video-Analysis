import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Keep upload-control requests same-origin in hosted browsers. Only the
    // signed video-part PUTs go directly to Cloudflare R2.
    NEXT_PUBLIC_UPLOAD_API_URL: "/backend",
  },
};

export default nextConfig;
