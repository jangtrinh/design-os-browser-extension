import type { ReaderSiteId } from '../../../shared/reader-schema.js';

const PRIVATE_IPV4_RE = /^(127\.|10\.|192\.168\.|0\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/;
const PRIVATE_IPV6_RE = /^(::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80:)/i;

const SITE_ALLOWED_HOSTS: Record<ReaderSiteId, string[]> = {
  linkedin: ['www.linkedin.com', 'linkedin.com'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
  'youtube-studio': ['studio.youtube.com', 'www.youtube.com', 'youtube.com'],
  producthunt: ['www.producthunt.com', 'producthunt.com'],
  reddit: ['www.reddit.com', 'old.reddit.com', 'reddit.com'],
  threads: ['www.threads.com', 'www.threads.net', 'threads.com', 'threads.net'],
  facebook: ['www.facebook.com', 'm.facebook.com', 'facebook.com'],
  unikorn: ['unikorn.vn', 'www.unikorn.vn'],
  jobs: ['www.linkedin.com', 'linkedin.com', 'wellfound.com', 'www.wellfound.com', 'dribbble.com', 'www.dribbble.com'],
  generic: [],
};

export function hostMatchesAllowed(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((pattern) => {
    const p = pattern.toLowerCase();
    return h === p || h.endsWith(`.${p}`);
  });
}

export function isPrivateOrForbiddenHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (PRIVATE_IPV4_RE.test(h)) return true;
  if (PRIVATE_IPV6_RE.test(h)) return true;
  return false;
}

export function validateReaderTargetUrl(params: {
  site: ReaderSiteId;
  targetUrl: string;
  allowFixtureLoopback?: boolean;
  configuredAllowedHosts?: string[];
}): { ok: boolean; code?: string; message?: string } {
  let parsed: URL;
  try {
    parsed = new URL(params.targetUrl);
  } catch {
    return { ok: false, code: 'INVALID_TARGET_URL', message: `Malformed URL: ${params.targetUrl}` };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, code: 'BLOCKED_POLICY', message: `Protocol "${parsed.protocol}" is forbidden for readers.` };
  }

  const host = parsed.hostname.toLowerCase();
  const isFixtureLoopback =
    Boolean(params.allowFixtureLoopback) &&
    parsed.protocol === 'http:' &&
    host === '127.0.0.1' &&
    parsed.pathname.startsWith('/fixture/');

  if (isFixtureLoopback) {
    return { ok: true };
  }

  if (parsed.protocol === 'http:' || isPrivateOrForbiddenHost(host)) {
    return { ok: false, code: 'BLOCKED_POLICY', message: `Host "${host}" or insecure scheme rejected.` };
  }

  if (params.site === 'generic') {
    const allowList = params.configuredAllowedHosts ?? [];
    if (allowList.length > 0 && !hostMatchesAllowed(host, allowList)) {
      return { ok: false, code: 'BLOCKED_POLICY', message: `Host "${host}" is not in configured generic allowlist.` };
    }
    return { ok: true };
  }

  const extra = params.configuredAllowedHosts ?? [];
  const allowed = [...SITE_ALLOWED_HOSTS[params.site], ...extra];
  if (!hostMatchesAllowed(host, allowed)) {
    return { ok: false, code: 'BLOCKED_POLICY', message: `Host "${host}" is not allowed for adapter "${params.site}".` };
  }

  return { ok: true };
}
