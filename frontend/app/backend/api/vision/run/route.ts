import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const backendInternalUrl = (
  process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

export async function POST(request: NextRequest) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 295 * 1000);

  try {
    const body = await request.text();
    const response = await fetch(`${backendInternalUrl}/api/vision/run`, {
      method: "POST",
      headers: {
        "Content-Type": request.headers.get("content-type") ?? "application/json",
      },
      body,
      cache: "no-store",
      signal: controller.signal,
    });

    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown proxy failure";
    return NextResponse.json(
      { detail: `Vision analysis proxy failed: ${message}` },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
