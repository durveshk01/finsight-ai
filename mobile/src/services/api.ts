import { Business, Session, User } from "../types";

export function normalizeApiUrl(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Enter a valid HTTPS API address."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTPS API address without credentials, query parameters, or a fragment.");
  }
  if (["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(url.hostname)) {
    throw new Error("Use the HTTPS address of a deployed API, not localhost.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function apiRequest<T>(apiUrl: string, path: string, body?: unknown, session?: Session, method = body === undefined ? "GET" : "POST"): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method, signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(session?.token ? { Authorization: `Bearer ${session.token}`, "X-Business-Id": String(session.business.id) } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let payload: unknown;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!response.ok) {
      const detail = payload && typeof payload === "object" && "detail" in payload ? payload.detail : null;
      const message = typeof detail === "string" ? detail : Array.isArray(detail)
        ? detail.map((entry: { msg?: string }) => entry.msg || "Invalid input").join(". ")
        : response.status === 404 ? "This address is not serving the FinSight API. Check the API address." : `The API returned HTTP ${response.status}. Try again later.`;
      throw new ApiError(message, response.status);
    }
    if (payload == null) throw new Error("The API returned an invalid response.");
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("The API did not respond within 20 seconds. Your local records are safe; try again later.");
    if (error instanceof TypeError) throw new Error("Cannot connect to the API. Check the address and your internet connection.");
    throw error;
  } finally { clearTimeout(timer); }
}

export interface AuthResponse {
  access_token: string;
  user: User;
  business?: Business;
  businesses?: Business[];
}

export function sessionFromAuth(response: AuthResponse, apiUrl: string, business: Business): Session {
  if (!response.access_token || !response.user?.id || !business?.id) throw new Error("The API did not return a valid account and workspace.");
  return {
    mode: "cloud", apiUrl, token: response.access_token,
    workspaceId: `cloud.${encodeURIComponent(apiUrl)}.${response.user.id}.${business.id}`,
    user: response.user, business: { ...business, opening_cash: Number(business.opening_cash), minimum_reserve: Number(business.minimum_reserve) },
    // Write permission is confirmed by the baseline sync response before enabling editors.
    role: "viewer",
  };
}
