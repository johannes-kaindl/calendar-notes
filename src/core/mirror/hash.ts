import { sha256HexUtf8 } from "../../vendor/code-kit/sha256";
import type { FmVal } from "./profile";

export function managedHash(set: Record<string, FmVal>, unset: string[], block: string | null): string {
  const sortedSet: Record<string, FmVal> = {};
  for (const k of Object.keys(set).sort()) {
    const v = set[k];
    if (v !== undefined) sortedSet[k] = v;
  }
  return sha256HexUtf8(JSON.stringify({ set: sortedSet, unset: [...unset].sort(), block }));
}

function norm(v: unknown): string | string[] | null {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" || typeof x === "number" || typeof x === "boolean" ? String(x) : JSON.stringify(x)));
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
}
export function fmEquals(a: unknown, b: unknown): boolean {
  const x = norm(a), y = norm(b);
  if (Array.isArray(x) || Array.isArray(y)) return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((v, i) => v === y[i]);
  return x === y;
}
