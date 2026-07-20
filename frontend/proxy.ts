import { NextRequest, NextResponse } from "next/server";

const REALM = "Rugby Video Analysis Private Workspace";

function hostedPrivateMode() {
  const configured = process.env.APP_PRIVATE_MODE?.toLowerCase();
  if (configured) return ["1", "true", "yes", "on"].includes(configured);
  return process.env.VERCEL === "1";
}

function unauthorized() {
  return new NextResponse("Private workspace. Contact the owner for access.", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Cache-Control": "no-store",
    },
  });
}

function credentialsFromHeader(header: string | null) {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function proxy(request: NextRequest) {
  if (!hostedPrivateMode()) return NextResponse.next();

  const expectedPassword = process.env.APP_ACCESS_PASSWORD;
  if (!expectedPassword) return unauthorized();

  const expectedUsername = process.env.APP_ACCESS_USERNAME || "coach";
  const credentials = credentialsFromHeader(request.headers.get("authorization"));
  if (credentials?.username === expectedUsername && credentials.password === expectedPassword) {
    return NextResponse.next();
  }

  return unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
