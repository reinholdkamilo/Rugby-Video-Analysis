import { NextRequest } from "next/server";
import { proxyBackendRequest } from "@/lib/server-backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

async function handler(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  return proxyBackendRequest(request, `/${path.join("/")}`, { timeoutMs: 295_000 });
}

export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
