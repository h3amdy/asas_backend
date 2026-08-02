// src/shared/validation/teacher/teacher.constants.ts

/** Teacher-specific constants — ليست حقول User مشتركة */
export const TEACHER = {
  /** الحد الأقصى لطول التخصص */
  SPECIALIZATION_MAX: 100,

  /** الحد الأقصى لطول المؤهل */
  QUALIFICATION_MAX: 100,

  /** الحد الأقصى لطول الخبرة */
  EXPERIENCE_MAX: 200,

  /** الحد الأقصى لطول الملاحظات */
  NOTES_MAX: 500,
} as const;
