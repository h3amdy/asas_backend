// src/platform/distribution/distribution.service.ts
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDistributionDto } from './dto/create-distribution.dto';
import { DistributionQueryDto } from './dto/distribution-query.dto';

@Injectable()
export class DistributionService {
    constructor(private readonly prisma: PrismaService) {}

    // ─────────────────────────────────────────────────────────
    // Helper: التحقق من صلاحية المستخدم (PLATFORM_ADMIN فقط)
    // ─────────────────────────────────────────────────────────
    private async assertPlatformAdmin(platformUserUuid: string) {
        const user = await this.prisma.platformUser.findFirst({
            where: { uuid: platformUserUuid, isDeleted: false, isActive: true },
        });

        if (!user) {
            throw new ForbiddenException('ليس لديك صلاحية لهذا الإجراء');
        }

        if (user.role !== 'PLATFORM_ADMIN') {
            throw new ForbiddenException('التوزيع متاح فقط لمدير المنصة');
        }

        return user;
    }

    // ─────────────────────────────────────────────────────────
    // Helper: تحويل اختيار المحتوى إلى قائمة lesson template IDs
    // ─────────────────────────────────────────────────────────
    private async resolveLessonTemplateIds(dto: CreateDistributionDto): Promise<number[]> {
        // الحالة 1: دروس محددة
        if (dto.lessonTemplateUuids?.length) {
            const templates = await this.prisma.lessonTemplate.findMany({
                where: {
                    uuid: { in: dto.lessonTemplateUuids },
                    ownerType: 'PLATFORM',
                    isDeleted: false,
                    status: { in: ['READY', 'PUBLISHED'] },
                },
                select: { id: true, uuid: true },
            });

            if (templates.length === 0) {
                throw new BadRequestException('لم يتم العثور على دروس صالحة للتوزيع');
            }

            return templates.map((t) => t.id);
        }

        // الحالة 2: وحدة → كل دروسها
        if (dto.unitUuid) {
            const unit = await this.prisma.unit.findFirst({
                where: { uuid: dto.unitUuid, ownerType: 'PLATFORM', isDeleted: false },
            });
            if (!unit) throw new NotFoundException('الوحدة غير موجودة');

            const templates = await this.prisma.lessonTemplate.findMany({
                where: {
                    unitId: unit.id,
                    ownerType: 'PLATFORM',
                    isDeleted: false,
                    status: { in: ['READY', 'PUBLISHED'] },
                },
                select: { id: true },
            });

            if (templates.length === 0) {
                throw new BadRequestException('لا توجد دروس جاهزة في هذه الوحدة');
            }

            return templates.map((t) => t.id);
        }

        // الحالة 3: مادة → كل الوحدات → كل الدروس
        if (dto.subjectDictUuid) {
            const subjectDict = await this.prisma.subjectDictionary.findFirst({
                where: { uuid: dto.subjectDictUuid, isDeleted: false },
            });
            if (!subjectDict) throw new NotFoundException('المادة غير موجودة');

            const templates = await this.prisma.lessonTemplate.findMany({
                where: {
                    subjectDictionaryId: subjectDict.id,
                    ownerType: 'PLATFORM',
                    isDeleted: false,
                    status: { in: ['READY', 'PUBLISHED'] },
                },
                select: { id: true },
            });

            if (templates.length === 0) {
                throw new BadRequestException('لا توجد دروس جاهزة في هذه المادة');
            }

            return templates.map((t) => t.id);
        }

        // الحالة 4: صف → كل المواد → كل الوحدات → كل الدروس
        if (dto.gradeUuid) {
            const grade = await this.prisma.gradeDictionary.findFirst({
                where: { uuid: dto.gradeUuid, isDeleted: false },
            });
            if (!grade) throw new NotFoundException('الصف غير موجود');

            // جلب كل المواد المرتبطة بهذا الصف
            const subjectDicts = await this.prisma.subjectDictionary.findMany({
                where: { gradeDictionaryId: grade.id, isDeleted: false },
                select: { id: true },
            });

            if (subjectDicts.length === 0) {
                throw new BadRequestException('لا توجد مواد لهذا الصف');
            }

            const templates = await this.prisma.lessonTemplate.findMany({
                where: {
                    subjectDictionaryId: { in: subjectDicts.map((s) => s.id) },
                    ownerType: 'PLATFORM',
                    isDeleted: false,
                    status: { in: ['READY', 'PUBLISHED'] },
                },
                select: { id: true },
            });

            if (templates.length === 0) {
                throw new BadRequestException('لا توجد دروس جاهزة لهذا الصف');
            }

            return templates.map((t) => t.id);
        }

        throw new BadRequestException(
            'يجب تحديد المحتوى: lessonTemplateUuids أو gradeUuid أو subjectDictUuid أو unitUuid',
        );
    }

    // ─────────────────────────────────────────────────────────
    // Helper: تحويل اختيار المدارس إلى قائمة school IDs
    // ─────────────────────────────────────────────────────────
    private async resolveSchoolIds(dto: CreateDistributionDto): Promise<number[]> {
        if (dto.allSchools) {
            const schools = await this.prisma.school.findMany({
                where: { isActive: true, isDeleted: false },
                select: { id: true },
            });

            if (schools.length === 0) {
                throw new BadRequestException('لا توجد مدارس نشطة');
            }

            return schools.map((s) => s.id);
        }

        if (dto.schoolUuids?.length) {
            const schools = await this.prisma.school.findMany({
                where: {
                    uuid: { in: dto.schoolUuids },
                    isActive: true,
                    isDeleted: false,
                },
                select: { id: true, uuid: true },
            });

            if (schools.length === 0) {
                throw new BadRequestException('لم يتم العثور على مدارس نشطة');
            }

            return schools.map((s) => s.id);
        }

        throw new BadRequestException('يجب تحديد المدارس: schoolUuids أو allSchools');
    }

    // ═══════════════════════════════════════════════════════════
    //  POST /platform/distribute — العملية الرئيسية
    // ═══════════════════════════════════════════════════════════
    async distribute(platformUserUuid: string, dto: CreateDistributionDto) {
        const platformUser = await this.assertPlatformAdmin(platformUserUuid);

        // 1. تحويل الاختيارات إلى IDs
        const lessonTemplateIds = await this.resolveLessonTemplateIds(dto);
        const schoolIds = await this.resolveSchoolIds(dto);

        // 2. جلب التوزيعات الموجودة مسبقاً لمنع التكرار
        const existingDistributions = await this.prisma.contentDistribution.findMany({
            where: {
                sourceLessonTemplateId: { in: lessonTemplateIds },
                schoolId: { in: schoolIds },
                isDeleted: false,
            },
            select: {
                schoolId: true,
                sourceLessonTemplateId: true,
            },
        });

        const existingSet = new Set(
            existingDistributions.map((d) => `${d.schoolId}-${d.sourceLessonTemplateId}`),
        );

        // 3. جمع التفاصيل وتنفيذ التوزيع
        const details: Array<{
            lessonTemplateId: number;
            schoolId: number;
            result: 'distributed' | 'skipped' | 'failed';
        }> = [];

        const newDistributions: Array<{
            schoolId: number;
            sourceLessonTemplateId: number;
            distributedByPlatformUserId: number;
        }> = [];

        for (const lessonId of lessonTemplateIds) {
            for (const schoolId of schoolIds) {
                const key = `${schoolId}-${lessonId}`;
                if (existingSet.has(key)) {
                    details.push({ lessonTemplateId: lessonId, schoolId, result: 'skipped' });
                } else {
                    newDistributions.push({
                        schoolId,
                        sourceLessonTemplateId: lessonId,
                        distributedByPlatformUserId: platformUser.id,
                    });
                    details.push({ lessonTemplateId: lessonId, schoolId, result: 'distributed' });
                }
            }
        }

        // 4. إنشاء التوزيعات الجديدة (bulk)
        if (newDistributions.length > 0) {
            await this.prisma.contentDistribution.createMany({
                data: newDistributions,
            });
        }

        // 5. إنشاء سجل الأرشيف
        const distributed = details.filter((d) => d.result === 'distributed').length;
        const skipped = details.filter((d) => d.result === 'skipped').length;
        const failed = details.filter((d) => d.result === 'failed').length;

        const batch = await this.prisma.distributionBatch.create({
            data: {
                platformUserId: platformUser.id,
                totalSchools: schoolIds.length,
                totalLessons: lessonTemplateIds.length,
                distributed,
                skipped,
                failed,
            },
        });

        // 6. جلب بيانات العرض
        const lessonTemplates = await this.prisma.lessonTemplate.findMany({
            where: { id: { in: lessonTemplateIds } },
            select: { id: true, uuid: true, title: true },
        });

        const schools = await this.prisma.school.findMany({
            where: { id: { in: schoolIds } },
            select: { id: true, uuid: true, name: true },
        });

        const lessonMap = new Map(lessonTemplates.map((l) => [l.id, l]));
        const schoolMap = new Map(schools.map((s) => [s.id, s]));

        return {
            batchUuid: batch.uuid,
            totalSchools: schoolIds.length,
            totalLessons: lessonTemplateIds.length,
            distributed,
            skipped,
            failed,
            details: details.map((d) => ({
                lessonUuid: lessonMap.get(d.lessonTemplateId)?.uuid,
                lessonTitle: lessonMap.get(d.lessonTemplateId)?.title,
                schoolUuid: schoolMap.get(d.schoolId)?.uuid,
                schoolName: schoolMap.get(d.schoolId)?.name,
                result: d.result,
            })),
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  GET /platform/distributions — سجل التوزيعات
    // ═══════════════════════════════════════════════════════════
    async getDistributions(platformUserUuid: string, query: DistributionQueryDto) {
        await this.assertPlatformAdmin(platformUserUuid);

        const where: any = { isDeleted: false };

        if (query.schoolUuid) {
            const school = await this.prisma.school.findFirst({
                where: { uuid: query.schoolUuid, isDeleted: false },
            });
            if (school) where.schoolId = school.id;
        }

        if (query.lessonTemplateUuid) {
            const lt = await this.prisma.lessonTemplate.findFirst({
                where: { uuid: query.lessonTemplateUuid, isDeleted: false },
            });
            if (lt) where.sourceLessonTemplateId = lt.id;
        }

        if (query.status) {
            where.status = query.status;
        }

        const distributions = await this.prisma.contentDistribution.findMany({
            where,
            orderBy: { distributedAt: 'desc' },
            take: 200,
            include: {
                school: { select: { uuid: true, name: true } },
                sourceLessonTemplate: {
                    select: {
                        uuid: true,
                        title: true,
                        templateVersion: true,
                        status: true,
                        unit: { select: { uuid: true, title: true } },
                        subjectDictionary: {
                            select: {
                                uuid: true,
                                defaultName: true,
                                gradeDictionary: { select: { uuid: true, defaultName: true } },
                            },
                        },
                    },
                },
            },
        });

        return {
            distributions: distributions.map((d) => ({
                uuid: d.uuid,
                status: d.status,
                distributedAt: d.distributedAt,
                school: {
                    uuid: d.school.uuid,
                    name: d.school.name,
                },
                lesson: {
                    uuid: d.sourceLessonTemplate.uuid,
                    title: d.sourceLessonTemplate.title,
                    templateVersion: d.sourceLessonTemplate.templateVersion,
                    status: d.sourceLessonTemplate.status,
                    unitTitle: d.sourceLessonTemplate.unit?.title ?? null,
                    subjectName: d.sourceLessonTemplate.subjectDictionary?.defaultName ?? null,
                    gradeName: d.sourceLessonTemplate.subjectDictionary?.gradeDictionary?.defaultName ?? null,
                },
                isForked: d.schoolLessonTemplateId !== null,
            })),
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  GET /platform/distributions/summary — ملخص لكل مدرسة
    // ═══════════════════════════════════════════════════════════
    async getSummary(platformUserUuid: string) {
        await this.assertPlatformAdmin(platformUserUuid);

        const result = await this.prisma.contentDistribution.groupBy({
            by: ['schoolId'],
            where: { isDeleted: false, status: 'ACTIVE' },
            _count: { id: true },
        });

        if (result.length === 0) {
            return { schools: [], totalDistributions: 0, totalSchools: 0 };
        }

        const schoolIds = result.map((r) => r.schoolId);
        const schools = await this.prisma.school.findMany({
            where: { id: { in: schoolIds } },
            select: { id: true, uuid: true, name: true },
        });

        const schoolMap = new Map(schools.map((s) => [s.id, s]));

        // عدد التوزيعات التي تم Fork لها
        const forkedCounts = await this.prisma.contentDistribution.groupBy({
            by: ['schoolId'],
            where: {
                isDeleted: false,
                status: 'ACTIVE',
                schoolLessonTemplateId: { not: null },
            },
            _count: { id: true },
        });
        const forkedMap = new Map(forkedCounts.map((r) => [r.schoolId, r._count.id]));

        return {
            totalDistributions: result.reduce((sum, r) => sum + r._count.id, 0),
            totalSchools: result.length,
            schools: result.map((r) => ({
                uuid: schoolMap.get(r.schoolId)?.uuid,
                name: schoolMap.get(r.schoolId)?.name,
                totalDistributed: r._count.id,
                totalForked: forkedMap.get(r.schoolId) ?? 0,
            })),
        };
    }

    // ═══════════════════════════════════════════════════════════
    //  GET /platform/distributions/batches — أرشيف العمليات
    // ═══════════════════════════════════════════════════════════
    async getBatches(platformUserUuid: string) {
        await this.assertPlatformAdmin(platformUserUuid);

        const batches = await this.prisma.distributionBatch.findMany({
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
                platformUser: { select: { uuid: true, name: true } },
            },
        });

        return {
            batches: batches.map((b) => ({
                uuid: b.uuid,
                totalSchools: b.totalSchools,
                totalLessons: b.totalLessons,
                distributed: b.distributed,
                skipped: b.skipped,
                failed: b.failed,
                description: b.description,
                createdAt: b.createdAt,
                distributedBy: {
                    uuid: b.platformUser.uuid,
                    name: b.platformUser.name,
                },
            })),
        };
    }
}
