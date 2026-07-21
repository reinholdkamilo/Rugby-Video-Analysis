import { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/server-backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  return proxyBackendRequest(request, "/api/automatic-suggestions/detect", { timeoutMs: 295_000 });
}
