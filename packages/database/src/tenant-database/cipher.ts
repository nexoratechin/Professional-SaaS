/**
 * Reversible cipher for enterprise tenant connection URLs stored at rest
 * (`tenant_databases.connection_url_encrypted`).
 *
 * A connection URL embeds database credentials, so it is never stored in plaintext. AES-256-GCM
 * with a key from env `TENANT_DB_SECRET_KEY` (64 hex chars = 32 bytes), following the same rule
 * this repo applies to every credential class: a distinct key per class, so a leaked notification
 * or integration key can never decrypt a tenant's database credentials. The format matches
 * packages/integrations' IntegrationSecretCipher (`iv:authTag:ciphertext`, hex) so operators see
 * one consistent scheme.
 *
 * Lives in packages/database rather than a consumer so apps/api (encrypt on provision) and
 * apps/worker (decrypt to route) agree byte-for-byte.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export function assertTenantDatabaseSecretKey(secretKey: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(secretKey)) {
    throw new Error('TENANT_DB_SECRET_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(secretKey, 'hex');
}

export class TenantDatabaseSecretCipher {
  private readonly key: Buffer;

  constructor(secretKey: string) {
    this.key = assertTenantDatabaseSecretKey(secretKey);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  decrypt(payload: string): string {
    const [ivHex, authTagHex, ciphertextHex] = payload.split(':');
    if (!ivHex || !authTagHex || !ciphertextHex) {
      throw new Error('Malformed encrypted tenant database connection payload.');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
