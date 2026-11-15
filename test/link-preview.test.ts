import { describe, expect, it } from "vitest";
import {
  checkFetchUrl,
  expandIPv6,
  fetchLinkPreview,
  findJsonLdProduct,
  parseProductHtml,
  PREVIEW_MAX_BYTES,
  readCapped,
  storeFromHostname,
} from "../src/worker/link-preview";

describe("URL guard", () => {
  const blocked = [
    "ftp://example.com/x",
    "javascript:alert(1)",
    "file:///etc/passwd",
    "not a url",
    "http://localhost/",
    "http://LOCALHOST./",
    "http://foo.localhost/",
    "http://printer.local/",
    "http://db.internal/",
    "http://router/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://0.0.0.0/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://100.64.0.1/",
    "http://100.127.255.255/",
    "http://224.0.0.1/",
    "http://[::1]/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[fc00::1]/",
    "http://[fd12:3456::1]/",
    "http://[fe80::1]/",
    "http://[ff02::1]/",
    "http://[64:ff9b::a00:1]/",
    "http://[2002:a00:1::]/",
    "http://example.com:8080/",
    "https://example.com:22/",
    "http://user:pass@example.com/",
  ];
  for (const url of blocked) {
    it(`blocks ${url}`, () => {
      expect(checkFetchUrl(url).ok).toBe(false);
    });
  }

  const allowed = [
    "https://www.target.com/p/lego/-/A-123",
    "http://example.com/",
    "http://example.com:80/",
    "https://example.com:443/x",
    "http://8.8.8.8/",
    "http://172.32.0.1/",
    "http://100.128.0.1/",
    "http://[2606:4700:4700::1111]/",
  ];
  for (const url of allowed) {
    it(`allows ${url}`, () => {
      expect(checkFetchUrl(url).ok).toBe(true);
    });
  }

  it("resolves relative redirects against the current URL", () => {
    const r = checkFetchUrl("/next?a=1", new URL("https://shop.example.com/start"));
    expect(r.ok && r.url.toString()).toBe("https://shop.example.com/next?a=1");
  });

  it("expands IPv6", () => {
    expect(expandIPv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIPv6("::ffff:1.2.3.4")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(expandIPv6("1:2:3:4:5:6:7:8:9")).toBeNull();
    expect(expandIPv6("example.com")).toBeNull();
  });
});

describe("store from hostname", () => {
  it("title-cases the main label", () => {
    expect(storeFromHostname("www.target.com")).toBe("Target");
    expect(storeFromHostname("shop.lego.com")).toBe("Lego");
    expect(storeFromHostname("www.amazon.co.uk")).toBe("Amazon");
    expect(storeFromHostname("rei-outlet.com")).toBe("Rei Outlet");
    expect(storeFromHostname("8.8.8.8")).toBe("");
  });
});

describe("HTML parser", () => {
  const base = "https://www.example-shop.com/products/socks";

  it("reads Open Graph and product meta tags", async () => {
    const html = `<!doctype html><html><head>
      <title>Ignored &mdash; Shop</title>
      <meta property="og:title" content="Fuzzy Socks &amp; Slippers">
      <meta property="og:image" content="/img/socks.jpg">
      <meta property="og:site_name" content="Example Shop">
      <meta property="product:price:amount" content="1,299.00">
    </head><body><svg><title>icon</title></svg></body></html>`;
    expect(await parseProductHtml(html, base)).toEqual({
      title: "Fuzzy Socks & Slippers",
      imageUrl: "https://www.example-shop.com/img/socks.jpg",
      priceCents: 129900,
      siteName: "Example Shop",
      looksLikeCaptcha: false,
    });
  });

  it("falls back to twitter:title, then <title>", async () => {
    expect((await parseProductHtml(`<meta name="twitter:title" content="Tw title"><title>T</title>`, base)).title).toBe("Tw title");
    expect((await parseProductHtml(`<html><head><title>\n  Plain   title </title></head></html>`, base)).title).toBe("Plain title");
  });

  it("reads itemprop=price from content or text", async () => {
    expect((await parseProductHtml(`<span itemprop="price" content="24.99">$24.99</span>`, base)).priceCents).toBe(2499);
    expect((await parseProductHtml(`<div><span itemprop="price">$ 7.50</span></div>`, base)).priceCents).toBe(750);
    expect((await parseProductHtml(`<meta itemprop="price" content="3.00">`, base)).priceCents).toBe(300);
  });

  it("reads JSON-LD Product offers, including @graph and arrays", async () => {
    const graph = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Shop" },
        { "@type": ["Product"], name: "LEGO Tree House", image: [{ url: "https://cdn.example.com/lego.png" }], offers: [{ "@type": "Offer", price: "199.99" }] },
      ],
    };
    const html = `<title>LEGO</title><script type="application/ld+json">{ not json</script>
      <script type="application/ld+json">${JSON.stringify(graph)}</script>`;
    const p = await parseProductHtml(html, base);
    expect(p.priceCents).toBe(19999);
    expect(p.imageUrl).toBe("https://cdn.example.com/lego.png");
    expect(p.title).toBe("LEGO");

    const arr = [{ "@type": "BreadcrumbList" }, { "@type": "Product", name: "Kite", offers: { "@type": "AggregateOffer", lowPrice: 12 } }];
    const p2 = await parseProductHtml(`<script type="application/ld+json">${JSON.stringify(arr)}</script>`, base);
    expect(p2).toMatchObject({ title: "Kite", priceCents: 1200 });

    expect(findJsonLdProduct({ "@type": "Product", offers: { priceSpecification: { price: 5 } } })?.price).toBe(5);
    expect(findJsonLdProduct({ "@type": "Article" })).toBeNull();
  });

  it("prefers meta prices over JSON-LD and ignores non-http images", async () => {
    const html = `<meta property="og:price:amount" content="10"><meta property="og:image" content="javascript:alert(1)">
      <script type="application/ld+json">{"@type":"Product","offers":{"price":"99"}}</script>`;
    expect(await parseProductHtml(html, base)).toMatchObject({ priceCents: 1000, imageUrl: "" });
  });

  it("returns empty fields for an empty page and detects captchas", async () => {
    expect(await parseProductHtml("", base)).toEqual({ title: "", imageUrl: "", priceCents: null, siteName: "", looksLikeCaptcha: false });
    expect((await parseProductHtml("<title>Robot Check</title>", base)).looksLikeCaptcha).toBe(true);
    expect((await parseProductHtml('<title>Hi</title><div class="g-recaptcha"></div>', base)).looksLikeCaptcha).toBe(true);
  });
});

describe("fetchLinkPreview (mocked fetch)", () => {
  const html = `<meta property="og:title" content="Bike"><meta property="og:price:amount" content="250">`;
  const url = (s: string) => {
    const r = checkFetchUrl(s);
    if (!r.ok) throw new Error(r.reason);
    return r.url;
  };

  it("follows allowed redirects manually and re-checks each hop", async () => {
    const calls: { url: string; redirect?: string }[] = [];
    const fetcher = async (u: any, init?: RequestInit) => {
      calls.push({ url: String(u), redirect: init?.redirect });
      if (String(u) === "https://a.example.com/") return new Response(null, { status: 301, headers: { Location: "https://www.bikes.com/p" } });
      return new Response(html, { headers: { "Content-Type": "text/html" } });
    };
    const p = await fetchLinkPreview(url("https://a.example.com/"), { fetcher });
    expect(p).toEqual({ title: "Bike", imageUrl: "", priceCents: 25000, store: "Bikes" });
    expect(calls).toEqual([
      { url: "https://a.example.com/", redirect: "manual" },
      { url: "https://www.bikes.com/p", redirect: "manual" },
    ]);
  });

  it("refuses a redirect to a private address", async () => {
    const calls: string[] = [];
    const fetcher = async (u: any) => {
      calls.push(String(u));
      return new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest" } });
    };
    const p = await fetchLinkPreview(url("https://evil.example.com/"), { fetcher });
    expect(p).toEqual({ title: "", imageUrl: "", priceCents: null, store: "Example" });
    expect(calls).toEqual(["https://evil.example.com/"]);
  });

  it("stops after 3 redirects", async () => {
    let n = 0;
    const fetcher = async () => new Response(null, { status: 302, headers: { Location: `/r${++n}` } });
    const p = await fetchLinkPreview(url("https://loop.example.com/"), { fetcher });
    expect(n).toBe(4); // the original request + 3 followed redirects
    expect(p.title).toBe("");
  });

  it("flags blocked sites", async () => {
    for (const status of [403, 503]) {
      const p = await fetchLinkPreview(url("https://www.amazon.com/dp/X"), { fetcher: async () => new Response("no", { status }) });
      expect(p).toEqual({ title: "", imageUrl: "", priceCents: null, store: "Amazon", blocked: true });
    }
    const captcha = await fetchLinkPreview(url("https://www.amazon.com/dp/X"), {
      fetcher: async () => new Response("<title>Amazon.com: Robot Check</title>", { headers: { "Content-Type": "text/html" } }),
    });
    expect(captcha).toEqual({ title: "", imageUrl: "", priceCents: null, store: "Amazon", blocked: true });
  });

  it("never throws on network errors, timeouts, or non-HTML", async () => {
    const err = await fetchLinkPreview(url("https://down.example.com/"), { fetcher: async () => { throw new TypeError("network"); } });
    expect(err).toEqual({ title: "", imageUrl: "", priceCents: null, store: "Example" });
    const slow = await fetchLinkPreview(url("https://slow.example.com/"), {
      timeoutMs: 20,
      fetcher: (_u, init) =>
        new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "TimeoutError")))),
    });
    expect(slow.title).toBe("");
    const pdf = await fetchLinkPreview(url("https://x.example.com/a.pdf"), {
      fetcher: async () => new Response("%PDF", { headers: { "Content-Type": "application/pdf" } }),
    });
    expect(pdf.title).toBe("");
    const notFound = await fetchLinkPreview(url("https://x.example.com/missing"), { fetcher: async () => new Response("", { status: 404 }) });
    expect(notFound.blocked).toBeUndefined();
  });

  it("reads at most 1 MB of the body", async () => {
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024).fill(97);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const text = await readCapped(stream, PREVIEW_MAX_BYTES);
    expect(text.length).toBe(PREVIEW_MAX_BYTES);
    expect(pulled).toBeLessThan(PREVIEW_MAX_BYTES + 4 * chunk.byteLength);
  });
});
