import type { CollectedPageSnapshot } from '../../../../shared/reader-schema.js';
import { parseCount } from '../linkedin/aria-nodes.js';

export interface ParsedViewOutput {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
  target_key?: string;
}

const TIER_NAMES = ['Free', 'Starter', 'Basic', 'Pro', 'Growth', 'Team', 'Business', 'Enterprise', 'Plus'] as const;
const TIER_REGEX = new RegExp(`\\b(${TIER_NAMES.join('|')})\\b`, 'i');
const PRICE_TOKEN_REGEX = /(?:[$€£₫]\s*\d[\d,.]*|\d[\d,.]*\s*(?:VND|đ|USD|EUR))(?:\/(?:mo|month|yr|year|seat))?|\bfree\b|\bcustom\b/i;
const NAV_BOILERPLATE = /^(nav|menu|skip to|home|about|contact|login|sign in|sign up|register|pricing|terms|privacy|cookie|careers|blog|docs|documentation|search|all rights reserved|copyright)\b/i;

export function parseGenericListingStatus(
  snap: CollectedPageSnapshot,
  params: Record<string, unknown>
): ParsedViewOutput {
  const productName = String(params.product_name ?? 'design:os').trim();
  const domain = typeof params.product_domain === 'string' ? params.product_domain.trim().toLowerCase() : '';
  const nameLower = productName.toLowerCase();
  const variants = [
    nameLower,
    'design:os',
    'design os',
    'design-os',
    nameLower.replace(/[:\-_]/g, ' '),
    nameLower.replace(/[:\s_]/g, '-'),
    nameLower.replace(/[:\s\-]/g, ''),
  ].filter(Boolean);

  const allTexts = [
    ...snap.headings,
    ...snap.axNodes.map((n) => (n.text ? `${n.name} ${n.text}` : n.name)),
    snap.bodySample,
  ].filter(Boolean);

  let listed = false;
  let matchedTitle: string | null = null;
  let matchedUrl: string | null = null;

  for (const l of snap.links) {
    const hrefLower = l.href.toLowerCase();
    const textLower = l.text.toLowerCase();
    if (
      (domain && hrefLower.includes(domain)) ||
      variants.some((v) => hrefLower.includes(v) || textLower.includes(v))
    ) {
      listed = true;
      matchedUrl = l.href;
      matchedTitle = l.text.trim() || null;
      break;
    }
  }

  if (!listed) {
    for (const t of allTexts) {
      const lower = t.toLowerCase();
      if ((domain && lower.includes(domain)) || variants.some((v) => lower.includes(v))) {
        listed = true;
        matchedTitle = t.slice(0, 100).trim();
        break;
      }
    }
  }

  const joined = allTexts.join('\n');
  const badgeM = joined.match(/\b(Featured|Verified|Top Product|Staff Pick)\b/i);
  const badge = badgeM ? badgeM[1] : null;

  const rankM = joined.match(/(?:^|\s|·)#\s*(\d+)\b|Rank\s*#?\s*(\d+)\b/i);
  const rank = rankM ? Number(rankM[1] ?? rankM[2]) : null;

  const votesM = joined.match(/(\d[\d,.]*[KkMm]?)\s*(?:upvotes?|votes?|likes?)\b/i);
  const votes = votesM ? (parseCount(votesM[1]) ?? null) : null;

  const preferJevRead = params.signed_in !== true;
  const notes: string[] = [];
  if (preferJevRead) {
    notes.push('Public listing page: prefer jev-read unless signed-in session is required (spec Q6).');
  }

  return {
    data: {
      product_name: productName,
      listed,
      title: matchedTitle || snap.title || snap.headings[0] || null,
      url: matchedUrl || snap.finalUrl || snap.url,
      badge,
      rank,
      votes,
      prefer_jev_read: preferJevRead,
    },
    missing_required: [],
    notes,
  };
}

export function parseGenericPageSnapshot(
  snap: CollectedPageSnapshot,
  params: Record<string, unknown>
): ParsedViewOutput {
  const preferJevRead = params.signed_in !== true;
  const notes: string[] = [];
  if (preferJevRead) {
    notes.push('Public page: prefer jev-read unless signed-in session is required (spec Q6).');
  }

  const rawLines = [
    ...snap.headings,
    ...snap.axNodes.map((n) => (n.text ? `${n.name} - ${n.text}` : n.name)),
    ...snap.bodySample.split(/\r?\n/),
  ].map((s) => s.trim()).filter(Boolean);

  const planMap = new Map<string, { plan: string; price_text: string }>();
  for (let i = 0; i < rawLines.length; i += 1) {
    const line = rawLines[i];
    const tierM = line.match(TIER_REGEX);
    if (!tierM) continue;

    const normalizedPlan = tierM[1].charAt(0).toUpperCase() + tierM[1].slice(1).toLowerCase();
    const key = normalizedPlan.toLowerCase();
    if (planMap.has(key)) continue;

    let priceM = line.match(PRICE_TOKEN_REGEX);
    if (!priceM && i + 1 < rawLines.length) {
      priceM = rawLines[i + 1].match(PRICE_TOKEN_REGEX);
    }
    if (priceM) {
      planMap.set(key, { plan: normalizedPlan, price_text: priceM[0].trim() });
    }
  }

  const pricingPlans = planMap.size > 0 ? Array.from(planMap.values()) : null;

  const featureCandidates: string[] = [];
  const seenFeatures = new Set<string>();
  for (const n of snap.axNodes) {
    if (n.role === 'listitem' || n.role === 'heading') {
      const txt = (n.text || n.name || '').trim();
      if (txt.length >= 4 && txt.length <= 140 && !NAV_BOILERPLATE.test(txt)) {
        const k = txt.toLowerCase();
        if (!seenFeatures.has(k)) {
          seenFeatures.add(k);
          featureCandidates.push(txt);
          if (featureCandidates.length >= 25) break;
        }
      }
    }
  }

  const uniqueLinks = Array.from(new Set(snap.links.map((l) => l.href))).slice(0, 200);

  return {
    data: {
      title: snap.title || snap.headings[0] || null,
      url: snap.finalUrl || snap.url,
      status: snap.status ?? null,
      headings: snap.headings,
      links: uniqueLinks,
      pricing_plans: pricingPlans,
      features: featureCandidates,
      prefer_jev_read: preferJevRead,
    },
    missing_required: [],
    notes,
  };
}
