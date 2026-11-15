// POST /link-preview: fetches a product page and pulls out title, image, price and store.
// Security: only http(s) on ports 80/443 to public hostnames; every redirect hop is
// re-checked; 5 s timeout; at most 1 MB of the body is read.
//
// LIMITATION: hostnames are checked by name and IP literal only. Workers can't resolve DNS
// before fetching, so a public name that resolves to a private address (DNS rebinding) isn't
// caught here; Cloudflare's edge doesn't route Worker subrequests to private networks.
import { parsePriceToCents } from "./price";

export const PREVIEW_TIMEOUT_MS = 5000;
export const PREVIEW_MAX_BYTES = 1024 * 1024;
export const PREVIEW_MAX_REDIRECTS = 3;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface LinkPreview {
  title: string;
  imageUrl: string;
  priceCents: number | null;
  store: string;
  blocked?: true;
}

// ---------------------------------------------------------------- URL guard

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp"];

function ipv4ToInt(host: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function inV4(ip: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) >>> 0 === (b & mask) >>> 0;
}

/** Non-public IPv4 ranges: this-network, private, CGNAT, loopback, link-local, test-nets, multicast, reserved. */
const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateIPv4(host: string): boolean {
  const ip = ipv4ToInt(host);
  if (ip == null) return false;
  return V4_BLOCKED.some(([base, bits]) => inV4(ip, base, bits));
}

/** Expands an IPv6 literal (no brackets) to 8 hextets, or null if it isn't one. */
export function expandIPv6(host: string): number[] | null {
  let h = host.toLowerCase();
  const zone = h.indexOf("%");
  if (zone >= 0) h = h.slice(0, zone);
  if (!h.includes(":")) return null;
  // Trailing embedded IPv4 (::ffff:1.2.3.4).
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (v4) {
    const n = ipv4ToInt(v4[1]!);
    if (n == null) return null;
    h = h.slice(0, -v4[1]!.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = h.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string) => (s === "" ? [] : s.split(":"));
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const out: number[] = [];
  for (const part of all) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    out.push(parseInt(part, 16));
  }
  return out;
}

/**
 * Only global unicast IPv6 (2000::/3) is allowed, minus documentation (2001:db8::/32),
 * 6to4 (2002::/16) and Teredo (2001::/32) which can tunnel to private IPv4.
 * That excludes ::, ::1, IPv4-mapped/compatible, NAT64, ULA (fc00::/7), link-local (fe80::/10) and multicast.
 */
export function isPrivateIPv6(host: string): boolean {
  const h = expandIPv6(host);
  if (!h) return false;
  const first = h[0]!;
  if ((first & 0xe000) !== 0x2000) return true;
  if (first === 0x2001 && (h[1] === 0x0db8 || h[1] === 0)) return true;
  if (first === 0x2002) return true;
  return false;
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Validates a URL the server is about to fetch. Used for the initial URL and every redirect hop. */
export function checkFetchUrl(raw: string, base?: URL): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Only http and https URLs are allowed" };
  if (url.username || url.password) return { ok: false, reason: "URLs with credentials are not allowed" };
  if (url.port !== "" && url.port !== "80" && url.port !== "443") return { ok: false, reason: "Only ports 80 and 443 are allowed" };
  // WHATWG URL already lowercases and normalizes numeric IPv4 forms (0x7f.1, 2130706433) to dotted quads.
  let host = url.hostname.replace(/\.$/, "");
  if (!host) return { ok: false, reason: "Invalid URL" };
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
    if (isPrivateIPv6(host) || !expandIPv6(host)) return { ok: false, reason: "That address is not allowed" };
    return { ok: true, url };
  }
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "That address is not allowed" };
  }
  if (ipv4ToInt(host) != null) {
    if (isPrivateIPv4(host)) return { ok: false, reason: "That address is not allowed" };
    return { ok: true, url };
  }
  // A single-label name (e.g. "router", "intranet") would resolve via local search domains.
  if (!host.includes(".")) return { ok: false, reason: "That address is not allowed" };
  return { ok: true, url };
}

// ---------------------------------------------------------------- store name

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "ac", "gov", "edu", "ne", "or"]);

/** "www.target.com" -> "Target", "shop.lego.com" -> "Lego", "amazon.co.uk" -> "Amazon", "rei-outlet.com" -> "Rei Outlet". */
export function storeFromHostname(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, "").replace(/^www\d*\./, "").split(".").filter(Boolean);
  if (labels.length === 0 || ipv4ToInt(labels.join(".")) != null || hostname.includes(":")) return "";
  if (labels.length >= 2) labels.pop(); // TLD
  if (labels.length >= 2 && labels[labels.length - 1]!.length <= 3 && SECOND_LEVEL.has(labels[labels.length - 1]!)) {
    labels.pop(); // co.uk, com.au, ...
  }
  const name = labels[labels.length - 1] ?? "";
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------- HTML parsing

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  trade: "™",
  reg: "®",
  copy: "©",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  pound: "£",
  euro: "€",
  yen: "¥",
  cent: "¢",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}

function clean(s: string | null | undefined, max = 300): string {
  if (!s) return "";
  return decodeEntities(s).replace(/\s+/g, " ").trim().slice(0, max);
}

function absoluteHttpUrl(raw: string, base: string): string {
  if (!raw) return "";
  try {
    const u = new URL(decodeEntities(raw.trim()), base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    const s = u.toString();
    return s.length <= 2000 ? s : "";
  } catch {
    return "";
  }
}

interface JsonLdProduct {
  name: string;
  image: string;
  price: string | number | null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}

function hasType(o: Record<string, unknown>, type: string): boolean {
  return asArray(o["@type"]).some((t) => typeof t === "string" && t.toLowerCase() === type.toLowerCase());
}

function imageFromLd(v: unknown): string {
  for (const item of asArray(v)) {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const u = o.url ?? o.contentUrl ?? o["@id"];
      if (typeof u === "string") return u;
    }
  }
  return "";
}

function priceFromOffers(v: unknown, depth = 0): string | number | null {
  if (depth > 4) return null;
  for (const item of asArray(v)) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    for (const key of ["price", "lowPrice", "highPrice"]) {
      const p = o[key];
      if (typeof p === "number" || (typeof p === "string" && p.trim())) return p as string | number;
    }
    const nested = priceFromOffers(o.priceSpecification, depth + 1) ?? priceFromOffers(o.offers, depth + 1);
    if (nested != null) return nested;
  }
  return null;
}

/** Finds the first Product (or anything with offers) in JSON-LD, walking arrays and @graph. */
export function findJsonLdProduct(data: unknown): JsonLdProduct | null {
  const queue: unknown[] = [data];
  let fallback: JsonLdProduct | null = null;
  let seen = 0;
  while (queue.length && seen++ < 500) {
    const node = queue.shift();
    if (Array.isArray(node)) {
      queue.push(...node);
      continue;
    }
    if (!node || typeof node !== "object") continue;
    const o = node as Record<string, unknown>;
    const isProduct = hasType(o, "Product") || hasType(o, "ProductGroup");
    if (isProduct || o.offers) {
      const found: JsonLdProduct = {
        name: typeof o.name === "string" ? o.name : "",
        image: imageFromLd(o.image),
        price: priceFromOffers(o.offers) ?? priceFromOffers(o.hasVariant),
      };
      if (isProduct) return found;
      fallback ??= found;
    }
    for (const key of ["@graph", "mainEntity", "itemListElement", "item"]) {
      if (o[key]) queue.push(o[key]);
    }
  }
  return fallback;
}

export interface ParsedPage {
  title: string;
  imageUrl: string;
  priceCents: number | null;
  siteName: string;
  looksLikeCaptcha: boolean;
}

/** Extracts preview fields from an HTML string with HTMLRewriter. `pageUrl` resolves relative image URLs. */
export async function parseProductHtml(html: string, pageUrl: string): Promise<ParsedPage> {
  const meta = new Map<string, string>();
  const setMeta = (key: string, value: string | null) => {
    if (value && value.trim() && !meta.has(key)) meta.set(key, value);
  };
  let titleText = "";
  let titleDone = false;
  let inTitle = false;
  let itempropPrice: string | null = null;
  let itempropPriceText = "";
  let collectingPriceText = false;
  const ldScripts: string[] = [];
  let currentLd: string | null = null;

  const rewriter = new HTMLRewriter()
    .on("meta", {
      element(el) {
        const content = el.getAttribute("content");
        for (const attr of ["property", "name", "itemprop"]) {
          const k = el.getAttribute(attr);
          if (k) setMeta(`${attr === "itemprop" ? "itemprop:" : ""}${k.trim().toLowerCase()}`, content);
        }
      },
    })
    .on("title", {
      element(el) {
        if (titleDone) return;
        inTitle = true;
        el.onEndTag(() => {
          inTitle = false;
          titleDone = true;
        });
      },
      text(t) {
        if (inTitle && !titleDone) titleText += t.text;
      },
    })
    .on('[itemprop="price"]', {
      element(el) {
        if (itempropPrice != null || el.tagName === "meta") return;
        const content = el.getAttribute("content");
        if (content) {
          itempropPrice = content;
          return;
        }
        collectingPriceText = true;
        el.onEndTag(() => {
          collectingPriceText = false;
          if (itempropPriceText.trim()) itempropPrice = itempropPriceText;
        });
      },
      text(t) {
        if (collectingPriceText && itempropPriceText.length < 100) itempropPriceText += t.text;
      },
    })
    .on('script[type="application/ld+json" i]', {
      element(el) {
        currentLd = "";
        el.onEndTag(() => {
          if (currentLd != null) ldScripts.push(currentLd);
          currentLd = null;
        });
      },
      text(t) {
        if (currentLd != null && currentLd.length < 500_000) currentLd += t.text;
      },
    });

  await rewriter.transform(new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } })).arrayBuffer();

  let product: JsonLdProduct | null = null;
  for (const raw of ldScripts) {
    try {
      product = findJsonLdProduct(JSON.parse(raw.trim()));
    } catch {
      continue; // malformed JSON-LD is common; ignore it
    }
    if (product) break;
  }

  const title =
    clean(meta.get("og:title")) || clean(meta.get("twitter:title")) || clean(titleText) || clean(product?.name);
  const imageUrl =
    absoluteHttpUrl(meta.get("og:image:secure_url") ?? "", pageUrl) ||
    absoluteHttpUrl(meta.get("og:image") ?? "", pageUrl) ||
    absoluteHttpUrl(meta.get("og:image:url") ?? "", pageUrl) ||
    absoluteHttpUrl(meta.get("twitter:image") ?? meta.get("twitter:image:src") ?? "", pageUrl) ||
    absoluteHttpUrl(product?.image ?? "", pageUrl);

  const priceCandidates: (string | number | null | undefined)[] = [
    meta.get("product:price:amount"),
    meta.get("og:price:amount"),
    meta.get("itemprop:price"),
    itempropPrice,
    product?.price,
  ];
  let priceCents: number | null = null;
  for (const p of priceCandidates) {
    if (p == null || p === "") continue;
    priceCents = parsePriceToCents(typeof p === "string" ? decodeEntities(p) : p);
    if (priceCents != null) break;
  }

  const lowerTitle = titleText.toLowerCase();
  const looksLikeCaptcha =
    /captcha|robot check|are you a (human|robot)|access denied|attention required|just a moment|verify you are human|pardon our interruption/.test(
      lowerTitle,
    ) || /(g-recaptcha|h-captcha|hcaptcha|cf-chl-|px-captcha|captcha-delivery|\/errors\/validatecaptcha)/i.test(html.slice(0, 200_000));

  return { title, imageUrl, priceCents, siteName: clean(meta.get("og:site_name"), 100), looksLikeCaptcha };
}

// ---------------------------------------------------------------- fetching

/** Reads at most `max` bytes of a body as UTF-8 text, then cancels the stream. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < max) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, max - total);
      chunks.push(take === value.byteLength ? value : value.subarray(0, take));
      total += take;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

type Fetcher = (input: Request | string | URL, init?: RequestInit) => Promise<Response>;

function empty(store: string, blocked = false): LinkPreview {
  return { title: "", imageUrl: "", priceCents: null, store, ...(blocked ? { blocked: true as const } : {}) };
}

/**
 * Fetches `url` (already validated with checkFetchUrl) and builds the preview.
 * Never throws for remote failures; returns empty fields instead (store falls back to the hostname).
 */
export async function fetchLinkPreview(
  url: URL,
  { fetcher = fetch, timeoutMs = PREVIEW_TIMEOUT_MS }: { fetcher?: Fetcher; timeoutMs?: number } = {},
): Promise<LinkPreview> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  try {
    for (let hop = 0; ; hop++) {
      const res = await fetcher(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      const fallbackStore = storeFromHostname(current.hostname);
      if (res.status >= 300 && res.status < 400 && res.headers.has("Location")) {
        res.body?.cancel().catch(() => {});
        if (hop >= PREVIEW_MAX_REDIRECTS) return empty(fallbackStore);
        const next = checkFetchUrl(res.headers.get("Location")!, current);
        if (!next.ok) return empty(fallbackStore);
        current = next.url;
        continue;
      }
      if (res.status === 403 || res.status === 429 || res.status === 503) {
        res.body?.cancel().catch(() => {});
        return empty(fallbackStore, true);
      }
      if (!res.ok) {
        res.body?.cancel().catch(() => {});
        return empty(fallbackStore);
      }
      const type = (res.headers.get("Content-Type") ?? "").toLowerCase();
      if (type && !type.includes("html") && !type.includes("xml") && !type.startsWith("text/")) {
        res.body?.cancel().catch(() => {});
        return empty(fallbackStore);
      }
      const html = await readCapped(res.body, PREVIEW_MAX_BYTES);
      const page = await parseProductHtml(html, current.toString());
      const preview: LinkPreview = {
        title: page.looksLikeCaptcha ? "" : page.title.slice(0, 200),
        imageUrl: page.looksLikeCaptcha ? "" : page.imageUrl,
        priceCents: page.looksLikeCaptcha ? null : page.priceCents,
        store: page.siteName || fallbackStore,
      };
      if (page.looksLikeCaptcha) preview.blocked = true;
      return preview;
    }
  } catch {
    // Timeout, DNS failure, connection reset, ...
    return empty(storeFromHostname(current.hostname));
  }
}
