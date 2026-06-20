// src/school/student/sync/student-sync.service.ts
import { Injectable, ForbiddenException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { SyncPullDto } from './dto/sync-pull.dto';
import { SyncPushDto, ClientChange } from './dto/sync-push.dto';
import { parseCursor, paginateResult, PaginatedSyncResult } from './helpers/cursor-paginator';

/**
 * أنواع الكيانات المدعومة في Pull
 */
const VALID_PULL_ENTITIES = ['subjects', 'lessons', 'questions', 'progress', 'timetable'] as const;
type PullEntity = typeof VALID_PULL_ENTITIES[number];

/**
 * أنواع الكيانات المدعومة في Push
 */
const VALID_PUSH_ENTITY_TYPES = ['student_answer', 'lesson_progress', 'lesson_result'] as const;

@Injectable()
export class StudentSyncService {
    private readonly logger = new Logger(StudentSyncService.name);

    constructor(private readonly prisma: PrismaService) { }

    // ═══════════════════════════════════════════════════════════════
    // Helper: جلب Student + Enrollment
    // ═══════════════════════════════════════════════════════════════

    private async getStudentContext(schoolId: number, userUuid: string) {
        const user = await this.prisma.user.findFirst({
            where: { uuid: userUuid, schoolId },
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

    // ═══════════════════════════════════════════════════════════════
    // MANIFEST — معلومات المزامنة
    // ═══════════════════════════════════════════════════════════════

    async getManifest(schoolId: number, userUuid: string) {
        const ctx = await this.getStudentContext(schoolId, userUuid);
        return {
            serverTime: new Date(),
            academicSnapshot: ctx.academicSnapshot,
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
                    data.lessons = await this.pullLessons(schoolId, ctx, cursor, limit);
                    break;
                case 'questions':
                    data.questions = await this.pullQuestions(schoolId, ctx, cursor, limit);
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
    ) {
        const where: any = {
            schoolId,
            status: { in: ['PUBLISHED', 'DELIVERED'] },
            targets: { some: { sectionId: ctx.sectionId } },
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
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                subject: { select: { uuid: true, displayName: true } },
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
                publishedAt: lesson.publishedAt,
                isActive: lesson.isActive,
                isDeleted: lesson.isDeleted,
                updatedAt: lesson.updatedAt,
                // محتوى الدرس
                contentBlocks: lesson.template.contentBlocks.map(b => ({
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
                    })),
                })),
                // قائمة UUIDs الوسائط للتحميل المسبق
                mediaAssetUuids: this.extractMediaUuids(lesson.template.contentBlocks, lesson.template.coverMediaAsset?.uuid),
            })),
            limit,
        );
    }

    /**
     * استخراج كل UUIDs الوسائط من محتوى الدرس (للتحميل المسبق)
     */
    private extractMediaUuids(blocks: any[], coverUuid?: string | null): string[] {
        const uuids = new Set<string>();
        if (coverUuid) uuids.add(coverUuid);

        for (const block of blocks) {
            for (const item of block.items) {
                if (item.mediaAsset?.uuid) {
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
            isDeleted: false,
            template: {
                lessons: {
                    some: {
                        schoolId,
                        status: { in: ['PUBLISHED', 'DELIVERED'] },
                        isDeleted: false,
                        isActive: true,
                        targets: { some: { sectionId: ctx.sectionId } },
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
    // PUSH — دفع التغييرات من Outbox
    // ═══════════════════════════════════════════════════════════════

    async push(schoolId: number, userUuid: string, dto: SyncPushDto) {
        const ctx = await this.getStudentContext(schoolId, userUuid);
        const results: { clientChangeUuid: string; status: string; error?: string }[] = [];

        for (const change of dto.changes) {
            try {
                // 1. Idempotency check
                const existing = await this.prisma.processedClientChange.findUnique({
                    where: { clientChangeUuid: change.clientChangeUuid },
                });

                if (existing) {
                    results.push({
                        clientChangeUuid: change.clientChangeUuid,
                        status: 'ALREADY_PROCESSED',
                    });
                    continue;
                }

                // 2. Process the change
                await this.processChange(ctx.studentId, schoolId, change);

                // 3. Mark as processed
                await this.prisma.processedClientChange.create({
                    data: {
                        clientChangeUuid: change.clientChangeUuid,
                        entityType: change.entityType,
                        entityUuid: change.entityUuid,
                        studentId: ctx.studentId,
                    },
                });

                results.push({
                    clientChangeUuid: change.clientChangeUuid,
                    status: 'OK',
                });
            } catch (error) {
                this.logger.error(
                    `Failed to process change ${change.clientChangeUuid}: ${error.message}`,
                    error.stack,
                );
                results.push({
                    clientChangeUuid: change.clientChangeUuid,
                    status: 'ERROR',
                    error: error.message,
                });
            }
        }

        return {
            results,
            serverTime: new Date(),
        };
    }

    private async processChange(studentId: number, schoolId: number, change: ClientChange) {
        switch (change.entityType) {
            case 'lesson_progress':
                await this.processProgressChange(studentId, change);
                break;
            case 'student_answer':
                await this.processAnswerChange(studentId, change);
                break;
            case 'lesson_result':
                await this.processResultChange(studentId, change);
                break;
            default:
                throw new Error(`Unknown entity type: ${change.entityType}`);
        }
    }

    private async processProgressChange(studentId: number, change: ClientChange) {
        const { lessonUuid, status, lastPosition } = change.payload;

        const lesson = await this.prisma.lesson.findFirst({
            where: { uuid: lessonUuid, isDeleted: false },
        });
        if (!lesson) throw new Error(`Lesson not found: ${lessonUuid}`);

        await this.prisma.studentLessonProgress.upsert({
            where: {
                studentId_lessonId: {
                    studentId,
                    lessonId: lesson.id,
                },
            },
            update: {
                status,
                lastPosition: lastPosition ? JSON.stringify(lastPosition) : null,
            },
            create: {
                studentId,
                lessonId: lesson.id,
                status,
                lastPosition: lastPosition ? JSON.stringify(lastPosition) : null,
            },
        });
    }

    private async processAnswerChange(studentId: number, change: ClientChange) {
        const { questionUuid, answerValue, scoreAwarded, correctness, isCorrect, resultUuid } = change.payload;

        const question = await this.prisma.question.findFirst({
            where: { uuid: questionUuid, isDeleted: false },
        });
        if (!question) throw new Error(`Question not found: ${questionUuid}`);

        // ربط بـ Result إن وُجد
        let resultId: number | null = null;
        if (resultUuid) {
            const result = await this.prisma.studentLessonResult.findFirst({
                where: { uuid: resultUuid },
            });
            resultId = result?.id ?? null;
        }

        await this.prisma.studentAnswer.upsert({
            where: {
                studentId_questionId: {
                    studentId,
                    questionId: question.id,
                },
            },
            update: {
                answerValue: typeof answerValue === 'string' ? answerValue : JSON.stringify(answerValue),
                correctness: correctness ?? 'WRONG',
                isCorrect: isCorrect ?? false,
                scoreAwarded: scoreAwarded ?? 0,
                resultId,
            },
            create: {
                studentId,
                questionId: question.id,
                answerValue: typeof answerValue === 'string' ? answerValue : JSON.stringify(answerValue),
                correctness: correctness ?? 'WRONG',
                isCorrect: isCorrect ?? false,
                scoreAwarded: scoreAwarded ?? 0,
                resultId,
            },
        });
    }

    private async processResultChange(studentId: number, change: ClientChange) {
        const {
            lessonUuid,
            totalQuestions,
            correctQuestions,
            totalPoints,
            earnedPoints,
            percent,
            gradeLabel,
        } = change.payload;

        const lesson = await this.prisma.lesson.findFirst({
            where: { uuid: lessonUuid, isDeleted: false },
        });
        if (!lesson) throw new Error(`Lesson not found: ${lessonUuid}`);

        // حساب version (عدد المحاولات + 1)
        const existingCount = await this.prisma.studentLessonResult.count({
            where: { studentId, lessonId: lesson.id },
        });

        await this.prisma.studentLessonResult.create({
            data: {
                uuid: change.entityUuid,
                studentId,
                lessonId: lesson.id,
                totalQuestions,
                correctQuestions,
                totalPoints,
                earnedPoints,
                percent,
                gradeLabel,
                calculatedAt: new Date(),
                version: existingCount + 1,
            },
        });
    }
}
