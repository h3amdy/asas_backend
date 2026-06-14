// src/owner/imports/imports.service.ts
import {
    Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { PreviewStudentsImportDto, PreviewTeachersImportDto } from './dto/import.dto';
import { UserType } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────

export interface RecordResult {
    index: number;
    name: string;
    status: 'NEW' | 'DUPLICATE' | 'ERROR';
    errors: string[];
    details: Record<string, any>;
}

export interface CredentialEntry {
    name: string;
    schoolNumber: number;
    password: string;
    role: 'STUDENT' | 'PARENT' | 'TEACHER';
    phone?: string;
    studentNames?: string[];
    subjects?: string[];
}

// ─── Normalizer — يقبل كلا الصيغتين ─────────────────────────

/** يجمع الأسماء المجزأة في اسم واحد، أو يُرجع الاسم الكامل */
function normalizeName(record: any, fullNameKey: string): string | null {
    // صيغة 1: اسم واحد كامل
    if (record[fullNameKey]) return record[fullNameKey].trim();

    // صيغة 2: أسماء مجزأة
    const parts = [
        record.first_name,
        record.second_name,
        record.third_name,
        record.last_name,
    ].filter(Boolean).map((p: string) => p.trim());

    return parts.length >= 2 ? parts.join(' ') : parts.length === 1 ? parts[0] : null;
}

/** يوحّد اسم الشعبة: يقبل section أو section_name */
function normalizeSection(record: any): string | null {
    return record.section_name?.trim() || record.section?.trim() || null;
}

/** يوحّد شعب الإسناد: يقبل sections[] أو section_name (string) */
function normalizeAssignmentSections(assignment: any): string[] {
    if (assignment.sections && assignment.sections.length > 0) {
        return assignment.sections;
    }
    if (assignment.section_name) {
        return [assignment.section_name];
    }
    return []; // فارغ = جميع الشعب (DEC-ADM-091-06)
}

@Injectable()
export class ImportsService {
    constructor(private readonly prisma: PrismaService) {}

    // ─── Helpers ────────────────────────────────────────────────

    private async resolveSchool(schoolUuid: string) {
        const school = await this.prisma.school.findUnique({
            where: { uuid: schoolUuid },
        });
        if (!school) throw new NotFoundException('SCHOOL_NOT_FOUND');
        return school;
    }

    private async getCurrentYear(schoolId: number) {
        const year = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
        });
        if (!year) throw new BadRequestException('NO_CURRENT_YEAR');
        return year;
    }

    private async resolveImportSession(schoolUuid: string, importUuid: string) {
        const school = await this.resolveSchool(schoolUuid);
        const session = await this.prisma.importSession.findUnique({
            where: { uuid: importUuid },
        });
        if (!session || session.schoolId !== school.id) {
            throw new NotFoundException('IMPORT_SESSION_NOT_FOUND');
        }
        return { school, session };
    }

    private async resolvePlatformUser(platformUserUuid: string) {
        const user = await this.prisma.platformUser.findUnique({
            where: { uuid: platformUserUuid },
        });
        if (!user) throw new NotFoundException('PLATFORM_USER_NOT_FOUND');
        return user;
    }

    // ═══════════════════════════════════════════════════════════════
    //  Import Readiness — ADM-089
    // ═══════════════════════════════════════════════════════════════

    async getImportReadiness(schoolUuid: string) {
        const school = await this.prisma.school.findUnique({
            where: { uuid: schoolUuid },
        });
        if (!school) throw new NotFoundException('SCHOOL_NOT_FOUND');

        // ─── Setup: Year & Term ─────────────────────────────────
        const currentYear = await this.prisma.year.findFirst({
            where: { schoolId: school.id, isCurrent: true, isDeleted: false },
            include: {
                terms: {
                    where: { isCurrent: true, isDeleted: false },
                    take: 1,
                },
            },
        });

        const hasCurrentYear = !!currentYear;
        const currentTerm = currentYear?.terms?.[0] ?? null;
        const hasCurrentTerm = !!currentTerm;

        // ─── Structure: Grades + Sections ───────────────────────
        const schoolGrades = await this.prisma.schoolGrade.findMany({
            where: { schoolId: school.id, isActive: true, isDeleted: false },
            include: {
                dictionary: true,
                sections: {
                    where: { isActive: true, isDeleted: false },
                    orderBy: { orderIndex: 'asc' },
                },
            },
            orderBy: { sortOrder: 'asc' },
        });

        const grades = schoolGrades.map(g => ({
            code: g.dictionary?.code ?? null,
            name: g.displayName,
            sectionsCount: g.sections.length,
            sections: g.sections.map(s => s.name),
        }));

        const totalSections = schoolGrades.reduce(
            (sum, g) => sum + g.sections.length, 0,
        );

        // ─── Structure: Subjects ────────────────────────────────
        const subjects = await this.prisma.subject.findMany({
            where: { schoolId: school.id, isActive: true, isDeleted: false },
            include: {
                dictionary: true,
                grade: { include: { dictionary: true } },
            },
            orderBy: { displayName: 'asc' },
        });

        const officialSubjects = subjects.filter(s => s.dictionaryId !== null);
        const localSubjects = subjects.filter(s => s.dictionaryId === null);

        const subjectList = officialSubjects.map(s => ({
            code: s.dictionary?.code ?? s.code ?? '',
            name: s.displayName,
            gradeName: s.grade.displayName,
            gradeCode: s.grade.dictionary?.code ?? null,
        }));

        // ─── Users count ────────────────────────────────────────
        const userCounts = await this.prisma.user.groupBy({
            by: ['userType'],
            where: { schoolId: school.id, isDeleted: false, isActive: true },
            _count: true,
        });

        const getUserCount = (type: UserType) =>
            userCounts.find(u => u.userType === type)?._count ?? 0;

        // ─── Manager ────────────────────────────────────────────
        const manager = await this.prisma.user.findFirst({
            where: {
                schoolId: school.id,
                userType: UserType.ADMIN,
                isDeleted: false,
                isActive: true,
            },
            select: { name: true },
        });

        // ─── Readiness checks ───────────────────────────────────
        const hasGrades = schoolGrades.length > 0;
        const hasSections = totalSections > 0;
        const hasOfficialGrades = schoolGrades.some(g => g.dictionaryId !== null);
        const hasSubjects = subjects.length > 0;
        const hasOfficialSubjects = officialSubjects.length > 0;

        // Students readiness
        const studentsMissing: string[] = [];
        if (!hasCurrentYear) studentsMissing.push('لا توجد سنة دراسية حالية');
        if (!hasGrades) studentsMissing.push('لا توجد صفوف دراسية');
        if (!hasSections) studentsMissing.push('لا توجد شعب دراسية');
        if (!hasOfficialGrades) studentsMissing.push('لا توجد صفوف مرتبطة بالقاموس الرسمي (grade_code)');

        // Teachers readiness = only requires a current year
        const teachersMissing: string[] = [];
        if (!hasCurrentYear) teachersMissing.push('لا توجد سنة دراسية حالية');

        // ─── Recent imports ─────────────────────────────────────
        const recentImports = await this.prisma.importSession.findMany({
            where: { schoolId: school.id },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: {
                importType: true,
                createdAt: true,
                totalRecords: true,
                createdRecords: true,
                status: true,
            },
        });

        return {
            school: {
                name: school.name,
                schoolCode: school.schoolCode,
                appType: school.appType,
                isActive: school.isActive,
                createdAt: school.createdAt,
                managerName: manager?.name ?? null,
            },
            setup: {
                hasCurrentYear,
                hasCurrentTerm,
                currentYearName: currentYear?.name ?? null,
                currentTermName: currentTerm?.name ?? null,
            },
            structure: {
                grades,
                totalGrades: schoolGrades.length,
                totalSections,
                subjects: {
                    total: subjects.length,
                    official: officialSubjects.length,
                    local: localSubjects.length,
                    list: subjectList,
                },
            },
            users: {
                managers: getUserCount(UserType.ADMIN),
                teachers: getUserCount(UserType.TEACHER),
                students: getUserCount(UserType.STUDENT),
                parents: getUserCount(UserType.PARENT),
            },
            readiness: {
                students: {
                    ready: studentsMissing.length === 0,
                    missing: studentsMissing,
                },
                teachers: {
                    ready: teachersMissing.length === 0,
                    missing: teachersMissing,
                },
            },
            recentImports: recentImports.map(i => ({
                type: i.importType,
                date: i.createdAt,
                totalRecords: i.totalRecords,
                createdRecords: i.createdRecords,
                status: i.status,
            })),
        };
    }

    // ─── Preview Students ───────────────────────────────────────

    async previewStudents(schoolUuid: string, dto: PreviewStudentsImportDto, platformUserUuid: string) {
        if (dto._schema !== 'asas_students_import_v1') {
            throw new BadRequestException('INVALID_SCHEMA_VERSION');
        }

        const school = await this.resolveSchool(schoolUuid);
        const platformUser = await this.resolvePlatformUser(platformUserUuid);
        const currentYear = await this.getCurrentYear(school.id);

        // Load school structure
        const schoolGrades = await this.prisma.schoolGrade.findMany({
            where: { schoolId: school.id, isActive: true, isDeleted: false },
            include: {
                dictionary: true,
                sections: { where: { isActive: true, isDeleted: false } },
            },
        });

        // Build lookup maps
        const gradeByCode = new Map<string, typeof schoolGrades[0]>();
        for (const g of schoolGrades) {
            if (g.dictionary) {
                gradeByCode.set(g.dictionary.code, g);
            }
        }

        // Track phones in file for in-file duplicate detection
        const phonesInFile = new Map<string, number>();

        const records: RecordResult[] = [];
        let newCount = 0, dupCount = 0, errCount = 0;

        for (let i = 0; i < dto.students.length; i++) {
            const s = dto.students[i];
            const errors: string[] = [];
            let isDuplicate = false;

            // ─── Normalize: اسم الطالب ──────────────────────
            const studentName = normalizeName(s, 'student_name');
            if (!studentName || studentName.length < 2) {
                errors.push('اسم الطالب مطلوب (student_name أو first_name + last_name)');
            }

            // ─── Normalize: الشعبة ──────────────────────────
            const sectionName = normalizeSection(s);
            if (!sectionName) {
                errors.push('اسم الشعبة مطلوب (section أو section_name)');
            }

            // ─── كشف التكرار بالهاتف ────────────────────────
            if (s.phone) {
                // تكرار داخل الملف
                if (phonesInFile.has(s.phone)) {
                    errors.push(`الطالب مكرر في الملف (سطر ${phonesInFile.get(s.phone)! + 1})`);
                    isDuplicate = true;
                } else {
                    phonesInFile.set(s.phone, i);
                }

                // تكرار في المدرسة
                if (!isDuplicate) {
                    const existingStudent = await this.prisma.user.findFirst({
                        where: {
                            phone: s.phone,
                            userType: 'STUDENT',
                            schoolId: school.id,
                            isDeleted: false,
                        },
                    });
                    if (existingStudent) {
                        isDuplicate = true;
                    }
                }
            }

            // Validate grade
            const grade = gradeByCode.get(s.grade_code);
            if (!grade) {
                errors.push(`الصف "${s.grade_code}" غير موجود أو غير مفعل في المدرسة`);
            }

            // Validate section
            let sectionId: number | null = null;
            if (grade && sectionName) {
                const section = grade.sections.find(
                    sec => sec.name === sectionName,
                );
                if (!section) {
                    errors.push(`الشعبة "${sectionName}" غير موجودة في الصف "${s.grade_code}"`);
                } else {
                    sectionId = section.id;
                }
            }

            // Validate birth_date format
            if (s.birth_date && isNaN(Date.parse(s.birth_date))) {
                errors.push(`تاريخ الميلاد "${s.birth_date}" غير صالح`);
            }

            // ─── Normalize: ولي الأمر ───────────────────────
            let parentName: string | null = null;
            if (s.parent) {
                parentName = normalizeName(s.parent, 'name');
                if (!parentName || parentName.length < 2) {
                    errors.push('اسم ولي الأمر مطلوب (name أو first_name + last_name)');
                }
            }

            const hasErrors = errors.length > 0;
            const status = hasErrors ? 'ERROR' : isDuplicate ? 'DUPLICATE' : 'NEW';

            if (status === 'NEW') newCount++;
            else if (status === 'DUPLICATE') dupCount++;
            else errCount++;

            records.push({
                index: i,
                name: studentName || `طالب #${i + 1}`,
                status,
                errors,
                details: {
                    grade_code: s.grade_code,
                    section: sectionName,
                    gradeId: grade?.id,
                    sectionId,
                    isDuplicate,
                    parent: s.parent ? { name: parentName, phone: s.parent.phone } : null,
                },
            });
        }

        // Save session
        const session = await this.prisma.importSession.create({
            data: {
                schoolId: school.id,
                platformUserId: platformUser.id,
                importType: 'STUDENTS',
                status: 'PREVIEW',
                originalJson: JSON.stringify(dto),
                previewResult: JSON.stringify(records),
                totalRecords: dto.students.length,
                newRecords: newCount,
                duplicateRecords: dupCount,
                errorRecords: errCount,
            },
        });

        return {
            importUuid: session.uuid,
            summary: {
                total: dto.students.length,
                new: newCount,
                duplicate: dupCount,
                errors: errCount,
            },
            records,
        };
    }

    // ─── Preview Teachers ───────────────────────────────────────

    async previewTeachers(schoolUuid: string, dto: PreviewTeachersImportDto, platformUserUuid: string) {
        if (dto._schema !== 'asas_teachers_import_v1') {
            throw new BadRequestException('INVALID_SCHEMA_VERSION');
        }

        const school = await this.resolveSchool(schoolUuid);
        const platformUser = await this.resolvePlatformUser(platformUserUuid);
        await this.getCurrentYear(school.id);

        // Load school structure
        const schoolGrades = await this.prisma.schoolGrade.findMany({
            where: { schoolId: school.id, isActive: true, isDeleted: false },
            include: {
                dictionary: true,
                sections: { where: { isActive: true, isDeleted: false } },
            },
        });

        // Load subjects with dictionary
        const subjects = await this.prisma.subject.findMany({
            where: { schoolId: school.id, isActive: true, isDeleted: false },
            include: {
                dictionary: true,
                grade: { include: { dictionary: true } },
                subjectSections: {
                    include: {
                        section: true,
                        teachers: { where: { role: 'PRIMARY', isDeleted: false } },
                    },
                },
            },
        });

        // Build lookup: SubjectDictionary.code → Subject
        const subjectByDictCode = new Map<string, typeof subjects[0]>();
        for (const subj of subjects) {
            if (subj.dictionary?.code) {
                subjectByDictCode.set(subj.dictionary.code, subj);
            }
        }

        // Build grade lookup
        const gradeByDictId = new Map<number, typeof schoolGrades[0]>();
        for (const g of schoolGrades) {
            if (g.dictionaryId) {
                gradeByDictId.set(g.dictionaryId, g);
            }
        }

        // Track phones in file for in-file duplicate detection
        const phonesInFile = new Map<string, number>();

        const records: RecordResult[] = [];
        let newCount = 0, dupCount = 0, errCount = 0;

        for (let i = 0; i < dto.teachers.length; i++) {
            const t = dto.teachers[i];
            const errors: string[] = [];
            let isDuplicate = false;

            // ─── Normalize: اسم المعلم ──────────────────────
            const teacherName = normalizeName(t, 'teacher_name');
            if (!teacherName || teacherName.length < 2) {
                errors.push('اسم المعلم مطلوب (teacher_name أو first_name + last_name)');
            }

            // Check in-file duplicate by phone
            if (t.phone) {
                if (phonesInFile.has(t.phone)) {
                    errors.push(`المعلم مكرر في الملف (سطر ${phonesInFile.get(t.phone)! + 1})`);
                } else {
                    phonesInFile.set(t.phone, i);
                }

                // Check existing teacher in school
                const existingTeacher = await this.prisma.user.findFirst({
                    where: {
                        phone: t.phone,
                        userType: 'TEACHER',
                        schoolId: school.id,
                        isDeleted: false,
                    },
                });
                if (existingTeacher) {
                    isDuplicate = true;
                }
            }

            // Validate assignments
            const assignmentResults: any[] = [];
            if (t.assignments) {
                for (const assignment of t.assignments) {
                    const subject = subjectByDictCode.get(assignment.subject_code);
                    if (!subject) {
                        errors.push(`كود المادة "${assignment.subject_code}" غير موجود في القاموس أو غير مفعل في المدرسة`);
                        continue;
                    }

                    // Resolve sections
                    const grade = gradeByDictId.get(subject.grade.dictionaryId!);
                    if (!grade) {
                        errors.push(`الصف المرتبط بالمادة "${assignment.subject_code}" غير مفعل في المدرسة`);
                        continue;
                    }

                    const normalizedSections = normalizeAssignmentSections(assignment);
                    const targetSections = normalizedSections.length > 0
                        ? normalizedSections
                        : grade.sections.map(s => s.name); // DEC-ADM-091-06: all sections

                    for (const secName of targetSections) {
                        const section = grade.sections.find(
                            s => s.name === secName,
                        );
                        if (!section) {
                            errors.push(`الشعبة "${secName}" غير موجودة في الصف "${grade.displayName}"`);
                            continue;
                        }

                        // Check assignment conflict
                        const subjectSection = subject.subjectSections.find(
                            ss => ss.sectionId === section.id,
                        );
                        const assignmentRole = assignment.role || 'PRIMARY';
                        if (subjectSection) {
                            const existingTeacher = subjectSection.teachers.find(t => t.role === assignmentRole);
                            if (existingTeacher) {
                                errors.push(`المادة "${subject.displayName}" في الشعبة "${secName}" مسندة لمعلم آخر (${assignmentRole})`);
                                continue;
                            }
                        }

                        assignmentResults.push({
                            subject_code: assignment.subject_code,
                            subject_name: subject.displayName,
                            section: secName,
                            role: assignmentRole,
                            subjectId: subject.id,
                            sectionId: section.id,
                            gradeId: grade.id,
                        });
                    }
                }
            }

            const hasAssignmentErrors = errors.length > 0;
            const status = hasAssignmentErrors ? 'ERROR' : isDuplicate ? 'DUPLICATE' : 'NEW';

            if (status === 'NEW') newCount++;
            else if (status === 'DUPLICATE') dupCount++;
            else errCount++;

            records.push({
                index: i,
                name: teacherName || `معلم #${i + 1}`,
                status,
                errors,
                details: {
                    phone: t.phone,
                    isDuplicate,
                    assignments: assignmentResults,
                },
            });
        }

        // Save session
        const session = await this.prisma.importSession.create({
            data: {
                schoolId: school.id,
                platformUserId: platformUser.id,
                importType: 'TEACHERS',
                status: 'PREVIEW',
                originalJson: JSON.stringify(dto),
                previewResult: JSON.stringify(records),
                totalRecords: dto.teachers.length,
                newRecords: newCount,
                duplicateRecords: dupCount,
                errorRecords: errCount,
            },
        });

        return {
            importUuid: session.uuid,
            summary: {
                total: dto.teachers.length,
                new: newCount,
                duplicate: dupCount,
                errors: errCount,
            },
            records,
        };
    }

    // ─── Get Import Preview ─────────────────────────────────────

    async getImportPreview(schoolUuid: string, importUuid: string) {
        const { session } = await this.resolveImportSession(schoolUuid, importUuid);

        return {
            importUuid: session.uuid,
            importType: session.importType,
            status: session.status,
            summary: {
                total: session.totalRecords,
                new: session.newRecords,
                duplicate: session.duplicateRecords,
                errors: session.errorRecords,
                created: session.createdRecords,
                failed: session.failedRecords,
            },
            records: session.previewResult ? JSON.parse(session.previewResult) : [],
        };
    }

    // ─── Execute Import ─────────────────────────────────────────

    async executeImport(schoolUuid: string, importUuid: string) {
        const { school, session } = await this.resolveImportSession(schoolUuid, importUuid);

        if (session.status !== 'PREVIEW') {
            throw new BadRequestException('IMPORT_ALREADY_EXECUTED');
        }

        // Mark as executing
        await this.prisma.importSession.update({
            where: { id: session.id },
            data: { status: 'EXECUTING', startedAt: new Date() },
        });

        const originalData = JSON.parse(session.originalJson!);
        const previewRecords: RecordResult[] = JSON.parse(session.previewResult!);
        const credentials: CredentialEntry[] = [];
        let createdCount = 0;
        let failedCount = 0;

        if (session.importType === 'STUDENTS') {
            const currentYear = await this.getCurrentYear(school.id);

            for (let i = 0; i < previewRecords.length; i++) {
                const record = previewRecords[i];
                if (record.status !== 'NEW') continue;

                const studentData = originalData.students[i];
                try {
                    await this.createStudentInTransaction(
                        school, studentData, record.details, currentYear.id, credentials,
                    );
                    record.status = 'NEW'; // remains new = success
                    createdCount++;
                } catch (err: any) {
                    record.status = 'ERROR';
                    record.errors.push(`فشل الإنشاء: ${err.message}`);
                    failedCount++;
                }
            }
        } else if (session.importType === 'TEACHERS') {
            for (let i = 0; i < previewRecords.length; i++) {
                const record = previewRecords[i];
                if (record.status === 'ERROR') continue;

                const teacherData = originalData.teachers[i];
                try {
                    await this.createTeacherInTransaction(
                        school, teacherData, record, credentials,
                    );
                    createdCount++;
                } catch (err: any) {
                    record.status = 'ERROR';
                    record.errors.push(`فشل الإنشاء: ${err.message}`);
                    failedCount++;
                }
            }
        }

        // Update session
        await this.prisma.importSession.update({
            where: { id: session.id },
            data: {
                status: 'COMPLETED',
                completedAt: new Date(),
                createdRecords: createdCount,
                failedRecords: failedCount,
                previewResult: JSON.stringify(previewRecords),
                credentialsJson: JSON.stringify(credentials),
            },
        });

        return {
            importUuid: session.uuid,
            status: 'COMPLETED',
            created: createdCount,
            failed: failedCount,
            credentials,
        };
    }

    private async createStudentInTransaction(
        school: any, studentData: any, details: any, yearId: number,
        credentials: CredentialEntry[],
    ) {
        // ─ Normalize: استخدم الاسم الموحّد من preview details
        const studentName = normalizeName(studentData, 'student_name') || details.name;
        const parentName = details.parent?.name || normalizeName(studentData.parent, 'name');

        await this.prisma.$transaction(async (tx) => {
            // Increment school code
            const updatedSchool = await tx.school.update({
                where: { id: school.id },
                data: { nextUserCode: { increment: 1 } },
            });
            const code = updatedSchool.nextUserCode - 1;
            const password = String(code);
            const passwordHash = await bcrypt.hash(password, 10);

            // Create user
            const user = await tx.user.create({
                data: {
                    schoolId: school.id,
                    userType: 'STUDENT',
                    code,
                    name: studentName,
                    displayName: studentName,
                    gender: studentData.gender,
                    phone: studentData.phone || null,
                    passwordHash,
                    isActive: true,
                },
            });

            // Create student profile
            await tx.student.create({
                data: {
                    userId: user.id,
                    birthDate: studentData.birth_date
                        ? new Date(studentData.birth_date)
                        : null,
                },
            });

            // Create enrollment
            await tx.studentEnrollment.create({
                data: {
                    studentId: user.id,
                    yearId,
                    gradeId: details.gradeId,
                    sectionId: details.sectionId,
                    status: 'ACTIVE',
                    isCurrent: true,
                    joinedAt: new Date(),
                },
            });

            // Create parent if provided
            if (studentData.parent && parentName) {
                let parentUserId: number;

                // Check if parent already exists by phone
                const existingParent = await tx.user.findFirst({
                    where: {
                        phone: studentData.parent.phone,
                        userType: 'PARENT',
                        schoolId: school.id,
                        isDeleted: false,
                    },
                });

                if (existingParent) {
                    parentUserId = existingParent.id;
                    const existingCred = credentials.find(
                        (c) => c.role === 'PARENT' && c.phone === studentData.parent.phone
                    );
                    if (existingCred) {
                        if (!existingCred.studentNames) {
                            existingCred.studentNames = [];
                        }
                        if (!existingCred.studentNames.includes(studentName)) {
                            existingCred.studentNames.push(studentName);
                        }
                    } else {
                        credentials.push({
                            name: parentName,
                            schoolNumber: existingParent.code ?? 0,
                            password: '*****',
                            role: 'PARENT',
                            phone: studentData.parent.phone,
                            studentNames: [studentName],
                        });
                    }
                } else {
                    // Create parent
                    const parentSchool = await tx.school.update({
                        where: { id: school.id },
                        data: { nextUserCode: { increment: 1 } },
                    });
                    const parentCode = parentSchool.nextUserCode - 1;
                    const parentPassword = String(parentCode);
                    const parentHash = await bcrypt.hash(parentPassword, 10);

                    const parentUser = await tx.user.create({
                        data: {
                            schoolId: school.id,
                            userType: 'PARENT',
                            code: parentCode,
                            name: parentName,
                            displayName: parentName,
                            gender: studentData.parent.gender || null,
                            phone: studentData.parent.phone,
                            passwordHash: parentHash,
                            isActive: true,
                        },
                    });

                    await tx.parent.create({
                        data: { userId: parentUser.id },
                    });

                    parentUserId = parentUser.id;

                    credentials.push({
                        name: parentName,
                        schoolNumber: parentCode,
                        password: parentPassword,
                        role: 'PARENT',
                        phone: studentData.parent.phone,
                        studentNames: [studentName],
                    });
                }

                // Link parent to student
                await tx.parentStudent.create({
                    data: { parentId: parentUserId, studentId: user.id },
                });
            }

            credentials.push({
                name: studentName,
                schoolNumber: code,
                password,
                role: 'STUDENT',
                phone: studentData.phone || null,
            });
        });
    }

    private async createTeacherInTransaction(
        school: any, teacherData: any, record: RecordResult,
        credentials: CredentialEntry[],
    ) {
        // ─ Normalize: استخدم الاسم الموحّد من record
        const teacherName = record.name;

        await this.prisma.$transaction(async (tx) => {
            let teacherUserId: number;

            if (record.details.isDuplicate) {
                // Find existing teacher — don't create account
                const existing = await tx.user.findFirst({
                    where: {
                        phone: teacherData.phone,
                        userType: 'TEACHER',
                        schoolId: school.id,
                        isDeleted: false,
                    },
                });
                if (!existing) throw new Error('DUPLICATE_TEACHER_NOT_FOUND');
                teacherUserId = existing.id;
            } else {
                // Create new teacher
                const updatedSchool = await tx.school.update({
                    where: { id: school.id },
                    data: { nextUserCode: { increment: 1 } },
                });
                const code = updatedSchool.nextUserCode - 1;
                const password = String(code);
                const passwordHash = await bcrypt.hash(password, 10);

                const user = await tx.user.create({
                    data: {
                        schoolId: school.id,
                        userType: 'TEACHER',
                        code,
                        name: teacherName,
                        displayName: teacherName,
                        gender: teacherData.gender,
                        phone: teacherData.phone || null,
                        passwordHash,
                        isActive: true,
                    },
                });

                await tx.teacher.create({
                    data: {
                        userId: user.id,
                        specialization: teacherData.specialization || null,
                    },
                });

                // Create extra permissions with defaults
                await tx.teacherExtraPermission.create({
                    data: { teacherId: user.id },
                });

                teacherUserId = user.id;

                const subjectsList: string[] = [];
                if (record.details.assignments) {
                    for (const a of record.details.assignments) {
                        if (a.subject_name && !subjectsList.includes(a.subject_name)) {
                            subjectsList.push(a.subject_name);
                        }
                    }
                }

                credentials.push({
                    name: teacherName,
                    schoolNumber: code,
                    password,
                    role: 'TEACHER',
                    phone: teacherData.phone || null,
                    subjects: subjectsList,
                });
            }

            // Create assignments (using role from preview)
            if (record.details.assignments) {
                for (const assignment of record.details.assignments) {
                    // Find or create SubjectSection
                    let subjectSection = await tx.subjectSection.findFirst({
                        where: {
                            subjectId: assignment.subjectId,
                            sectionId: assignment.sectionId,
                        },
                    });

                    if (!subjectSection) {
                        subjectSection = await tx.subjectSection.create({
                            data: {
                                subjectId: assignment.subjectId,
                                sectionId: assignment.sectionId,
                            },
                        });
                    }

                    // Create teacher assignment
                    const existingAssignment = await tx.subjectSectionTeacher.findFirst({
                        where: {
                            subjectSectionId: subjectSection.id,
                            teacherId: teacherUserId,
                        },
                    });

                    if (!existingAssignment) {
                        await tx.subjectSectionTeacher.create({
                            data: {
                                subjectSectionId: subjectSection.id,
                                teacherId: teacherUserId,
                                role: assignment.role || 'PRIMARY',
                            },
                        });
                    }
                }
            }
        });
    }

    // ─── Get Credentials ────────────────────────────────────────

    async getCredentials(schoolUuid: string, importUuid: string) {
        const { session } = await this.resolveImportSession(schoolUuid, importUuid);

        if (session.status !== 'COMPLETED') {
            throw new BadRequestException('IMPORT_NOT_COMPLETED');
        }

        return {
            importUuid: session.uuid,
            importType: session.importType,
            credentials: session.credentialsJson
                ? JSON.parse(session.credentialsJson)
                : [],
        };
    }
}
