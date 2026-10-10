import { createHash, createPublicKey, randomBytes, verify as cryptoVerify, type JsonWebKey } from 'crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { assertSafeOutboundUrl } from '@college-erp/integrations';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

/**
 * Minimal OIDC Relying-Party client built on Node's crypto + global fetch.
 *
 * Deliberately dependency-free: this repo already pins its supply chain tightly, and the OIDC
 * surface a single-IdP-at-a-time college ERP needs is small — discovery, an authorization-code +
 * PKCE exchange, and id_token signature/claim validation. Pulling in a full `openid-client`/`jose`
 * tree for that would add more transitive surface than the feature is worth. Discovery documents
 * and JWKS are cached in Redis (not the DB) so a provider rotating its keys/endpoints is picked up
 * with no migration and no restart.
 */

const HTTP_TIMEOUT_MS = 10_000;
const DISCOVERY_CACHE_TTL_SECONDS = 3600;
const JWKS_CACHE_TTL_SECONDS = 3600;

export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  id_token_signing_alg_values_supported?: string[];
}

export interface OidcIdTokenClaims {
  iss: string;
  aud: string | string[];
  sub: string;
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  [claim: string]: unknown;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

const SIGNING_ALGORITHMS: Record<string, string> = {
  RS256: 'RSA-SHA256',
  RS384: 'RSA-SHA384',
  RS512: 'RSA-SHA512',
  ES256: 'SHA256',
  ES384: 'SHA384',
  ES512: 'SHA512',
};

@Injectable()
export class OidcService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Random, URL-safe state / nonce / PKCE verifier (32 bytes => 43 base64url chars). */
  static randomToken(): string {
    return randomBytes(32).toString('base64url');
  }

  static generatePkce(): PkcePair {
    const verifier = OidcService.randomToken();
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge, method: 'S256' };
  }

  private static cacheKey(prefix: string, url: string): string {
    return `oidc:${prefix}:${createHash('sha256').update(url).digest('hex')}`;
  }

  /** Fetches (and caches) the OIDC discovery document for a provider. */
  async discover(issuer: string, discoveryUrl?: string | null): Promise<OidcDiscoveryDocument> {
    const url = discoveryUrl?.trim() || `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
    const cacheKey = OidcService.cacheKey('discovery', url);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as OidcDiscoveryDocument;
    }

    const response = await this.fetchJson<Partial<OidcDiscoveryDocument>>(url);
    if (
      !response.authorization_endpoint ||
      !response.token_endpoint ||
      !response.jwks_uri ||
      !response.issuer
    ) {
      throw new UnauthorizedException('Identity provider discovery document is missing required endpoints.');
    }
    const doc: OidcDiscoveryDocument = {
      issuer: String(response.issuer),
      authorization_endpoint: String(response.authorization_endpoint),
      token_endpoint: String(response.token_endpoint),
      jwks_uri: String(response.jwks_uri),
      id_token_signing_alg_values_supported: response.id_token_signing_alg_values_supported,
    };
    await this.redis.set(cacheKey, JSON.stringify(doc), 'EX', DISCOVERY_CACHE_TTL_SECONDS);
    return doc;
  }

  buildAuthorizationUrl(input: {
    authorizationEndpoint: string;
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state: string;
    nonce: string;
    codeChallenge: string;
  }): string {
    const url = new URL(input.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', input.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', (input.scopes.length > 0 ? input.scopes : ['openid', 'email', 'profile']).join(' '));
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /** Authorization-code + PKCE exchange. Returns the raw id_token (verified separately). */
  async exchangeCode(input: {
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
  }): Promise<{ idToken: string }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.codeVerifier,
    });

    const response = await this.httpFetch(input.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        // client_secret_post. Providers that require client_secret_basic would set this in the
        // discovery metadata; post is the most broadly supported default.
        Authorization: `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`).toString('base64')}`,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new UnauthorizedException('Identity provider rejected the authorization code exchange.');
    }
    const json = (await response.json()) as { id_token?: string };
    if (!json.id_token) {
      throw new UnauthorizedException('Identity provider did not return an id_token.');
    }
    return { idToken: json.id_token };
  }

  /**
   * Verifies an id_token end-to-end: signature against the provider JWKS selected by `kid`, then
   * issuer/audience/expiry/nonce claims. Any failure throws UnauthorizedException — callers map
   * that to a generic FAILED_SSO login event without leaking which check failed.
   */
  async verifyIdToken(
    idToken: string,
    input: { issuer: string; clientId: string; jwksUri: string; nonce?: string },
  ): Promise<OidcIdTokenClaims> {
    const parts = idToken.split('.');
    if (parts.length !== 3) {
      throw new UnauthorizedException('Malformed id_token.');
    }
    const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
    const header = this.decodeJson<{ alg?: string; kid?: string }>(headerB64);
    const payload = this.decodeJson<OidcIdTokenClaims>(payloadB64);

    const alg = header.alg ?? '';
    const nodeAlgorithm = SIGNING_ALGORITHMS[alg];
    if (!nodeAlgorithm) {
      // Reject "none" and anything we can't verify rather than trusting an unsigned token.
      throw new UnauthorizedException('Unsupported id_token signing algorithm.');
    }

    const jwks = await this.getJwks(input.jwksUri);
    const candidates = jwks.filter((key) => (header.kid ? key.kid === header.kid : true));
    const signingKey = candidates[0];
    if (!signingKey) {
      throw new UnauthorizedException('No matching signing key for id_token.');
    }

    const publicKey = createPublicKey({ key: signingKey as JsonWebKey, format: 'jwk' });
    const valid = cryptoVerify(
      nodeAlgorithm,
      Buffer.from(`${headerB64}.${payloadB64}`),
      publicKey,
      Buffer.from(signatureB64, 'base64url'),
    );
    if (!valid) {
      throw new UnauthorizedException('Invalid id_token signature.');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const leewaySeconds = 60;
    if (!Number.isFinite(payload.exp) || payload.exp + leewaySeconds < nowSeconds) {
      throw new UnauthorizedException('id_token is expired.');
    }
    if (payload.iat !== undefined && payload.iat - leewaySeconds > nowSeconds) {
      throw new UnauthorizedException('id_token issued in the future.');
    }
    if (payload.iss !== input.issuer) {
      throw new UnauthorizedException('id_token issuer mismatch.');
    }
    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audiences.includes(input.clientId)) {
      throw new UnauthorizedException('id_token audience mismatch.');
    }
    if (input.nonce !== undefined && payload.nonce !== input.nonce) {
      throw new UnauthorizedException('id_token nonce mismatch.');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new UnauthorizedException('id_token is missing a subject.');
    }
    return payload;
  }

  private async getJwks(jwksUri: string): Promise<Array<Record<string, unknown>>> {
    const cacheKey = OidcService.cacheKey('jwks', jwksUri);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as Array<Record<string, unknown>>;
    }
    const json = await this.fetchJson<{ keys?: Array<Record<string, unknown>> }>(jwksUri);
    if (!json.keys || json.keys.length === 0) {
      throw new UnauthorizedException('Identity provider returned an empty JWKS.');
    }
    await this.redis.set(cacheKey, JSON.stringify(json.keys), 'EX', JWKS_CACHE_TTL_SECONDS);
    return json.keys;
  }

  private decodeJson<T>(segment: string): T {
    try {
      return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
    } catch {
      throw new UnauthorizedException('Malformed id_token segment.');
    }
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await this.httpFetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (!response.ok) {
      throw new UnauthorizedException('Identity provider request failed.');
    }
    return (await response.json()) as T;
  }

  private async httpFetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    try {
      // issuer/discoveryUrl (and the endpoints they advertise) are tenant-configured: block SSRF
      // to internal services and never follow a redirect out of the validated host.
      await assertSafeOutboundUrl(url);
      return await fetch(url, { ...init, redirect: 'manual', signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'SsrfError') {
        throw new UnauthorizedException('The identity provider URL is not permitted.');
      }
      throw new UnauthorizedException('Could not reach the identity provider.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
