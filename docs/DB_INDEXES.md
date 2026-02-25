# 🗃️ فهارس قاعدة البيانات — Database Indexes Reference

> مستخلصة من `prisma/schema.prisma`. آخر تحديث: 2026-02-25

---

## 📋 ملخص سريع

| النوع | العدد |
|-------|-------|
| **Primary Key** (`@id`) | 19 |
| **Unique** (`@unique` / `@@unique`) | 25 |
| **Index** (`@@index`) | 18 |
| **المجموع** | 62 |

---

## 1. المستخدمون (`users`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| Index | `school_id` | `users_school_id_idx` | جلب مستخدمي مدرسة |

---

## 2. المدارس (`schools`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| Unique | `schoolCode` | — | كود المدرسة الفريد |

---

## 3. قاموس الصفوف (`grade_dictionaries`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| Unique | `code` | — | كود الصف الفريد (G1, G2…) |

---

## 4. السنوات الدراسية (`years`) — بدون تواريخ (تُشتق من الفصول)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| Index | `school_id` | `years_school_id_idx` | جلب سنوات مدرسة |

> 💡 `isCurrent` ليس عليه unique index حالياً — يُدار بـ Transaction في الكود.

---

## 5. الفصول الدراسية (`terms`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| Index | `year_id` | `terms_year_id_idx` | جلب فصول سنة |

---

## 6. صفوف المدرسة (`school_grades`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| Index | `school_id` | `school_grades_school_id_idx` | جلب صفوف مدرسة |
| Index | `dictionary_id` | `school_grades_dictionary_id_idx` | ربط بالقاموس |

> 💡 يوجد partial unique constraint في الـ migrations لمنع تكرار `dictionaryId` لنفس المدرسة (فقط للصفوف غير المحذوفة).

---

## 7. الشُعب (`sections`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| Index | `grade_id` | `sections_grade_id_idx` | جلب شُعب صف |

---

## 8. بيانات الطالب (`students`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `user_id` | — | 1:1 مع User |
| Unique | `uuid` | — | معرف API |

---

## 9. بيانات ولي الأمر (`parents`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `user_id` | — | 1:1 مع User |
| Unique | `uuid` | — | معرف API |

---

## 10. بيانات المعلم (`teachers`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `user_id` | — | 1:1 مع User |
| Unique | `uuid` | — | معرف API |

---

## 11. قيد الطالب (`student_enrollments`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| **Unique** | `student_id + year_id` | `student_enrollments_student_year_key` | طالب واحد لكل سنة |
| **Index** | `student_id + is_current` | `student_enrollments_student_current_idx` | جلب قيد الطالب الحالي |
| **Index** | `year_id + section_id` | `student_enrollments_year_section_idx` | طلاب شعبة في سنة |
| Index | `updated_at` | `student_enrollments_updated_at_idx` | مزامنة |

---

## 12. ربط ولي الأمر بطالب (`parent_students`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| **Unique** | `parent_id + student_id` | `parent_students_parent_student_key` | منع التكرار |
| **Index** | `parent_id + is_deleted` | `parent_students_parent_deleted_idx` | جلب أبناء ولي أمر |

---

## 13. نطاق إشراف المعلم (`teacher_scopes`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| **Index** | `teacher_id + updated_at` | `teacher_scopes_teacher_updated_idx` | جلب نطاقات معلم + مزامنة |

---

## 14. صلاحيات المعلم الإضافية (`teacher_extra_permissions`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `teacher_id` | — | 1:1 مع Teacher |
| Unique | `uuid` | — | معرف API |

---

## 15. قاموس المواد (`subject_dictionary`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| Unique | `code` | — | كود فريد (اختياري) |
| **Index** | `grade_dictionary_id + sort_order` | `subject_dictionary_grade_sort_idx` | مواد صف مرتبة |

---

## 16. مواد المدرسة (`subjects`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| **Index** | `school_id + grade_id` | `subjects_school_grade_idx` | مواد صف في مدرسة |
| Index | `dictionary_id` | `subjects_dictionary_id_idx` | ربط بالقاموس |

---

## 17. تقديم المادة في شعبة (`subject_sections`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| **Unique** | `subject_id + section_id` | `subject_sections_subject_section_key` | مادة واحدة لكل شعبة |
| Index | `updated_at` | `subject_sections_updated_at_idx` | مزامنة |

---

## 18. إسناد معلم لمادة في شعبة (`subject_section_teachers`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| **Unique** | `subject_section_id + teacher_id` | `subject_section_teachers_ss_teacher_key` | معلم واحد لكل مادة/شعبة |
| **Index** | `teacher_id + updated_at` | `subject_section_teachers_teacher_updated_idx` | جلب مواد معلم + مزامنة |

---

## 19. أجهزة المستخدمين (`user_devices`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| **Unique** | `user_id + device_fingerprint` | `user_devices_user_device_fp_key` | جهاز واحد لكل بصمة لكل مستخدم |
| Index | `push_token` | `user_devices_push_token_idx` | بحث بتوكن الإشعارات |
| Index | `user_id` | `user_devices_user_id_idx` | جلب أجهزة مستخدم |
| Index | `device_fingerprint` | `user_devices_device_fp_idx` | بحث ببصمة الجهاز |

---

## 20. جلسات المصادقة (`auth_sessions`)

| النوع | الأعمدة | الاسم | الغرض |
|-------|---------|-------|-------|
| PK | `id` | — | auto-increment |
| Unique | `uuid` | — | معرف API |
| **Unique** | `refresh_token_hash` | — | منع تكرار Refresh Token |
| Index | `user_id` | `auth_sessions_user_id_idx` | جلسات مستخدم |
| Index | `school_id` | `auth_sessions_school_id_idx` | جلسات مدرسة |
| Index | `device_id` | `auth_sessions_device_id_idx` | جلسات جهاز |
| Index | `revoked_at` | `auth_sessions_revoked_at_idx` | فلترة الجلسات الملغية |

---

## 🔑 أنماط التصميم

| النمط | التطبيق |
|-------|---------|
| **كل جدول** لديه `uuid` فريد | `@unique @default(uuid())` |
| **Composite Unique** | لمنع التكرار المنطقي (طالب/سنة، ولي أمر/طالب، مادة/شعبة…) |
| **FK Index** | كل Foreign Key عليه `@@index` لتسريع الـ JOIN |
| **updated_at Index** | للجداول المتصلة بالمزامنة (Sync) |
| **1:1 Relations** | PK = FK (`userId` كـ `@id` في Student/Parent/Teacher) |
