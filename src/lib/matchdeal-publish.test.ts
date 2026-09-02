// Prompt 543 §A — the dead end, pinned so it cannot come back.
import { describe, it, expect } from 'vitest';
import {
  MATCHDEAL_STARTUP_REQUIREMENTS, matchdealPublishPayload, matchdealStartupState, orgMatchdealMissing,
} from './matchdeal-publish';
import type { Org } from './types';

const COMPLETE = {
  name: 'Sherlock Deal', logo_url: 'org/logo/x.png', website: 'sherlockdeal.com',
  sectors: ['SaaS', 'AI'], description: 'A disciplined investor-relations platform.',
  country: 'Portugal', stage: 'pre_seed', current_phase: 'prototype', one_liner: 'From pitch to close.',
} as unknown as Org;

describe('orgMatchdealMissing — the list that used to be an ellipsis', () => {
  it('is empty for an org that has everything a profile needs', () => {
    expect(orgMatchdealMissing(COMPLETE)).toEqual([]);
  });

  it('names every missing field, with the anchor to jump to it', () => {
    const missing = orgMatchdealMissing({} as Org);
    expect(missing.map((m) => m.label)).toEqual([
      'Logo', 'Website', 'Sector / vertical', 'Short description', 'HQ country', 'Stage', 'Current phase',
    ]);
    // The whole point of the anchors: the old banner offered no way to the
    // fields at all, only a link to an app that could not edit them.
    for (const m of missing) expect(m.fieldId).toMatch(/^(identity|round)\./);
  });

  it('accepts a one-liner as the description, same as computeProfilePrefill', () => {
    const org = { ...COMPLETE, description: null } as unknown as Org;
    expect(orgMatchdealMissing(org)).toEqual([]);
  });

  it('treats an empty sectors array as missing, not as present', () => {
    const org = { ...COMPLETE, sectors: [] } as unknown as Org;
    expect(orgMatchdealMissing(org).map((m) => m.label)).toEqual(['Sector / vertical']);
  });

  it('covers exactly the seven fields migration 0105 requires', () => {
    expect(MATCHDEAL_STARTUP_REQUIREMENTS.map((r) => r.profileColumn)).toEqual([
      'photo_url', 'website', 'sectors', 'description', 'country', 'investment_stage_sought', 'company_phase',
    ]);
  });
});

describe('matchdealStartupState', () => {
  const none = { orgMissing: [], ownerSuspended: false, platformSuspended: false };

  it('is unpublished when the org is ready but nothing has been published', () => {
    // This is the state every real founder was actually in, shown to them
    // as "Incomplete — not visible yet ... missing: …".
    expect(matchdealStartupState({ ...none, isComplete: false })).toBe('unpublished');
  });

  it('is incomplete only when something is genuinely missing', () => {
    expect(matchdealStartupState({
      ...none, isComplete: false, orgMissing: [{ label: 'Logo', fieldId: 'identity.logo' }],
    })).toBe('incomplete');
  });

  it('can never be incomplete with an empty list — that combination WAS the bug', () => {
    // "your MatchDeal profile is missing: …" came from exactly this: the
    // incomplete branch with nothing in the list.
    for (const isComplete of [true, false]) {
      const s = matchdealStartupState({ ...none, isComplete });
      expect(s === 'incomplete').toBe(false);
    }
  });

  it('is published once the trigger says the profile is complete', () => {
    expect(matchdealStartupState({ ...none, isComplete: true })).toBe('published');
  });

  it('reports suspension ahead of everything else', () => {
    // A suspended profile must not be sent off to fill in fields that are
    // already filled.
    expect(matchdealStartupState({ ...none, isComplete: true, ownerSuspended: true })).toBe('suspended');
    expect(matchdealStartupState({
      isComplete: false, ownerSuspended: false, platformSuspended: true,
      orgMissing: [{ label: 'Logo', fieldId: 'identity.logo' }],
    })).toBe('suspended');
  });
});

describe('matchdealPublishPayload', () => {
  it('copies the seven fields the trigger checks, plus the company name', () => {
    const p = matchdealPublishPayload(COMPLETE, 'https://signed/logo.png');
    expect(p).toEqual({
      photo_url: 'https://signed/logo.png',
      photo_storage_path: 'org/logo/x.png',
      website: 'sherlockdeal.com',
      sectors: ['SaaS', 'AI'],
      description: 'A disciplined investor-relations platform.',
      country: 'Portugal',
      investment_stage_sought: 'pre_seed',
      company_phase: 'prototype',
      entity_name: 'Sherlock Deal',
    });
  });

  it('falls back to the one-liner for the description', () => {
    const p = matchdealPublishPayload({ ...COMPLETE, description: '  ' } as unknown as Org, 'u');
    expect(p.description).toBe('From pitch to close.');
  });

  it('writes null rather than an empty string, so the trigger sees a real absence', () => {
    const p = matchdealPublishPayload({ sectors: [] } as unknown as Org, null);
    expect(p.photo_url).toBeNull();
    expect(p.website).toBeNull();
    expect(p.country).toBeNull();
    expect(p.description).toBeNull();
    expect(p.sectors).toEqual([]);
  });

  it('points photo_storage_path at the org logo rather than a copy of the file', () => {
    // The image was already magic-byte checked and VirusTotal-scanned by
    // IdentityCard's upload; re-uploading would create a second object to
    // keep in sync for no gain.
    expect(matchdealPublishPayload(COMPLETE, 'u').photo_storage_path).toBe(COMPLETE.logo_url);
  });
});
