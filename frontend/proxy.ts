import { NextRequest, NextResponse } from "next/server";

const REALM = "Rugby Video Analysis Private Workspace";
const SESSION_COOKIE = "rva_private_session";

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

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sessionToken(username: string, password: string) {
  return sha256(`${username}:${password}:${process.env.APP_ACCESS_PASSWORD ?? ""}`);
}

export async function proxy(request: NextRequest) {
  if (!hostedPrivateMode()) return NextResponse.next();

  const expectedPassword = process.env.APP_ACCESS_PASSWORD;
  if (!expectedPassword) return unauthorized();

  const expectedUsername = process.env.APP_ACCESS_USERNAME || "coach";
  const expectedToken = await sessionToken(expectedUsername, expectedPassword);
  if (request.cookies.get(SESSION_COOKIE)?.value === expectedToken) {
    return NextResponse.next();
  }

  const credentials = credentialsFromHeader(request.headers.get("authorization"));
  if (credentials?.username === expectedUsername && credentials.password === expectedPassword) {
    const response = NextResponse.next();
    response.cookies.set(SESSION_COOKIE, expectedToken, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return response;
  }

  return unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
