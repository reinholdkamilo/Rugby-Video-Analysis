import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const backendInternalUrl = (
  process.env.BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000"
).replace(/\/$/, "");

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const response = await fetch(
      `${backendInternalUrl}/api/automatic-suggestions/detect`,
      {
        method: "POST",
        headers: {
          "Content-Type": request.headers.get("content-type") ?? "application/json",
          Accept: "application/json",
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(295 * 1000),
      },
    );

    const responseBody = await response.text();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unknown proxy failure";
    return NextResponse.json(
      { detail: `Automatic detection proxy failed: ${detail}` },
      { status: 502 },
    );
  }
}
