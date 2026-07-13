import type { NextConfig } from "next";

const backendInternalUrl = (
  process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

const nextConfig: NextConfig = {
  // Codespaces already terminates HTTPS and may compress responses itself.
  // Serving uncompressed HTML avoids iPad Safari treating a forwarded response
  // as a download or rendering an empty document.
  compress: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
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
