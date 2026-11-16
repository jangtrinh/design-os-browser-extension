import { describe, expect, it } from 'vitest';
import {
  createPassiveEntityStore,
  ingestPassiveTap,
  mergeProfile,
} from '../extension/src/adapters/linkedin/entity-normalizer.js';
import type { LinkedInProfile } from '../shared/linkedin-schema.js';

describe('LinkedIn Zero-Drift Hybrid Normalizer', () => {
  it('normalizes passive Voyager included[] entities independently of queryId hashes', () => {
    const store = createPassiveEntityStore();

    // First tap simulates rotated GraphQL build hash A
    ingestPassiveTap(store, {
      status: 200,
      entities: [
        {
          $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
          entityUrn: 'urn:li:fsd_profile:ACoAA_ALICE',
          publicIdentifier: 'alice-architect',
          firstName: 'Alice',
          lastName: 'Nguyen',
          headline: 'Principal Systems Architect',
          followersCount: 9200,
          skills: ['TypeScript', 'WebExtensions'],
        },
      ],
    });

    // Second tap simulates rotated GraphQL build hash B overwriting enriched fields seamlessly
    ingestPassiveTap(store, {
      status: 200,
      entities: [
        {
          $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
          entityUrn: 'urn:li:fsd_profile:ACoAA_ALICE',
          publicIdentifier: 'alice-architect',
          summary: 'Building cross-browser agent bridges without queryId drift.',
          skills: ['Distributed Systems'],
        },
      ],
    });

    const domBase: LinkedInProfile = {
      publicIdentifier: 'alice-architect',
      url: 'https://www.linkedin.com/in/alice-architect/',
      fullName: 'Alice Nguyen',
      headline: 'Principal Systems Architect',
      experiences: [{ title: 'Principal Architect', company: 'DESIGN:OS' }],
      skills: ['Security'],
      source: 'dom',
      capturedAt: new Date().toISOString(),
    };

    const merged = mergeProfile(domBase, store.profiles.get('alice-architect'));
    expect(merged.source).toBe('hybrid');
    expect(merged.urn).toBe('urn:li:fsd_profile:ACoAA_ALICE');
    expect(merged.about).toContain('without queryId drift');
    expect(merged.followersCount).toBe(9200);
    expect(merged.skills).toEqual(['Security', 'Distributed Systems']);
    expect(merged.experiences).toHaveLength(1);
  });
});
