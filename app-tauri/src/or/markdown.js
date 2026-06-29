// Minimal, XSS-safe markdown renderer shared by Compose, Inbox, Queue and any
// other surface that shows LLM-generated text that may contain markdown.
import { esc } from "./api.js";

export function renderMarkdown(md) {
  if (!md) return "";
  const lines = md.split("\n");
  const out = [];
  let inList = false;
  let inQuote = false;
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      if (!inCode) { out.push("<pre><code>"); inCode = true; }
      else { out.push("</code></pre>"); inCode = false; }
      continue;
    }
    if (inCode) { out.push(esc(line)); continue; }
    if (line.startsWith("# "))        out.push(`<h1>${inlineMd(line.slice(2))}</h1>`);
    else if (line.startsWith("## "))  out.push(`<h2>${inlineMd(line.slice(3))}</h2>`);
    else if (line.startsWith("### ")) out.push(`<h3>${inlineMd(line.slice(4))}</h3>`);
    else if (line.startsWith("> "))   { if (!inQuote) { out.push("<blockquote>"); inQuote = true; } out.push(inlineMd(line.slice(2))); }
    else if (line.trim() === "---")   out.push("<hr/>");
    else if (line.match(/^[-*]\s/))   { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inlineMd(line.replace(/^[-*]\s/, ""))}</li>`); }
    else {
      if (inList) { out.push("</ul>"); inList = false; }
      if (inQuote) { out.push("</blockquote>"); inQuote = false; }
      if (line.trim() === "") out.push("");
      else out.push(`<p>${inlineMd(line)}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  if (inQuote) out.push("</blockquote>");
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
}

export function inlineMd(s) {
  // SECURITY: this renders untrusted text (LLM output + collected posts/papers)
  // as HTML. Escape raw HTML FIRST so markdown source can't inject tags/attrs,
  // and allow only safe link schemes — otherwise `[x](javascript:…)` / a stray
  // `<img onerror>` would execute.
  return esc(s)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, href) => {
      const h = href.trim().toLowerCase();
      const safe = h.startsWith("https://") || h.startsWith("http://")
        || h.startsWith("asset://") || h.startsWith("mailto:");
      // href is already HTML-escaped by esc() above → attribute-safe.
      return safe ? `<a href="${href}" target="_blank" rel="noopener">${text}</a>` : text;
    })
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

/** Wrap rendered markdown in a styled, theme-aware container. */
export function mdWrap(html) {
  return `<div class="or-md">${html}</div>`;
}
