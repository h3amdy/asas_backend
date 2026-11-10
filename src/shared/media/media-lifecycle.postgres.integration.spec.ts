/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
// src/shared/media/media-lifecycle.postgres.integration.spec.ts
// ═══════════════════════════════════════════════════════════════
// 🐘 VIDEO P4-5a — اختبارات التكامل والتزامن الحقيقية على PostgreSQL الفعلي
// مرجع: docs/features/video/10-VIDEO-BACKEND-IMPLEMENTATION-PLAN.md (v1.2 §8.1, §9.1)
//        p4-5-design-and-audit.md (RACE-T1, S4-T1..T6, W061-T1..T4, Decision 3)
// ═══════════════════════════════════════════════════════════════

import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AppType,
  DistributionStatus,
  MediaKind,
  ProcessingStatus,
} from '@prisma/client';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import { promisify } from 'util';
import { PrismaService } from '../../prisma/prisma.service';
import { StudentSyncService } from '../../school/student/sync/student-sync.service';
import { MediaAccessPolicyService } from './media-access-policy.service';
import { MediaLifecycleService } from './media-lifecycle.service';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

function assertSafeTestDb(dbName: string): void {
  if (!/^asas_video_p45a_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(
      `SAFETY: test database name "${dbName}" violates naming format.`,
    );
  }
  const lower = dbName.toLowerCase();
  if (
    lower.includes('prod') ||
    lower.includes('staging') ||
    lower.includes('dev')
  ) {
    throw new Error(`SAFETY: "${dbName}" matches a protected database name.`);
  }
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('VIDEO P4-5a — Real PostgreSQL Concurrency (RACE-T1) & Isolation (S4 / W-061)', () => {
  jest.setTimeout(120_000);

  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;

  // اتصالان مستقلان تماماً بقاعدة بيانات PostgreSQL لاختبار الأقفال الحقيقية FOR UPDATE
  let prismaA: PrismaService;
  let prismaB: PrismaService;
  let policyA: MediaAccessPolicyService;
  let policyB: MediaAccessPolicyService;
  let lifecycleA: MediaLifecycleService;
  let lifecycleB: MediaLifecycleService;

  let schoolAId: number;
  let schoolBId: number;
  let templateA1Id: number;
  let templateA2Id: number;
  let blockA1Id: number;
  let blockA2Id: number;

  beforeAll(async () => {
    tempDbName = `asas_video_p45a_pg_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    assertSafeTestDb(tempDbName);
    const dbUser = process.env.PGUSER || process.env.USER || 'postgres';
    tempDbUrl = `postgresql://${dbUser}@localhost:5432/${tempDbName}`;

    await execFileAsync('createdb', [
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

    prismaA = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    prismaB = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    await prismaA.$connect();
    await prismaB.$connect();

    const rows: Array<{ db: string }> = await prismaA.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (rows[0]?.db !== tempDbName) {
      throw new Error(
        `ISOLATION FAILURE: connected to "${rows[0]?.db}" instead of "${tempDbName}"`,
      );
    }

    policyA = new MediaAccessPolicyService(prismaA);
    policyB = new MediaAccessPolicyService(prismaB);
    lifecycleA = new MediaLifecycleService(policyA);
    lifecycleB = new MediaLifecycleService(policyB);

    const schoolA = await prismaA.school.create({
      data: {
        name: 'مدرسة أ - اختبارات P4-5a',
        schoolCode: 99501,
        appType: AppType.PUBLIC,
      },
    });
    const schoolB = await prismaA.school.create({
      data: {
        name: 'مدرسة ب - اختبارات P4-5a',
        schoolCode: 99502,
        appType: AppType.PRIVATE,
      },
    });
    schoolAId = schoolA.id;
    schoolBId = schoolB.id;

    const tpl1 = await prismaA.lessonTemplate.create({
      data: {
        ownerType: 'SCHOOL',
        schoolId: schoolAId,
        title: 'درس 1 في المدرسة أ',
        orderIndex: 1,
      },
    });
    const tpl2 = await prismaA.lessonTemplate.create({
      data: {
        ownerType: 'SCHOOL',
        schoolId: schoolAId,
        title: 'درس 2 في المدرسة أ',
        orderIndex: 2,
      },
    });
    templateA1Id = tpl1.id;
    templateA2Id = tpl2.id;

    const blk1 = await prismaA.lessonContentBlock.create({
      data: {
        templateId: templateA1Id,
        title: 'فقرة 1',
        orderIndex: 1,
      },
    });
    const blk2 = await prismaA.lessonContentBlock.create({
      data: {
        templateId: templateA2Id,
        title: 'فقرة 2',
        orderIndex: 1,
      },
    });
    blockA1Id = blk1.id;
    blockA2Id = blk2.id;
  });

  afterAll(async () => {
    await prismaA?.$disconnect().catch(() => undefined);
    await prismaB?.$disconnect().catch(() => undefined);

    if (dbCreated && tempDbName) {
      assertSafeTestDb(tempDbName);
      await execFileAsync('dropdb', [
        '-h',
        'localhost',
        '-p',
        '5432',
        '--if-exists',
        tempDbName,
      ]).catch(() => undefined);
    }
  });

  it('PG-LC-1 (RACE-T1): سباق متزامن حقيقي بين حذف آخر مرجع للفيديو وربطه في درس جديد — القفل FOR UPDATE يمنع المرجع المعلّق ويرفض الربط بـ 404', async () => {
    const videoAsset = await prismaA.mediaAsset.create({
      data: {
        schoolId: schoolAId,
        ownerType: 'SCHOOL',
        kind: MediaKind.VIDEO,
        storageProvider: 'R2',
        contentType: 'video/mp4',
        processingStatus: ProcessingStatus.DONE,
        sizeBytes: BigInt(5_000_000),
      },
    });

    const item1 = await prismaA.lessonBlockItem.create({
      data: {
        blockId: blockA1Id,
        itemType: 'VIDEO',
        orderIndex: 1,
        mediaAssetId: videoAsset.id,
      },
    });

    const lockAcquiredByDeleteTx = createDeferred<void>();
    const linkTxAttempted = createDeferred<void>();

    // المعاملة A (اتصال 1): تقفل الأصل بـ FOR UPDATE، تحذف المرجع الوحيد، وتعلّم الأصل isDeleted = true
    const deleteTxPromise = prismaA.$transaction(async (txA) => {
      await lifecycleA.lockMediaAssetsForUpdate(txA, [videoAsset.id]);
      lockAcquiredByDeleteTx.resolve();

      // انتظر حتى تبدأ المعاملة B محاولة القفل والربط
      await linkTxAttempted.promise;
      await new Promise((r) => setTimeout(r, 100));

      await txA.lessonBlockItem.update({
        where: { id: item1.id },
        data: { isDeleted: true, deletedAt: new Date() },
      });

      return lifecycleA.reconcileUnlinkedAssetsUnderLock(txA, [videoAsset.id]);
    });

    await lockAcquiredByDeleteTx.promise;

    // المعاملة B (اتصال 2 مستقل): تحاول في نفس اللحظة ربط نفس الفيديو في فقرة أخرى
    const linkTxPromise = prismaB.$transaction(async (txB) => {
      linkTxAttempted.resolve();
      const locked = await lifecycleB.resolveAndLockAssetForLink(txB, {
        assetUuid: videoAsset.uuid,
        expectedKind: 'VIDEO',
        targetOwnerType: 'SCHOOL',
        schoolId: schoolAId,
      });

      return txB.lessonBlockItem.create({
        data: {
          blockId: blockA2Id,
          itemType: 'VIDEO',
          orderIndex: 1,
          mediaAssetId: locked.id,
        },
      });
    });

    const deleteResult = await deleteTxPromise;
    expect(deleteResult.softDeletedAssetIds).toEqual([videoAsset.id]);
    expect(deleteResult.remainingCounts[videoAsset.id]).toBe(0);

    // يجب أن تفشل المعاملة B بـ 404 ASSET_NOT_FOUND فور انتهاء قفل المعاملة A
    await expect(linkTxPromise).rejects.toThrow(NotFoundException);

    // التحقق النهائي من قاعدة البيانات: الأصل محذوف منطقياً، وعدد المراجع النشطة = 0
    const finalAsset = await prismaA.mediaAsset.findUniqueOrThrow({
      where: { id: videoAsset.id },
    });
    expect(finalAsset.isDeleted).toBe(true);
    expect(finalAsset.deletedAt).not.toBeNull();

    const activeRefs = await prismaA.lessonBlockItem.count({
      where: { mediaAssetId: videoAsset.id, isDeleted: false },
    });
    expect(activeRefs).toBe(0);
  });

  it('PG-LC-2 (RACE-T1 Reverse): عندما تسبق معاملة الربط الجديدة إلى القفل FOR UPDATE ثم تحذف المعاملة الأخرى المرجع القديم، يبقى الأصل نشطاً (remainingCounts = 1)', async () => {
    const videoAsset = await prismaA.mediaAsset.create({
      data: {
        schoolId: schoolAId,
        ownerType: 'SCHOOL',
        kind: MediaKind.VIDEO,
        storageProvider: 'R2',
        contentType: 'video/mp4',
        processingStatus: ProcessingStatus.DONE,
        sizeBytes: BigInt(4_000_000),
      },
    });

    const item1 = await prismaA.lessonBlockItem.create({
      data: {
        blockId: blockA1Id,
        itemType: 'VIDEO',
        orderIndex: 2,
        mediaAssetId: videoAsset.id,
      },
    });

    const lockAcquiredByLinkTx = createDeferred<void>();
    const deleteTxStarted = createDeferred<void>();

    // المعاملة B (اتصال 2): تكتسب القفل أولاً وتربط الفيديو في الدرس الثاني
    const linkTxPromise = prismaB.$transaction(async (txB) => {
      const locked = await lifecycleB.resolveAndLockAssetForLink(txB, {
        assetUuid: videoAsset.uuid,
        expectedKind: 'VIDEO',
        targetOwnerType: 'SCHOOL',
        schoolId: schoolAId,
      });
      lockAcquiredByLinkTx.resolve();

      await deleteTxStarted.promise;
      await new Promise((r) => setTimeout(r, 100));

      return txB.lessonBlockItem.create({
        data: {
          blockId: blockA2Id,
          itemType: 'VIDEO',
          orderIndex: 2,
          mediaAssetId: locked.id,
        },
      });
    });

    await lockAcquiredByLinkTx.promise;

    // المعاملة A (اتصال 1): تحاول حذف المرجع الأول أثناء إمساك B بالقفل
    const deleteTxPromise = prismaA.$transaction(async (txA) => {
      deleteTxStarted.resolve();
      await lifecycleA.lockMediaAssetsForUpdate(txA, [videoAsset.id]);

      await txA.lessonBlockItem.update({
        where: { id: item1.id },
        data: { isDeleted: true, deletedAt: new Date() },
      });

      return lifecycleA.reconcileUnlinkedAssetsUnderLock(txA, [videoAsset.id]);
    });

    const [createdItem2, reconcileRes] = await Promise.all([
      linkTxPromise,
      deleteTxPromise,
    ]);

    expect(createdItem2.mediaAssetId).toBe(videoAsset.id);
    expect(reconcileRes.softDeletedAssetIds).toEqual([]);
    expect(reconcileRes.remainingCounts[videoAsset.id]).toBe(1);

    const finalAsset = await prismaA.mediaAsset.findUniqueOrThrow({
      where: { id: videoAsset.id },
    });
    expect(finalAsset.isDeleted).toBe(false);
  });

  it('PG-LC-3 (Deadlock-Free Symmetric Lock Ordering): استبدال متزامن متعاكس [A, B] مقابل [B, A] يكتمل بنجاح بلا Deadlock بفضل ORDER BY id ASC FOR UPDATE', async () => {
    const asset1 = await prismaA.mediaAsset.create({
      data: {
        schoolId: schoolAId,
        ownerType: 'SCHOOL',
        kind: MediaKind.VIDEO,
        storageProvider: 'R2',
        contentType: 'video/mp4',
        processingStatus: ProcessingStatus.DONE,
      },
    });
    const asset2 = await prismaA.mediaAsset.create({
      data: {
        schoolId: schoolAId,
        ownerType: 'SCHOOL',
        kind: MediaKind.VIDEO,
        storageProvider: 'R2',
        contentType: 'video/mp4',
        processingStatus: ProcessingStatus.DONE,
      },
    });

    expect(asset1.id).toBeLessThan(asset2.id);

    // اتصال 1 يطلب ربط asset2 مع تمرير previousAssetId = asset1.id (ترتيب المدخلات: [asset2.id, asset1.id])
    // اتصال 2 يطلب ربط asset1 مع تمرير previousAssetId = asset2.id (ترتيب المدخلات: [asset1.id, asset2.id])
    const [resA, resB] = await Promise.all([
      prismaA.$transaction(async (txA) => {
        const locked = await lifecycleA.resolveAndLockAssetForLink(txA, {
          assetUuid: asset2.uuid,
          expectedKind: 'VIDEO',
          targetOwnerType: 'SCHOOL',
          schoolId: schoolAId,
          previousAssetId: asset1.id,
        });
        await new Promise((r) => setTimeout(r, 50));
        return locked.id;
      }),
      prismaB.$transaction(async (txB) => {
        const locked = await lifecycleB.resolveAndLockAssetForLink(txB, {
          assetUuid: asset1.uuid,
          expectedKind: 'VIDEO',
          targetOwnerType: 'SCHOOL',
          schoolId: schoolAId,
          previousAssetId: asset2.id,
        });
        await new Promise((r) => setTimeout(r, 50));
        return locked.id;
      }),
    ]);

    expect(resA).toBe(asset2.id);
    expect(resB).toBe(asset1.id);
  });

  it('PG-LC-4 (S4 & W-061 on Real PostgreSQL): يتحقق من عزل القراءة والكتابة عبر المدارس والتوزيع النشط والاستنساخ (Policy A) والحفاظ على أصول المنصة غير الفيديو', async () => {
    // 1. قالب منصة مع فيديو منصة
    const platformTpl = await prismaA.lessonTemplate.create({
      data: {
        ownerType: 'PLATFORM',
        schoolId: null,
        title: 'قالب منصة رسمي',
        orderIndex: 1,
      },
    });
    const platformBlock = await prismaA.lessonContentBlock.create({
      data: {
        templateId: platformTpl.id,
        title: 'فقرة منصة',
        orderIndex: 1,
      },
    });
    const platformVideo = await prismaA.mediaAsset.create({
      data: {
        ownerType: 'PLATFORM',
        schoolId: null,
        kind: MediaKind.VIDEO,
        storageProvider: 'R2',
        contentType: 'video/mp4',
        processingStatus: ProcessingStatus.DONE,
      },
    });
    await prismaA.lessonBlockItem.create({
      data: {
        blockId: platformBlock.id,
        itemType: 'VIDEO',
        orderIndex: 1,
        mediaAssetId: platformVideo.id,
      },
    });

    // قبل التوزيع: لا المدرسة A ولا المدرسة B تستطيع قراءة أو ربط فيديو المنصة (S4-T5 & W061-T2)
    await expect(
      policyA.getAccessibleSchoolAsset(platformVideo.uuid, schoolAId),
    ).rejects.toThrow(NotFoundException);
    await expect(
      policyA.getAccessibleSchoolAsset(platformVideo.uuid, schoolBId),
    ).rejects.toThrow(NotFoundException);

    // 2. إنشاء توزيع نشط للمدرسة A فقط (S4-T3)
    const platformAdmin = await prismaA.platformUser.create({
      data: {
        username: 'p45a_admin',
        email: 'p45a-admin@asas.local',
        name: 'مدير منصة P4-5a',
        passwordHash: 'hash',
        role: 'PLATFORM_ADMIN',
      },
    });

    const dist = await prismaA.contentDistribution.create({
      data: {
        schoolId: schoolAId,
        sourceLessonTemplateId: platformTpl.id,
        distributedByPlatformUserId: platformAdmin.id,
        status: DistributionStatus.ACTIVE,
      },
    });

    const accessibleInA = await policyA.getAccessibleSchoolAsset(
      platformVideo.uuid,
      schoolAId,
    );
    expect(accessibleInA.id).toBe(platformVideo.id);

    // المدرسة B تظل ممنوعة بـ 404
    await expect(
      policyA.getAccessibleSchoolAsset(platformVideo.uuid, schoolBId),
    ).rejects.toThrow(NotFoundException);

    // 3. استنساخ القالب إلى المدرسة A (Policy A — sourceTemplateId != null) ثم إلغاء التوزيع الرسمي (REVOKED)
    const clonedTplInA = await prismaA.lessonTemplate.create({
      data: {
        ownerType: 'SCHOOL',
        schoolId: schoolAId,
        sourceTemplateId: platformTpl.id,
        title: 'نسخة المدرسة أ المستنسخة',
        orderIndex: 10,
      },
    });
    const clonedBlockInA = await prismaA.lessonContentBlock.create({
      data: {
        templateId: clonedTplInA.id,
        title: 'فقرة مستنسخة',
        orderIndex: 1,
      },
    });
    await prismaA.lessonBlockItem.create({
      data: {
        blockId: clonedBlockInA.id,
        itemType: 'VIDEO',
        orderIndex: 1,
        mediaAssetId: platformVideo.id,
      },
    });

    // إلغاء التوزيع الرسمي
    await prismaA.contentDistribution.update({
      where: { id: dist.id },
      data: { status: DistributionStatus.REVOKED },
    });

    // S4-T4 (Policy A): المدرسة A تظل قادرة على الوصول لأن لديها نسخة مستنسخة نشطة!
    const stillAccessibleInA = await policyA.getAccessibleSchoolAsset(
      platformVideo.uuid,
      schoolAId,
    );
    expect(stillAccessibleInA.id).toBe(platformVideo.id);

    // 4. أصل منصة غير فيديو (IMAGE) يظل متاحاً للمدرسة B دون قيود الفيديو (Decision 3)
    const platformImage = await prismaA.mediaAsset.create({
      data: {
        ownerType: 'PLATFORM',
        schoolId: null,
        kind: MediaKind.IMAGE,
        storageProvider: 'LOCAL',
        contentType: 'image/png',
        processingStatus: ProcessingStatus.DONE,
      },
    });
    const imgInB = await policyA.getAccessibleSchoolAsset(
      platformImage.uuid,
      schoolBId,
    );
    expect(imgInB.id).toBe(platformImage.id);

    // 5. منع ربط VIDEO في الحقول غير الدروس (W061-T4)
    await expect(
      policyA.assertCanLinkNonVideoAsset(prismaA, platformVideo.uuid, {
        targetOwnerType: 'PLATFORM',
        allowedKinds: ['IMAGE'],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('PG-LC-5 (Decision 1 on Real PostgreSQL): يحمي حالة COMPLETED ذرياً من التراجع إلى IN_PROGRESS عند وصول تحديثات متأخرة أو متزامنة دون الحاجة لترحيل M4', async () => {
    const year = await prismaA.year.create({
      data: {
        schoolId: schoolAId,
        name: '2026-2027',
        isCurrent: true,
      },
    });
    const term = await prismaA.term.create({
      data: {
        yearId: year.id,
        name: 'الفصل الأول',
        orderIndex: 1,
        isCurrent: true,
      },
    });
    const grade = await prismaA.schoolGrade.create({
      data: {
        schoolId: schoolAId,
        displayName: 'الصف الأول',
        sortOrder: 1,
      },
    });
    const subject = await prismaA.subject.create({
      data: {
        schoolId: schoolAId,
        gradeId: grade.id,
        displayName: 'العلوم',
      },
    });
    const teacherUser = await prismaA.user.create({
      data: {
        schoolId: schoolAId,
        userType: 'TEACHER',
        name: 'معلم الاختبار',
        passwordHash: 'hash',
        isActive: true,
      },
    });
    await prismaA.teacher.create({
      data: {
        userId: teacherUser.id,
      },
    });
    const studentUser = await prismaA.user.create({
      data: {
        schoolId: schoolAId,
        userType: 'STUDENT',
        name: 'طالب الاختبار',
        passwordHash: 'hash',
        isActive: true,
      },
    });
    const student = await prismaA.student.create({
      data: {
        userId: studentUser.id,
      },
    });

    const lesson = await prismaA.lesson.create({
      data: {
        templateId: templateA1Id,
        schoolId: schoolAId,
        teacherId: teacherUser.id,
        subjectId: subject.id,
        yearId: year.id,
        termId: term.id,
        status: 'PUBLISHED',
      },
    });

    const syncServiceA = new StudentSyncService(prismaA);
    const syncServiceB = new StudentSyncService(prismaB);

    // 1. انتقال أولي إلى IN_PROGRESS
    await (syncServiceA as any).processProgressChange(student.userId, {
      entityType: 'lesson_progress',
      operation: 'UPSERT',
      clientTimestamp: new Date().toISOString(),
      payload: {
        lessonUuid: lesson.uuid,
        status: 'IN_PROGRESS',
        lastPosition: { blockIndex: 1 },
      },
    });

    const afterInitial = await prismaA.studentLessonProgress.findUnique({
      where: {
        studentId_lessonId: {
          studentId: student.userId,
          lessonId: lesson.id,
        },
      },
    });
    expect(afterInitial?.status).toBe('IN_PROGRESS');

    // 2. سباق متزامن بين اتصالين حقيقيين: أحدهما يرسل COMPLETED والآخر يرسل IN_PROGRESS متأخرة
    await Promise.all([
      (syncServiceA as any).processProgressChange(student.userId, {
        entityType: 'lesson_progress',
        operation: 'UPSERT',
        clientTimestamp: new Date().toISOString(),
        payload: {
          lessonUuid: lesson.uuid,
          status: 'COMPLETED',
          lastPosition: { blockIndex: 5, completed: true },
        },
      }),
      (syncServiceB as any).processProgressChange(student.userId, {
        entityType: 'lesson_progress',
        operation: 'UPSERT',
        clientTimestamp: new Date().toISOString(),
        payload: {
          lessonUuid: lesson.uuid,
          status: 'IN_PROGRESS',
          lastPosition: { blockIndex: 2 },
        },
      }),
    ]);

    // 3. إرسال تحديث IN_PROGRESS متأخر آخر بعد استقرار COMPLETED
    await (syncServiceB as any).processProgressChange(student.userId, {
      entityType: 'lesson_progress',
      operation: 'UPSERT',
      clientTimestamp: new Date().toISOString(),
      payload: {
        lessonUuid: lesson.uuid,
        status: 'IN_PROGRESS',
        lastPosition: { blockIndex: 0 },
      },
    });

    const finalProgress = await prismaA.studentLessonProgress.findUnique({
      where: {
        studentId_lessonId: {
          studentId: student.userId,
          lessonId: lesson.id,
        },
      },
    });

    expect(finalProgress?.status).toBe('COMPLETED');
    expect(JSON.parse(finalProgress?.lastPosition ?? '{}')).toEqual({
      blockIndex: 5,
      completed: true,
    });
  });
});
