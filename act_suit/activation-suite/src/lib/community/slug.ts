// Produces URL-safe slugs for /explore/[slug] and /workspaces.
// Strips unicode, collapses non-alphanumerics to hyphens, lowercases.
// Appends a short random suffix on collision (caller handles the retry).

export function slugify(input: string, maxLen = 60): string {
  const cleaned = (input || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
  return cleaned || "untitled";
}

export function slugWithSuffix(base: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slugify(base)}-${suffix}`;
}
