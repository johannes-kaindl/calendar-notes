export interface DavRequest { method: string; url: string; headers?: Record<string, string>; body?: string }
export interface DavResponse { status: number; headers: Record<string, string>; text: string }
export type Transport = (req: DavRequest) => Promise<DavResponse>;

export interface DavCollection {
  href: string;               // absolut
  kind: "calendar" | "addressbook";
  displayName: string;
  ctag?: string;
  syncToken?: string;
  components?: string[];      // Kalender: VEVENT/VTODO/…
  readOnly: boolean;
  color?: string;
}
export interface DavObjectRef { href: string; etag: string }
export interface DavObject extends DavObjectRef { data: string }

export class DavError extends Error {
  constructor(public readonly status: number, message: string, public readonly url: string) {
    super(message);
    this.name = "DavError";
  }
}
