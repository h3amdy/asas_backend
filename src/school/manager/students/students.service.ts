// src/school/manager/students/students.service.ts
import {
    Injectable, NotFoundException, BadRequestException,
    ForbiddenException, ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import {
    CreateStudentDto, UpdateStudentDto,
    SectionTransferDto, GradeTransferDto,
    DropEnrollmentDto, ReEnrollDto, ResetPasswordDto,
} from './dto/students.dto';

@Injectable()
export class StudentsService {
    constructor(private readonly prisma: PrismaService) { }

    // ─── Helpers ────────────────────────────────────────────────

    private async findStudentByUuid(uuid: string, schoolId: number) {
        const user = await this.prisma.user.findFirst({
            where: { uuid, userType: 'STUDENT', isDeleted: false, schoolId },
            select: { id: true, uuid: true, code: true, isActive: true },
        });
        if (!user) throw new NotFoundException('STUDENT_NOT_FOUND');
        return user;
    }

    private async getCurrentYear(schoolId: number) {
        const year = await this.prisma.year.findFirst({
            where: { schoolId, isCurrent: true, isDeleted: false },
        });
        if (!year) throw new BadRequestException('NO_CURRENT_YEAR');
        return year;
    }

    private async getActiveEnrollment(studentId: number) {
        const enrollment = await this.prisma.studentEnrollment.findFirst({
            where: { studentId, isCurrent: true, isDeleted: false },
        });
        if (!enrollment) throw new BadRequestException('NO_ACTIVE_ENROLLMENT');
        return enrollment;
    }

    private async validateGradeSection(gradeId: number, sectionId: number, schoolId: number) {
        const grade = await this.prisma.schoolGrade.findFirst({
            where: { id: gradeId, schoolId, isActive: true, isDeleted: false },
        });
        if (!grade) throw new NotFoundException('GRADE_NOT_FOUND');

        const section = await this.prisma.section.findFirst({
            where: { id: sectionId, gradeId, isActive: true, isDeleted: false },
        });
        if (!section) throw new NotFoundException('SECTION_NOT_FOUND');

        return { grade, section };
    }

    // ─── SRS-STU-01: List Students ──────────────────────────────

    async listStudents(
        schoolId: number,
        query: {
            gradeId?: number;
            sectionId?: number;
            yearId?: number;
            search?: string;
            page?: number;
            limit?: number;
        },
    ) {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const yearFilter = query.yearId
            ? { yearId: query.yearId }
            : { year: { isCurrent: true, isDeleted: false } };

        const searchFilter = query.search
            ? {
                student: {
                    user: {
                        schoolId,
                        isDeleted: false,
                        OR: [
                            { name: { contains: query.search, mode: 'insensitive' as const } },
                            ...(query.search && !isNaN(+query.search)
                                ? [{ code: +query.search }]
                                : []),
                        ],
                    },
                },
            }
            : { student: { user: { schoolId, isDeleted: false } } };

        const where = {
            isDeleted: false,
            ...yearFilter,
            ...(query.gradeId ? { gradeId: query.gradeId } : {}),
            ...(query.sectionId ? { sectionId: query.sectionId } : {}),
            ...searchFilter,
        };

        const [data, total] = await Promise.all([
            this.prisma.studentEnrollment.findMany({
                where,
                include: {
                    student: {
                        include: {
                            user: {
                                select: {
                                    uuid: true, name: true, displayName: true,
                                    code: true, phone: true, isActive: true, updatedAt: true,
                                },
                            },
                        },
                    },
                    grade: { select: { id: true, displayName: true, sortOrder: true } },
                    section: { select: { id: true, name: true, orderIndex: true } },
                },
                orderBy: [
                    { grade: { sortOrder: 'asc' } },
                    { section: { orderIndex: 'asc' } },
                    { student: { user: { name: 'asc' } } },
                ],
                skip,
                take: limit,
            }),
            this.prisma.studentEnrollment.count({ where }),
        ]);

        return {
            data: data.map((e) => ({
                id: e.student.user.uuid,
                uuid: e.student.user.uuid,
                name: e.student.user.name,
                displayName: e.student.user.displayName,
                code: e.student.user.code,
                isActive: e.student.user.isActive,
                gradeName: e.grade.displayName,
                sectionName: e.section.name,
                gradeId: e.gradeId,
                sectionId: e.sectionId,
                enrollmentId: e.id,
                enrollmentStatus: e.status,
                isCurrent: e.isCurrent,
                updatedAt: e.student.user.updatedAt,
            })),
            meta: { total, page, limit },
        };
    }

    // ─── SRS-STU-02: Create Student ─────────────────────────────

    async createStudent(schoolId: number, dto: CreateStudentDto) {
        const currentYear = await this.getCurrentYear(schoolId);
        await this.validateGradeSection(dto.gradeId, dto.sectionId, schoolId);

        // Generate unique code
        const school = await this.prisma.school.findUniqueOrThrow({
            where: { id: schoolId },
        });
        const code = school.nextUserCode;

        const passwordHash = await bcrypt.hash(dto.password, 10);

        const result = await this.prisma.$transaction(async (tx) => {
            // Step 1: Increment school code
            await tx.school.update({
                where: { id: schoolId },
                data: { nextUserCode: code + 1 },
            });

            // Step 2: Create user
            const user = await tx.user.create({
                data: {
                    schoolId,
                    userType: 'STUDENT',
                    code,
                    name: dto.name,
                    displayName: dto.name,
                    gender: dto.gender,
                    phone: dto.phone,
                    province: dto.province,
                    district: dto.district,
                    addressArea: dto.addressArea,
                    passwordHash,
                    isActive: true,
                },
            });

            // Step 3: Create student profile
            await tx.student.create({
                data: {
                    userId: user.id,
                    birthDate: dto.birthDate ? new Date(dto.birthDate) : null,
                },
            });

            // Step 4: Create enrollment
            await tx.studentEnrollment.create({
                data: {
                    studentId: user.id,
                    yearId: currentYear.id,
                    gradeId: dto.gradeId,
                    sectionId: dto.sectionId,
                    status: 'ACTIVE',
                    isCurrent: true,
                    joinedAt: new Date(),
                },
            });

            // Step 5: Link parent (optional)
            if (dto.parentId) {
                const parent = await tx.parent.findFirst({
                    where: { userId: dto.parentId, user: { schoolId, isDeleted: false } },
                });
                if (!parent) throw new NotFoundException('PARENT_NOT_FOUND');

                await tx.parentStudent.create({
                    data: { parentId: dto.parentId, studentId: user.id },
                });
            }

            return user;
        });

        // Return with credentials (SRS §6.5)
        return {
            student: {
                uuid: result.uuid,
                name: result.name,
                code,
            },
            credentials: {
                schoolCode: school.schoolCode,
                studentCode: code,
                password: dto.password,
            },
        };
    }

    // ─── SRS-STU-03: Student Profile ────────────────────────────

    async getStudentProfile(uuid: string, schoolId: number) {
        const user = await this.prisma.user.findFirst({
            where: { uuid, userType: 'STUDENT', isDeleted: false, schoolId },
            select: {
                uuid: true, name: true, displayName: true, code: true, gender: true,
                phone: true, email: true, province: true, district: true,
                addressArea: true, addressDetails: true,
                isActive: true, createdAt: true, updatedAt: true,
                student: {
                    select: {
                        birthDate: true,
                        enrollments: {
                            where: { isDeleted: false, isCurrent: true },
                            include: {
                                grade: { select: { id: true, displayName: true } },
                                section: { select: { id: true, name: true } },
                                year: { select: { id: true, name: true } },
                            },
                        },
                        parentLinks: {
                            where: { isDeleted: false },
                            include: {
                                parent: {
                                    include: {
                                        user: { select: { uuid: true, name: true, phone: true } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });
        if (!user) throw new NotFoundException('STUDENT_NOT_FOUND');

        const currentEnrollment = user.student?.enrollments?.[0] ?? null;

        return {
            uuid: user.uuid,
            name: user.name,
            displayName: user.displayName,
            code: user.code,
            gender: user.gender,
            isActive: user.isActive,
            phone: user.phone,
            email: user.email,
            birthDate: user.student?.birthDate,
            province: user.province,
            district: user.district,
            addressArea: user.addressArea,
            addressDetails: user.addressDetails,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            currentEnrollment: currentEnrollment
                ? {
                    id: currentEnrollment.id,
                    gradeName: currentEnrollment.grade.displayName,
                    sectionName: currentEnrollment.section.name,
                    gradeId: currentEnrollment.gradeId,
                    sectionId: currentEnrollment.sectionId,
                    status: currentEnrollment.status,
                    isCurrent: currentEnrollment.isCurrent,
                    joinedAt: currentEnrollment.joinedAt,
                    yearName: currentEnrollment.year.name,
                }
                : null,
            parents: (user.student?.parentLinks ?? []).map((link) => ({
                uuid: link.parent.user.uuid,
                name: link.parent.user.name,
                phone: link.parent.user.phone,
            })),
        };
    }

    // ─── SRS-STU-04: Update Student ─────────────────────────────

    async updateStudent(uuid: string, schoolId: number, dto: UpdateStudentDto) {
        const student = await this.findStudentByUuid(uuid, schoolId);

        const userData: Record<string, any> = {};
        if (dto.name !== undefined) userData.name = dto.name;
        if (dto.displayName !== undefined) userData.displayName = dto.displayName;
        if (dto.gender !== undefined) userData.gender = dto.gender;
        if (dto.phone !== undefined) userData.phone = dto.phone;
        if (dto.email !== undefined) userData.email = dto.email;
        if (dto.province !== undefined) userData.province = dto.province;
        if (dto.district !== undefined) userData.district = dto.district;
        if (dto.addressArea !== undefined) userData.addressArea = dto.addressArea;
        if (dto.addressDetails !== undefined) userData.addressDetails = dto.addressDetails;

        await this.prisma.$transaction(async (tx) => {
            if (Object.keys(userData).length > 0) {
                await tx.user.update({ where: { id: student.id }, data: userData });
            }
            if (dto.birthDate !== undefined) {
                await tx.student.update({
                    where: { userId: student.id },
                    data: { birthDate: dto.birthDate ? new Date(dto.birthDate) : null },
                });
            }
        });

        return this.getStudentProfile(uuid, schoolId);
    }

    // ─── SRS-STU-05: Section Transfer ──────────────────────────

    async transferSection(uuid: string, schoolId: number, dto: SectionTransferDto) {
        const student = await this.findStudentByUuid(uuid, schoolId);
        const enrollment = await this.getActiveEnrollment(student.id);

        if (enrollment.sectionId === dto.newSectionId) {
            throw new BadRequestException('SAME_SECTION');
        }

        // Validate section belongs to same grade
        const section = await this.prisma.section.findFirst({
            where: {
                id: dto.newSectionId,
                gradeId: enrollment.gradeId,
                isActive: true,
                isDeleted: false,
            },
        });
        if (!section) throw new BadRequestException('SECTION_GRADE_MISMATCH');

        await this.prisma.studentEnrollment.update({
            where: { id: enrollment.id },
            data: { sectionId: dto.newSectionId },
        });

        return this.getStudentProfile(uuid, schoolId);
    }

    // ─── SRS-STU-06: Grade Transfer ────────────────────────────

    async transferGrade(uuid: string, schoolId: number, dto: GradeTransferDto) {
        const student = await this.findStudentByUuid(uuid, schoolId);
        const enrollment = await this.getActiveEnrollment(student.id);

        if (enrollment.gradeId === dto.newGradeId) {
            throw new BadRequestException('SAME_GRADE');
        }

        await this.validateGradeSection(dto.newGradeId, dto.newSectionId, schoolId);

        await this.prisma.studentEnrollment.update({
            where: { id: enrollment.id },
            data: { gradeId: dto.newGradeId, sectionId: dto.newSectionId },
        });

        return this.getStudentProfile(uuid, schoolId);
    }

    // ─── SRS-STU-07: Drop Enrollment ──────────────────────────

    async dropEnrollment(uuid: string, schoolId: number, dto: DropEnrollmentDto) {
        const student = await this.findStudentByUuid(uuid, schoolId);
        const enrollment = await this.getActiveEnrollment(student.id);

        await this.prisma.studentEnrollment.update({
            where: { id: enrollment.id },
            data: {
                status: dto.status,
                isCurrent: false,
                leftAt: new Date(),
            },
        });

        return { success: true, status: dto.status };
    }

    // ─── SRS-STU-08: Re-Enroll ────────────────────────────────

    async reEnroll(uuid: string, schoolId: number, dto: ReEnrollDto) {
        const student = await this.findStudentByUuid(uuid, schoolId);
        const currentYear = await this.getCurrentYear(schoolId);

        // Check no active enrollment exists
        const existing = await this.prisma.studentEnrollment.findFirst({
            where: { studentId: student.id, isCurrent: true, isDeleted: false },
        });
        if (existing) throw new BadRequestException('ALREADY_ENROLLED');

        // Scenario A: Restore same year enrollment
        const previousInYear = await this.prisma.studentEnrollment.findFirst({
            where: {
                studentId: student.id,
                yearId: currentYear.id,
                isCurrent: false,
                isDeleted: false,
            },
        });

        if (previousInYear) {
            await this.prisma.studentEnrollment.update({
                where: { id: previousInYear.id },
                data: { status: 'ACTIVE', isCurrent: true, leftAt: null },
            });
        } else {
            // Scenario B: Create new enrollment
            if (!dto.gradeId || !dto.sectionId) {
                throw new BadRequestException('VALIDATION_ERROR');
            }
            await this.validateGradeSection(dto.gradeId, dto.sectionId, schoolId);

            // Check unique constraint
            const conflict = await this.prisma.studentEnrollment.findFirst({
                where: { studentId: student.id, yearId: currentYear.id },
            });
            if (conflict) throw new ConflictException('ENROLLMENT_CONFLICT');

            await this.prisma.studentEnrollment.create({
                data: {
                    studentId: student.id,
                    yearId: currentYear.id,
                    gradeId: dto.gradeId,
                    sectionId: dto.sectionId,
                    status: 'ACTIVE',
                    isCurrent: true,
                    joinedAt: new Date(),
                },
            });
        }

        return this.getStudentProfile(uuid, schoolId);
    }

    // ─── SRS-STU-09: Toggle Active ────────────────────────────

    async toggleStudentActive(uuid: string, schoolId: number, isActive: boolean) {
        const student = await this.findStudentByUuid(uuid, schoolId);

        await this.prisma.user.update({
            where: { id: student.id },
            data: { isActive },
        });

        return { uuid, isActive, updatedAt: new Date() };
    }

    // ─── SRS-STU-10: Reset Password ──────────────────────────

    async resetPassword(uuid: string, schoolId: number, dto: ResetPasswordDto) {
        const student = await this.findStudentByUuid(uuid, schoolId);
        const passwordHash = await bcrypt.hash(dto.newPassword, 10);

        await this.prisma.user.update({
            where: { id: student.id },
            data: { passwordHash },
        });

        const school = await this.prisma.school.findUniqueOrThrow({
            where: { id: schoolId },
            select: { schoolCode: true },
        });

        return {
            credentials: {
                schoolCode: school.schoolCode,
                studentCode: student.code,
                password: dto.newPassword,
            },
        };
    }

    // ─── SRS-STU-11: Get Credentials ─────────────────────────

    async getCredentials(uuid: string, schoolId: number) {
        const user = await this.prisma.user.findFirst({
            where: { uuid, userType: 'STUDENT', isDeleted: false, schoolId },
            select: { code: true, passwordHash: true },
        });
        if (!user) throw new NotFoundException('STUDENT_NOT_FOUND');

        const school = await this.prisma.school.findUniqueOrThrow({
            where: { id: schoolId },
            select: { schoolCode: true },
        });

        // Note: passwordHash cannot be reversed.
        // The plain password is only available at create/reset time.
        // This endpoint returns what we can: school_code + student_code.
        // For password, the admin must use reset-password (SRS-STU-10).
        return {
            schoolCode: school.schoolCode,
            studentCode: user.code,
            note: 'Password is not stored in plain text. Use reset-password to generate a new one.',
        };
    }
}
