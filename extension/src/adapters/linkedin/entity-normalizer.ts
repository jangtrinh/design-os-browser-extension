import type {
  LinkedInCompany,
  LinkedInExperienceItem,
  LinkedInJob,
  LinkedInPost,
  LinkedInProfile,
  LinkedInThread,
} from '../../../../shared/linkedin-schema.js';

export interface PassiveEntityStore {
  profiles: Map<string, Partial<LinkedInProfile>>;
  posts: Map<string, Partial<LinkedInPost>>;
  companies: Map<string, Partial<LinkedInCompany>>;
  jobs: Map<string, Partial<LinkedInJob>>;
  threads: Map<string, Partial<LinkedInThread>>;
  recentStatuses: number[];
  totalEntitiesIngested: number;
}

export function createPassiveEntityStore(): PassiveEntityStore {
  return {
    profiles: new Map(),
    posts: new Map(),
    companies: new Map(),
    jobs: new Map(),
    threads: new Map(),
    recentStatuses: [],
    totalEntitiesIngested: 0,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function extractUrnTail(urn: string | undefined): string | undefined {
  if (!urn) return undefined;
  const parts = urn.split(':');
  return parts[parts.length - 1] || undefined;
}

function parseProfileEntity(raw: Record<string, unknown>): Partial<LinkedInProfile> | null {
  const typeStr = asString(raw.$type) ?? '';
  const urn = asString(raw.entityUrn) ?? asString(raw.urn);
  const publicIdentifier = asString(raw.publicIdentifier);
  const hasName = asString(raw.firstName) || asString(raw.lastName) || asString(raw.fullName);

  if (
    !publicIdentifier &&
    !typeStr.toLowerCase().includes('profile') &&
    !(urn?.includes('fsd_profile') || urn?.includes('miniProfile'))
  ) {
    return null;
  }
  if (!hasName && !publicIdentifier && !asString(raw.headline)) {
    return null;
  }

  const firstName = asString(raw.firstName) ?? '';
  const lastName = asString(raw.lastName) ?? '';
  const fullName = asString(raw.fullName) ?? `${firstName} ${lastName}`.trim();
  const skills = Array.isArray(raw.skills)
    ? raw.skills.filter((s): s is string => typeof s === 'string')
    : [];

  const experiences: LinkedInExperienceItem[] = Array.isArray(raw.experiences)
    ? raw.experiences
        .filter((e): e is Record<string, unknown> => Boolean(e && typeof e === 'object'))
        .map((e) => ({
          title: asString(e.title) ?? '',
          company: asString(e.companyName) ?? asString(e.company) ?? '',
          dateRange: asString(e.dateRange),
          location: asString(e.location),
        }))
        .filter((e) => e.title || e.company)
    : [];

  return {
    ...(publicIdentifier ? { publicIdentifier } : {}),
    ...(urn ? { urn } : {}),
    ...(fullName ? { fullName } : {}),
    ...(asString(raw.headline) ?? asString(raw.occupation)
      ? { headline: asString(raw.headline) ?? asString(raw.occupation) }
      : {}),
    ...(asString(raw.locationName) ?? asString(raw.geoLocationName)
      ? { location: asString(raw.locationName) ?? asString(raw.geoLocationName) }
      : {}),
    ...(asString(raw.summary) ?? asString(raw.about)
      ? { about: asString(raw.summary) ?? asString(raw.about) }
      : {}),
    ...(asNumber(raw.followersCount) !== undefined ? { followersCount: asNumber(raw.followersCount) } : {}),
    ...(asString(raw.connectionsText) ? { connectionsText: asString(raw.connectionsText) } : {}),
    ...(experiences.length > 0 ? { experiences } : {}),
    ...(skills.length > 0 ? { skills } : {}),
  };
}

function parsePostEntity(raw: Record<string, unknown>): Partial<LinkedInPost> | null {
  const typeStr = asString(raw.$type) ?? '';
  const urn = asString(raw.entityUrn) ?? asString(raw.updateUrn) ?? asString(raw.urn);
  const textObj = raw.commentary as Record<string, unknown> | undefined;
  const commentaryText =
    asString(raw.text) ??
    asString(textObj?.text && typeof textObj.text === 'object' ? (textObj.text as Record<string, unknown>).text : textObj?.text);

  if (
    !typeStr.toLowerCase().includes('update') &&
    !typeStr.toLowerCase().includes('activity') &&
    !urn?.includes('activity') &&
    !commentaryText
  ) {
    return null;
  }
  if (!urn && !commentaryText) return null;

  const actor = raw.actor as Record<string, unknown> | undefined;
  const authorName =
    asString(raw.authorName) ??
    asString(actor?.name && typeof actor.name === 'object' ? (actor.name as Record<string, unknown>).text : actor?.name);
  const socialDetail = raw.socialDetail as Record<string, unknown> | undefined;
  const counts = (socialDetail?.totalSocialActivityCounts ?? raw.socialCounts) as Record<string, unknown> | undefined;

  return {
    ...(urn ? { postUrn: urn } : {}),
    ...(authorName ? { authorName } : {}),
    ...(asString(raw.authorHeadline) ? { authorHeadline: asString(raw.authorHeadline) } : {}),
    ...(commentaryText ? { text: commentaryText } : {}),
    ...(asNumber(counts?.numLikes ?? raw.reactionsCount) !== undefined
      ? { reactionsCount: asNumber(counts?.numLikes ?? raw.reactionsCount) }
      : {}),
    ...(asNumber(counts?.numComments ?? raw.commentsCount) !== undefined
      ? { commentsCount: asNumber(counts?.numComments ?? raw.commentsCount) }
      : {}),
    ...(asNumber(counts?.numShares ?? raw.repostsCount) !== undefined
      ? { repostsCount: asNumber(counts?.numShares ?? raw.repostsCount) }
      : {}),
  };
}

function parseCompanyEntity(raw: Record<string, unknown>): Partial<LinkedInCompany> | null {
  const typeStr = asString(raw.$type) ?? '';
  const urn = asString(raw.entityUrn);
  const slug = asString(raw.universalName) ?? asString(raw.slug);
  if (!slug && !typeStr.toLowerCase().includes('company') && !urn?.includes('fsd_company')) {
    return null;
  }
  const name = asString(raw.name);
  if (!name && !slug) return null;

  return {
    ...(slug ? { slug } : {}),
    ...(urn ? { urn } : {}),
    ...(name ? { name } : {}),
    ...(asString(raw.tagline) ? { tagline: asString(raw.tagline) } : {}),
    ...(asString(raw.industry) ?? asString(raw.industryName)
      ? { industry: asString(raw.industry) ?? asString(raw.industryName) }
      : {}),
    ...(asString(raw.staffCountRange) ?? asString(raw.sizeText)
      ? { sizeText: asString(raw.staffCountRange) ?? asString(raw.sizeText) }
      : {}),
    ...(asString(raw.description) ?? asString(raw.about)
      ? { about: asString(raw.description) ?? asString(raw.about) }
      : {}),
    ...(asString(raw.websiteUrl) ?? asString(raw.website)
      ? { website: asString(raw.websiteUrl) ?? asString(raw.website) }
      : {}),
    ...(asNumber(raw.followerCount ?? raw.followersCount) !== undefined
      ? { followersCount: asNumber(raw.followerCount ?? raw.followersCount) }
      : {}),
  };
}

function parseJobEntity(raw: Record<string, unknown>): Partial<LinkedInJob> | null {
  const typeStr = asString(raw.$type) ?? '';
  const urn = asString(raw.entityUrn) ?? asString(raw.jobPostingUrn);
  if (!typeStr.toLowerCase().includes('job') && !urn?.includes('jobPosting')) {
    return null;
  }
  const jobId = asString(raw.jobId) ?? extractUrnTail(urn);
  const title = asString(raw.title);
  if (!jobId && !title) return null;

  return {
    ...(jobId ? { jobId } : {}),
    ...(title ? { title } : {}),
    ...(asString(raw.companyName) ? { companyName: asString(raw.companyName) } : {}),
    ...(asString(raw.formattedLocation) ?? asString(raw.location)
      ? { location: asString(raw.formattedLocation) ?? asString(raw.location) }
      : {}),
    ...(asString(raw.workplaceType) ? { workplaceType: asString(raw.workplaceType) } : {}),
    ...(asString(raw.salaryText) ? { salaryText: asString(raw.salaryText) } : {}),
    ...(asString(raw.description) ? { description: asString(raw.description) } : {}),
  };
}

export function ingestPassiveTap(
  store: PassiveEntityStore,
  tap: { status?: number; entities?: Record<string, unknown>[] },
): void {
  if (typeof tap.status === 'number') {
    store.recentStatuses.push(tap.status);
    if (store.recentStatuses.length > 20) {
      store.recentStatuses.shift();
    }
  }
  for (const raw of tap.entities ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    store.totalEntitiesIngested += 1;

    const prof = parseProfileEntity(raw);
    if (prof) {
      const keys = [prof.publicIdentifier, prof.urn].filter((k): k is string => Boolean(k));
      for (const k of keys) {
        const prev = store.profiles.get(k) ?? {};
        store.profiles.set(k, { ...prev, ...prof });
      }
      continue;
    }

    const post = parsePostEntity(raw);
    if (post?.postUrn) {
      const prev = store.posts.get(post.postUrn) ?? {};
      store.posts.set(post.postUrn, { ...prev, ...post });
      continue;
    }

    const company = parseCompanyEntity(raw);
    if (company) {
      const keys = [company.slug, company.urn].filter((k): k is string => Boolean(k));
      for (const k of keys) {
        const prev = store.companies.get(k) ?? {};
        store.companies.set(k, { ...prev, ...company });
      }
      continue;
    }

    const job = parseJobEntity(raw);
    if (job?.jobId) {
      const prev = store.jobs.get(job.jobId) ?? {};
      store.jobs.set(job.jobId, { ...prev, ...job });
    }
  }
}

export function mergeProfile(
  dom: LinkedInProfile,
  passive?: Partial<LinkedInProfile>,
): LinkedInProfile {
  if (!passive) return dom;
  return {
    ...dom,
    urn: passive.urn ?? dom.urn,
    fullName: dom.fullName || passive.fullName || '',
    headline: dom.headline ?? passive.headline,
    location: dom.location ?? passive.location,
    about: passive.about && (!dom.about || passive.about.length > dom.about.length) ? passive.about : dom.about,
    connectionsText: passive.connectionsText ?? dom.connectionsText,
    followersCount: passive.followersCount ?? dom.followersCount,
    experiences: dom.experiences.length > 0 ? dom.experiences : (passive.experiences ?? []),
    skills: Array.from(new Set([...(dom.skills ?? []), ...(passive.skills ?? [])])),
    source: 'hybrid',
  };
}
