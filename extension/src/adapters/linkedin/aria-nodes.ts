/**
 * Pure helpers over an accessibility-tree node list (role + accessible name + href).
 *
 * LinkedIn now renders most pages through server-driven UI (SDUI). Class names and
 * `data-test` hooks drift, and the old `/voyager/api/` JSON tap sees nothing, but the
 * accessible names stay stable because screen readers depend on them
 * (pilot 2026-11-16, docs/pilot/2026-11-16-linkedin-live/README.md).
 * Every reader in this adapter therefore works on `AxNode[]`, which is exactly what
 * `observe` returns, so the same fixtures drive unit tests and live pages.
 */

export interface AxNode {
  role: string;
  name: string;
  href?: string;
  /** Longer visible text for non-interactive nodes (role `text`, `comment`, `article`). */
  text?: string;
}

/** Parses "8,741", "1.2K", "3M", "500+" into a number (500+ -> 500). */
export function parseCount(raw: string | undefined | null): number | undefined {
  if (!raw) return undefined;
  const m = raw.replace(/\u00a0/g, ' ').match(/(\d[\d,.]*)\s*([KkMm])?\+?/);
  if (!m) return undefined;
  const base = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return undefined;
  const unit = m[2]?.toUpperCase();
  const scaled = unit === 'K' ? base * 1_000 : unit === 'M' ? base * 1_000_000 : base;
  return Math.round(scaled);
}

/** Returns the count when `name` matches `<number> <label>` at the start (e.g. "8,741 followers"). */
export function countBefore(name: string, label: RegExp): number | undefined {
  const m = name.match(new RegExp(`^\\s*(\\d[\\d,.]*[KkMm]?\\+?)\\s*${label.source}`, 'i'));
  return m ? parseCount(m[1]) : undefined;
}

/** Returns the count when `name` is `<Label><number>` (e.g. "Profile viewers638"). */
export function countAfter(name: string, label: RegExp): number | undefined {
  const m = name.match(new RegExp(`^\\s*${label.source}\\s*(\\d[\\d,.]*[KkMm]?\\+?)\\s*$`, 'i'));
  return m ? parseCount(m[1]) : undefined;
}

/** First non-undefined result of `fn` over the nodes. */
export function firstMatch<T>(nodes: AxNode[], fn: (n: AxNode) => T | undefined): T | undefined {
  for (const n of nodes) {
    const v = fn(n);
    if (v !== undefined) return v;
  }
  return undefined;
}

export function absoluteUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).href;
  } catch {
    return undefined;
  }
}

/** `/in/<slug>/` -> slug, else undefined. */
export function profileSlugFromHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  const m = href.match(/\/in\/([^/?#]+)\/?(?:[?#]|$|en\/?$)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

/** Extracts `urn:li:<kind>:<id>` from a path or query value. */
export function urnFromHref(href: string | undefined, kinds = 'activity|share|ugcPost'): string | undefined {
  if (!href) return undefined;
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // keep raw
  }
  const m = decoded.match(new RegExp(`urn:li:(?:${kinds}):\\d+`));
  return m ? m[0] : undefined;
}

const CHROME_NAMES = [
  /notifications?$/i,
  /^skip to /i,
  /^close jump menu$/i,
  /^search$/i,
  /^(me|for business|premium|more)$/i,
];

/** Drops global navigation chrome so readers only see page content. */
export function contentNodes(nodes: AxNode[]): AxNode[] {
  return nodes.filter((n) => !CHROME_NAMES.some((re) => re.test(n.name)));
}

/** Splits the node list into segments that start at each heading named `heading`. */
export function segmentsByHeading(nodes: AxNode[], heading: RegExp): AxNode[][] {
  const out: AxNode[][] = [];
  let current: AxNode[] | null = null;
  for (const n of nodes) {
    if (n.role === 'heading' && heading.test(n.name)) {
      current = [];
      out.push(current);
      continue;
    }
    current?.push(n);
  }
  return out;
}

/** "Jang Trinh • You" / "Jane Doe • 2nd" -> "Jane Doe". */
export function stripDegree(name: string): string {
  return name.replace(/\s*[•·]\s*(you|1st|2nd|3rd\+?|following|author)\b.*$/i, '').trim();
}
