// src/school/manager/rollover/rollover.service.ts
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { EnrollmentStatus } from '@prisma/client';
import type { RolloverRequestDto } from './dto/rollover.dto';

// ─── Types ───

interface GradeSection {
    id: number;
    name: string;
    orderIndex: number;
}

interface EligibilityGrade {
    id: number;
    name: string;
    sortOrder: number;
    studentCount: number;
    sectionCount: number;
    sections: GradeSection[];
}

export interface EligibilityResult {
    eligible: boolean;
    reason: string | null;
    currentYear: { id: number; name: string } | null;
    activeTermExists: boolean;
    alreadyRolledOver: boolean;
    totalStudents: number;
    totalGrades: number;
    grades: EligibilityGrade[];
}

@Injectable()
export class RolloverService {
    constructor(private readonly prisma: PrismaService) { }

    // ==================== 1. فحص أهلية الترحيل ====================

    async checkEligibility(schoolId: number): Promise<EligibilityResult> {
        // جلب السنة الحالية مع الفصول
        const currentYear = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
            include: {
                terms: { where: { isDeleted: false }, orderBy: { orderIndex: 'asc' } },
            },
        });

        if (!currentYear) {
            return {
                eligible: false,
                reason: 'NO_CURRENT_YEAR',
                currentYear: null,
                activeTermExists: false,
                alreadyRolledOver: false,
                totalStudents: 0,
                totalGrades: 0,
                grades: [],
            };
        }

        // هل يوجد فصل حالي؟
        const activeTermExists = currentYear.terms.some(t => t.isCurrent);

        // هل تم الترحيل مسبقاً؟ (يوجد سنة أخرى أحدث)
        const newerYear = await this.prisma.year.findFirst({
            where: {
                schoolId,
                isDeleted: false,
                id: { not: currentYear.id },
                createdAt: { gt: currentYear.createdAt },
            },
        });
        const alreadyRolledOver = !!newerYear;

        // جلب الصفوف مع عدد الطلاب والشعب
        const grades = await this.prisma.schoolGrade.findMany({
            where: { schoolId, isDeleted: false, isActive: true },
            orderBy: { sortOrder: 'asc' },
            include: {
                sections: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                },
                _count: {
                    select: {
                        enrollments: {
                            where: { isCurrent: true, isDeleted: false },
                        },
                    },
                },
            },
        });

        // عدد الطلاب الكلي
        const totalStudents = grades.reduce((sum, g) => sum + g._count.enrollments, 0);

        return {
            eligible: !activeTermExists && !alreadyRolledOver,
            reason: activeTermExists ? 'ACTIVE_TERM_EXISTS' : alreadyRolledOver ? 'ALREADY_ROLLED_OVER' : null,
            currentYear: {
                id: currentYear.id,
                name: currentYear.name,
            },
            activeTermExists,
            alreadyRolledOver,
            totalStudents,
            totalGrades: grades.length,
            grades: grades.map(g => ({
                id: g.id,
                name: g.displayName,
                sortOrder: g.sortOrder,
                studentCount: g._count.enrollments,
                sectionCount: g.sections.length,
                sections: g.sections.map(s => ({
                    id: s.id,
                    name: s.name,
                    orderIndex: s.orderIndex,
                })),
            })),
        };
    }

    // ==================== 1b. جلب الطلاب للترحيل ====================

    async getStudentsForRollover(schoolId: number) {
        const grades = await this.prisma.schoolGrade.findMany({
            where: { schoolId, isDeleted: false, isActive: true },
            orderBy: { sortOrder: 'asc' },
            include: {
                sections: {
                    where: { isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    include: {
                        enrollments: {
                            where: { isCurrent: true, isDeleted: false },
                            include: {
                                student: {
                                    include: { user: true },
                                },
                            },
                        },
                    },
                },
            },
        });

        return {
            grades: grades.map(g => ({
                id: g.id,
                name: g.displayName,
                sortOrder: g.sortOrder,
                sections: g.sections.map(s => ({
                    id: s.id,
                    name: s.name,
                    orderIndex: s.orderIndex,
                    students: s.enrollments.map(e => ({
                        enrollmentId: e.id,
                        studentId: e.studentId,
                        fullName: e.student.user.name,
                        schoolCode: e.student.user.code?.toString() ?? '',
                    })),
                })),
            })),
        };
    }

    // ==================== 2. معاينة الترحيل ====================

    async preview(schoolId: number, dto: RolloverRequestDto) {
        // التحقق من صحة بيانات السنة
        this.validateTermDates(dto);

        // جلب بيانات الأهلية
        const eligibility = await this.checkEligibility(schoolId);
        if (!eligibility.eligible) {
            throw new ConflictException(eligibility.reason || 'NOT_ELIGIBLE');
        }

        // بناء خريطة الاستثناءات
        const exceptionMap = new Map<number, string>();
        for (const s of dto.studentStatuses) {
            exceptionMap.set(s.enrollmentId, s.status);
        }

        // حساب الإحصائيات
        let promotedCount = 0;
        let repeatedCount = 0;
        let withdrawnCount = 0;
        let graduatedCount = 0;

        // بناء خريطة الصفوف
        const migrationMap = new Map<number, number | null>();
        for (const m of dto.gradeMigrations) {
            migrationMap.set(m.sourceGradeId, m.targetGradeId ?? null);
        }

        // حساب لكل صف
        for (const grade of eligibility.grades) {
            const targetGradeId = migrationMap.get(grade.id);
            const isGraduating = targetGradeId === null || targetGradeId === undefined;

            // جلب enrollments لهذا الصف
            const enrollments = await this.prisma.studentEnrollment.findMany({
                where: {
                    gradeId: grade.id,
                    isCurrent: true,
                    isDeleted: false,
                    grade: { schoolId },
                },
            });

            for (const enrollment of enrollments) {
                const exception = exceptionMap.get(enrollment.id);

                if (exception === 'WITHDRAWN') {
                    withdrawnCount++;
                } else if (exception === 'REPEATED') {
                    repeatedCount++;
                } else if (isGraduating) {
                    graduatedCount++;
                } else {
                    promotedCount++;
                }
            }
        }

        // حساب الشعب الناقصة
        const sectionsToCreate: { gradeName: string; sectionName: string; orderIndex: number }[] = [];
        for (const m of dto.gradeMigrations) {
            if (m.targetGradeId == null) continue;
            const sourceGrade = eligibility.grades.find(g => g.id === m.sourceGradeId);
            const targetGrade = eligibility.grades.find(g => g.id === m.targetGradeId);
            if (!sourceGrade || !targetGrade) continue;

            const deficit = sourceGrade.sectionCount - targetGrade.sectionCount;
            if (deficit > 0) {
                const arabicLetters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];
                for (let i = 0; i < deficit; i++) {
                    const newIndex = targetGrade.sectionCount + i + 1;
                    sectionsToCreate.push({
                        gradeName: targetGrade.name,
                        sectionName: arabicLetters[newIndex - 1] || `شعبة ${newIndex}`,
                        orderIndex: newIndex,
                    });
                }
            }
        }

        return {
            yearName: dto.year.name,
            termsCount: dto.year.terms.length,
            promotedCount,
            repeatedCount,
            withdrawnCount,
            graduatedCount,
            totalCount: promotedCount + repeatedCount + withdrawnCount + graduatedCount,
            sectionsToCreate,
            gradeMigrations: dto.gradeMigrations.map(m => {
                const src = eligibility.grades.find(g => g.id === m.sourceGradeId);
                const tgt = m.targetGradeId ? eligibility.grades.find(g => g.id === m.targetGradeId) : null;
                return {
                    sourceGradeName: src?.name ?? '?',
                    targetGradeName: tgt?.name ?? null,
                    studentCount: src?.studentCount ?? 0,
                    sourceSections: src?.sectionCount ?? 0,
                    targetSections: tgt?.sectionCount ?? 0,
                    sectionsToCreate: Math.max(0, (src?.sectionCount ?? 0) - (tgt?.sectionCount ?? 0)),
                };
            }),
        };
    }

    // ==================== 3. تنفيذ الترحيل ====================

    async execute(schoolId: number, dto: RolloverRequestDto) {
        // ───── التحقق المسبق (خارج Transaction) ─────
        this.validateTermDates(dto);

        const eligibility = await this.checkEligibility(schoolId);
        if (!eligibility.eligible) {
            throw new ConflictException(eligibility.reason || 'NOT_ELIGIBLE');
        }

        // التحقق من خريطة الصفوف
        for (const m of dto.gradeMigrations) {
            const src = eligibility.grades.find(g => g.id === m.sourceGradeId);
            if (!src) throw new BadRequestException(`INVALID_SOURCE_GRADE_${m.sourceGradeId}`);
            if (m.targetGradeId != null) {
                const tgt = eligibility.grades.find(g => g.id === m.targetGradeId);
                if (!tgt) throw new BadRequestException(`INVALID_TARGET_GRADE_${m.targetGradeId}`);
            }
        }

        // بناء خريطة الاستثناءات
        const exceptionMap = new Map<number, string>();
        for (const s of dto.studentStatuses) {
            exceptionMap.set(s.enrollmentId, s.status);
        }

        // بناء خريطة الصفوف
        const migrationMap = new Map<number, number | null>();
        for (const m of dto.gradeMigrations) {
            migrationMap.set(m.sourceGradeId, m.targetGradeId ?? null);
        }

        // ───── Transaction ─────
        return this.prisma.$transaction(async (tx) => {
            // ══════ Step 1: إلغاء السنة القديمة أولاً (لتجنب قيد Unique) ══════
            await tx.year.update({
                where: { id: eligibility.currentYear!.id },
                data: { isCurrent: false },
            });

            // ══════ Step 2: إنشاء السنة الجديدة ══════
            const newYear = await tx.year.create({
                data: {
                    schoolId,
                    name: dto.year.name,
                    isCurrent: true,
                },
            });

            // ══════ Step 3: إنشاء الفصول (Smart Term Status) ══════
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            const sortedTerms = [...dto.year.terms].sort((a, b) => a.orderIndex - b.orderIndex);
            for (const term of sortedTerms) {
                const termStart = new Date(term.startDate);
                termStart.setHours(0, 0, 0, 0);

                await tx.term.create({
                    data: {
                        yearId: newYear.id,
                        name: term.name,
                        orderIndex: term.orderIndex,
                        startDate: new Date(term.startDate),
                        endDate: new Date(term.endDate),
                        isCurrent: term.orderIndex === 1 && termStart <= today,
                    },
                });
            }

            // ══════ Step 4: إنشاء الشعب الناقصة ══════
            const arabicLetters = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];
            let sectionsCreated = 0;

            // خريطة الشعب لكل صف وجهة (لاستخدامها في الترحيل)
            const targetSectionsMap = new Map<number, { id: number; orderIndex: number }[]>();

            for (const m of dto.gradeMigrations) {
                if (m.targetGradeId == null) continue;

                const sourceGrade = eligibility.grades.find(g => g.id === m.sourceGradeId)!;
                const targetGrade = eligibility.grades.find(g => g.id === m.targetGradeId)!;

                const deficit = sourceGrade.sectionCount - targetGrade.sectionCount;

                // إنشاء الشعب الناقصة
                if (deficit > 0) {
                    for (let i = 0; i < deficit; i++) {
                        const newIndex = targetGrade.sectionCount + i + 1;
                        await tx.section.create({
                            data: {
                                gradeId: m.targetGradeId,
                                name: arabicLetters[newIndex - 1] || `شعبة ${newIndex}`,
                                orderIndex: newIndex,
                            },
                        });
                        sectionsCreated++;
                    }
                }

                // جلب شعب الصف الوجهة (بعد الإنشاء) مرتبة
                const targetSections = await tx.section.findMany({
                    where: { gradeId: m.targetGradeId, isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                    select: { id: true, orderIndex: true },
                });
                targetSectionsMap.set(m.targetGradeId, targetSections);
            }

            // أيضاً نحتاج شعب الصفوف للراسبين (نفس الصف)
            for (const grade of eligibility.grades) {
                if (!targetSectionsMap.has(grade.id)) {
                    const sections = await tx.section.findMany({
                        where: { gradeId: grade.id, isDeleted: false },
                        orderBy: { orderIndex: 'asc' },
                        select: { id: true, orderIndex: true },
                    });
                    targetSectionsMap.set(grade.id, sections);
                }
            }

            // ══════ Step 5: ترحيل الطلاب ══════
            let promotedCount = 0;
            let repeatedCount = 0;
            let withdrawnCount = 0;
            let graduatedCount = 0;

            for (const grade of eligibility.grades) {
                const targetGradeId = migrationMap.get(grade.id);
                const isGraduating = targetGradeId === null || targetGradeId === undefined;

                // جلب جميع enrollments الحالية لهذا الصف
                const enrollments = await tx.studentEnrollment.findMany({
                    where: {
                        gradeId: grade.id,
                        isCurrent: true,
                        isDeleted: false,
                        grade: { schoolId },
                    },
                    include: {
                        section: { select: { orderIndex: true } },
                    },
                });

                for (const enrollment of enrollments) {
                    const exception = exceptionMap.get(enrollment.id);

                    // تحديد الحالة والسلوك
                    // Prisma enum: ACTIVE, PROMOTED, REPEATED, TRANSFERRED_OUT, DROPPED
                    let oldStatus: EnrollmentStatus;
                    let shouldCreateNew = true;
                    let newGradeId: number = grade.id;
                    let newSectionOrderIndex: number = enrollment.section?.orderIndex ?? 1;

                    if (exception === 'WITHDRAWN') {
                        // منسحب → DROPPED (لا يُنشأ له قيد جديد)
                        oldStatus = EnrollmentStatus.DROPPED;
                        shouldCreateNew = false;
                        withdrawnCount++;
                    } else if (exception === 'REPEATED') {
                        // راسب → REPEATED (يبقى في نفس الصف)
                        oldStatus = EnrollmentStatus.REPEATED;
                        newGradeId = grade.id;
                        repeatedCount++;
                    } else if (isGraduating) {
                        // خريج → PROMOTED (أنهى آخر صف)
                        oldStatus = EnrollmentStatus.PROMOTED;
                        shouldCreateNew = false;
                        graduatedCount++;
                    } else {
                        // ناجح → PROMOTED (ينتقل للصف التالي)
                        oldStatus = EnrollmentStatus.PROMOTED;
                        newGradeId = targetGradeId!;
                        promotedCount++;
                    }

                    // تحديث القيد القديم
                    await tx.studentEnrollment.update({
                        where: { id: enrollment.id },
                        data: {
                            isCurrent: false,
                            status: oldStatus,
                        },
                    });

                    // إنشاء قيد جديد (إذا ليس منسحب/خريج)
                    if (shouldCreateNew) {
                        const targetSections = targetSectionsMap.get(newGradeId) ?? [];
                        const matchedSection = targetSections.find(s => s.orderIndex === newSectionOrderIndex)
                            ?? targetSections[0];

                        if (matchedSection) {
                            await tx.studentEnrollment.create({
                                data: {
                                    studentId: enrollment.studentId,
                                    gradeId: newGradeId,
                                    sectionId: matchedSection.id,
                                    yearId: newYear.id,
                                    isCurrent: true,
                                    status: EnrollmentStatus.ACTIVE,
                                },
                            });
                        }
                    }
                }
            }

            // ══════ Step 6: نسخ الجدول الدراسي (اختياري) ══════
            let timetableCopied = false;
            if (dto.copyTimetable) {
                timetableCopied = await this.copyTimetable(tx, schoolId, eligibility.currentYear!.id, newYear.id);
            }

            return {
                success: true,
                newYearId: newYear.id,
                promotedCount,
                repeatedCount,
                withdrawnCount,
                graduatedCount,
                sectionsCreated,
                timetableCopied,
            };
        }, {
            timeout: 60000, // 60 seconds — عملية كبيرة
        });
    }

    // ==================== Helpers ====================

    /** التحقق من صحة تواريخ الفصول */
    private validateTermDates(dto: RolloverRequestDto) {
        const sortedTerms = [...dto.year.terms].sort((a, b) => a.orderIndex - b.orderIndex);

        for (let i = 0; i < sortedTerms.length; i++) {
            const term = sortedTerms[i];
            const start = new Date(term.startDate);
            const end = new Date(term.endDate);

            if (end <= start) {
                throw new BadRequestException(`TERM_${term.orderIndex}_END_BEFORE_START`);
            }

            if (i > 0) {
                const prevEnd = new Date(sortedTerms[i - 1].endDate);
                if (start <= prevEnd) {
                    throw new BadRequestException(
                        `TERM_${term.orderIndex}_OVERLAPS_WITH_TERM_${sortedTerms[i - 1].orderIndex}`,
                    );
                }
            }
        }
    }

    /** نسخ الجدول الدراسي من آخر فصل في السنة القديمة إلى أول فصل في السنة الجديدة */
    private async copyTimetable(tx: any, schoolId: number, oldYearId: number, newYearId: number): Promise<boolean> {
        // جلب آخر فصل في السنة القديمة
        const lastOldTerm = await tx.term.findFirst({
            where: { yearId: oldYearId, isDeleted: false },
            orderBy: { orderIndex: 'desc' },
        });

        // جلب أول فصل في السنة الجديدة
        const firstNewTerm = await tx.term.findFirst({
            where: { yearId: newYearId, isDeleted: false },
            orderBy: { orderIndex: 'asc' },
        });

        if (!lastOldTerm || !firstNewTerm) return false;

        // التحقق من عدم وجود جدول في الفصل الجديد
        const existingSlots = await tx.timetableSlot.count({
            where: { termId: firstNewTerm.id, isDeleted: false },
        });
        if (existingSlots > 0) return false; // لا نستبدل جدول موجود

        // جلب جميع حصص الفصل القديم
        const oldSlots = await tx.timetableSlot.findMany({
            where: { termId: lastOldTerm.id, isDeleted: false },
        });

        // نسخ الحصص
        for (const slot of oldSlots) {
            await tx.timetableSlot.create({
                data: {
                    termId: firstNewTerm.id,
                    sectionId: slot.sectionId,
                    subjectId: slot.subjectId,
                    teacherId: slot.teacherId,
                    dayOfWeek: slot.dayOfWeek,
                    slotNumber: slot.slotNumber,
                },
            });
        }

        return oldSlots.length > 0;
    }
}
