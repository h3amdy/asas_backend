/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { ParentsService } from './parents.service';

describe('ParentsService resetPassword & login tracking', () => {
  function createSetup(lastLoginAt: Date | null = null) {
    const parentUser = {
      id: 88,
      uuid: 'par-uuid-88',
      code: 2300088,
      name: 'خالد صالح',
      phone: '771234567',
      email: null,
      gender: 'MALE',
      province: null,
      district: null,
      addressArea: null,
      isActive: true,
      schoolId: 3,
      lastLoginAt,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      updatedAt: new Date('2026-11-01T00:00:00.000Z'),
      parent: { childLinks: [] },
    };

    const prisma: any = {
      user: {
        findFirst: jest.fn().mockResolvedValue(parentUser),
        update: jest.fn().mockResolvedValue({}),
      },
      authSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      school: {
        findUnique: jest.fn().mockResolvedValue({ schoolCode: 'SCH-03' }),
      },
      $transaction: jest.fn().mockImplementation(async (cb: any) =>
        cb({
          user: prisma.user,
          authSession: prisma.authSession,
        }),
      ),
    };

    const service = new ParentsService(prisma, {} as any);
    return { service, prisma, parentUser };
  }

  it('returns hasLoggedIn and lastLoginAt in getParentProfile', async () => {
    const first = createSetup(null);
    const p1 = await first.service.getParentProfile('par-uuid-88', 3);
    expect(p1.hasLoggedIn).toBe(false);
    expect(p1.lastLoginAt).toBeNull();

    const ts = new Date('2026-11-22T09:30:00.000Z');
    const second = createSetup(ts);
    const p2 = await second.service.getParentProfile('par-uuid-88', 3);
    expect(p2.hasLoggedIn).toBe(true);
    expect(p2.lastLoginAt).toEqual(ts);
  });

  it('auto-generates password and revokes active sessions on resetPassword', async () => {
    const { service, prisma, parentUser } = createSetup();

    const res = await service.resetPassword(parentUser.uuid, 3);

    expect(res.code).toBe(parentUser.code);
    expect(res.password).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: parentUser.id },
      data: { passwordHash: expect.any(String) },
    });
    expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
      where: { userId: parentUser.id, revokedAt: null },
      data: { revokedAt: expect.any(Date), revokeReason: 'PASSWORD_CHANGED' },
    });
  });
});

