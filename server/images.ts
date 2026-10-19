// Pictures for the board, from Wikimedia Commons. Only freely licensed files
// are used, each with its credit. The browser never talks to Wikimedia: the
// search hands back an opaque id and the image bytes come through this server,
// so the page's strict content policy stays as it is and the phone can use
// the pictures as AR textures without cross-origin trouble.

export interface ImageHit {
  id: string;
  title: string;
  credit: string;
  license: string;
  width: number;
  height: number;
}

const API = "https://commons.wikimedia.org/w/api.php";
const ALLOWED_HOSTS = new Set(["upload.wikimedia.org", "thumb.wikimedia.org"]);
const FREE_LICENSE = /^(cc0|public domain|pd\b|cc[ -]by(-sa)?\b)/i;
/** Titles that have no place on a school board. */
const BLOCKED =
  /\b(nude|naked|nudity|sex|sexual|porn|erotic|nsfw|genital|penis|vagina|breasts?|topless|lingerie|corpse|gore|execution|torture|beheading)\b/i;
const MAX_BYTES = 4_000_000;
const MAX_CACHED = 500;

const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** "File:Ludo_board game.jpg" -> "Ludo board game" */
const cleanTitle = (t: string) =>
  t
    .replace(/^File:/i, "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/_/g, " ")
    .trim();

interface CommonsPage {
  title: string;
  index?: number;
  imageinfo?: Array<{
    thumburl?: string;
    thumbwidth?: number;
    thumbheight?: number;
    mime?: string;
    extmetadata?: Record<string, { value?: string }>;
  }>;
}

export class ImageSearch {
  /** id -> image URL on Wikimedia, filled by searches. */
  private readonly urls = new Map<string, string>();

  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly userAgent = "MochiTutor/1.0 (https://github.com/NandishwarSingh/MochiTutor)",
  ) {}

  async search(query: string, signal?: AbortSignal): Promise<ImageHit | null> {
    const q = query.replace(/["<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!q || BLOCKED.test(q)) return null;
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "search",
      gsrnamespace: "6",
      gsrlimit: "8",
      gsrsearch: q,
      prop: "imageinfo",
      iiprop: "url|mime|extmetadata",
      iiurlwidth: "800",
      iiextmetadatafilter: "LicenseShortName|Artist",
      origin: "*",
    });
    const res = await this.fetcher(`${API}?${params}`, { headers: { "user-agent": this.userAgent }, signal });
    if (!res.ok) throw new Error(`Wikimedia answered ${res.status}`);
    const body = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
    const pages = Object.values(body.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      const url = info?.thumburl;
      if (!info || !url || BLOCKED.test(page.title)) continue;
      if (!/^image\/(jpeg|png|webp|svg\+xml)$/.test(info.mime ?? "")) continue;
      const license = stripTags(info.extmetadata?.LicenseShortName?.value ?? "");
      if (!FREE_LICENSE.test(license)) continue;
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        continue;
      }
      if (!ALLOWED_HOSTS.has(host)) continue;
      const id = new Bun.CryptoHasher("sha256").update(url).digest("hex").slice(0, 20);
      this.remember(id, url);
      const artist = stripTags(info.extmetadata?.Artist?.value ?? "").slice(0, 80) || "Unknown author";
      return {
        id,
        title: cleanTitle(page.title).slice(0, 100),
        credit: `${artist}, ${license}, via Wikimedia Commons`,
        license,
        width: info.thumbwidth ?? 0,
        height: info.thumbheight ?? 0,
      };
    }
    return null;
  }

  private remember(id: string, url: string): void {
    this.urls.delete(id);
    this.urls.set(id, url);
    while (this.urls.size > MAX_CACHED) this.urls.delete(this.urls.keys().next().value as string);
  }

  /** The bytes of an image a search returned, or null for an unknown id. */
  async file(id: string): Promise<Response | null> {
    const url = this.urls.get(id);
    if (!url) return null;
    const res = await this.fetcher(url, { headers: { "user-agent": this.userAgent } });
    const type = res.headers.get("content-type") ?? "";
    const length = Number(res.headers.get("content-length") ?? 0);
    if (!res.ok || !type.startsWith("image/") || length > MAX_BYTES) {
      return new Response(JSON.stringify({ error: "That picture couldn't be loaded." }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_BYTES) {
      return new Response(JSON.stringify({ error: "That picture is too big." }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(bytes, {
      headers: { "content-type": type, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" },
    });
  }
}
