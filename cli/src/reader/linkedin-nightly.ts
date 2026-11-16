import type { ReaderCaller } from '../../../shared/reader-schema.js';
import { readAnalytics } from '../../../extension/src/adapters/linkedin/aria-analytics.js';
import { registerCompositeReader } from './reader-registry.js';
import type { ReaderRuntime } from './reader-runtime.js';

/**
 * R1 (#13): Composite LinkedIn nightly analytics snapshot.
 * Reads `profile.self`, `analytics.content`, and `analytics.profile_views` using <= 4 page loads
 * and 0 input events. Never lets analytics `BLOCKED_PAYMENT` trigger Account Guard pause.
 */
export function registerLinkedInNightlyComposite(): void {
  registerCompositeReader(
    {
      site: 'linkedin',
      view: 'analytics.nightly_snapshot',
      description: 'Composite LinkedIn nightly snapshot across self profile, creator content analytics, and profile viewers (<= 4 loads).',
      requiredFields: ['followers', 'impressions'],
      freshnessClass: 'metrics',
      defaultMaxAgeS: 21_600,
      allowedHosts: ['www.linkedin.com', 'linkedin.com'],
    },
    async (runtime: ReaderRuntime, input: { params: Record<string, unknown>; caller: ReaderCaller }) => {
      const notes: string[] = ['Non-rendered chart totals reported null (accessibility tree only).'];
      const profileSlug = typeof input.params.public_id === 'string' ? input.params.public_id : 'jangtrinh';

      const profileEnv = await runtime.read({
        site: 'linkedin',
        view: 'profile.self',
        target: typeof input.params.profile_url === 'string' ? input.params.profile_url : `https://www.linkedin.com/in/${profileSlug}/`,
        params: { public_id: profileSlug },
        max_age_s: typeof input.params.max_age_s === 'number' ? input.params.max_age_s : undefined,
        evidence: 'off',
        caller: input.caller,
      });
      if (!profileEnv.ok) {
        return {
          ok: false,
          data: profileEnv.data,
          gate: profileEnv.gate,
          error_code: profileEnv.error_code ?? 'NIGHTLY_PROFILE_FAILED',
          notes: [...notes, ...profileEnv.notes],
        };
      }

      const contentEnv = await runtime.read({
        site: 'linkedin',
        view: 'analytics.content',
        target: typeof input.params.content_url === 'string' ? input.params.content_url : 'https://www.linkedin.com/analytics/creator/content/',
        max_age_s: typeof input.params.max_age_s === 'number' ? input.params.max_age_s : undefined,
        evidence: 'off',
        caller: input.caller,
      });
      if (contentEnv.gate === 'BLOCKED_PAYMENT') {
        notes.push('Creator analytics returned BLOCKED_PAYMENT; profile-only metrics kept without pausing guard.');
      }

      const viewersEnv = await runtime.read({
        site: 'linkedin',
        view: 'analytics.profile_views',
        target: typeof input.params.profile_views_url === 'string' ? input.params.profile_views_url : 'https://www.linkedin.com/analytics/profile-views/',
        max_age_s: typeof input.params.max_age_s === 'number' ? input.params.max_age_s : undefined,
        evidence: 'off',
        caller: input.caller,
      });
      if (viewersEnv.gate === 'BLOCKED_PAYMENT') {
        notes.push('Profile-views analytics returned BLOCKED_PAYMENT (Premium upsell); continuing without guard pause.');
      }

      const p = profileEnv.data as Record<string, unknown>;
      const c = contentEnv.ok ? (contentEnv.data as Record<string, unknown>) : {};
      const v = viewersEnv.ok ? (viewersEnv.data as Record<string, unknown>) : {};
      const cMetrics = (c.metrics as Record<string, unknown> | undefined) ?? {};

      const snapshotData = {
        period: String(cMetrics.postImpressionsPeriod ?? p.post_impressions_period ?? 'past_7_days'),
        followers: (p.followers as number | null) ?? null,
        followers_text: (p.followers_text as string | null) ?? null,
        connections: (p.connections as number | null) ?? null,
        connections_text: (p.connections_text as string | null) ?? null,
        connections_floor: Boolean(p.connections_floor),
        profile_views: (p.profile_views as number | null) ?? (cMetrics.profileViewers as number | null) ?? null,
        impressions: (p.post_impressions as number | null) ?? (cMetrics.postImpressions as number | null) ?? null,
        search_appearances: (p.search_appearances as number | null) ?? null,
        recruiter_views: (v.recruiter_views as number | null) ?? null,
        posts: Array.isArray(c.posts) ? c.posts : [],
        recent_viewers: Array.isArray(v.recent_viewers) ? v.recent_viewers : [],
        chart_totals: null,
      };

      const missingRequired: string[] = [];
      if (snapshotData.followers === null) missingRequired.push('followers');
      if (snapshotData.impressions === null) missingRequired.push('impressions');

      return {
        ok: true,
        data: snapshotData,
        missing_required: missingRequired,
        gate: viewersEnv.gate === 'BLOCKED_PAYMENT' || contentEnv.gate === 'BLOCKED_PAYMENT' ? 'BLOCKED_PAYMENT' : 'CLEAR',
        notes,
      };
    },
  );
  void readAnalytics;
}
