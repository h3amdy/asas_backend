// src/school/student/sync/student-sync.service.ts
import {
    BadRequestException,
    ForbiddenException,
    HttpException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { buildSanitizedVariantsMap } from '../../../shared/media/video-delivery.helper';
import { SyncPullDto } from './dto/sync-pull.dto';
import { SyncPushDto, ClientChange } from './dto/sync-push.dto';
import { parseCursor, paginateResult, PaginatedSyncResult } from './helpers/cursor-paginator';
import {
    QUESTION_EVALUATION_INCLUDE,
    evaluateQuestionAnswer,
    getGradeLabel,
} from '../quiz/helpers/answer-evaluator';

/**
 * أنواع الكيانات المدعومة في Pull
 */
const VALID_PULL_ENTITIES = ['subjects', 'lessons', 'questions', 'progress', 'timetable'] as const;
type PullEntity = typeof VALID_PULL_ENTITIES[number];

/**
 * أنواع الكيانات المدعومة في Push (تم إيقاف lesson_result حسب قرار المنتج)
 */
const VALID_PUSH_ENTITY_TYPES = ['student_answer', 'lesson_progress'] as const;
const VALID_PROGRESS_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'] as const;
const MAX_SYNC_ATTEMPTS = 999;

interface StudentSubscriptionWindow {
    allowed: boolean;
    active: boolean;
    reason: 'SUBSCRIPTION_REQUIRED' | 'SUBSCRIPTION_EXPIRED' | null;
    cutoff: Date | null;
}

@Injectable()
export class StudentSyncService {
    private readonly logger = new Logger(StudentSyncService.name);

    constructor(private readonly prisma: PrismaService) { }

    // ═══════════════════════════════════════════════════════════════
    // Helper: جلب Student + Enrollment
    // ═══════════════════════════════════════════════════════════════

    private async getStudentContext(schoolId: number, userUuid: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId, userType: 'STUDENT', isDeleted: false },
            include: { student: { select: { userId: true, uuid: true } } },
        });

        if (!user || !user.student) {
            throw new ForbiddenException('USER_IS_NOT_STUDENT');
        }

        const enrollment = await this.prisma.studentEnrollment.findFirst({
            where: {
                studentId: user.student.userId,
                isCurrent: true,
                status: 'ACTIVE',
                isDeleted: false,
            },
            include: {
                year: { select: { uuid: true } },
                grade: { select: { uuid: true } },
                section: { select: { uuid: true } },
            },
        });

        if (!enrollment) {
            throw new NotFoundException('ENROLLMENT_NOT_FOUND');
        }

        // جلب الفصل الحالي
        const currentTerm = await this.prisma.term.findFirst({
            where: {
                yearId: enrollment.yearId,
                isCurrent: true,
                isDeleted: false,
            },
            select: { uuid: true, id: true },
        });

        return {
            studentId: user.student.userId,
            studentUuid: user.student.uuid,
            sectionId: enrollment.sectionId,
            gradeId: enrollment.gradeId,
            yearId: enrollment.yearId,
            termId: currentTerm?.id ?? null,
            // Academic Snapshot — يُرسل للتطبيق لاكتشاف تغيير السياق
            academicSnapshot: {
                enrollmentUuid: enrollment.uuid,
                yearUuid: enrollment.year.uuid,
                gradeUuid: enrollment.grade.uuid,
                sectionUuid: enrollment.section.uuid,
                termUuid: currentTerm?.uuid ?? null,
            },
        };
    }

    /**
     * SRS-SUB-005 §3.4 — هل الطالب يحق له المحتوى؟
     * true عند: مدرسة مجانية أو فترة وصول سارية.
     */
    private async hasContentAccess(schoolId: number, studentId: number): Promise<boolean> {
        const settings = await this.prisma.schoolSubscriptionSettings.findUnique({
            where: { schoolId },
            select: { isActivated: true },
        });
        if (!settings?.isActivated) return true; // مدرسة مجانية

        const now = new Date();
        const active = await this.prisma.studentAccessPeriod.findFirst({
            where: {
                schoolId,
                studentUserId: studentId,
                endedEarlyAt: null,
                expiresAt: { gt: now },
            },
            select: { id: true },
        });
        return !!active;
    }

    // ═══════════════════════════════════════════════════════════════
    // MANIFEST — معلومات المزامنة
    // ═══════════════════════════════════════════════════════════════

    async getManifest(schoolId: number, userUuid: string) {
        const ctx = await this.getStudentContext(schoolId, userUuid);
        const contentEntitled = await this.hasContentAccess(schoolId, ctx.studentId);
        return {
            serverTime: new Date(),
            academicSnapshot: ctx.academicSnapshot,
            contentEntitled,
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // PULL — سحب البيانات (Delta أو Bootstrap)
    // ═══════════════════════════════════════════════════════════════

    async pull(schoolId: number, userUuid: string, dto: SyncPullDto) {
        const ctx = await this.getStudentContext(schoolId, userUuid);
        const limit = dto.limit ?? 200;
        const serverTime = new Date();
        const data: Record<string, any> = {};

        // SRS-SUB-005 §8.0 — فحص استحقاق المحتوى مرة واحدة
        const contentEntitled = await this.hasContentAccess(schoolId, ctx.studentId);

        for (const [entity, cursorStr] of Object.entries(dto.cursors)) {
            if (!VALID_PULL_ENTITIES.includes(entity as PullEntity)) {
                this.logger.warn(`Unknown entity type in pull: ${entity}`);
                continue;
            }

            const cursor = parseCursor(cursorStr);

            switch (entity as PullEntity) {
                case 'subjects':
                    data.subjects = await this.pullSubjects(schoolId, ctx, cursor, limit);
                    break;
                case 'lessons':
                    data.lessons = await this.pullLessons(schoolId, ctx, cursor, limit, contentEntitled);
                    break;
                case 'questions':
                    data.questions = contentEntitled
                        ? await this.pullQuestions(schoolId, ctx, cursor, limit)
                        : { items: [], hasMore: false, cursor: null };
                    break;
                case 'progress':
                    data.progress = await this.pullProgress(ctx, cursor, limit);
                    break;
                case 'timetable':
                    data.timetable = await this.pullTimetable(ctx, cursor, limit);
                    break;
            }
        }

        return {
            serverTime,
            academicSnapshot: ctx.academicSnapshot,
            contentEntitled,
            data,
        };
    }

    // ── Pull: المواد ─────────────────────────────────────────────

    private async pullSubjects(
        schoolId: number,
        ctx: Awaited<ReturnType<typeof this.getStudentContext>>,
        cursor: { updatedAt: Date; uuid: string } | null,
        limit: number,
    ) {
        const where: any = {
            schoolId,
            gradeId: ctx.gradeId,
        };

        if (cursor) {
            where.OR = [
                { updatedAt: { gt: cursor.updatedAt } },
                { AND: [{ updatedAt: cursor.updatedAt }, { uuid: { gt: cursor.uuid } }] },
            ];
        }

        const items = await this.prisma.subject.findMany({
            where,
            orderBy: [{ updatedAt: 'asc' }, { uuid: 'asc' }],
            take: limit + 1,
            select: {
                uuid: true,
                displayName: true,
                shortName: true,
                code: true,
                isActive: true,
                isDeleted: true,
                updatedAt: true,
                coverMediaAsset: { select: { uuid: true } },
            },
        });

        return paginateResult(
            items.map(s => ({
                uuid: s.uuid,
                displayName: s.displayName,
                shortName: s.shortName,
                code: s.code,
                isActive: s.isActive,
                isDeleted: s.isDeleted,
                updatedAt: s.updatedAt,
                coverMediaAssetUuid: s.coverMediaAsset?.uuid ?? null,
            })),
            limit,
        );
    }

    // ── Pull: الدروس ────────────────────────────────────────────

    private async pullLessons(
        schoolId: number,
        ctx: Awaited<ReturnType<typeof this.getStudentContext>>,
        cursor: { updatedAt: Date; uuid: string } | null,
        limit: number,
        contentEntitled: boolean = true,
    ) {
        const where: any = {
            schoolId,
            status: { not: 'ARCHIVED' },
            // DEC-024 v3.0: Per-Target visibility
            targets: { some: { sectionId: ctx.sectionId, publishedAt: { not: null } } },
        };

        if (cursor) {
            where.OR = [
                { updatedAt: { gt: cursor.updatedAt } },
                { AND: [{ updatedAt: cursor.updatedAt }, { uuid: { gt: cursor.uuid } }] },
            ];
        }

        const items = await this.prisma.lesson.findMany({
            where,
            orderBy: [{ updatedAt: 'asc' }, { uuid: 'asc' }],
            take: limit + 1,
            include: {
                template: {
                    include: {
                        unit: { select: { uuid: true, title: true, orderIndex: true } },
                        coverMediaAsset: { select: { uuid: true } },
                        _count: {
                            select: { questions: { where: { isDeleted: false } } },
                        },
                        // محتوى الدرس (فقرات + عناصر)
                        contentBlocks: {
                            where: { isDeleted: false },
                            orderBy: { orderIndex: 'asc' },
                            include: {
                                items: {
                                    where: { isDeleted: false },
                                    orderBy: { orderIndex: 'asc' },
                                    include: {
                                        mediaAsset: {
                                            select: {
                                                uuid: true,
                                                kind: true,
                                                contentType: true,
                                                durationSec: true,
                                                processingStatus: true,
                                                variantsJson: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                subject: { select: { uuid: true, displayName: true, isDeleted: true, isActive: true } },
                // Per-Target: جلب target الطالب للحصول على publishedAt
                targets: {
                    where: { sectionId: ctx.sectionId, publishedAt: { not: null } },
                    select: { publishedAt: true },
                    take: 1,
                },
            },
        });

        return paginateResult(
            items.map(lesson => ({
                uuid: lesson.uuid,
                subjectUuid: lesson.subject.uuid,
                subjectName: lesson.subject.displayName,
                title: lesson.template.title,
                unitUuid: lesson.template.unit?.uuid ?? null,
                unitName: lesson.template.unit?.title ?? null,
                unitOrder: lesson.template.unit?.orderIndex ?? 0,
                orderIndex: lesson.template.orderIndex,
                questionCount: lesson.template._count.questions,
                coverMediaAssetUuid: lesson.template.coverMediaAsset?.uuid ?? null,
                status: lesson.status,
                publishedAt: lesson.targets[0]?.publishedAt ?? null, // Per-Target
                isActive: lesson.isActive && lesson.subject.isActive,
                // درس تابع لمادة محذوفة يُعامل كمحذوف — وإلا يبني التطبيق مادة "شبح" مكررة
                // من الدروس القديمة بجانب المادة المُعاد استيرادها (نفس الاسم، UUID مختلف)
                isDeleted: lesson.isDeleted || lesson.subject.isDeleted,
                updatedAt: lesson.updatedAt,
                // محتوى الدرس — يُحذف لغير المشترك (SRS-SUB-005 §8.0)
                contentBlocks: contentEntitled
                    ? lesson.template.contentBlocks.map(b => ({
                        uuid: b.uuid,
                        title: b.title,
                        orderIndex: b.orderIndex,
                        items: b.items.map(item => ({
                            uuid: item.uuid,
                            itemType: item.itemType,
                            orderIndex: item.orderIndex,
                            textContent: item.textContent,
                            caption: item.caption,
                            mediaAssetUuid: item.mediaAsset?.uuid ?? null,
                            mediaAssetKind: item.mediaAsset?.kind ?? null,
                            contentType: item.mediaAsset?.contentType ?? null,
                            durationSec: item.mediaAsset?.durationSec ?? null,
                            mediaVariants:
                                item.mediaAsset?.kind === 'VIDEO'
                                    ? buildSanitizedVariantsMap(
                                          'VIDEO',
                                          item.mediaAsset.variantsJson ?? null,
                                      )
                                    : null,
                        })),
                    }))
                    : [],
                // قائمة UUIDs الوسائط للتحميل المسبق
                mediaAssetUuids: contentEntitled
                    ? this.extractMediaUuids(lesson.template.contentBlocks, lesson.template.coverMediaAsset?.uuid)
                    : (lesson.template.coverMediaAsset?.uuid ? [lesson.template.coverMediaAsset.uuid] : []),
                contentLocked: !contentEntitled,
            })),
            limit,
        );
    }

    /**
     * استخراج كل UUIDs الوسائط من محتوى الدرس (للتحميل المسبق)
     * W-049: يتم استثناء أصول VIDEO من mediaAssetUuids لأن تنزيلها يتم عبر /download-url?variant=...
     */
    private extractMediaUuids(blocks: any[], coverUuid?: string | null): string[] {
        const uuids = new Set<string>();
        if (coverUuid) uuids.add(coverUuid);

        for (const block of blocks) {
            for (const item of block.items) {
                if (
                    item.mediaAsset?.uuid &&
                    item.mediaAsset.kind !== 'VIDEO' &&
                    item.itemType !== 'VIDEO'
                ) {
                    uuids.add(item.mediaAsset.uuid);
                }
            }
        }
        return Array.from(uuids);
    }

    // ── Pull: الأسئلة ───────────────────────────────────────────

    private async pullQuestions(
        schoolId: number,
        ctx: Awaited<ReturnType<typeof this.getStudentContext>>,
        cursor: { updatedAt: Date; uuid: string } | null,
        limit: number,
    ) {
        // نجلب أسئلة الدروس المستهدفة لشعبة الطالب فقط
        const where: any = {
            // Include deleted questions as well; client will process isDeleted flag
            template: {
                lessons: {
                    some: {
                        schoolId,
                        isActive: true,
                        status: { not: 'ARCHIVED' },
                        // DEC-024 v3.0: Per-Target visibility
                        targets: { some: { sectionId: ctx.sectionId, publishedAt: { not: null } } },
                    },
                },
            },
        };

        if (cursor) {
            where.OR = [
                { updatedAt: { gt: cursor.updatedAt } },
                { AND: [{ updatedAt: cursor.updatedAt }, { uuid: { gt: cursor.uuid } }] },
            ];
        }

        const items = await this.prisma.question.findMany({
            where,
            orderBy: [{ updatedAt: 'asc' }, { uuid: 'asc' }],
            take: limit + 1,
            include: {
                template: { select: { uuid: true } },
                questionImageAsset: { select: { uuid: true } },
                questionAudioAsset: { select: { uuid: true } },
                explanationImageAsset: { select: { uuid: true } },
                explanationAudioAsset: { select: { uuid: true } },
                options: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    include: {
                        imageAsset: { select: { uuid: true } },
                        audioAsset: { select: { uuid: true } },
                    },
                },
                matchingPairs: {
                    where: { isDeleted: false },
                    include: {
                        leftImageAsset: { select: { uuid: true } },
                        leftAudioAsset: { select: { uuid: true } },
                        rightImageAsset: { select: { uuid: true } },
                        rightAudioAsset: { select: { uuid: true } },
                    },
                },
                orderingItems: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    include: {
                        imageAsset: { select: { uuid: true } },
                        audioAsset: { select: { uuid: true } },
                    },
                },
                fillBlanks: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                },
                fillAnswers: {
                    where: { isDeleted: false },
                },
            },
        });

        return paginateResult(
            items.map(q => ({
                uuid: q.uuid,
                lessonTemplateUuid: q.template.uuid,
                type: q.type,
                orderIndex: q.orderIndex,
                instructionText: q.instructionText,
                questionText: q.questionText,
                score: q.score,
                explanationText: q.explanationText,
                isDeleted: q.isDeleted,
                updatedAt: q.updatedAt,
                // Media UUIDs
                questionImageAssetUuid: q.questionImageAsset?.uuid ?? null,
                questionAudioAssetUuid: q.questionAudioAsset?.uuid ?? null,
                explanationImageAssetUuid: q.explanationImageAsset?.uuid ?? null,
                explanationAudioAssetUuid: q.explanationAudioAsset?.uuid ?? null,
                // بيانات حسب النوع
                options: q.options.map(o => ({
                    uuid: o.uuid,
                    optionText: o.optionText,
                    isCorrect: o.isCorrect,
                    orderIndex: o.orderIndex,
                    imageAssetUuid: o.imageAsset?.uuid ?? null,
                    audioAssetUuid: o.audioAsset?.uuid ?? null,
                })),
                matchingPairs: q.matchingPairs.map(mp => ({
                    uuid: mp.uuid,
                    pairKey: mp.pairKey,
                    leftText: mp.leftText,
                    rightText: mp.rightText,
                    leftOrderIndex: mp.leftOrderIndex,
                    rightOrderIndex: mp.rightOrderIndex,
                    leftImageAssetUuid: mp.leftImageAsset?.uuid ?? null,
                    leftAudioAssetUuid: mp.leftAudioAsset?.uuid ?? null,
                    rightImageAssetUuid: mp.rightImageAsset?.uuid ?? null,
                    rightAudioAssetUuid: mp.rightAudioAsset?.uuid ?? null,
                })),
                orderingItems: q.orderingItems.map(oi => ({
                    uuid: oi.uuid,
                    itemText: oi.itemText,
                    correctIndex: oi.correctIndex,
                    orderIndex: oi.orderIndex,
                    imageAssetUuid: oi.imageAsset?.uuid ?? null,
                    audioAssetUuid: oi.audioAsset?.uuid ?? null,
                })),
                fillBlanks: q.fillBlanks.map(fb => ({
                    uuid: fb.uuid,
                    blankKey: fb.blankKey,
                    orderIndex: fb.orderIndex,
                    placeholder: fb.placeholder,
                })),
                fillAnswers: q.fillAnswers.map(fa => ({
                    uuid: fa.uuid,
                    blankKey: fa.blankKey,
                    answerText: fa.answerText,
                    isPrimary: fa.isPrimary,
                })),
                // قائمة وسائط للتحميل
                mediaAssetUuids: this.extractQuestionMediaUuids(q),
            })),
            limit,
        );
    }

    private extractQuestionMediaUuids(q: any): string[] {
        const uuids = new Set<string>();

        if (q.questionImageAsset?.uuid) uuids.add(q.questionImageAsset.uuid);
        if (q.questionAudioAsset?.uuid) uuids.add(q.questionAudioAsset.uuid);
        if (q.explanationImageAsset?.uuid) uuids.add(q.explanationImageAsset.uuid);
        if (q.explanationAudioAsset?.uuid) uuids.add(q.explanationAudioAsset.uuid);

        for (const o of q.options ?? []) {
            if (o.imageAsset?.uuid) uuids.add(o.imageAsset.uuid);
            if (o.audioAsset?.uuid) uuids.add(o.audioAsset.uuid);
        }
        for (const mp of q.matchingPairs ?? []) {
            if (mp.leftImageAsset?.uuid) uuids.add(mp.leftImageAsset.uuid);
            if (mp.leftAudioAsset?.uuid) uuids.add(mp.leftAudioAsset.uuid);
            if (mp.rightImageAsset?.uuid) uuids.add(mp.rightImageAsset.uuid);
            if (mp.rightAudioAsset?.uuid) uuids.add(mp.rightAudioAsset.uuid);
        }
        for (const oi of q.orderingItems ?? []) {
            if (oi.imageAsset?.uuid) uuids.add(oi.imageAsset.uuid);
            if (oi.audioAsset?.uuid) uuids.add(oi.audioAsset.uuid);
        }

        return Array.from(uuids);
    }

    // ── Pull: تقدم الطالب ───────────────────────────────────────

    private async pullProgress(
        ctx: Awaited<ReturnType<typeof this.getStudentContext>>,
        cursor: { updatedAt: Date; uuid: string } | null,
        limit: number,
    ) {
        const where: any = {
            studentId: ctx.studentId,
            isDeleted: false,
        };

        if (cursor) {
            where.OR = [
                { updatedAt: { gt: cursor.updatedAt } },
                { AND: [{ updatedAt: cursor.updatedAt }, { uuid: { gt: cursor.uuid } }] },
            ];
        }

        const items = await this.prisma.studentLessonProgress.findMany({
            where,
            orderBy: [{ updatedAt: 'asc' }, { uuid: 'asc' }],
            take: limit + 1,
            include: {
                lesson: { select: { uuid: true } },
            },
        });

        return paginateResult(
            items.map(p => ({
                uuid: p.uuid,
                lessonUuid: p.lesson.uuid,
                status: p.status,
                lastPosition: p.lastPosition,
                isDeleted: p.isDeleted,
                updatedAt: p.updatedAt,
                rowVersion: p.rowVersion,
            })),
            limit,
        );
    }

    // ── Pull: الجدول الدراسي ────────────────────────────────────

    private async pullTimetable(
        ctx: Awaited<ReturnType<typeof this.getStudentContext>>,
        cursor: { updatedAt: Date; uuid: string } | null,
        limit: number,
    ) {
        // الجدول الدراسي لشعبة الطالب في الفصل الحالي
        if (!ctx.termId) {
            return { items: [], hasMore: false, cursor: null };
        }

        const where: any = {
            sectionId: ctx.sectionId,
            yearId: ctx.yearId,
            termId: ctx.termId,
            isDeleted: false,
        };

        if (cursor) {
            where.OR = [
                { updatedAt: { gt: cursor.updatedAt } },
                { AND: [{ updatedAt: cursor.updatedAt }, { uuid: { gt: cursor.uuid } }] },
            ];
        }

        const timetables = await this.prisma.timetable.findMany({
            where,
            orderBy: [{ updatedAt: 'asc' }, { uuid: 'asc' }],
            take: limit + 1,
            include: {
                slots: {
                    where: { isDeleted: false },
                    orderBy: [{ weekday: 'asc' }, { lessonNumber: 'asc' }],
                    include: {
                        subjectSection: {
                            include: {
                                subject: { select: { uuid: true, displayName: true } },
                                teachers: {
                                    where: { isActive: true, isDeleted: false },
                                    include: {
                                        teacher: {
                                            include: {
                                                user: { select: { displayName: true } },
                                            },
                                        },
                                    },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
            },
        });

        return paginateResult(
            timetables.map(tt => ({
                uuid: tt.uuid,
                status: tt.status,
                isDeleted: tt.isDeleted,
                updatedAt: tt.updatedAt,
                slots: tt.slots.map(s => ({
                    uuid: s.uuid,
                    weekday: s.weekday,
                    lessonNumber: s.lessonNumber,
                    subjectUuid: s.subjectSection?.subject?.uuid ?? null,
                    subjectName: s.subjectSection?.subject?.displayName ?? null,
                    teacherName: s.subjectSection?.teachers?.[0]?.teacher?.user?.displayName ?? null,
                })),
            })),
            limit,
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // PUSH — دفع التغييرات من Outbox (ذري + مقيّد بالملكية والاحتساب الخادمي)
    // ═══════════════════════════════════════════════════════════════

    private async getStudentSubscriptionWindow(
        db: Prisma.TransactionClient | PrismaService,
        schoolId: number,
        studentId: number,
    ): Promise<StudentSubscriptionWindow> {
        const settings = await db.schoolSubscriptionSettings.findUnique({
            where: { schoolId },
            select: { isActivated: true },
        });
        if (!settings?.isActivated) {
            return { allowed: true, active: true, reason: null, cutoff: null };
        }

        const periods = await db.studentAccessPeriod.findMany({
            where: { schoolId, studentUserId: studentId },
            select: { expiresAt: true, endedEarlyAt: true },
        });

        const now = new Date();
        if (periods.some((p) => p.endedEarlyAt === null && p.expiresAt > now)) {
            return { allowed: true, active: true, reason: null, cutoff: null };
        }

        if (periods.length === 0) {
            return {
                allowed: false,
                active: false,
                reason: 'SUBSCRIPTION_REQUIRED',
                cutoff: null,
            };
        }

        let cutoff: Date | null = null;
        for (const p of periods) {
            const effectiveEnd =
                p.endedEarlyAt && p.endedEarlyAt < p.expiresAt ? p.endedEarlyAt : p.expiresAt;
            if (!cutoff || effectiveEnd > cutoff) {
                cutoff = effectiveEnd;
            }
        }

        return {
            allowed: true,
            active: false,
            reason: 'SUBSCRIPTION_EXPIRED',
            cutoff,
        };
    }

    private assertLessonSubscriptionAccess(
        subWindow: StudentSubscriptionWindow,
        lessonPublishedAt: Date | null | undefined,
    ): void {
        if (subWindow.active) {
            return;
        }
        if (!subWindow.allowed) {
            throw new ForbiddenException('SUBSCRIPTION_REQUIRED');
        }
        // قرار المنتج #3: قبول التقدم/الإجابات المنجزة أوفلاين لدروس نُشرت قبل انتهاء الاشتراك
        if (lessonPublishedAt && subWindow.cutoff && lessonPublishedAt <= subWindow.cutoff) {
            return;
        }
        throw new ForbiddenException('SUBSCRIPTION_EXPIRED');
    }

    private async resolveAccessibleLessonTx(
        tx: Prisma.TransactionClient,
        schoolId: number,
        sectionId: number,
        lessonUuid: unknown,
    ) {
        if (typeof lessonUuid !== 'string' || lessonUuid.trim().length === 0) {
            throw new ForbiddenException('LESSON_NOT_ACCESSIBLE');
        }

        const lesson = await tx.lesson.findFirst({
            where: {
                uuid: lessonUuid,
                schoolId,
                isDeleted: false,
                isActive: true,
                status: { not: 'ARCHIVED' },
                targets: {
                    some: {
                        sectionId,
                        publishedAt: { not: null },
                    },
                },
            },
            select: {
                id: true,
                uuid: true,
                templateId: true,
                template: { select: { questionsRevision: true } },
                targets: {
                    where: { sectionId, publishedAt: { not: null } },
                    select: { publishedAt: true },
                    take: 1,
                },
            },
        });

        if (!lesson) {
            throw new ForbiddenException('LESSON_NOT_ACCESSIBLE');
        }

        return lesson;
    }

    private async resolveAccessibleQuestionTx(
        tx: Prisma.TransactionClient,
        schoolId: number,
        sectionId: number,
        questionUuid: unknown,
        lessonUuid?: unknown,
        yearId?: number,
    ) {
        if (typeof questionUuid !== 'string' || questionUuid.trim().length === 0) {
            throw new ForbiddenException('QUESTION_NOT_ACCESSIBLE');
        }

        // B-4: إذا أرسل العميل lessonUuid (حتى كسلسلة فارغة أو نوع خاطئ)، نتحقق منه بصرامة بلا تراجع صامت
        if (lessonUuid !== undefined && lessonUuid !== null) {
            if (typeof lessonUuid !== 'string' || lessonUuid.trim().length === 0) {
                throw new ForbiddenException('QUESTION_NOT_ACCESSIBLE');
            }
            const lesson = await this.resolveAccessibleLessonTx(tx, schoolId, sectionId, lessonUuid);
            const question = await tx.question.findFirst({
                where: {
                    uuid: questionUuid,
                    templateId: lesson.templateId,
                    isDeleted: false,
                },
                include: QUESTION_EVALUATION_INCLUDE,
            });
            if (!question) {
                throw new ForbiddenException('QUESTION_NOT_ACCESSIBLE');
            }
            return { lesson, question };
        }

        const accessibleLessonFilter = {
            schoolId,
            isDeleted: false,
            isActive: true,
            status: { not: 'ARCHIVED' as const },
            targets: {
                some: {
                    sectionId,
                    publishedAt: { not: null },
                },
            },
        };

        const question = await tx.question.findFirst({
            where: {
                uuid: questionUuid,
                isDeleted: false,
                template: {
                    lessons: {
                        some: accessibleLessonFilter,
                    },
                },
            },
            include: {
                ...QUESTION_EVALUATION_INCLUDE,
                template: {
                    select: {
                        questionsRevision: true,
                        lessons: {
                            where: accessibleLessonFilter,
                            select: {
                                id: true,
                                uuid: true,
                                yearId: true,
                                templateId: true,
                                template: { select: { questionsRevision: true } },
                                targets: {
                                    where: { sectionId, publishedAt: { not: null } },
                                    select: { publishedAt: true },
                                    orderBy: { publishedAt: 'desc' },
                                    take: 1,
                                },
                            },
                        },
                    },
                },
            },
        });

        const accessibleLessons = question?.template?.lessons ?? [];
        if (!question || accessibleLessons.length === 0) {
            throw new ForbiddenException('QUESTION_NOT_ACCESSIBLE');
        }

        // B-4: اختيار حتمي للدرس المطابق لسنة الطالب الحالية وأحدث تاريخ نشر
        const currentYearMatches =
            yearId !== undefined
                ? accessibleLessons.filter((l) => l.yearId === yearId)
                : [];
        const pool = currentYearMatches.length > 0 ? currentYearMatches : accessibleLessons;
        const lesson = [...pool].sort((a, b) => {
            const diff =
                (b.targets[0]?.publishedAt?.getTime() ?? 0) -
                (a.targets[0]?.publishedAt?.getTime() ?? 0);
            return diff !== 0 ? diff : b.id - a.id;
        })[0];

        return { lesson, question };
    }

    async push(schoolId: number, userUuid: string, dto: SyncPushDto) {
        const ctx = await this.getStudentContext(schoolId, userUuid);
        const subWindow = await this.getStudentSubscriptionWindow(
            this.prisma,
            schoolId,
            ctx.studentId,
        );
        const results: { clientChangeUuid: string; status: string; error?: string }[] = [];

        for (const change of dto.changes) {
            try {
                if (typeof change.clientChangeUuid !== 'string' || change.clientChangeUuid.trim().length === 0) {
                    throw new BadRequestException('INVALID_CLIENT_CHANGE_UUID');
                }
                if (change.operation?.toLowerCase() !== 'upsert') {
                    throw new BadRequestException('OPERATION_NOT_SUPPORTED');
                }
                if (change.entityType === 'lesson_result') {
                    // قرار المنتج #7: رفض lesson_result المباشر من العميل
                    throw new BadRequestException('ENTITY_TYPE_NOT_SUPPORTED');
                }
                if (!VALID_PUSH_ENTITY_TYPES.includes(change.entityType as any)) {
                    throw new BadRequestException('UNKNOWN_ENTITY_TYPE');
                }

                // SEC-R3-03: التحقق من Idempotency وتسجيله وتنفيذ التغيير داخل معاملة ذرية واحدة
                const status = await this.prisma.$transaction(async (tx) => {
                    const existing = await tx.processedClientChange.findUnique({
                        where: { clientChangeUuid: change.clientChangeUuid },
                        select: { studentId: true },
                    });

                    if (existing) {
                        if (existing.studentId !== ctx.studentId) {
                            throw new ForbiddenException('CLIENT_CHANGE_CONFLICT');
                        }
                        return 'ALREADY_PROCESSED';
                    }

                    await tx.processedClientChange.create({
                        data: {
                            clientChangeUuid: change.clientChangeUuid,
                            entityType: change.entityType,
                            entityUuid: change.entityUuid ?? '',
                            studentId: ctx.studentId,
                        },
                    });

                    if (change.entityType === 'lesson_progress') {
                        await this.processProgressChangeTx(tx, ctx, schoolId, subWindow, change);
                    } else if (change.entityType === 'student_answer') {
                        await this.processAnswerChangeTx(tx, ctx, schoolId, subWindow, change);
                    }

                    return 'OK';
                });

                results.push({
                    clientChangeUuid: change.clientChangeUuid,
                    status,
                });
            } catch (error: any) {
                // عند تزامن اتصالين متوازيين بنفس clientChangeUuid، يسقط الثاني بـ P2002 وتنتفي الازدواجية
                const isPrismaUniqueError =
                    error?.code === 'P2002' ||
                    (typeof error?.message === 'string' &&
                        error.message.includes('Unique constraint'));
                const metaTarget = error?.meta?.target;
                const targetsClientChangeUuid =
                    !metaTarget ||
                    (Array.isArray(metaTarget) &&
                        metaTarget.some(
                            (t: unknown) =>
                                String(t).includes('client_change_uuid') ||
                                String(t).includes('clientChangeUuid'),
                        )) ||
                    (typeof metaTarget === 'string' &&
                        (metaTarget.includes('client_change_uuid') ||
                            metaTarget.includes('clientChangeUuid')));

                if (isPrismaUniqueError && targetsClientChangeUuid) {
                    const existingRow = await this.prisma.processedClientChange.findUnique({
                        where: { clientChangeUuid: change.clientChangeUuid },
                        select: { studentId: true },
                    });
                    if (existingRow && existingRow.studentId === ctx.studentId) {
                        results.push({
                            clientChangeUuid: change.clientChangeUuid,
                            status: 'ALREADY_PROCESSED',
                        });
                        continue;
                    }
                    results.push({
                        clientChangeUuid: change.clientChangeUuid,
                        status: 'ERROR',
                        error: 'CLIENT_CHANGE_CONFLICT',
                    });
                    continue;
                }

                this.logger.error(
                    `Failed to process change ${change.clientChangeUuid}: ${error?.message ?? 'Unknown error'}`,
                    error?.stack,
                );
                results.push({
                    clientChangeUuid: change.clientChangeUuid,
                    status: 'ERROR',
                    error:
                        error instanceof HttpException ? error.message : 'INTERNAL_SYNC_ERROR',
                });
            }
        }

        return {
            results,
            serverTime: new Date(),
        };
    }

    private async processProgressChangeTx(
        tx: Prisma.TransactionClient,
        ctx: { studentId: number; sectionId: number },
        schoolId: number,
        subWindow: StudentSubscriptionWindow,
        change: ClientChange,
    ) {
        const { lessonUuid, status, lastPosition } = change.payload ?? {};

        if (!VALID_PROGRESS_STATUSES.includes(status)) {
            throw new BadRequestException('INVALID_PROGRESS_STATUS');
        }

        const lesson = await this.resolveAccessibleLessonTx(
            tx,
            schoolId,
            ctx.sectionId,
            lessonUuid,
        );

        this.assertLessonSubscriptionAccess(subWindow, lesson.targets[0]?.publishedAt ?? null);

        if (typeof (tx as any).$executeRaw === 'function') {
            await tx.$executeRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(CAST(${ctx.studentId} AS INTEGER), CAST(${lesson.id} AS INTEGER))`,
            );
        }

        const serializedPosition =
            lastPosition == null
                ? null
                : typeof lastPosition === 'string'
                  ? lastPosition
                  : JSON.stringify(lastPosition);

        // Decision 1 (P4-5d): حماية COMPLETED من التراجع إلى IN_PROGRESS ذرياً على مستوى قاعدة البيانات
        if (typeof (tx as any).$executeRaw === 'function') {
            await tx.$executeRaw(Prisma.sql`
                INSERT INTO "student_lesson_progress" (
                    "uuid",
                    "student_id",
                    "lesson_id",
                    "status",
                    "last_position",
                    "created_at",
                    "updated_at"
                ) VALUES (
                    gen_random_uuid(),
                    ${ctx.studentId},
                    ${lesson.id},
                    ${status},
                    ${serializedPosition},
                    NOW(),
                    NOW()
                )
                ON CONFLICT ("student_id", "lesson_id") DO UPDATE SET
                    "status" = CASE
                        WHEN "student_lesson_progress"."status" = 'COMPLETED' THEN 'COMPLETED'
                        ELSE EXCLUDED."status"
                    END,
                    "last_position" = CASE
                        WHEN "student_lesson_progress"."status" = 'COMPLETED' AND EXCLUDED."status" <> 'COMPLETED'
                            THEN "student_lesson_progress"."last_position"
                        ELSE EXCLUDED."last_position"
                    END,
                    "is_deleted" = false,
                    "deleted_at" = NULL,
                    "updated_at" = NOW()
            `);
        } else {
            const existingProgress = await tx.studentLessonProgress?.findUnique?.({
                where: {
                    studentId_lessonId: {
                        studentId: ctx.studentId,
                        lessonId: lesson.id,
                    },
                },
                select: { status: true, lastPosition: true },
            });
            const isAlreadyCompleted = existingProgress?.status === 'COMPLETED';
            const nextStatus = isAlreadyCompleted ? 'COMPLETED' : status;
            const nextLastPosition =
                isAlreadyCompleted && status !== 'COMPLETED'
                    ? existingProgress?.lastPosition ?? serializedPosition
                    : serializedPosition;

            await tx.studentLessonProgress.upsert({
                where: {
                    studentId_lessonId: {
                        studentId: ctx.studentId,
                        lessonId: lesson.id,
                    },
                },
                update: {
                    status: nextStatus,
                    lastPosition: nextLastPosition,
                    isDeleted: false,
                    deletedAt: null,
                },
                create: {
                    studentId: ctx.studentId,
                    lessonId: lesson.id,
                    status,
                    lastPosition: serializedPosition,
                },
            });
        }

        if (status === 'COMPLETED') {
            await this.maybeDeriveLessonResultTx(tx, ctx.studentId, lesson);
        }
    }

    private async processAnswerChangeTx(
        tx: Prisma.TransactionClient,
        ctx: { studentId: number; sectionId: number; yearId?: number },
        schoolId: number,
        subWindow: StudentSubscriptionWindow,
        change: ClientChange,
    ) {
        const { questionUuid, answerValue, lessonUuid } = change.payload ?? {};

        const { lesson, question } = await this.resolveAccessibleQuestionTx(
            tx,
            schoolId,
            ctx.sectionId,
            questionUuid,
            lessonUuid,
            ctx.yearId,
        );

        this.assertLessonSubscriptionAccess(subWindow, lesson.targets[0]?.publishedAt ?? null);

        if (typeof (tx as any).$executeRaw === 'function') {
            await tx.$executeRaw(
                Prisma.sql`SELECT pg_advisory_xact_lock(CAST(${ctx.studentId} AS INTEGER), CAST(${lesson.id} AS INTEGER))`,
            );
        }

        // إعادة التقييم بالكامل على الخادم وتجاهل isCorrect/correctness/scoreAwarded/resultUuid القادمة من العميل
        const isCorrect = evaluateQuestionAnswer(question, answerValue);
        const correctness = isCorrect ? 'CORRECT' : 'WRONG';
        const scoreAwarded = isCorrect ? question.score : 0;
        const serializedAnswer =
            typeof answerValue === 'string' ? answerValue : JSON.stringify(answerValue ?? null);

        await tx.studentAnswer.upsert({
            where: {
                studentId_questionId: {
                    studentId: ctx.studentId,
                    questionId: question.id,
                },
            },
            update: {
                answerValue: serializedAnswer,
                correctness,
                isCorrect,
                scoreAwarded,
                isDeleted: false,
                deletedAt: null,
            },
            create: {
                studentId: ctx.studentId,
                questionId: question.id,
                answerValue: serializedAnswer,
                correctness,
                isCorrect,
                scoreAwarded,
            },
        });

        // SEC-R3-04: إذا وصل التقدم COMPLETED قبل الإجابات، تشتق النتيجة تلقائياً بمجرد اكتمال إجابات القالب
        const progress = await tx.studentLessonProgress.findUnique({
            where: {
                studentId_lessonId: {
                    studentId: ctx.studentId,
                    lessonId: lesson.id,
                },
            },
            select: { status: true, isDeleted: true },
        });
        if (progress && !progress.isDeleted && progress.status === 'COMPLETED') {
            await this.maybeDeriveLessonResultTx(tx, ctx.studentId, lesson);
        }
    }

    private async maybeDeriveLessonResultTx(
        tx: Prisma.TransactionClient,
        studentId: number,
        lesson: {
            id: number;
            templateId: number;
            template?: { questionsRevision: number } | null;
        },
    ) {
        const latestResult = await tx.studentLessonResult.findFirst({
            where: { studentId, lessonId: lesson.id, isDeleted: false },
            orderBy: [{ calculatedAt: 'desc' }, { version: 'desc' }],
        });

        const questions = await tx.question.findMany({
            where: { templateId: lesson.templateId, isDeleted: false },
            include: QUESTION_EVALUATION_INCLUDE,
        });

        const serverQuestionsRevision = lesson.template?.questionsRevision ?? 1;

        if (questions.length === 0) {
            if (latestResult) {
                return;
            }
            const versionAgg = await tx.studentLessonResult.aggregate({
                where: { studentId, lessonId: lesson.id },
                _max: { version: true },
            });
            const nextVersion = (versionAgg._max.version ?? 0) + 1;

            // قرار المنتج #5: درس قرائي متاح بدون أسئلة → نتيجة 100%
            await tx.studentLessonResult.create({
                data: {
                    studentId,
                    lessonId: lesson.id,
                    totalQuestions: 0,
                    correctQuestions: 0,
                    totalPoints: 0,
                    earnedPoints: 0,
                    percent: 100,
                    gradeLabel: 'تمت القراءة',
                    calculatedAt: new Date(),
                    version: nextVersion,
                    questionsRevisionAtSubmit: serverQuestionsRevision,
                },
            });
            return;
        }

        const questionIds = questions.map((q) => q.id);
        const answers = await tx.studentAnswer.findMany({
            where: {
                studentId,
                questionId: { in: questionIds },
                isDeleted: false,
            },
        });

        // SEC-R3-04: لا نشتق نتيجة 0% مبكرة قبل وصول إجابات كافة أسئلة القالب
        if (answers.length < questions.length) {
            return;
        }

        const answerByQuestionId = new Map(answers.map((a) => [a.questionId, a]));
        const totalQuestions = questions.length;
        const totalPoints = questions.reduce((sum, q) => sum + q.score, 0);

        let correctQuestions = 0;
        let earnedPoints = 0;

        for (const q of questions) {
            const ans = answerByQuestionId.get(q.id);
            if (!ans) {
                return;
            }
            const isCorrect = evaluateQuestionAnswer(q, ans.answerValue);
            if (isCorrect) {
                correctQuestions++;
                earnedPoints += q.score;
            }
        }

        const percent =
            totalPoints > 0
                ? Math.max(0, Math.min(100, (earnedPoints / totalPoints) * 100))
                : 0;
        const gradeLabel = getGradeLabel(percent);

        // B-1 (OBS-W2-01 + إعادة المحاولة أوفلاين): إذا تغيّرت الدرجة أو معطيات التقييم عن آخر نتيجة
        // نشتق إصدار نتيجة جديد ونربط الإجابات به بدلاً من تجميد النتيجة على القيمة القديمة
        if (latestResult) {
            const scoreChanged =
                latestResult.totalQuestions !== totalQuestions ||
                latestResult.correctQuestions !== correctQuestions ||
                latestResult.totalPoints !== totalPoints ||
                latestResult.earnedPoints !== earnedPoints ||
                latestResult.questionsRevisionAtSubmit !== serverQuestionsRevision;

            if (!scoreChanged) {
                await tx.studentAnswer.updateMany({
                    where: {
                        studentId,
                        questionId: { in: questionIds },
                        isDeleted: false,
                        OR: [
                            { resultId: null },
                            { resultId: { not: latestResult.id } },
                        ],
                    },
                    data: {
                        resultId: latestResult.id,
                    },
                });
                return;
            }

            const attemptCount = await tx.studentLessonResult.count({
                where: { studentId, lessonId: lesson.id, isDeleted: false },
            });
            if (attemptCount >= MAX_SYNC_ATTEMPTS) {
                return;
            }
        }

        const versionAgg = await tx.studentLessonResult.aggregate({
            where: { studentId, lessonId: lesson.id },
            _max: { version: true },
        });
        const nextVersion = (versionAgg._max.version ?? 0) + 1;

        const result = await tx.studentLessonResult.create({
            data: {
                studentId,
                lessonId: lesson.id,
                totalQuestions,
                correctQuestions,
                totalPoints,
                earnedPoints,
                percent,
                gradeLabel,
                calculatedAt: new Date(),
                version: nextVersion,
                questionsRevisionAtSubmit: serverQuestionsRevision,
            },
        });

        await tx.studentAnswer.updateMany({
            where: {
                studentId,
                questionId: { in: questionIds },
                isDeleted: false,
            },
            data: {
                resultId: result.id,
            },
        });
    }
}
