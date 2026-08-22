export function resolveHref(base: string, href: string): string {
  return new URL(href, base).toString();
}
export function ensureTrailingSlash(u: string): string {
  return u.endsWith("/") ? u : `${u}/`;
}
export function hrefPath(absUrl: string): string {
  return new URL(absUrl).pathname;
}
