// A small, safe Markdown renderer for gift descriptions and person notes.
//
// Safety model: the whole input is HTML-escaped FIRST, so nothing the user typed can become a
// tag or attribute. Only the handful of tags this file emits (p, br, strong, em, code, ul, ol,
// li, a) ever appear in the output. Links are allowed only for http(s) and mailto, and always
// get rel="noopener noreferrer" target="_blank".
//
// Supported: **bold**, __bold__, *italics*, _italics_, `code`, [text](url), bare http(s) links,
// "- " / "* " / "+ " bullet lists, "1. " numbered lists, blank-line paragraphs, single-newline
// line breaks. "# Heading" lines render as a bold line.

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

function unescapeHtml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[e] ?? "");
}

/** Only http(s) and mailto links, with no whitespace or control characters. Returns the safe URL or null. */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  // eslint-disable-next-line no-control-regex
  if (!url || /[\s\u0000-\u001f\u007f]/.test(url)) return null;
  if (/^https?:\/\/[^/?#]/i.test(url)) return url;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(url)) return url;
  return null;
}

const anchor = (href: string, textHtml: string) =>
  `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${textHtml}</a>`;

/** Inline formatting on already-escaped text. */
function inline(escaped: string): string {
  const slots: string[] = [];
  const hold = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = escaped.replace(/\u0000/g, "");

  // `code` first: its contents are left alone.
  s = s.replace(/`([^`\n]+)`/g, (_, c: string) => hold(`<code>${c}</code>`));
  // [text](url)
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const href = safeHref(unescapeHtml(url));
    return href ? hold(anchor(href, emphasis(text))) : text;
  });
  // Bare links. Stop before escaped quotes/brackets; trailing punctuation stays outside.
  s = s.replace(/https?:\/\/(?:(?!&lt;|&gt;|&quot;|&#39;)[^\s\u0000])+/gi, (m: string) => {
    const trail = m.match(/[.,;:!?)]+$/)?.[0] ?? "";
    const core = trail ? m.slice(0, -trail.length) : m;
    const href = safeHref(unescapeHtml(core));
    return href ? hold(anchor(href, core)) + trail : m;
  });
  s = emphasis(s);
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => slots[Number(i)]);
}

function emphasis(s: string): string {
  return s
    .replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__(?=\S)([^_\n]*?\S)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/(^|[^*\w])\*(?=\S)([^*\n]*?\S)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, "$1<em>$2</em>");
}

const BULLET = /^\s{0,3}[-*+]\s+(.*)$/;
const NUMBER = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;

/** Markdown → a safe HTML string (see the header comment). Empty input gives "". */
export function renderMarkdown(src: string | null | undefined): string {
  if (!src || !src.trim()) return "";
  const lines = escapeHtml(src.replace(/\r\n?/g, "\n")).split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };

  for (const line of lines) {
    const b = line.match(BULLET);
    const n = b ? null : line.match(NUMBER);
    if (b || n) {
      flushPara();
      const tag = b ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((b ?? n)![1]);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    // An indented line right after a list item continues that item.
    if (list && /^\s{2,}\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    flushList();
    const h = line.match(HEADING);
    if (h) {
      flushPara();
      out.push(`<p><strong>${inline(h[1])}</strong></p>`);
      continue;
    }
    para.push(line);
  }
  flushPara();
  flushList();
  return out.join("");
}
