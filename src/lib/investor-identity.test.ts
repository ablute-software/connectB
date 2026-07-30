import { describe, expect, it } from 'vitest';
import { computeIdentityStatus } from './investor-identity';

describe('computeIdentityStatus', () => {
  it('self_declared_individual only applies when nothing else has verified them', () => {
    expect(computeIdentityStatus({
      selfDeclaredIndividual: true, domainVerified: false, entityVerificationStatus: null,
    })).toBe('self_declared_individual');
  });

  it('verified beats self_declared_individual — domain/entity/vouch proof outranks the self-declaration', () => {
    expect(computeIdentityStatus({
      selfDeclaredIndividual: true, domainVerified: true, entityVerificationStatus: 'verified',
    })).toBe('verified');
  });

  it('verified when domain matched, even if the entity itself is only pending', () => {
    expect(computeIdentityStatus({
      selfDeclaredIndividual: false, domainVerified: true, entityVerificationStatus: 'pending',
    })).toBe('verified');
  });

  it('verified when the entity is verified, even without a domain match', () => {
    expect(computeIdentityStatus({
      selfDeclaredIndividual: false, domainVerified: false, entityVerificationStatus: 'verified',
    })).toBe('verified');
  });

  it('pending_verification when neither signal is present', () => {
    expect(computeIdentityStatus({
      selfDeclaredIndividual: false, domainVerified: false, entityVerificationStatus: 'pending',
    })).toBe('pending_verification');
  });

  it('a rejected entity still reads as pending_verification, not a dead end', () => {
    expect(computeIdentityStatus({
      selfDeclaredIndividual: false, domainVerified: false, entityVerificationStatus: 'rejected',
    })).toBe('pending_verification');
  });

  it('two distinct-entity vouches upgrade a pending investor to verified', () => {
    expect(computeIdentityStatus({
      selfDeclaredIndividual: false, domainVerified: false, entityVerificationStatus: 'pending', distinctVoucherEntityCount: 2,
    })).toBe('verified');
  });

  it('one vouch is not enough (below VOUCH_THRESHOLD)', () => {
    expect(computeIdentityStatus({
      selfDeclaredIndividual: false, domainVerified: false, entityVerificationStatus: 'pending', distinctVoucherEntityCount: 1,
    })).toBe('pending_verification');
  });

  it('vouching can also upgrade a self-declared individual, per the prompt', () => {
    expect(computeIdentityStatus({
      selfDeclaredIndividual: true, domainVerified: false, entityVerificationStatus: null, distinctVoucherEntityCount: 2,
    })).toBe('verified');
  });
});
