import {
  ExecutionContext,
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import * as fs from 'node:fs';
import * as path from 'node:path';
import request from 'supertest';
import { PlatformJwtAuthGuard } from '../../platform/auth/guards/platform-jwt-auth.guard';
import { PLATFORM_AUTH_ERRORS } from '../../platform/auth/constants';
import { PlatformProfileController } from '../../platform/profile/platform-profile.controller';
import { PlatformProfileService } from '../../platform/profile/platform-profile.service';
import { PlatformSessionsService } from '../../platform/sessions/platform-sessions.service';
import { PrismaService } from '../../prisma/prisma.service';

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

describe('SEC-OWN-01 — Owner Profile & Password Hardening + Legacy Removal', () => {
  describe('Dead vulnerable legacy OwnerModule files removed', () => {
    it('confirms legacy owner.module/controller/service/update-owner.dto are deleted and not referenced in app.module.ts', () => {
      const legacyPaths = [
        'src/owner/owner.module.ts',
        'src/owner/owner.controller.ts',
        'src/owner/owner.service.ts',
        'src/owner/dto/update-owner.dto.ts',
      ];
      for (const relPath of legacyPaths) {
        expect(fs.existsSync(path.join(PROJECT_ROOT, relPath))).toBe(false);
      }
      const appModuleSrc = fs.readFileSync(
        path.join(PROJECT_ROOT, 'src/app.module.ts'),
        'utf8',
      );
      expect(appModuleSrc).not.toContain('OwnerModule');
    });
  });

  describe('PlatformProfileController & PlatformProfileService HTTP security', () => {
    let app: INestApplication;
    let currentHash: string;
    let txUpdateMock: jest.Mock;
    let txSessionUpdateManyMock: jest.Mock;
    let prismaMock: any;

    beforeAll(async () => {
      currentHash = await bcrypt.hash('CurrentStrongPass#1', 10);
      txUpdateMock = jest.fn().mockResolvedValue({ id: 1 });
      txSessionUpdateManyMock = jest.fn().mockResolvedValue({ count: 2 });

      prismaMock = {
        platformUser: {
          findFirst: jest.fn(({ where }: any) => {
            if (where?.uuid === 'admin-uuid-1' && where?.isActive === true) {
              return Promise.resolve({
                id: 1,
                uuid: 'admin-uuid-1',
                username: 'owner',
                email: 'owner@mafhooom.com',
                name: 'مالك النظام',
                displayName: 'مالك النظام',
                phone: '+967770000001',
                role: 'PLATFORM_ADMIN',
                isActive: true,
                passwordHash: currentHash,
                assignedSubjects: [],
              });
            }
            return Promise.resolve(null);
          }),
          update: jest.fn().mockResolvedValue({
            uuid: 'admin-uuid-1',
            username: 'owner',
            email: 'owner@mafhooom.com',
            name: 'مالك النظام',
            displayName: 'مالك النظام',
            phone: '+967770000001',
            role: 'PLATFORM_ADMIN',
            isActive: true,
          }),
        },
        platformAuthSession: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        $transaction: jest.fn((cb: any) =>
          cb({
            platformUser: { update: txUpdateMock },
            platformAuthSession: { updateMany: txSessionUpdateManyMock },
          }),
        ),
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          ThrottlerModule.forRoot([
            { name: 'short', ttl: 60000, limit: 5 },
            { name: 'long', ttl: 3600000, limit: 20 },
          ]),
        ],
        controllers: [PlatformProfileController],
        providers: [
          PlatformProfileService,
          PlatformSessionsService,
          { provide: PrismaService, useValue: prismaMock },
        ],
      })
        .overrideGuard(PlatformJwtAuthGuard)
        .useValue({
          canActivate: (ctx: ExecutionContext) => {
            const req = ctx.switchToHttp().getRequest<any>();
            const auth = req.headers?.authorization as string | undefined;
            if (!auth || !auth.startsWith('Bearer ')) {
              throw new UnauthorizedException();
            }
            const token = auth.slice(7);
            if (token === 'active-token') {
              req.user = { sub: 'admin-uuid-1', role: 'PLATFORM_ADMIN' };
              return true;
            }
            if (token === 'inactive-token') {
              req.user = { sub: 'inactive-uuid-1', role: 'PLATFORM_ADMIN' };
              return true;
            }
            throw new UnauthorizedException();
          },
        })
        .compile();

      app = moduleRef.createNestApplication();
      app.getHttpAdapter().getInstance().set('trust proxy', true);
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      await app.init();
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    afterAll(async () => {
      await app.close();
    });

    it('rejects unauthenticated PATCH /platform/profile/password with 401', async () => {
      await request(app.getHttpServer())
        .patch('/platform/profile/password')
        .set('X-Forwarded-For', '10.10.2.1')
        .send({
          oldPassword: 'CurrentStrongPass#1',
          newPassword: 'NewStrongPass#2',
        })
        .expect(401);
    });

    it('rejects missing oldPassword and >72 char newPassword with 400', async () => {
      await request(app.getHttpServer())
        .patch('/platform/profile/password')
        .set('Authorization', 'Bearer active-token')
        .set('X-Forwarded-For', '10.10.2.2')
        .send({ newPassword: 'NewStrongPass#2' })
        .expect(400);

      await request(app.getHttpServer())
        .patch('/platform/profile/password')
        .set('Authorization', 'Bearer active-token')
        .set('X-Forwarded-For', '10.10.2.2')
        .send({
          oldPassword: 'CurrentStrongPass#1',
          newPassword: 'A'.repeat(73),
        })
        .expect(400);

      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('rejects wrong oldPassword with 401 WRONG_PASSWORD without updating hash or revoking sessions', async () => {
      const res = await request(app.getHttpServer())
        .patch('/platform/profile/password')
        .set('Authorization', 'Bearer active-token')
        .set('X-Forwarded-For', '10.10.2.3')
        .send({
          oldPassword: 'WrongPassword#999',
          newPassword: 'NewStrongPass#2',
        })
        .expect(401);

      expect(res.body.message).toBe(PLATFORM_AUTH_ERRORS.WRONG_PASSWORD);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(txUpdateMock).not.toHaveBeenCalled();
      expect(txSessionUpdateManyMock).not.toHaveBeenCalled();
    });

    it('blocks non-whitelisted fields (email, newPassword, role) in PATCH /platform/profile with 400', async () => {
      for (const payload of [
        { email: 'attacker@evil.com' },
        { newPassword: 'HackedPassword123' },
        { role: 'PLATFORM_ADMIN', isActive: true },
      ]) {
        await request(app.getHttpServer())
          .patch('/platform/profile')
          .set('Authorization', 'Bearer active-token')
          .set('X-Forwarded-For', '10.10.2.4')
          .send(payload)
          .expect(400);
      }

      expect(prismaMock.platformUser.update).not.toHaveBeenCalled();
    });

    it('enforces isActive: true across GET /platform/profile, PATCH /platform/profile, and PATCH /platform/profile/password', async () => {
      await request(app.getHttpServer())
        .get('/platform/profile')
        .set('Authorization', 'Bearer inactive-token')
        .set('X-Forwarded-For', '10.10.2.5')
        .expect(404);

      expect(prismaMock.platformUser.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { uuid: 'inactive-uuid-1', isActive: true, isDeleted: false },
        }),
      );

      await request(app.getHttpServer())
        .patch('/platform/profile')
        .set('Authorization', 'Bearer inactive-token')
        .set('X-Forwarded-For', '10.10.2.5')
        .send({ name: 'محاولة تعديل' })
        .expect(404);

      expect(prismaMock.platformUser.findFirst).toHaveBeenLastCalledWith({
        where: { uuid: 'inactive-uuid-1', isActive: true, isDeleted: false },
      });

      await request(app.getHttpServer())
        .patch('/platform/profile/password')
        .set('Authorization', 'Bearer inactive-token')
        .set('X-Forwarded-For', '10.10.2.5')
        .send({
          oldPassword: 'CurrentStrongPass#1',
          newPassword: 'NewStrongPass#2',
        })
        .expect(404);

      expect(prismaMock.platformUser.findFirst).toHaveBeenLastCalledWith({
        where: { uuid: 'inactive-uuid-1', isActive: true, isDeleted: false },
      });
    });

    it('atomically updates passwordHash and revokes all sessions inside $transaction on valid password change', async () => {
      await request(app.getHttpServer())
        .patch('/platform/profile/password')
        .set('Authorization', 'Bearer active-token')
        .set('X-Forwarded-For', '10.10.2.6')
        .send({
          oldPassword: 'CurrentStrongPass#1',
          newPassword: 'NewStrongPass#2',
        })
        .expect(200);

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(txUpdateMock).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { passwordHash: expect.stringMatching(/^\$2[aby]\$/) },
      });
      expect(txSessionUpdateManyMock).toHaveBeenCalledWith({
        where: { platformUserId: 1, revokedAt: null },
        data: {
          revokedAt: expect.any(Date),
          revokeReason: 'PASSWORD_CHANGED',
        },
      });
      expect(prismaMock.platformAuthSession.updateMany).not.toHaveBeenCalled();
    });

    it('throttles PATCH /platform/profile/password after 5 requests per minute per IP with 429', async () => {
      for (let i = 0; i < 5; i++) {
        await request(app.getHttpServer())
          .patch('/platform/profile/password')
          .set('Authorization', 'Bearer active-token')
          .set('X-Forwarded-For', '10.10.2.99')
          .send({
            oldPassword: 'CurrentStrongPass#1',
            newPassword: 'NewStrongPass#2',
          })
          .expect(200);
      }

      await request(app.getHttpServer())
        .patch('/platform/profile/password')
        .set('Authorization', 'Bearer active-token')
        .set('X-Forwarded-For', '10.10.2.99')
        .send({
          oldPassword: 'CurrentStrongPass#1',
          newPassword: 'NewStrongPass#2',
        })
        .expect(429);
    });
  });
});
