import { BadRequestException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';

/**
 * Shared by both the self-service change-password endpoint and the forgot/reset-password flow
 * (see PasswordResetService) — always goes through PlatformPrismaService with an explicit
 * tenantId, the same convention those two services already use, since it must work from both an
 * authenticated context and the public reset-password flow uniformly.
 */
@Injectable()
export class PasswordHistoryService {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  /** Throws if the candidate password matches the current hash or any of the last
   * `historyCount` replaced hashes. A historyCount of 0 only blocks reuse of the current
   * password. */
  async assertNotReused(
    tenantId: string,
    userId: string,
    newPassword: string,
    currentPasswordHash: string | null,
    historyCount: number,
  ): Promise<void> {
    if (currentPasswordHash && (await bcrypt.compare(newPassword, currentPasswordHash))) {
      throw new BadRequestException('New password must be different from your current password.');
    }
    if (historyCount <= 0) {
      return;
    }

    const history = await this.platformPrisma.client.passwordHistory.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      take: historyCount,
    });
    for (const entry of history) {
      if (await bcrypt.compare(newPassword, entry.passwordHash)) {
        throw new BadRequestException(`New password must not match any of your last ${historyCount} passwords.`);
      }
    }
  }

  /** Call AFTER the new hash has been committed to User.passwordHash — records the OLD
   * (replaced) hash and prunes anything beyond historyCount. */
  async recordAndPrune(tenantId: string, userId: string, replacedPasswordHash: string, historyCount: number): Promise<void> {
    await this.platformPrisma.client.passwordHistory.create({
      data: { tenantId, userId, passwordHash: replacedPasswordHash },
    });

    if (historyCount <= 0) {
      await this.platformPrisma.client.passwordHistory.deleteMany({ where: { tenantId, userId } });
      return;
    }

    const toKeep = await this.platformPrisma.client.passwordHistory.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      take: historyCount,
      select: { id: true },
    });
    await this.platformPrisma.client.passwordHistory.deleteMany({
      where: { tenantId, userId, id: { notIn: toKeep.map((row) => row.id) } },
    });
  }
}
