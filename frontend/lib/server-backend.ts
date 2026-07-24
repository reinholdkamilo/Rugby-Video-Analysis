import { NextRequest, NextResponse } from "next/server";

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

export function backendBaseUrls() {
  const configuredBackendUrl = process.env.BACKEND_INTERNAL_URL?.replace(/\/$/, "");
  if (process.env.VERCEL) {
    if (!configuredBackendUrl || isPrivateBackendTarget(configuredBackendUrl)) return [PUBLIC_BACKEND_URL];
    return [configuredBackendUrl, PUBLIC_BACKEND_URL].filter((url, index, urls) => urls.indexOf(url) === index);
  }
  return [configuredBackendUrl ?? "http://127.0.0.1:8000"];
}

export function backendAuthHeader() {
  const privateMode = process.env.APP_PRIVATE_MODE?.toLowerCase();
  if (!privateMode || !["1", "true", "yes", "on"].includes(privateMode)) return null;
  const password = process.env.APP_ACCESS_PASSWORD;
  if (!password) return null;
  const username = process.env.APP_ACCESS_USERNAME || "coach";
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function forwardedHeaders(request: NextRequest) {
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  const range = request.headers.get("range");
  if (contentType) headers.set("content-type", contentType);
  if (accept) headers.set("accept", accept);
  if (range) headers.set("range", range);

  const authorization = backendAuthHeader();
  if (authorization) headers.set("authorization", authorization);
  return headers;
}

function responseHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  return headers;
}

function isMediaPlaybackPath(backendPath: string) {
  return backendPath.startsWith("/media/") || /^\/api\/videos\/\d+\/stream$/.test(backendPath);
}

function shouldStreamResponse(request: NextRequest, backendPath: string) {
  return request.headers.has("range") || isMediaPlaybackPath(backendPath);
}

export async function proxyBackendRequest(
  request: NextRequest,
  backendPath: string,
  options: { timeoutMs?: number } = {},
) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const backendMethod = method === "HEAD" && isMediaPlaybackPath(backendPath) ? "GET" : method;
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  const backendOrigins = backendBaseUrls();
  const errors: string[] = [];

  for (const backendOrigin of backendOrigins) {
    const target = `${backendOrigin}${backendPath}${url.search}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);

    try {
      const response = await fetch(target, {
        method: backendMethod,
        headers: forwardedHeaders(request),
        body,
        cache: "no-store",
        redirect: isMediaPlaybackPath(backendPath) ? "manual" : "follow",
        signal: controller.signal,
      });

      const headers = responseHeaders(response);
      headers.set("x-rugby-backend-origin", backendOrigin);
      if (backendPath === "/health" && response.ok) {
        return NextResponse.json(
          { status: "healthy", service: "backend", proxy: "reachable" },
          { status: response.status, headers },
        );
      }
      const responseBody = method === "HEAD"
        ? null
        : (shouldStreamResponse(request, backendPath) ? response.body : await response.arrayBuffer());
      return new NextResponse(responseBody, {
        status: response.status,
        headers,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown backend proxy failure";
      errors.push(`${backendOrigin}: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  return NextResponse.json(
    {
      detail: `Backend proxy failed: ${errors.join("; ")}`,
      attempted_origins: backendOrigins,
    },
    { status: 502 },
  );
}
