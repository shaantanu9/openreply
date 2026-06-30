// Minimal, XSS-safe markdown renderer shared by Compose, Inbox, Queue, the
// article/post draft viewer, the chat assistant and any other surface that
// shows LLM-generated text that may contain markdown.
import { esc } from "./api.js";

export function renderMarkdown(md) {
  if (!md) return "";
  const lines = String(md).split("\n");
  const out = [];
  let inList = false;     // <ul>
  let inOl = false;       // <ol>
  let inQuote = false;
  let inCode = false;
  const closeBlocks = () => {
    if (inList) { out.push("</ul>"); inList = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
    if (inQuote) { out.push("</blockquote>"); inQuote = false; }
  };
  for (const line of lines) {
    if (line.startsWith("```")) {
      closeBlocks();
      if (!inCode) { out.push("<pre><code>"); inCode = true; }
      else { out.push("</code></pre>"); inCode = false; }
      continue;
    }
    if (inCode) { out.push(esc(line)); continue; }
    if (line.startsWith("### "))      { closeBlocks(); out.push(`<h3>${inlineMd(line.slice(4))}</h3>`); }
    else if (line.startsWith("## "))  { closeBlocks(); out.push(`<h2>${inlineMd(line.slice(3))}</h2>`); }
    else if (line.startsWith("# "))   { closeBlocks(); out.push(`<h1>${inlineMd(line.slice(2))}</h1>`); }
    else if (line.startsWith("> "))   { if (inList || inOl) closeBlocks(); if (!inQuote) { out.push("<blockquote>"); inQuote = true; } out.push(inlineMd(line.slice(2))); }
    else if (line.trim() === "---" || line.trim() === "***") { closeBlocks(); out.push("<hr/>"); }
    else if (line.match(/^\s*\d+\.\s/)) { if (inList || inQuote) closeBlocks(); if (!inOl) { out.push("<ol>"); inOl = true; } out.push(`<li>${inlineMd(line.replace(/^\s*\d+\.\s/, ""))}</li>`); }
    else if (line.match(/^\s*[-*•]\s/))  { if (inOl || inQuote) closeBlocks(); if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inlineMd(line.replace(/^\s*[-*•]\s/, ""))}</li>`); }
    else {
      closeBlocks();
      if (line.trim() === "") out.push("");
      else out.push(`<p>${inlineMd(line)}</p>`);
    }
  }
  closeBlocks();
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

export function inlineMd(s) {
  // SECURITY: this renders untrusted text (LLM output + collected posts/papers)
  // as HTML. Escape raw HTML FIRST so markdown source can't inject tags/attrs,
  // and allow only safe link schemes — otherwise `[x](javascript:…)` / a stray
  // `<img onerror>` would execute.
  return esc(s)
    // [text](url) links
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, href) => {
      const h = href.trim().toLowerCase();
      const safe = h.startsWith("https://") || h.startsWith("http://")
        || h.startsWith("asset://") || h.startsWith("mailto:");
      // href is already HTML-escaped by esc() above → attribute-safe.
      return safe ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : text;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    // Bare URLs — only when not already inside an href="…" (guarded by the
    // preceding char: links above produce `href="…"`, so http is preceded by a
    // quote, which is excluded here).
    .replace(/(^|[\s(])((?:https?|asset):\/\/[^\s<>"')]+)/g,
      (_m, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
}

/** Inline-only formatting for single-line / chat contexts: inline marks +
 *  `•` bullets, with newlines as <br> (no block <p>/<h1> wrapping). */
export function inlineMdMultiline(s) {
  if (!s) return "";
  return String(s)
    .split("\n")
    .map((line) => {
      const m = line.match(/^\s*[-*•]\s+(.*)$/);
      if (m) return `&nbsp;&nbsp;•&nbsp;${inlineMd(m[1])}`;
      return inlineMd(line);
    })
    .join("<br>");
}

/** Wrap rendered markdown in a styled, theme-aware container. */
export function mdWrap(html) {
  return `<div class="or-md">${html}</div>`;
}
