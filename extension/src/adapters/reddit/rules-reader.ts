import type { CollectedPageSnapshot } from '../../../../shared/reader-schema.js';

export function parseRedditSubredditRules(
  snap: CollectedPageSnapshot,
  params: Record<string, unknown>
): {
  data: Record<string, unknown>;
  missing_required: string[];
  notes: string[];
} {
  let subreddit = '';
  if (typeof params.subreddit === 'string') {
    subreddit = params.subreddit.replace(/^r\//i, '').trim();
  }
  if (!subreddit) {
    const subM = (snap.url || snap.finalUrl).match(/\/r\/([A-Za-z0-9_]+)/i);
    if (subM) subreddit = subM[1];
  }
  if (!subreddit) {
    for (const h of snap.headings) {
      const hm = h.match(/^r\/([A-Za-z0-9_]+)/i);
      if (hm) {
        subreddit = hm[1];
        break;
      }
    }
  }

  const allTexts = [
    ...snap.headings,
    ...snap.axNodes.map((n) => (n.text ? `${n.name} ${n.text}` : n.name)),
    snap.bodySample,
  ].filter(Boolean);
  const allText = allTexts.join('\n');

  // 1. Extract rules
  const rulesMap = new Map<number, { index: number; title: string; detail: string }>();

  for (const node of snap.axNodes) {
    const name = node.name.trim();
    const m = name.match(/^(?:rule\s*)?(\d+)[.:\-–\s]+(.+)$/i);
    if (m) {
      const idx = Number(m[1]);
      if (idx > 0 && idx <= 50 && !rulesMap.has(idx)) {
        const fullTitle = m[2].trim();
        const detail = (node.text && node.text !== name ? node.text : '').trim();
        rulesMap.set(idx, { index: idx, title: fullTitle, detail });
      }
    }
  }

  const lines = snap.bodySample.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const cleanLine = lines[i].replace(/^[*#>\s]+/, '').replace(/[*_~]+/g, '').trim();
    const m = cleanLine.match(/^(?:rule\s*)?(\d+)[.:\-–\s]+(.+)$/i);
    if (m) {
      const idx = Number(m[1]);
      if (idx > 0 && idx <= 50) {
        const titleCandidate = m[2].trim();
        let detail = '';
        if (i + 1 < lines.length && !lines[i + 1].match(/^(?:rule\s*)?\d+[.:\-–\s]+/i)) {
          detail = lines[i + 1].replace(/^[*#>\s]+/, '').trim();
        }
        if (!rulesMap.has(idx)) {
          rulesMap.set(idx, { index: idx, title: titleCandidate, detail });
        } else {
          const existing = rulesMap.get(idx)!;
          if (!existing.detail && detail) {
            existing.detail = detail;
          }
        }
      }
    }
  }

  const rules = Array.from(rulesMap.values()).sort((a, b) => a.index - b.index);

  // 2. Extract flairs
  const flairs = new Set<string>();
  let inFlairSection = false;
  for (const n of snap.axNodes) {
    const name = n.name.trim();
    if (/flair/i.test(name) && /filter|select|available|post flair/i.test(name)) {
      inFlairSection = true;
      continue;
    }
    if (inFlairSection) {
      if (n.role === 'heading') {
        inFlairSection = false;
      } else if (n.role === 'button' || n.role === 'listitem' || n.role === 'link') {
        if (name && name.length <= 40 && !/filter|search|all/i.test(name)) {
          flairs.add(name);
        }
      }
    }
    const bracketM = name.match(/\[([A-Za-z0-9_\s/-]{2,30})\]/);
    if (bracketM && !/removed|deleted|spoiler|nsfw/i.test(bracketM[1])) {
      flairs.add(bracketM[1].trim());
    }
  }

  for (const line of lines) {
    const fm = line.match(/(?:post\s+)?flair[s]?\s*[:\-–]\s*([^\n\r]+)/i);
    if (fm) {
      const parts = fm[1].split(/[,|•·;]/).map((s) => s.replace(/[[\]]/g, '').trim());
      for (const p of parts) {
        if (p && p.length >= 2 && p.length <= 35) flairs.add(p);
      }
    }
  }

  // 3. Flags and constraints
  const flairRequired = /flair\s*(?:is\s*)?required|must\s+(?:include|select|use|pick)\s+(?:a\s+)?(?:post\s+)?flair|posts without flair/i.test(allText);
  const noLinks = /no\s+(?:external\s+|direct\s+|outbound\s+)?links|text[- ]only\s+posts|links\s+are\s+not\s+allowed|link\s+posts\s+(?:are\s+)?banned/i.test(allText);
  const noSelfPromo = /no\s+self[- ]?promo(?:tion)?|no\s+(?:unsolicited\s+)?(?:promotion|advertising|marketing|shilling)|10%\s+self[- ]?promotion/i.test(allText);

  const karmaM = allText.match(
    /(?:minimum|at least|require[sd]?)\s+(\d[\d,]*)\s*(?:comment\s+|post\s+|combined\s+)?karma|(\d[\d,]*)\s*(?:comment\s+|post\s+|combined\s+)?karma\s+(?:required|minimum)/i
  );
  let minKarma: number | null = null;
  if (karmaM) {
    const raw = (karmaM[1] ?? karmaM[2]).replace(/,/g, '');
    const num = Number(raw);
    if (Number.isFinite(num)) minKarma = num;
  }

  const ageM = allText.match(
    /(?:account age|at least|older than)\s+(\d+)\s*(days?|weeks?|months?)/i
  );
  let minAccountAgeDays: number | null = null;
  if (ageM) {
    const val = Number(ageM[1]);
    const unit = ageM[2].toLowerCase();
    if (Number.isFinite(val)) {
      minAccountAgeDays = unit.startsWith('week') ? val * 7 : unit.startsWith('month') ? val * 30 : val;
    }
  }

  return {
    data: {
      subreddit,
      url: snap.finalUrl || snap.url,
      rules,
      flairs: Array.from(flairs).slice(0, 30),
      flair_required: flairRequired,
      no_links: noLinks,
      no_self_promo: noSelfPromo,
      min_karma: minKarma,
      min_account_age_days: minAccountAgeDays,
    },
    missing_required: subreddit ? [] : ['subreddit'],
    notes: [],
  };
}
