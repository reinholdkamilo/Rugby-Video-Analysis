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

export function backendBaseUrl() {
  const configuredBackendUrl = process.env.BACKEND_INTERNAL_URL?.replace(/\/$/, "");
  return (
    process.env.VERCEL && (!configuredBackendUrl || isPrivateBackendTarget(configuredBackendUrl))
      ? PUBLIC_BACKEND_URL
      : configuredBackendUrl ?? "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
}

export function backendAuthHeader() {
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
  headers.delete("transfer-encoding");
  return headers;
}

export async function proxyBackendRequest(
  request: NextRequest,
  backendPath: string,
  options: { timeoutMs?: number } = {},
) {
  const url = new URL(request.url);
  const target = `${backendBaseUrl()}${backendPath}${url.search}`;
  const method = request.method.toUpperCase();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 60_000);

  try {
    const response = await fetch(target, {
      method,
      headers: forwardedHeaders(request),
      body: method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      signal: controller.signal,
    });

    return new NextResponse(response.body, {
      status: response.status,
      headers: responseHeaders(response),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown backend proxy failure";
    return NextResponse.json({ detail: `Backend proxy failed: ${message}` }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
