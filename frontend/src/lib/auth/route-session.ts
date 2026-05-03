import { connection } from "next/server";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth/server";

/** Must match @neondatabase/auth server cookie filter (see extractNeonAuthCookies). */
const NEON_AUTH_COOKIE_PREFIX = "__Secure-neon-auth";

const NEON_AUTH_PROXY_HEADER = "x-neon-auth-proxy";

function isNeonAuthCookieName(name: string): boolean {
  return (
    name.startsWith(NEON_AUTH_COOKIE_PREFIX) ||
    name.startsWith("neon-auth.") ||
    (name.includes("neon-auth") && name.includes("session"))
  );
}

function extractNeonAuthCookieHeader(cookieHeader: string | null): string {
  if (!cookieHeader) return "";
  const parts = cookieHeader.split(";").map((p) => p.trim()).filter(Boolean);
  const kept: string[] = [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (isNeonAuthCookieName(name)) {
      kept.push(part);
    }
  }
  return kept.join("; ");
}

type SessionResult = Awaited<ReturnType<typeof auth.getSession>>;

function hasUser(data: SessionResult["data"]): boolean {
  const u = data && "user" in data ? data.user : null;
  return !!u && typeof u === "object";
}

async function fetchSessionFromNeonServer(
  fromSdk: SessionResult,
  neonCookies: string,
  origin: string,
): Promise<SessionResult> {
  const base = process.env.NEON_AUTH_BASE_URL?.replace(/\/$/, "");
  if (!base) {
    return fromSdk;
  }

  try {
    const res = await fetch(`${base}/get-session`, {
      method: "GET",
      headers: {
        Cookie: neonCookies,
        Origin: origin,
        [NEON_AUTH_PROXY_HEADER]: "nextjs",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      return fromSdk;
    }

    const body = (await res.json()) as Record<string, unknown>;
    const nested =
      body &&
      typeof body === "object" &&
      "data" in body &&
      body.data &&
      typeof body.data === "object"
        ? (body.data as Record<string, unknown>)
        : null;
    const payload =
      body && "user" in body && "session" in body
        ? body
        : nested && "user" in nested && "session" in nested
          ? nested
          : null;

    if (
      payload &&
      payload.user &&
      typeof payload.user === "object" &&
      payload.session &&
      typeof payload.session === "object"
    ) {
      return {
        data: payload as NonNullable<SessionResult["data"]>,
        error: null,
      };
    }
  } catch {
    /* keep SDK result */
  }

  return fromSdk;
}

/**
 * Neon Auth's `getSession()` uses `headers()` from `next/headers`. In App Router
 * POST/GET handlers that snapshot can be empty even when the browser sent
 * `Cookie` on the real `Request`. We fall back to calling the Auth server's
 * `get-session` with cookies taken from `request.headers`.
 */
export async function getSessionInApiRoute(
  request: Request,
): Promise<SessionResult> {
  await connection();

  const fromSdk = await auth.getSession();
  if (hasUser(fromSdk.data)) {
    return fromSdk;
  }

  const raw = request.headers.get("cookie");
  const neonCookies = extractNeonAuthCookieHeader(raw);
  if (!neonCookies) {
    return fromSdk;
  }

  const origin =
    request.headers.get("origin") ||
    request.headers.get("referer")?.split("/").slice(0, 3).join("/") ||
    new URL(request.url).origin;

  return fetchSessionFromNeonServer(fromSdk, neonCookies, origin);
}

/**
 * Same empty / partial `Cookie` snapshot as API routes: Server Actions, RSC
 * refresh (`router.refresh()`), and some POSTs only see a thin header (e.g. HMR),
 * while `cookies()` still has the full jar — merge when Neon cookies are missing.
 */
export async function getSessionInServerAction(): Promise<SessionResult> {
  await connection();

  const fromSdk = await auth.getSession();
  if (hasUser(fromSdk.data)) {
    return fromSdk;
  }

  const h = await headers();
  let raw = h.get("cookie") ?? "";
  let neonCookies = extractNeonAuthCookieHeader(raw || null);

  if (!neonCookies) {
    const store = await cookies();
    const all = store.getAll();
    if (all.length > 0) {
      raw = all.map((c) => `${c.name}=${c.value}`).join("; ");
      neonCookies = extractNeonAuthCookieHeader(raw);
    }
  }

  const origin =
    h.get("origin") ||
    h.get("referer")?.split("/").slice(0, 3).join("/") ||
    "";

  if (!neonCookies) {
    return fromSdk;
  }

  const resolved = await fetchSessionFromNeonServer(
    fromSdk,
    neonCookies,
    origin,
  );

  return resolved;
}
