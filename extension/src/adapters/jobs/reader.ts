import { shortHash8 } from '../../../../shared/hash.js';
import type { CollectedItemBlock, CollectedPageSnapshot } from '../../../../shared/reader-schema.js';

/** Job card blocks the collector returns as `snapshot.items` (Dribbble job board list items). */
export const JOB_CARD_SELECTOR = 'li.job-list-item';

/** Path segments under /jobs/ that are board pages, not postings. */
const RESERVED_JOB_SLUGS = /^(new|search|post|posts|hire|alerts?|saved|collections?|filters?|remote|locations?|categories|index)$/i;
/** Link texts that are calls to action, never a job title. */
const CTA_TITLE_RE = /^(view job|apply now|apply|easy apply|see job|learn more|view|details|save|post a (?:full-time )?job.*)$/i;

export type JobBoard = 'linkedin' | 'wellfound' | 'dribbble' | 'unknown';

export interface JobItem {
  id: string;
  board: JobBoard;
  title: string;
  company: string | null;
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
  const linkedInM = fullUrl.match(/\/jobs\/view\/(?:[^/?#]*-)?(\d+)/i);
  if (linkedInM) return { id: linkedInM[1], url: `https://www.linkedin.com/jobs/view/${linkedInM[1]}/` };
  // Dribbble postings are /jobs/<numeric id>-<slug>; /jobs/new is "Post a Full-Time Job".
  const dribbbleM = fullUrl.match(/dribbble\.com\/jobs\/(\d+)(-[^/?#]*)?/i);
  if (dribbbleM) return { id: dribbbleM[1], url: fullUrl.split(/[?#]/)[0] };
  if (board === 'dribbble' || board === 'linkedin') return null;
  const wellfoundM = fullUrl.match(/(?:wellfound\.com)?\/(?:jobs|company\/[^/]+\/jobs)\/([^/?#]+)/i);
  if (wellfoundM && !RESERVED_JOB_SLUGS.test(wellfoundM[1])) return { id: wellfoundM[1], url: fullUrl };
  const genericM = fullUrl.match(/\/jobs\/(?:view\/)?([a-zA-Z0-9_-]+)/i);
  return genericM && !RESERVED_JOB_SLUGS.test(genericM[1]) ? { id: genericM[1], url: fullUrl } : null;
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

/** Title from a posting URL slug, e.g. /jobs/310307-Product-Designer-Mobile-Apps. */
function titleFromSlug(url: string): string {
  const m = url.match(/\/jobs\/\d+-([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]).replace(/-/g, ' ').trim() : '';
}

function parseJobCard(block: CollectedItemBlock, base: string, board: JobBoard): { id: string; url: string; title: string; company: string | null; lines: string[] } | null {
  let parsed: { id: string; url: string } | null = null;
  for (const l of block.links) {
    parsed = extractJobIdAndUrl(l.href, base, board);
    if (parsed) break;
  }
  if (!parsed) return null;
  const lines = block.lines.filter((l) => !CTA_TITLE_RE.test(l) && !/^(view job\s*apply now)$/i.test(l));
  const title = block.heading && !CTA_TITLE_RE.test(block.heading) ? block.heading : titleFromSlug(parsed.url) || lines[1] || lines[0] || '';
  const titleAt = lines.indexOf(title);
  // Dribbble card: company line, then the h4 title, then location lines.
  const company = titleAt > 0 ? lines[titleAt - 1] : null;
  return { ...parsed, title, company, lines };
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

  const candidates: Array<{ id: string; url: string; title: string; nodeIndex: number; company?: string | null; cardLines?: string[] }> = [];
  const registeredIds = new Set<string>();

  // Job cards first: they carry title, company and location together.
  for (const block of snap.items ?? []) {
    const card = parseJobCard(block, snap.url, board);
    if (card && !registeredIds.has(card.id)) {
      registeredIds.add(card.id);
      candidates.push({ id: card.id, url: card.url, title: card.title, nodeIndex: -1, company: card.company, cardLines: card.lines });
    }
  }

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
    if (CTA_TITLE_RE.test(cand.title)) cand.title = titleFromSlug(cand.url);
    const cardSnippets: string[] = cand.title ? [cand.title] : [];
    if (cand.cardLines) cardSnippets.push(...cand.cardLines);
    let company = cand.company ?? '';

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
      company = compM ? compM[1].trim() : '';
    }

    const meta = extractMeta(cardText);
    const seen = seenIds.has(cand.id) || seenUrls.has(cand.url) || seenUrls.has(cand.url.split('?')[0]);

    return {
      id: cand.id,
      board,
      title: cand.title,
      company: company || null,
      location: meta.location,
      remote: meta.remote,
      seniority: meta.seniority,
      posted_at: meta.posted_at,
      url: cand.url,
      salary: meta.salary,
      seen,
    };
  });

  const notes: string[] = [];
  const untitled = items.filter((i) => !i.title).length;
  const noCompany = items.filter((i) => !i.company).length;
  if (items.length === 0) notes.push('No job postings rendered; an empty list is not a complete result.');
  if (untitled > 0) notes.push(`${untitled} posting(s) without a readable title.`);
  if (noCompany > 0) notes.push(`${noCompany} posting(s) without a readable company.`);

  return {
    data: { board, url: snap.finalUrl || snap.url, total_found: items.length, items },
    missing_required: [...(items.length === 0 ? ['items'] : []), ...(untitled > 0 ? ['title'] : [])],
    notes,
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
