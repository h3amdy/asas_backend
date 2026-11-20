/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PlatformRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { PLATFORM_AUTH_ERRORS } from '../../src/platform/auth/constants';
import { PlatformProfileService } from '../../src/platform/profile/platform-profile.service';
import { PlatformSessionsService } from '../../src/platform/sessions/platform-sessions.service';
import { PrismaService } from '../../src/prisma/prisma.service';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function resolvePgBinary(name: 'createdb' | 'dropdb'): string {
  const candidates = [
    `/usr/local/opt/libpq/bin/${name}`,
    `/opt/homebrew/opt/libpq/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return name;
}

function assertSafeTestDb(dbName: string): void {
  if (!/^asas_sec_own_01_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(`SAFETY: invalid test database name "${dbName}".`);
  }
}

describe('SEC-OWN-01 — Real PostgreSQL PlatformProfile & Session Revocation Integration', () => {
  jest.setTimeout(120_000);

  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  let prisma: PrismaService;
  let sessionsService: PlatformSessionsService;
  let profileService: PlatformProfileService;

  beforeAll(async () => {
    tempDbName = `asas_sec_own_01_pg_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    assertSafeTestDb(tempDbName);

    const dbUser = process.env.PGUSER || process.env.USER || 'postgres';
    tempDbUrl = `postgresql://${dbUser}@localhost:5432/${tempDbName}?connection_limit=10`;

    await execFileAsync(resolvePgBinary('createdb'), [
      '-h',
      'localhost',
      '-p',
      '5432',
      tempDbName,
    ]);
    dbCreated = true;

    await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: tempDbUrl },
    });

    prisma = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    await prisma.onModuleInit();

    const rows: Array<{ db: string }> = await prisma.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (rows[0]?.db !== tempDbName) {
      throw new Error(`Wrong DB connected: ${rows[0]?.db}`);
    }

    sessionsService = new PlatformSessionsService(prisma);
    profileService = new PlatformProfileService(prisma, sessionsService);
  });

  afterAll(async () => {
    try {
      if (prisma) await prisma.onModuleDestroy();
    } finally {
      if (dbCreated && tempDbName) {
        assertSafeTestDb(tempDbName);
        await execFileAsync(resolvePgBinary('dropdb'), [
          '-h',
          'localhost',
          '-p',
          '5432',
          '--if-exists',
          tempDbName,
        ]);
      }
    }
  });

  it('requires valid oldPassword, atomically revokes all active PlatformAuthSession rows, rejects old refresh tokens, and enforces isActive: true in PostgreSQL', async () => {
    const oldPassword = 'OldAdminPass#1';
    const newPassword = 'NewAdminPass#2';
    const oldHash = await bcrypt.hash(oldPassword, 10);

    const admin = await prisma.platformUser.create({
      data: {
        username: 'sec_own_01_admin',
        email: 'sec_own_01_admin@mafhooom.com',
        passwordHash: oldHash,
        name: 'مالك اختباري',
        role: PlatformRole.PLATFORM_ADMIN,
        isActive: true,
      },
    });

    const refresh1 = crypto.randomBytes(24).toString('hex');
    const refresh2 = crypto.randomBytes(24).toString('hex');
    const sess1 = await sessionsService.createSession({
      platformUserId: admin.id,
      refreshTokenPlain: refresh1,
    });
    const sess2 = await sessionsService.createSession({
      platformUserId: admin.id,
      refreshTokenPlain: refresh2,
    });

    // 1) Wrong oldPassword rejected without changing hash or revoking sessions
    await expect(
      profileService.changePassword(admin.uuid, {
        oldPassword: 'WrongOldPassword#9',
        newPassword,
      }),
    ).rejects.toThrow(
      new UnauthorizedException(PLATFORM_AUTH_ERRORS.WRONG_PASSWORD),
    );

    const sessionsBefore = await prisma.platformAuthSession.findMany({
      where: { platformUserId: admin.id },
    });
    expect(sessionsBefore).toHaveLength(2);
    expect(sessionsBefore.every((s) => s.revokedAt === null)).toBe(true);

    // 2) Valid password change updates passwordHash & revokes ALL active sessions atomically
    await profileService.changePassword(admin.uuid, {
      oldPassword,
      newPassword,
    });

    const updatedUser = await prisma.platformUser.findUnique({
      where: { id: admin.id },
    });
    expect(updatedUser).not.toBeNull();
    expect(await bcrypt.compare(newPassword, updatedUser!.passwordHash)).toBe(true);
    expect(await bcrypt.compare(oldPassword, updatedUser!.passwordHash)).toBe(false);

    const sessionsAfter = await prisma.platformAuthSession.findMany({
      where: { platformUserId: admin.id },
    });
    expect(sessionsAfter).toHaveLength(2);
    for (const s of sessionsAfter) {
      expect(s.revokedAt).not.toBeNull();
      expect(s.revokeReason).toBe('PASSWORD_CHANGED');
    }

    // 3) Previously valid refresh tokens from both sessions now fail with SESSION_REVOKED
    await expect(
      sessionsService.validateAndRotateRefresh({
        sessionUuid: sess1.uuid,
        refreshTokenPlain: refresh1,
      }),
    ).rejects.toThrow(
      new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_REVOKED),
    );
    await expect(
      sessionsService.validateAndRotateRefresh({
        sessionUuid: sess2.uuid,
        refreshTokenPlain: refresh2,
      }),
    ).rejects.toThrow(
      new ForbiddenException(PLATFORM_AUTH_ERRORS.SESSION_REVOKED),
    );

    // 4) Disabled account rejected across getProfile, updateProfile, and changePassword
    await prisma.platformUser.update({
      where: { id: admin.id },
      data: { isActive: false },
    });

    await expect(profileService.getProfile(admin.uuid)).rejects.toThrow(
      new NotFoundException(PLATFORM_AUTH_ERRORS.USER_NOT_FOUND),
    );
    await expect(
      profileService.updateProfile(admin.uuid, { name: 'اسم مرفوض' }),
    ).rejects.toThrow(
      new NotFoundException(PLATFORM_AUTH_ERRORS.USER_NOT_FOUND),
    );
    await expect(
      profileService.changePassword(admin.uuid, {
        oldPassword: newPassword,
        newPassword: 'AnotherPass#3',
      }),
    ).rejects.toThrow(
      new NotFoundException(PLATFORM_AUTH_ERRORS.USER_NOT_FOUND),
    );
  });
});
