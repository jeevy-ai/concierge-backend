import type { ClerkClaims } from "./types.js";

function b64url(s: string): Uint8Array {
  const base64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

function decodePayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT structure");
  const [, payload] = parts as [string, string, string];
  const decoded = b64url(payload);
  return JSON.parse(new TextDecoder().decode(decoded)) as Record<string, unknown>;
}

function decodeHeader(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT structure");
  const [header] = parts as [string, string, string];
  const decoded = b64url(header);
  return JSON.parse(new TextDecoder().decode(decoded)) as Record<string, unknown>;
}

type JsonWebKeyWithKid = JsonWebKey & { kid?: string };

async function verifyRs256(token: string, key: CryptoKey): Promise<boolean> {
  const parts = token.split(".");
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const message = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = b64url(sigB64);
  return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, message);
}

/**
 * Verifies a Clerk-issued JWT against the provided JWKS URI.
 * Uses native Web Crypto — no external dependencies.
 */
export async function verifyClerkJwt(token: string, jwksUri: string): Promise<ClerkClaims> {
  const header = decodeHeader(token);
  const kid = typeof header.kid === "string" ? header.kid : undefined;

  const res = await fetch(jwksUri);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = (await res.json()) as { keys: JsonWebKeyWithKid[] };

  const jwk = kid ? keys.find((k) => k.kid === kid) : keys[0];
  if (!jwk) throw new Error(`No matching JWK for kid=${kid ?? "any"}`);

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const valid = await verifyRs256(token, cryptoKey);
  if (!valid) throw new Error("JWT signature invalid");

  const claims = decodePayload(token);
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp < now) {
    throw new Error("JWT expired");
  }
  if (typeof claims.sub !== "string") throw new Error("Missing sub claim");

  return {
    sub: claims.sub,
    org_id: typeof claims.org_id === "string" ? claims.org_id : undefined,
    org_role: typeof claims.org_role === "string" ? claims.org_role : undefined,
    exp: typeof claims.exp === "number" ? claims.exp : 0,
    iat: typeof claims.iat === "number" ? claims.iat : 0,
  };
}
