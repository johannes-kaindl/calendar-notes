import type { Transport } from "./types";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** UTF-8-sicheres Base64 (btoa allein zerlegt Umlaute). */
export function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0, b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += b === undefined ? "=" : B64[(n >> 6) & 63]!;
    out += c === undefined ? "=" : B64[n & 63]!;
  }
  return out;
}

export function withBasicAuth(t: Transport, user: string, pass: string): Transport {
  const auth = `Basic ${base64Utf8(`${user}:${pass}`)}`;
  return (req) => t({ ...req, headers: { ...(req.headers ?? {}), Authorization: auth } });
}

export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const k of Object.keys(headers)) if (k.toLowerCase() === want) return headers[k];
  return undefined;
}
