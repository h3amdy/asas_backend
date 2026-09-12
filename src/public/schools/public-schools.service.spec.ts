// src/public/schools/public-schools.service.spec.ts
//
// Regression tests for Public Schools Service
// Ensures all active non-deleted schools appear regardless of appType
//

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PublicSchoolsService } from './public-schools.service';

// ── Mock Data ─────────────────────────────────────────────────────────────

const SCHOOL_PUBLIC_ACTIVE = {
  uuid: 'uuid-pub-1',
  displayName: 'مدرسة حكومية عامة',
  name: 'مدرسة حكومية عامة',
  schoolCode: 1001,
  appType: 'PUBLIC',
  isActive: true,
  isDeleted: false,
  phone: '777111222',
  email: 'pub@school.com',
  province: 'صنعاء',
  district: null,
  addressArea: null,
  address: null,
  educationType: 'حكومي',
  deliveryPolicy: 'OPEN',
  logoMediaAssetId: null,
  logoMediaAsset: null,
  primaryColor: null,
  secondaryColor: null,
  backgroundColor: null,
};

const SCHOOL_PRIVATE_ACTIVE = {
  uuid: 'uuid-prv-1',
  displayName: 'مدرسة أهلية خاصة',
  name: 'مدرسة أهلية خاصة',
  schoolCode: 2001,
  appType: 'PRIVATE',
  isActive: true,
  isDeleted: false,
  phone: '777333444',
  email: 'prv@school.com',
  province: 'عدن',
  district: null,
  addressArea: null,
  address: null,
  educationType: 'أهلي',
  deliveryPolicy: 'OPEN',
  logoMediaAssetId: null,
  logoMediaAsset: null,
  primaryColor: null,
  secondaryColor: null,
  backgroundColor: null,
};

const SCHOOL_INACTIVE = {
  ...SCHOOL_PUBLIC_ACTIVE,
  uuid: 'uuid-inactive',
  schoolCode: 3001,
  isActive: false,
  displayName: 'مدرسة موقوفة',
};

const SCHOOL_DELETED = {
  ...SCHOOL_PUBLIC_ACTIVE,
  uuid: 'uuid-deleted',
  schoolCode: 4001,
  isDeleted: true,
  displayName: 'مدرسة محذوفة',
};

const ALL_SCHOOLS = [
  SCHOOL_PUBLIC_ACTIVE,
  SCHOOL_PRIVATE_ACTIVE,
  SCHOOL_INACTIVE,
  SCHOOL_DELETED,
];

// ── Mock Factory ──────────────────────────────────────────────────────────

function createMockPrisma() {
  return {
    school: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
}

function buildService(prisma: any): PublicSchoolsService {
  return new PublicSchoolsService(prisma);
}

// ── searchSchools ─────────────────────────────────────────────────────────

describe('PublicSchoolsService.searchSchools', () => {
  it('returns PUBLIC schools in search results', async () => {
    const prisma = createMockPrisma();
    prisma.school.findMany.mockResolvedValue([SCHOOL_PUBLIC_ACTIVE]);
    const service = buildService(prisma);

    const result = await service.searchSchools('حكومية');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].uuid).toBe(SCHOOL_PUBLIC_ACTIVE.uuid);
  });

  it('returns PRIVATE schools in search results (core regression)', async () => {
    const prisma = createMockPrisma();
    prisma.school.findMany.mockResolvedValue([SCHOOL_PRIVATE_ACTIVE]);
    const service = buildService(prisma);

    const result = await service.searchSchools('أهلية');

    expect(result.items).toHaveLength(1);
    expect(result.items[0].uuid).toBe(SCHOOL_PRIVATE_ACTIVE.uuid);
    expect(result.items[0].appType).toBe('PRIVATE');
  });

  it('returns both PUBLIC and PRIVATE schools together', async () => {
    const prisma = createMockPrisma();
    prisma.school.findMany.mockResolvedValue([SCHOOL_PUBLIC_ACTIVE, SCHOOL_PRIVATE_ACTIVE]);
    const service = buildService(prisma);

    const result = await service.searchSchools('مدرسة');

    expect(result.items).toHaveLength(2);
    const appTypes = result.items.map((i) => i.appType);
    expect(appTypes).toContain('PUBLIC');
    expect(appTypes).toContain('PRIVATE');
  });

  it('filters by isActive and isDeleted (NOT appType)', async () => {
    const prisma = createMockPrisma();
    prisma.school.findMany.mockResolvedValue([]);
    const service = buildService(prisma);

    await service.searchSchools('test');

    const call = prisma.school.findMany.mock.calls[0][0];
    // Must filter by these
    expect(call.where.isDeleted).toBe(false);
    expect(call.where.isActive).toBe(true);
    // Must NOT filter by appType
    expect(call.where.appType).toBeUndefined();
  });

  it('supports province filter without appType restriction', async () => {
    const prisma = createMockPrisma();
    prisma.school.findMany.mockResolvedValue([SCHOOL_PRIVATE_ACTIVE]);
    const service = buildService(prisma);

    await service.searchSchools(undefined, 10, 'عدن');

    const call = prisma.school.findMany.mock.calls[0][0];
    expect(call.where.province).toBe('عدن');
    expect(call.where.appType).toBeUndefined();
  });

  it('throws BadRequestException when no q and no province', async () => {
    const prisma = createMockPrisma();
    const service = buildService(prisma);

    await expect(service.searchSchools(undefined)).rejects.toThrow(BadRequestException);
  });

  it('throws BadRequestException when q < 2 chars', async () => {
    const prisma = createMockPrisma();
    const service = buildService(prisma);

    await expect(service.searchSchools('م')).rejects.toThrow(BadRequestException);
  });
});

// ── verifyBySchoolCode ────────────────────────────────────────────────────

describe('PublicSchoolsService.verifyBySchoolCode', () => {
  it('verifies PUBLIC school by code', async () => {
    const prisma = createMockPrisma();
    prisma.school.findFirst.mockResolvedValue(SCHOOL_PUBLIC_ACTIVE);
    const service = buildService(prisma);

    const result = await service.verifyBySchoolCode(1001);

    expect(result.school.uuid).toBe(SCHOOL_PUBLIC_ACTIVE.uuid);
  });

  it('verifies PRIVATE school by code (core regression)', async () => {
    const prisma = createMockPrisma();
    prisma.school.findFirst.mockResolvedValue(SCHOOL_PRIVATE_ACTIVE);
    const service = buildService(prisma);

    const result = await service.verifyBySchoolCode(2001);

    expect(result.school.uuid).toBe(SCHOOL_PRIVATE_ACTIVE.uuid);
    expect(result.school.appType).toBe('PRIVATE');
  });

  it('filters by isActive and isDeleted (NOT appType)', async () => {
    const prisma = createMockPrisma();
    prisma.school.findFirst.mockResolvedValue(SCHOOL_PUBLIC_ACTIVE);
    const service = buildService(prisma);

    await service.verifyBySchoolCode(1001);

    const call = prisma.school.findFirst.mock.calls[0][0];
    expect(call.where.isDeleted).toBe(false);
    expect(call.where.isActive).toBe(true);
    expect(call.where.schoolCode).toBe(1001);
    // Must NOT filter by appType
    expect(call.where.appType).toBeUndefined();
  });

  it('throws NotFoundException when school not found', async () => {
    const prisma = createMockPrisma();
    prisma.school.findFirst.mockResolvedValue(null);
    const service = buildService(prisma);

    await expect(service.verifyBySchoolCode(9999)).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException for invalid schoolCode', async () => {
    const prisma = createMockPrisma();
    const service = buildService(prisma);

    await expect(service.verifyBySchoolCode(-1)).rejects.toThrow(BadRequestException);
    await expect(service.verifyBySchoolCode(0)).rejects.toThrow(BadRequestException);
  });
});

// ── getDistinctProvinces ──────────────────────────────────────────────────

describe('PublicSchoolsService.getDistinctProvinces', () => {
  it('returns provinces from all active schools (not just PUBLIC)', async () => {
    const prisma = createMockPrisma();
    prisma.school.findMany.mockResolvedValue([
      { province: 'صنعاء' },
      { province: 'عدن' },
    ]);
    const service = buildService(prisma);

    const result = await service.getDistinctProvinces();

    expect(result.provinces).toEqual(['صنعاء', 'عدن']);
  });

  it('filters by isActive and isDeleted (NOT appType)', async () => {
    const prisma = createMockPrisma();
    prisma.school.findMany.mockResolvedValue([]);
    const service = buildService(prisma);

    await service.getDistinctProvinces();

    const call = prisma.school.findMany.mock.calls[0][0];
    expect(call.where.isDeleted).toBe(false);
    expect(call.where.isActive).toBe(true);
    expect(call.where.province).toEqual({ not: null });
    // Must NOT filter by appType
    expect(call.where.appType).toBeUndefined();
  });
});

// ── getProfile (unchanged — no appType filter) ────────────────────────────

describe('PublicSchoolsService.getProfile', () => {
  it('returns profile for PRIVATE school (no appType filter)', async () => {
    const prisma = createMockPrisma();
    prisma.school.findFirst.mockResolvedValue(SCHOOL_PRIVATE_ACTIVE);
    const service = buildService(prisma);

    const result = await service.getProfile('uuid-prv-1');

    expect(result.school.uuid).toBe('uuid-prv-1');
    expect(result.school.appType).toBe('PRIVATE');
    expect(result.serverTime).toBeDefined();
  });

  it('does not filter by isActive (allows inactive profiles)', async () => {
    const prisma = createMockPrisma();
    prisma.school.findFirst.mockResolvedValue(SCHOOL_INACTIVE);
    const service = buildService(prisma);

    await service.getProfile('uuid-inactive');

    const call = prisma.school.findFirst.mock.calls[0][0];
    expect(call.where.uuid).toBe('uuid-inactive');
    expect(call.where.isDeleted).toBe(false);
    expect(call.where.isActive).toBeUndefined();
  });

  it('throws NotFoundException for deleted school', async () => {
    const prisma = createMockPrisma();
    prisma.school.findFirst.mockResolvedValue(null);
    const service = buildService(prisma);

    await expect(service.getProfile('uuid-deleted')).rejects.toThrow(NotFoundException);
  });
});
