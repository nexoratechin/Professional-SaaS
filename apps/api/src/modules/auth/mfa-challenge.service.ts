import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { generateOpaqueToken, hashToken } from './token.util';
import type { RequestMeta } from './auth.service';

export type MfaRealm = 'TENANT' | 'PLATFORM';

export interface MfaChallengePayload {
  realm: MfaRealm;
  tenantId?: string;
  userId: string;
  isNewDevice: boolean;
  ipAddress?: string;
  userAgent?: string;
  attempts: number;
}

const CHALLENGE_TTL_SECONDS = 300;
export const MAX_CHALLENGE_ATTEMPTS = 5;

/**
 * Ephemeral, Redis-backed state for the password-verified-but-second-factor-pending step of
 * login — deliberately NOT a database row: it's short-lived (5 min), single-use, and needs a
 * per-challenge attempt counter that's cheap to mutate atomically. The challenge id is opaque
 * (same convention as refresh tokens) and only its hash is used as the Redis key, so a Redis
 * dump/log leak doesn't hand out live challenge tokens. Shared by both realms (tenant User and
 * PlatformUser) — the `realm` field is what MfaService/PlatformMfaService assert against so a
 * challenge minted for one can never be redeemed against the other.
 */
@Injectable()
export class MfaChallengeService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private key(challengeId: string): string {
    return `mfa-challenge:${hashToken(challengeId)}`;
  }

  async create(
    realm: MfaRealm,
    userId: string,
    meta: RequestMeta,
    options: { tenantId?: string; isNewDevice: boolean },
  ): Promise<string> {
    const challengeId = generateOpaqueToken();
    const payload: MfaChallengePayload = {
      realm,
      tenantId: options.tenantId,
      userId,
      isNewDevice: options.isNewDevice,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
      attempts: 0,
    };
    await this.redis.set(this.key(challengeId), JSON.stringify(payload), 'EX', CHALLENGE_TTL_SECONDS);
    return challengeId;
  }

  async get(challengeId: string): Promise<MfaChallengePayload | null> {
    const raw = await this.redis.get(this.key(challengeId));
    return raw ? (JSON.parse(raw) as MfaChallengePayload) : null;
  }

  /** Returns the attempt count after incrementing, or null if the challenge was invalidated
   * (attempts exhausted — caller must tell the user to log in again rather than retry). */
  async registerFailedAttempt(challengeId: string): Promise<number | null> {
    const payload = await this.get(challengeId);
    if (!payload) {
      return null;
    }
    const attempts = payload.attempts + 1;
    if (attempts >= MAX_CHALLENGE_ATTEMPTS) {
      await this.consume(challengeId);
      return null;
    }
    await this.redis.set(
      this.key(challengeId),
      JSON.stringify({ ...payload, attempts }),
      'EX',
      CHALLENGE_TTL_SECONDS,
    );
    return attempts;
  }

  async consume(challengeId: string): Promise<void> {
    await this.redis.del(this.key(challengeId));
  }
}
