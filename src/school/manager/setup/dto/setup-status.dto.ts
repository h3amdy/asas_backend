// src/school/manager/setup/dto/setup-status.dto.ts

export class SetupStatusDto {
    hasCurrentYear!: boolean;
    currentYearId?: number;
    currentTermId?: number;
    termsCount!: number;

    hasGrades!: boolean;
    gradesCount!: number;

    hasSections!: boolean;
    sectionsCount!: number;

    hasTeachers!: boolean;
    teachersCount!: number;

    hasSubjects!: boolean;
    subjectsCount!: number;

    /** السنة + فصول + صفوف + شُعب */
    isAcademicReady!: boolean;

    /** جاهز لإضافة الطلاب */
    isReadyForStudents!: boolean;

    /** كل شيء جاهز (أكاديمي + مواد + معلمين) */
    isFullyReady!: boolean;
}
