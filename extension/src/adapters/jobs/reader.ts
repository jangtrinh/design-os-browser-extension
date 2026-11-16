import { shortHash8 } from '../../../../shared/hash.js';
import type { CollectedPageSnapshot } from '../../../../shared/reader-schema.js';

export type JobBoard = 'linkedin' | 'wellfound' | 'dribbble' | 'unknown';

export interface JobItem {
  id: string;
  board: JobBoard;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  seniority: string | null;
  posted_at: string | null;
  url: string;
  salary: string | null;
  seen: boolean;
}

const SALARY_REGEX = /[$€£]\s*\d[\d,.]*[KkMm]?(?:\s*[-–]\s*[$€£]?\d[\d,.]*[KkMm]?)?(?:\s*\/\s*(?:yr|year|hr|mo|month))?/i;
const REMOTE_REGEX = /\b(remote|work from home|wfh|anywhere)\b/i;
const SENIORITY_REGEX = /\b(intern|junior|mid-level|mid|senior|staff|principal|lead|manager|director|head of|vp)\b/i;
const POSTED_REGEX = /\b(\d+\s+(?:hours?|days?|weeks?|months?)\s+ago|just now|today|yesterday)\b/i;

export function detectBoard(url: string): JobBoard {
  const lower = url.toLowerCase();
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('wellfound.com') || lower.includes('angel.co')) return 'wellfound';
  if (lower.includes('dribbble.com')) return 'dribbble';
  return 'unknown';
}

function extractJobIdAndUrl(rawHref: string, base: string, board: JobBoard): { id: string; url: string } | null {
  let fullUrl = rawHref;
  try { fullUrl = new URL(rawHref, base).href; } catch { /* keep raw */ }
  const linkedInM = fullUrl.match(/\/jobs\/view\/(\d+)/i);
  if (linkedInM) return { id: linkedInM[1], url: `https://www.linkedin.com/jobs/view/${linkedInM[1]}/` };
  const wellfoundM = fullUrl.match(/(?:wellfound\.com)?\/(?:jobs|company\/[^/]+\/jobs)\/([^/?#]+)/i);
  if (wellfoundM) return { id: wellfoundM[1], url: fullUrl };
  const dribbbleM = fullUrl.match(/(?:dribbble\.com)?\/jobs\/(\d+[^/?#]*)/i);
  if (dribbbleM) return { id: dribbbleM[1], url: fullUrl };
  const genericM = fullUrl.match(/\/jobs\/(?:view\/)?([a-zA-Z0-9_-]+)/i);
  return genericM ? { id: genericM[1], url: fullUrl } : null;
}

function extractMeta(text: string) {
  const salaryM = text.match(SALARY_REGEX);
  const seniorityM = text.match(SENIORITY_REGEX);
  const postedM = text.match(POSTED_REGEX);
  const remote = REMOTE_REGEX.test(text);
  const locM = text.match(/([A-Z][a-zA-Z\s]+,\s*[A-Z]{2}|Vietnam|United States|Singapore|Remote)/);
  return {
    salary: salaryM ? salaryM[0].trim() : null,
    seniority: seniorityM ? seniorityM[1].toLowerCase() : null,
    posted_at: postedM ? postedM[1] : null,
    remote,
    location: locM ? locM[1].trim() : remote ? 'Remote' : null,
  };
}

export function parseJobsSearchResults(
  snap: CollectedPageSnapshot,
  params: Record<string, unknown>
): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const board = detectBoard(snap.url || snap.finalUrl);
  const seenIds = new Set<string>(Array.isArray(params.seen_job_ids) ? params.seen_job_ids.map(String) : []);
  const seenUrls = new Set<string>(Array.isArray(params.seen_urls) ? params.seen_urls.map(String) : []);

  const candidates: Array<{ id: string; url: string; title: string; nodeIndex: number }> = [];
  const registeredIds = new Set<string>();

  for (let i = 0; i < snap.axNodes.length; i += 1) {
    const node = snap.axNodes[i];
    if (!node.href) continue;
    const parsed = extractJobIdAndUrl(node.href, snap.url, board);
    if (parsed && !registeredIds.has(parsed.id)) {
      registeredIds.add(parsed.id);
      candidates.push({ id: parsed.id, url: parsed.url, title: (node.name || node.text || '').replace(/\s+/g, ' ').trim(), nodeIndex: i });
    }
  }

  for (const link of snap.links) {
    const parsed = extractJobIdAndUrl(link.href, snap.url, board);
    if (parsed && !registeredIds.has(parsed.id)) {
      registeredIds.add(parsed.id);
      candidates.push({ id: parsed.id, url: parsed.url, title: link.text.trim(), nodeIndex: -1 });
    }
  }

  const items: JobItem[] = candidates.map((cand) => {
    const cardSnippets: string[] = cand.title ? [cand.title] : [];
    let company = '';

    if (cand.nodeIndex >= 0) {
      const start = Math.max(0, cand.nodeIndex - 3);
      const end = Math.min(snap.axNodes.length - 1, cand.nodeIndex + 7);
      for (let j = start; j <= end; j += 1) {
        const neighbor = snap.axNodes[j];
        if (neighbor.href && /company/i.test(neighbor.href) && !company) {
          company = (neighbor.name || neighbor.text || '').trim();
        }
        if (neighbor.name) cardSnippets.push(neighbor.name.trim());
        if (neighbor.text && neighbor.text !== neighbor.name) cardSnippets.push(neighbor.text.trim());
      }
    }

    const cardText = cardSnippets.join(' • ');
    if (!company) {
      const compM = cardText.match(/(?:at|@)\s+([A-Za-z0-9&.\-\s]{2,40})/i);
      company = compM ? compM[1].trim() : 'Unknown';
    }

    const meta = extractMeta(cardText);
    const seen = seenIds.has(cand.id) || seenUrls.has(cand.url) || seenUrls.has(cand.url.split('?')[0]);

    return {
      id: cand.id,
      board,
      title: cand.title || 'Job Opening',
      company,
      location: meta.location,
      remote: meta.remote,
      seniority: meta.seniority,
      posted_at: meta.posted_at,
      url: cand.url,
      salary: meta.salary,
      seen,
    };
  });

  return {
    data: { board, url: snap.finalUrl || snap.url, total_found: items.length, items },
    missing_required: [],
    notes: [],
  };
}

export function parseJobsDetail(
  snap: CollectedPageSnapshot,
  params: Record<string, unknown>
): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  const board = detectBoard(snap.url || snap.finalUrl);
  const parsedId = extractJobIdAndUrl(snap.url || snap.finalUrl, snap.url, board);
  const id = parsedId?.id ?? shortHash8(snap.url || snap.finalUrl);
  const title = snap.headings[0]?.trim() || snap.title.split(/[-–|]/)[0]?.trim() || '';

  const allText = [
    ...snap.headings,
    ...snap.axNodes.map((n) => (n.text ? `${n.name} ${n.text}` : n.name)),
    snap.bodySample,
  ].filter(Boolean).join('\n');

  let company = '';
  for (const n of snap.axNodes) {
    if (n.href && /company/i.test(n.href)) {
      company = (n.name || n.text || '').trim();
      if (company) break;
    }
  }
  if (!company) {
    const compM = snap.title.match(/(?:at|@)\s+([A-Za-z0-9&.\-\s]{2,40})/i);
    company = compM ? compM[1].trim() : 'Unknown';
  }

  const meta = extractMeta(title + ' ' + allText);
  const seenIds = new Set<string>(Array.isArray(params.seen_job_ids) ? params.seen_job_ids.map(String) : []);
  const seenUrls = new Set<string>(Array.isArray(params.seen_urls) ? params.seen_urls.map(String) : []);
  const url = snap.finalUrl || snap.url;
  const seen = seenIds.has(id) || seenUrls.has(url) || seenUrls.has(url.split('?')[0]);

  return {
    data: {
      id,
      board,
      title,
      company,
      location: meta.location,
      remote: meta.remote,
      seniority: meta.seniority,
      posted_at: meta.posted_at,
      url,
      salary: meta.salary,
      seen,
      description_preview: snap.bodySample.slice(0, 600),
    },
    missing_required: title ? [] : ['title'],
    notes: ['Read-only job detail; Easy Apply and form actions not invoked.'],
  };
}
