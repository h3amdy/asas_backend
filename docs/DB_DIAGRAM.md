Project AsassSchoolAdmin {
  database_type: 'PostgreSQL'
  Note: 'Version V9.3 '
}

//////////////////////////////////////////////////////
// Core: Schools & Academic Structure
//////////////////////////////////////////////////////


// NOTE: In PostgreSQL/Prisma use timestamptz for created_at/updated_at/expires_at
// جدول المدارس
Table schools {
  id                int [pk, increment]
  uuid              varchar [unique]   // معرّف عالمي للمدرسة
  name              varchar
  display_name      varchar [null]
  school_code       int        // unique across platform, not editable
  app_type          varchar    // PUBLIC / PRIVATE
  phone             varchar
  email             varchar
  logo_media_asset_id int [null]         // صورة شعار المدرسة
  // logo_url          varchar // Removed in favor of media system
  address           varchar

  province          varchar     // المحافظة
  district          varchar [null] // المديرية
  address_area      varchar [null]  // العزلة/ الحي
  education_type    varchar     // حكومي / أهلي

  owner_notes       text [null] // ملاحظات خاصة بالمالك

  next_user_code    int      // default 1, counter for users per school
  primary_color     varchar [null]
  secondary_color   varchar [null]
  background_color  varchar [null]

  // سياسة تمرير/توصيل الدروس (ADM-070)
  delivery_policy   varchar  // OPEN / SCHEDULED / MANUAL

  is_active         boolean
  created_at        datetime
 // Sync (Server)
  updated_at        datetime        // ✅ last modified on server
  is_deleted        boolean [default: false]
  deleted_at        datetime [null]
  indexes {
    (school_code) [unique]
    (logo_media_asset_id)
  }
}


// جدول السنوات الدراسية
Table years {
  id          int [pk, increment]
  uuid        varchar [unique]
  school_id   int
  name        varchar         // e.g. "2025/2026"
  start_date  date
  end_date    date
  is_current  boolean

created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
}


// جدول الفصول الدراسية
Table terms {
  id          int [pk, increment]
  uuid        varchar [unique]
  year_id     int
  name        varchar         // "الفصل الأول"
  order_index int             // 1..3
  start_date  date    [null]
  end_date    date    [null]
  is_current  boolean
created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
}




//////////////////////////////////////////////////////
// Users & Roles
//////////////////////////////////////////////////////


// جدول المستخدمين
Table users {
  id              int [pk, increment]
  uuid            varchar [unique]
 school_id int [null]       // null for platform owner
  user_type       varchar    // OWNER/ADMIN/TEACHER/STUDENT/PARENT
  code            int        // unique per school (for teacher/student/manager)
  name            varchar
  display_name    varchar [null]
  gender          varchar [null] // الجنس ذكر انثى

 phone varchar [null]
  email           varchar [null]
  province        varchar [null] // المحافظة
  district        varchar [null] // المديرية
  address_area    varchar [null]  // العزلة/ الحي
  address_details varchar [null]  // تفاصيل إضافية للعنوان
  password_hash   varchar
  is_active       boolean
  created_at      datetime
updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
  /*
   ملاحظة مهمة جدًا (منطق النظام):
   - وليّ الأمر (user_type = 'PARENT') يدخل برقم الهاتف + كلمة المرور
   - باقي المستخدمين (ADMIN / TEACHER / STUDENT) يدخلون بالكود + كلمة المرور
   يجب أن يكون رقم الهاتف فريدًا فقط بين أولياء الأمور داخل نفس المدرسة.

   - يُطبّق ذلك عبر Partial Unique Index في PostgreSQL:

   CREATE UNIQUE INDEX IF NOT EXISTS uq_parent_phone_per_school
ON "User" ("schoolId", "phone")
WHERE "userType" = 'PARENT' AND "phone" IS NOT NULL AND "isDeleted" = false;

  */
}


// جدول الطلاب
Table students {
  user_id     int [pk] // FK to users.id
  uuid        varchar [unique]
  birth_date  date    [null]
}
// جدول أولياء الأمور
Table parents {
  user_id  int [pk] // FK to users.id
  uuid     varchar [unique]
}
// جدول المعلمين
Table teachers {
  user_id       int [pk] // FK -> users.id
  uuid          varchar [unique]
  hire_date     date [null] // تاريخ التعيين
  is_supervisor boolean

  // ✅ بيانات مهنية (اختياري)
  specialization   varchar [null]  // التخصص (مثال: رياضيات، لغة عربية...)
  qualification    varchar [null]  // المؤهل العلمي (بكالوريوس/دبلوم/...)
experience varchar     [null]  // الخبرة (المؤهل العملي)
  notes            text    [null]  // ملاحظات إدارية داخلية عن المعلّم
}


// ✅ جدول سجل قيد الطالب عبر السنوات (التاريخ الحقيقي للترحيل)
Table student_enrollments {
  id          int [pk, increment]
  uuid        varchar [unique]
  student_id  int   // FK -> students.user_id
  year_id     int   // FK -> years.id
  grade_id    int   // FK -> school_grades.id
  section_id  int   // FK -> sections.id

  status      varchar // ACTIVE / PROMOTED / REPEATED / TRANSFERRED_OUT / DROPPED
  is_current  boolean

  joined_at   date   [null]
  left_at     date   [null]
  notes       text   [null]
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
  indexes {
    (student_id, year_id) [unique]
    (student_id, is_current)
    (year_id, section_id)
    (updated_at)
  }
}




// جدول ربط ولي الأمر بالطلاب
Table parent_students {
  id          int [pk, increment]
  uuid        varchar [unique]
  parent_id   int   // FK -> parents.user_id
  student_id  int   // FK -> students.user_id
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
  indexes {
    (parent_id, student_id) [unique]
    (parent_id, updated_at)
    (parent_id, is_deleted)
  }
}




// جدول نطاقات المعلم (تدريس/إشراف)
Table teacher_scopes {
  id          int [pk, increment]
  uuid        varchar [unique]
  teacher_id  int    // FK -> teachers.user_id
  grade_id    int    // FK -> school_grades.id, nullable
  section_id  int    // FK -> sections.id, nullable
  scope_type  varchar     //SUPERVISE سنحتاجه مستقبلا مثل قد يكون هناك صلاحيات اخرى مثل مراقبة او او
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
  indexes {
      (teacher_id, updated_at)
  }
}


// جدول صلاحيات المعلم الإضافية
Table teacher_extra_permissions {
  teacher_id int [pk] // FK -> teachers.user_id  ✅ واحد لكل معلم
  uuid       varchar [unique]

  can_manage_subjects  boolean [default: false]
  can_manage_timetable boolean [default: false]
  can_manage_students  boolean [default: false]
  can_manage_parents   boolean [default: false]
  can_view_reports     boolean [default: false]

  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
}


//////////////////////////////////////////////////////
// 
//////////////////////////////////////////////////////



// جدول قاموس الصفوف الرسمي
Table grade_dictionary {
  id           int [pk, increment]
  uuid         varchar [unique]
  code         varchar        // e.g. "G01"
  short_name   varchar [null]  // مثل "أ.أ" أو "أ.ث"
  default_name varchar
  stage        varchar    // تمهيدي/أساسي/إعدادي/ثانوي
  sort_order   int
  is_active    boolean
created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
}


// جدول صفوف المدرسة
Table school_grades {
  id             int [pk, increment]
  uuid           varchar [unique]
  school_id      int
  dictionary_id  int          // null = صف محلي
  display_name   varchar
  sort_order     int
  is_local       boolean      // true = صف مخصص
  is_active      boolean
created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
}


// جدول الشعب (الفصول/الشعب داخل الصف)
Table sections {
  id           int [pk, increment]
  uuid         varchar [unique]
  grade_id     int
  name         varchar
  order_index  int      // 1..N (أساسي للمطابقة والترتيب) لمطابقة الشعبة في الصف السادس مع الشعبة في الصف السابع مثلا
  is_active    boolean
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
}


//////////////////////////////////////////////////////
// Subjects & Content
//////////////////////////////////////////////////////
// جدول قاموس المواد الرسمي للمنصة (Platform Subject Dictionary)
Table subject_dictionary {
  id                 int [pk, increment]
  uuid               varchar [unique]

  grade_dictionary_id int          // FK -> grade_dictionary.id (الصف الرسمي)
  code               varchar [null] // مثل "MATH_G06" (اختياري)
  default_name       varchar       // الاسم الموحد (رياضيات)
  short_name         varchar [null]
  sort_order         int           // ترتيبها على مستوى الصف الرسمي

  is_active          boolean
  cover_media_asset_id int [null]  // (اختياري) غلاف موحد من المنصة

  created_at         datetime
  updated_at         datetime
  is_deleted         boolean [default: false]
  deleted_at         datetime [null]

  indexes {
    (grade_dictionary_id, default_name) [unique]  // يمنع تكرار نفس المادة داخل نفس الصف الرسمي
    (grade_dictionary_id, sort_order)
    (code) [unique]
    (cover_media_asset_id)
  }
}


// جدول مواد المدرسة (School Subjects) — قد تكون رسمية أو محلية
Table subjects {
  id                 int [pk, increment]
  uuid               varchar [unique]

  school_id          int
  grade_id           int               // FK -> school_grades.id (صف المدرسة)
  dictionary_id      int [null]        // FK -> subject_dictionary.id (إن كانت مادة رسمية)

  // الاسم داخل المدرسة (قد يساوي اسم القاموس أو يكون مخصصاً)
  display_name       varchar
  short_name         varchar [null]

  // (اختياري) غلاف مخصص للمدرسة، وإن كان NULL يمكن للـ UI أن يرث غلاف القاموس
  cover_media_asset_id int [null]

  is_active          boolean

  created_at         datetime
  updated_at         datetime
  is_deleted         boolean [default: false]
  deleted_at         datetime [null]

  indexes {
    (school_id, grade_id)
    (dictionary_id)
    (cover_media_asset_id)

    // ✅ ملاحظة مهمة: نستخدم Partial Unique Index في PostgreSQL بدل UNIQUE عادي
    // 1) منع تكرار نفس المادة الرسمية على نفس صف المدرسة:
    // CREATE UNIQUE INDEX uq_subjects_official_per_grade
    // ON subjects (school_id, grade_id, dictionary_id)
    // WHERE dictionary_id IS NOT NULL AND is_deleted = false;

    // 2) منع تكرار مواد محلية بنفس الاسم داخل نفس صف المدرسة:
    // CREATE UNIQUE INDEX uq_subjects_local_name_per_grade
    // ON subjects (school_id, grade_id, lower(display_name))
    // WHERE dictionary_id IS NULL AND is_deleted = false;
  }
}



// جدول تقديم المادة داخل الشعبة (Subject Offering)
Table subject_sections {
  id          int [pk, increment]
  uuid        varchar [unique]
  subject_id  int   // FK -> subjects.id
  section_id  int   // FK -> sections.id

  is_active   boolean
  notes       text [null]
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]

  indexes {
    (subject_id, section_id) [unique]
    (updated_at)
  }
}


// جدول إسناد المعلم للمادة داخل شعبة
Table subject_section_teachers {
  id                 int [pk, increment]
  uuid               varchar [unique]
  subject_section_id int  // FK -> subject_sections.id
  teacher_id         int  // FK -> teachers.user_id

  role               varchar [null] // PRIMARY / ASSISTANT (اختياري)
  is_active          boolean
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]

  indexes {
    (subject_section_id, teacher_id) [unique]
    (teacher_id, updated_at)
    (subject_section_id)
  }
}

// جدول الوحدات الدراسية (يدعم منصة + مدرسة)
Table units {
  id           int [pk, increment]
  uuid         varchar [unique]

  owner_type   varchar            // PLATFORM / SCHOOL
  school_id    int [null]         // null لو PLATFORM، وإلا مدرسة

  // ربط بالمادة: واحد فقط من الاثنين
  subject_dictionary_id int [null] // FK -> subject_dictionary.id (لو PLATFORM)
  subject_id            int [null] // FK -> subjects.id (لو SCHOOL)

  title        varchar
  order_index  int
  description  text [null]

  created_at   datetime
  updated_at   datetime
  is_deleted   boolean [default: false]
  deleted_at   datetime [null]

  indexes {
    (owner_type)
    (school_id)
    (subject_dictionary_id)
    (subject_id)
    (updated_at)

    // ✅ منع تكرار ترتيب الوحدة داخل نفس مادة
    (subject_dictionary_id, order_index) [unique]
    (subject_id, order_index) [unique]
  }
}

/*
قواعد تحقق (يفضل Check Constraints في PostgreSQL):
1) owner_type='PLATFORM' => school_id IS NULL AND subject_dictionary_id IS NOT NULL AND subject_id IS NULL
2) owner_type='SCHOOL'   => school_id IS NOT NULL AND subject_id IS NOT NULL AND subject_dictionary_id IS NULL
3) لا يسمح بأن يكون subject_dictionary_id و subject_id معًا
4) لا يسمح بأن يكونا كلاهما NULL
*/



// قالب الدرس (Content Template) — منصة أو مدرسة
Table lesson_templates {
  id                 int [pk, increment]
  uuid               varchar [unique]

  owner_type         varchar            // PLATFORM / SCHOOL
  school_id          int [null]         // null لو PLATFORM، وإلا مدرسة

  // ربط بالمادة:
  subject_dictionary_id int [null]      // FK -> subject_dictionary.id (للقالب الرسمي)
  subject_id          int [null]        // FK -> subjects.id (للقالب المدرسي: مادة محلية/أو رسمية داخل المدرسة)

  // (اختياري) ربط بالوحدة:
  unit_id            int [null]         // FK -> units.id (لو وحدات المدرسة)
  order_index        int [default: 1]   // ✅ ترتيب الدرس داخل الوحدة
 
  title              varchar
  cover_media_asset_id int [null]
  template_version   int [default: 1]   // لنسخ القالب عند التعديل (clone)
  source_template_id int [null]         // FK -> lesson_templates.id (يشير للأصل عند clone)
  created_by_user_id int [null]         // FK -> users.id (من أنشأ/نسخ القالب)
  is_active          boolean

  created_at         datetime
  updated_at         datetime
  is_deleted         boolean [default: false]
  deleted_at         datetime [null]

  indexes {
    (school_id)
    (owner_type)
    (subject_dictionary_id)
    (subject_id)
    (cover_media_asset_id)
    (source_template_id)
    (updated_at)
  }
}

/*
قواعد تحقق (تكتب كملاحظة لأن DBML محدود):
- owner_type='PLATFORM' => school_id IS NULL AND subject_dictionary_id IS NOT NULL
- owner_type='SCHOOL'   => school_id IS NOT NULL AND subject_id IS NOT NULL
- subject_dictionary_id و subject_id لا يجتمعان معًا.
- unit_dictionary_id و unit_id لا يجتمعان معًا.
*/
// نشر/نسخة الدرس داخل مدرسة + سنة + فصل (Instance/Publication)
Table lessons {
  id                 int [pk, increment]
  uuid               varchar [unique]

  school_id          int
  year_id            int
  term_id            int

  template_id        int               // FK -> lesson_templates.id

  teacher_id         int               // FK -> teachers.user_id (من نشر/قدّم الدرس)
  status             varchar           // DRAFT / READY / PUBLISHED / ARCHIVED

  created_at_device  datetime
  publish_at         datetime [null]

  // توصيل/تمرير الدروس (Delivery)
  delivered_at       datetime [null]
  delivery_method    varchar [null]    // OPEN / SCHEDULED / MANUAL_OVERRIDE / MANUAL_APPROVAL

  created_at         datetime
  updated_at         datetime
  is_deleted         boolean [default: false]
  deleted_at         datetime [null]

  indexes {
    (school_id, year_id, term_id)
    (template_id)
    (teacher_id)
    (publish_at)
    (updated_at)
  }
}



// جدول استهداف الدرس للشعبة
Table lesson_targets {
  id          int [pk, increment]
  uuid        varchar [unique]
  lesson_id   int
  section_id  int
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
  indexes {
    (lesson_id, section_id) [unique]
  }
}


// جدول محتويات الدرس
Table lesson_contents {
  id            int [pk, increment]
  uuid          varchar [unique]
    template_id     int               // FK -> lesson_templates.id
  type          varchar   // TEXT/IMAGE/AUDIO
  media_asset_id  int [null]             // ✅ الوسيط المرتبط بهذا المحتوى
  content_text    text    [null]         // نص المحتوى عندما type=TEXT
  
  order_index   int
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]

 indexes {
    (template_id)
    (media_asset_id)
  }
}


//////////////////////////////////////////////////////
// Delivery Logs (Tracking / Audit)
//////////////////////////////////////////////////////


// جدول سجل تمرير/نشر الدروس (للتتبع والمراجعة)
Table lesson_delivery_logs {
  id             int [pk, increment]
  uuid           varchar [unique]
  lesson_id      int
  actor_user_id  int        // من قام بالتمرير (مشرف/مدير/معلّم) - يمكن لاحقًا دعم SYSTEM
  action         varchar    // DELIVER / OVERRIDE_DELIVER / ADD_TARGETS / UNDO (اختياري)
  policy_at_time varchar    // OPEN / SCHEDULED / MANUAL
  notes          text [null]
  created_at     datetime
}


//////////////////////////////////////////////////////
// Questions & Options
//////////////////////////////////////////////////////


// جدول الأسئلة
Table questions {
  id                int [pk, increment]
  uuid              varchar [unique]
template_id                int               // FK -> lesson_templates.id
  
  type              varchar   // MCQ / TRUE_FALSE / MATCHING / FILL / ORDERING

  question_text     text    [null]
  question_image_asset_id     int [null]  // صورة السؤال
  question_audio_asset_id     int [null]  // صوت السؤال

  score             float   [default: 1.0] // points

  explanation_text  text    [null]
  explanation_image_asset_id  int [null]  // صورة الشرح
  explanation_audio_asset_id  int [null]  // صوت الشرح
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]

  indexes {
    (question_image_asset_id)
    (question_audio_asset_id)
    (explanation_image_asset_id)
    (explanation_audio_asset_id)
  }
}


// جدول خيارات الأسئلة
Table question_options {
  id           int [pk, increment]
  uuid         varchar [unique]
  question_id  int
  option_text  text    [null]
  image_asset_id int [null]              // صورة الخيار
  audio_asset_id int [null]              // صوت الخيار
  is_correct   boolean
  order_index  int
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
  indexes {
     (question_id)
     (image_asset_id)
     (audio_asset_id)
  }
}


// جدول أزواج أسئلة المطابقة (MATCHING)
Table question_matching_pairs {
  id          int [pk, increment]
  uuid        varchar [unique]
  question_id int

  // LEFT item (عنصر العمود A)
  left_text            text [null]
  left_image_asset_id  int  [null]
  left_audio_asset_id  int  [null]

  // RIGHT item (عنصر العمود B)
  right_text            text [null]
  right_image_asset_id  int  [null]
  right_audio_asset_id  int  [null]

  // ✅ مفتاح منطقي ثابت للزوج داخل السؤال
  pair_key    varchar

  // ✅ ترتيب عرض كل طرف (مرونة كاملة)
  left_order_index   int  [null]  // ترتيب ظهور عناصر العمود الأيسر
  right_order_index  int [null]   // ترتيب ظهور عناصر العمود الأيمن

  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]

  indexes {
    (question_id)

    // ✅ ضمان ثبات/عدم تكرار الهوية داخل السؤال
    (question_id, pair_key) [unique]

    (left_image_asset_id)
    (left_audio_asset_id)
    (right_image_asset_id)
    (right_audio_asset_id)
  }
}



// جدول عناصر الترتيب (للأسئلة من نوع ORDERING)
Table question_ordering_items {
  id            int [pk, increment]
  uuid          varchar [unique]
  question_id   int
  item_text     text    [null]
  image_asset_id int [null]              // صورة العنصر
  audio_asset_id int [null]              // صوت العنصر
  correct_index int     // 1..N
  order_index   int     // لعرض العناصر بشكل عشوائي أو محدد
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
  indexes {
    (question_id)
    (question_id, correct_index) [unique]
    (question_id, order_index) [unique]
    (image_asset_id)
    (audio_asset_id)
  }
}


// جدول الإجابات المقبولة (للأسئلة من نوع FILL)
Table question_fill_answers {
  id           int [pk, increment]
  uuid         varchar [unique]
  question_id  int
  blank_key    varchar  // مثال: "A" / "B" / "1" / "capital" ...
  answer_text  text     // الإجابة المقبولة لهذا الفراغ
  is_primary   boolean  // اختياري
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
  indexes {
    (question_id, blank_key)
    (question_id, blank_key, answer_text) [unique]
  }
}


// جدول تعريف الفراغات (للأسئلة من نوع FILL)
Table question_fill_blanks {
  id          int [pk, increment]
  uuid        varchar [unique]
  question_id int
  blank_key   varchar // "A", "B", ...
  order_index int
  placeholder varchar [null]
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
  indexes {
    (question_id, blank_key) [unique]
    (question_id, order_index) [unique]
  }
}




//////////////////////////////////////////////////////
// Progress & Answers
//////////////////////////////////////////////////////


// جدول تقدم الطالب في الدروس
Table student_lesson_progress {
  id            int [pk, increment]
  uuid          varchar [unique]
  student_id    int   // FK -> students.user_id
  lesson_id     int
  status        varchar   // NOT_STARTED/IN_PROGRESS/COMPLETED
  last_position varchar   // JSON or any pointer
 created_at datetime
  updated_at    datetime
  row_version   int [default: 0]  // ✅ مفيد للتعارضات (اختياري لكن أنصح به)
  is_deleted    boolean [default: false]
  deleted_at    datetime [null]
}


// جدول نتائج الدرس (Snapshot للأداء)
Table student_lesson_results {
  id              int [pk, increment]
  uuid            varchar [unique]
  student_id      int
  lesson_id       int

  total_questions int
  correct_questions int      // الأسئلة الصحيحة بالكامل
  total_points    float
  earned_points   float
  percent         float      // 0..100

  grade_label     varchar    // ممتاز / جيد جدًا / ...
  calculated_at   datetime
  version         int        // لتتبع تغيّر خوارزمية الحساب
 // Server-derived: Pull only
  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
  indexes {
    (student_id, lesson_id) [unique]
  }
}


// جدول إجابات الطلاب
Table student_answers {
  id            int [pk, increment]
  uuid          varchar [unique]
  student_id    int   // FK -> students.user_id
  question_id   int
  answer_value  text     // JSON
  correctness   varchar  // CORRECT / PARTIAL / WRONG
  is_correct    boolean  [null] // optional, derived
  score_awarded float

  created_at    datetime
  updated_at    datetime [null]
 row_version int [default: 0]   // ✅ للتعارضات/آخر نسخة
  is_deleted  boolean [default: false] // اختياري (غالبًا لا تحذف الإجابات)
  deleted_at  datetime [null]

  indexes {
    (student_id, question_id)
    (updated_at)
  }
}


// تفاصيل إجابة الطالب (للمطابقة والترتيب - اختياري)
Table student_answer_details {
  id                int [pk, increment]
  uuid              varchar [unique]
  student_answer_id int
  
  detail_type       varchar // MATCH_PAIR / ORDER_ITEM / FILL_BLANK
  pair_key          varchar [null] // للمطابقة (MATCH_PAIR)
  ordering_item_id  int     [null] // للترتيب (ORDER_ITEM)
  blank_key         varchar [null] // للفراغات (FILL_BLANK) (prefer fill_blank_id)
  fill_blank_id     int     [null] // FK -> question_fill_blanks.id

  is_correct        boolean
  score_awarded     float [null]

  indexes {
    (student_answer_id)
    (student_answer_id, fill_blank_id) [unique]
    (student_answer_id, ordering_item_id) [unique]
    (student_answer_id, pair_key) [unique]
  }
}


//////////////////////////////////////////////////////
// Timetable
//////////////////////////////////////////////////////


// جدول الجداول الدراسية
Table timetables {
  id         int [pk, increment]
  uuid       varchar [unique]
  school_id  int
  year_id    int
  term_id    int

 status          varchar  // DRAFT / PUBLISHED
  published_at    datetime [null]
  publish_version int [default: 0]   // يزيد عند كل Publish/Republish 

  created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]

  indexes {
    (school_id, year_id, term_id) [unique]  // ✅ يمنع وجود جدولين لنفس الفصل
  }
}



// جدول حصص الجدول
Table timetable_slots {
  id                 int [pk, increment]
  uuid               varchar [unique]
  timetable_id       int
  section_id         int
  weekday            int    // 0-6
  lesson_number      int    // 1-8
 subject_section_id int [null]   // ✅ خليها nullable لو تريد “حصة فراغ/استراحة” مستقبلاً، وإلا اجعلها إلزامية
    created_at datetime
  updated_at datetime
  is_deleted boolean [default: false]
  deleted_at datetime [null]
 indexes {
    (timetable_id, section_id, weekday, lesson_number) [unique]
    (timetable_id, section_id)
    (subject_section_id)
  }
}


// جدول ربط الدروس بحصص الجدول
Table lesson_timetable_slots {
  id                int [pk, increment]
  uuid              varchar [unique]
  lesson_id         int
  timetable_slot_id int
  created_at        datetime
  updated_at        datetime
  is_deleted        boolean [default: false]
  deleted_at        datetime [null]

  indexes {
    (lesson_id, timetable_slot_id) [unique]
    (timetable_slot_id)
    (lesson_id)
  }
}



//////////////////////////////////////////////////////
// System Jobs, Notifications, Sync
//////////////////////////////////////////////////////


// جدول سجل الحصص الناقصة
Table missing_lesson_logs {
  id          int [pk, increment]
  uuid        varchar [unique]
  date        date
  grade_id    int
  section_id  int
  subject_id  int
  teacher_id  int
  reason      varchar
}


// جدول سجل الإشعارات
Table notification_logs {
  id                int [pk, increment]
  uuid              varchar [unique]
  user_id           int
  notification_type varchar
  title             varchar
  body              text
  created_at        datetime
}


// جدول سجل التغييرات المعالجة (Server-Side)
Table processed_client_changes {
  id                  int [pk, increment]
  client_change_uuid  varchar [unique]

  user_id             int
  school_id           int
  scope_key           varchar [null]

  table_name          varchar
  record_uuid         varchar
  action              varchar
client_batch_uuid varchar [null]
/*
فائدته:

تتبع دفعة كاملة

debugging عند مشاكل الشبكة

إمكانية dedupe/trace على مستوى batch*/
  received_at         datetime
  result_status       varchar     // ACKED / CONFLICT / REJECTED
  server_row_version  int [null]

  // Retention: Job should delete records > 90 days old
  indexes {
    (user_id, received_at)
    (school_id, received_at)
    (record_uuid)
    (table_name, record_uuid)
  }
}


//////////////////////////////////////////////////////
// Devices & Sessions
//////////////////////////////////////////////////////


// جدول أجهزة المستخدمين
Table user_devices {
  id                 int [pk, increment]
  uuid               varchar [unique]
  user_id            int        // FK -> users.id
  device_fingerprint varchar    // معرّف ثابت للجهاز
  push_token         varchar [null] // FCM token (قد يتغير)
  device_type        varchar    // ANDROID / IOS / WEB
  last_seen_at       datetime
  is_active          boolean

  indexes {
    (user_id)
    (device_fingerprint) [unique]
    (push_token) [unique]
  }
}


// جدول جلسات المستخدمين (Active Sessions)
Table auth_sessions {
  id                 int [pk, increment]
  uuid               varchar [unique]

  user_id            int        // FK -> users.id
  school_id          int [null] // FK -> schools.id (nullable for OWNER)
  device_id          int [null] // FK -> user_devices.id

  refresh_token_hash varchar [unique] // للتحقق من التجديد
  created_at         datetime
  last_seen_at       datetime [null]

  expires_at         datetime
  revoked_at         datetime [null] // وقت تسجيل الخروج
  revoke_reason      varchar  [null] // LOGOUT / PASSWORD_CHANGED / ADMIN_REVOKE

  indexes {
    (user_id)
    (school_id)
    (device_id)
    (revoked_at)
  }
}
//////////////////////////////////////////////////////
// Media Upload Sessions (Server) — جلسات رفع الوسائط (السيرفر)
//////////////////////////////////////////////////////

// جدول جلسات رفع الوسائط (يدعم Chunked Upload + Resume + Debugging)
Table media_upload_sessions {
  id                 int [pk, increment]      // رقم داخلي للجلسة (للربط السريع)
  uuid               varchar [unique]         // معرّف جلسة الرفع (يرسله العميل في كل طلب)

  // الربط بالوسيط النهائي الذي سيتم إنشاؤه/تحديثه
  media_asset_id     int                      // FK -> media_assets.id (الأصل الذي سينتج بعد اكتمال الرفع)

  // سياق أمني وتعدّد المستأجرين
  school_id          int                      // مدرسة الجلسة (عزل Multi-tenant)
  uploader_user_id   int                      // المستخدم الذي بدأ الرفع (معلّم/مالك/مشرف)

  // خصائص الملف قبل الرفع (للقبول والتحقق)
  kind               varchar                  // IMAGE / AUDIO (تحديد مسار المعالجة)
  content_type       varchar                  // نوع المحتوى المتوقع (مثل image/jpeg, audio/aac)
  total_size_bytes   bigint  [null]           // الحجم المتوقع (قد يكون null إذا لم يُعرف عند البداية)
  chunk_size_bytes   int                      // حجم الجزء المعتمد (مثلاً 262144 أو 1048576)

  // حالة الرفع والاستئناف
  status             varchar                  // INITIATED / UPLOADING / COMPLETED / FAILED / CANCELED
  bytes_received     bigint [default: 0]      // كم وصل للسيرفر فعليًا (مصدر الحقيقة للاستئناف)
  last_chunk_at      datetime [null]          // آخر وقت استلام chunk (لمراقبة الانقطاع)

  // مكان التخزين المؤقت أثناء الرفع
  temp_storage_key   varchar                  // مسار/مفتاح الملف المؤقت على VPS (قبل complete)

  // سياسات/طلبات معالجة (اختياري لكن مفيد)
  requested_variants_json text [null]         // ما طلبه العميل (إن سمحت) وإلا السيرفر يقرر
  processing_status  varchar [null]           // PENDING / PROCESSING / DONE / ERROR (بعد complete)

  // تتبع الأخطاء ومحاولات الاستئناف
  attempt_count      int [default: 0]         // عدد محاولات العميل (تقريبي/اختياري)
  last_error         text [null]              // آخر سبب فشل (للـ debugging)

  // Sync/Audit
  created_at         datetime                 // وقت إنشاء الجلسة
  updated_at         datetime                 // وقت آخر تحديث للجلسة

  // إغلاق الجلسة
  completed_at       datetime [null]          // وقت اكتمال الرفع (قبل/بعد توليد variants)
  expires_at         datetime                 // انتهاء صلاحية الجلسة (مثلاً 24 ساعة)
  canceled_at        datetime [null]          // وقت الإلغاء

  indexes {
    (school_id)
    (uploader_user_id, created_at)
    (status, expires_at)
    (media_asset_id)
    (updated_at)
  }
}



// ⚠️ LOCAL ONLY (Drift/SQLite) - ليس في PostgreSQL
// فائدته: طابور تغييرات Offline يتم دفعه للسيرفر عند توفر الإنترنت
Table local_outbox {
  id                int [pk, increment]

  client_change_uuid varchar [unique]   // Idempotency per change
  client_batch_uuid  varchar [null]     // grouping (optional)

  school_uuid       varchar             // scope school
  actor_user_id     int                 // who is acting now (parent or student)
  data_owner_id     int [null]          // usually student_id for student data

  table_name        varchar
  record_uuid       varchar
  action            varchar             // INSERT/UPDATE/DELETE/UPSERT
  payload_json      text

  device_timestamp  datetime            // diagnostics only
  attempt_count     int [default: 0]
  last_error        text [null]
  status            varchar             // PENDING/SENT/ACKED/FAILED

  created_at_local  datetime
}

//////////////////////////////////////////////////////
// Media System (Server) — نظام الوسائط (السيرفر)
//////////////////////////////////////////////////////

// جدول سجل الوسائط الموحد (Metadata فقط — بدون تخزين الملف داخل DB)
Table media_assets {
  id            int [pk, increment]      // رقم داخلي للربط السريع داخل قاعدة البيانات
  uuid          varchar [unique]         // معرف منطقي ثابت يُرسل للعميل ضمن المزامنة

  school_id     int                      // مدرسة الوسائط (للعزل Multi-tenant)
  kind          varchar                  // نوع الوسيط: IMAGE / AUDIO

  storage_key   varchar                  // مفتاح التخزين (مسار داخل VPS/S3) — لا تربطه ببنية URL نهائية
  original_url  varchar [null]           // رابط النسخة الأصلية (اختياري) — قد يكون Presigned لاحقًا

  // خصائص مهمة لمنع إعادة التنزيل + تحقق سلامة الملف
  content_type  varchar                  // مثل image/webp, image/jpeg, audio/aac
  size_bytes    bigint                   // حجم الملف بالبايت (للتقدير والحدود في Yemen Mode)
  etag          varchar [null]           // ETag من التخزين/الويب (ممتاز للتحقق والتحديث)
  sha256        varchar [null]           // Hash (اختياري) للتحقق القوي من سلامة الملف

  // خصائص إضافية (اختيارية لكنها مفيدة)
  width         int [null]               // عرض الصورة (للتحجيم والـ UI)
  height        int [null]               // ارتفاع الصورة
  duration_sec  int [null]               // مدة الصوت بالثواني

  // روابط نسخ متعددة لتقليل الحجم (small/medium/original)
  variants_json text [null]              // JSON: { "small": "...", "medium": "...", "original": "..." }
  preferred_variant varchar [null]       // MEDIUM مثلا (اختياري)

  // Sync fields (Server)
  created_at    datetime                 // وقت إنشاء سجل الوسيط
  updated_at    datetime                 // ✅ وقود Pull Delta (آخر تعديل على Metadata)
  is_deleted    boolean [default: false] // Soft delete للوسائط
  deleted_at    datetime [null]          // وقت الحذف (لـ GC لاحقًا)
row_version int [default: 0] //  stronger delta + ordering

  indexes {
    (school_id)
    (kind)
    (updated_at)
    (school_id, updated_at)
  }
}

// ⚠️ LOCAL ONLY (Drift/SQLite) - ليس في PostgreSQL
// فائدته: حفظ مؤشرات المزامنة لكل مدرسة/نطاق (cursor + permissions hash)
Table sync_state {
  id                   int [pk, increment]
  school_uuid          varchar
  scope_key            varchar           // e.g. STUDENT:50 or PARENT:10
  permissions_hash     varchar [null]
  last_pull_server_time datetime [null]  // cursor time = last applied updated_at from server
  last_pull_uuid_tie   varchar [null]    // ✅ tie-breaker لو ساويت timestamps (اختياري قوي)
  last_success_at_local datetime [null]

  indexes {
    (school_uuid, scope_key) [unique]
  }
}

//////////////////////////////////////////////////////
// (Optional) Media System (Local) — نظام الوسائط (محلي/عميل)
//////////////////////////////////////////////////////

// ⚠️ LOCAL ONLY (Drift/SQLite)
// كاش الوسائط (لكل asset + variant)
Table media_cache {
  id              int [pk, increment]
  asset_uuid       varchar               // uuid للوسيط
  variant          varchar               // MEDIUM/SMALL/LOW/ORIGINAL (أو image_medium..)
  local_path       varchar [null]
  status           varchar               // NOT_DOWNLOADED / DOWNLOADING / READY / FAILED
  bytes_downloaded bigint [default: 0]
  total_bytes      bigint [null]         // من variants_json[variant].size_bytes
  etag_or_hash     varchar [null]        // من variants_json[variant].etag
  last_error       text [null]
  last_accessed_at datetime [null]       // ✅ (اختياري) للـ LRU
  updated_at_local datetime

  indexes {
    (asset_uuid, variant) [unique]       // ✅ مهم
    (status)
    (last_accessed_at)
  }
}


// ⚠️ LOCAL ONLY (Drift/SQLite)
// طابور تنزيل الوسائط (Queue) مع أولويات (Yemen Mode)
Table media_download_queue {
  id              int [pk, increment]    // رقم داخلي محلي
  asset_uuid       varchar               // الوسيط المطلوب تنزيله
 variant          varchar               // MEDIUM/SMALL/LOW/ORIGINAL
  priority         int                   // 3=HIGH, 2=MED, 1=LOW
  reason           varchar               // OPEN_LESSON / PREFETCH_TODAY / MANUAL
  attempt_count    int [default: 0]      // عدد المحاولات
  next_retry_at    datetime [null]       // إعادة المحاولة بعد وقت معين
  created_at_local datetime              // وقت إضافة الطلب للطابور

indexes {
    (asset_uuid, variant) [unique]       // ✅ dedupe
    (priority)
    (next_retry_at)
  }
}
// ⚠️ LOCAL ONLY (Drift/SQLite)
// طابور رفع الوسائط: إدارة المهام + retry + استئناف
Table local_media_upload_queue {
  id                  int [pk, increment]      // رقم داخلي محلي
  task_uuid           varchar [unique]         // معرّف ثابت للمهمة (للتتبع ومنع التكرار)

  // الملف المحلي
  local_path          varchar                  // مسار الملف في الجهاز
  kind                varchar                  // IMAGE / AUDIO
  content_type        varchar                  // نوع الملف
  total_size_bytes    bigint                   // حجم الملف

  // الهدف على السيرفر
  school_uuid         varchar                  // المدرسة (للعزل)
  uploader_user_id    int                      // المستخدم الحالي (معلّم/مالك)
  media_asset_uuid    varchar [null]           // uuid للـ media_asset بعد الإنشاء (إن وُجد)
  upload_session_uuid varchar [null]           // uuid لجلسة الرفع (من السيرفر)

  // إدارة الرفع
  status              varchar                  // PENDING / UPLOADING / PAUSED / COMPLETED / FAILED / CANCELED
  bytes_sent          bigint [default: 0]      // كم أرسلنا فعليًا (resume)
  chunk_size_bytes    int                      // حجم chunk المستخدم
  last_chunk_index    int [default: 0]         // آخر chunk تم تأكيده (اختياري)

  // retry/backoff
  attempt_count       int [default: 0]         // عدد المحاولات
  next_retry_at       datetime [null]          // وقت المحاولة القادمة
  last_error          text [null]              // آخر خطأ

  // ميتاداتا إضافية
  priority            int [default: 2]         // 3=HIGH,2=MED,1=LOW
  reason              varchar [null]           // USER_UPLOAD / AUTO_SYNC / RETRY

  created_at_local    datetime                 // وقت الإنشاء محليًا
  updated_at_local    datetime                 // آخر تحديث محلي

  indexes {
    (status)
    (next_retry_at)
    (priority)
    (school_uuid)
    (upload_session_uuid)
  }
}
// ⚠️ LOCAL ONLY (Drift/SQLite)
// تتبع أجزاء الملف (chunks) لمنع إعادة إرسال أجزاء مؤكدة
Table local_media_upload_parts {
  id             int [pk, increment]      // رقم داخلي
  task_uuid       varchar                 // FK منطقي إلى local_media_upload_queue.task_uuid
  chunk_index     int                     // رقم الجزء
  start_byte      bigint                  // بداية الجزء
  end_byte        bigint                  // نهاية الجزء
  status          varchar                 // PENDING / SENT / ACKED
  etag            varchar [null]          // إن كان السيرفر يرجّع ETag لكل chunk (اختياري)
  updated_at_local datetime               // آخر تحديث

  indexes {
    (task_uuid, chunk_index) [unique]
    (task_uuid)
    (status)
  }
}

//////////////////////////////////////////////////////
// Relationships (Refs)
//////////////////////////////////////////////////////

Ref: years.school_id > schools.id
Ref: terms.year_id   > years.id

Ref: school_grades.school_id     > schools.id
Ref: school_grades.dictionary_id > grade_dictionary.id

Ref: sections.grade_id > school_grades.id

Ref: users.school_id > schools.id

Ref: students.user_id > users.id

// ✅ علاقات سجل قيد الطالب عبر السنوات
Ref: student_enrollments.student_id > students.user_id
Ref: student_enrollments.year_id    > years.id
Ref: student_enrollments.grade_id   > school_grades.id
Ref: student_enrollments.section_id > sections.id

Ref: parents.user_id > users.id

Ref: parent_students.parent_id  > parents.user_id
Ref: parent_students.student_id > students.user_id

Ref: teachers.user_id > users.id

Ref: teacher_scopes.teacher_id > teachers.user_id
Ref: teacher_scopes.grade_id   > school_grades.id
Ref: teacher_scopes.section_id > sections.id

Ref: teacher_extra_permissions.teacher_id > teachers.user_id

Ref: subjects.school_id > schools.id
Ref: subjects.grade_id  > school_grades.id

// ✅ علاقات تقديم المادة داخل الشعبة + معلميها
Ref: subject_sections.subject_id > subjects.id
Ref: subject_sections.section_id > sections.id

Ref: subject_section_teachers.subject_section_id > subject_sections.id
Ref: subject_section_teachers.teacher_id         > teachers.user_id

Ref: units.subject_id > subjects.id
Ref: units.subject_dictionary_id > subject_dictionary.id

Ref: lesson_templates.subject_id > subjects.id
Ref: lesson_templates.subject_dictionary_id > subject_dictionary.id
Ref: lesson_templates.unit_id > units.id

Ref: lesson_contents.template_id > lesson_templates.id

Ref: lessons.template_id    > lesson_templates.id
Ref: lessons.teacher_id > teachers.user_id
Ref: lessons.year_id    > years.id
Ref: lessons.term_id    > terms.id

Ref: lesson_targets.lesson_id  > lessons.id
Ref: lesson_targets.section_id > sections.id



// ✅ سجل تمرير/توصيل الدروس
Ref: lesson_delivery_logs.lesson_id     > lessons.id
Ref: lesson_delivery_logs.actor_user_id > users.id

Ref: questions.template_id             > lesson_templates.id
Ref: question_options.question_id        > questions.id
Ref: question_matching_pairs.question_id > questions.id

Ref: student_lesson_progress.student_id > students.user_id
Ref: student_lesson_progress.lesson_id  > lessons.id

Ref: student_answers.student_id  > students.user_id
Ref: student_answers.question_id > questions.id

Ref: timetables.school_id > schools.id
Ref: timetables.year_id   > years.id
Ref: timetables.term_id   > terms.id

Ref: timetable_slots.timetable_id       > timetables.id
Ref: timetable_slots.section_id         > sections.id
Ref: timetable_slots.subject_section_id > subject_sections.id

Ref: lesson_timetable_slots.lesson_id         > lessons.id
Ref: lesson_timetable_slots.timetable_slot_id > timetable_slots.id

Ref: missing_lesson_logs.grade_id   > school_grades.id
Ref: missing_lesson_logs.section_id > sections.id
Ref: missing_lesson_logs.subject_id > subjects.id
Ref: missing_lesson_logs.teacher_id > teachers.user_id

Ref: notification_logs.user_id > users.id
Ref: processed_client_changes.user_id > users.id
Ref: user_devices.user_id > users.id
Ref: processed_client_changes.school_id > schools.id
// ✅ علاقات الجلسات
Ref: auth_sessions.user_id   > users.id
Ref: auth_sessions.school_id > schools.id
Ref: auth_sessions.device_id > user_devices.id

// ✅ علاقات الأسئلة المتقدمة
Ref: question_ordering_items.question_id > questions.id
Ref: question_fill_answers.question_id   > questions.id
Ref: question_fill_blanks.question_id    > questions.id

// ✅ علاقات النتائج والتصحيح
Ref: student_lesson_results.student_id > students.user_id
Ref: student_lesson_results.lesson_id  > lessons.id

Ref: student_answer_details.student_answer_id > student_answers.id
Ref: student_answer_details.ordering_item_id  > question_ordering_items.id
Ref: student_answer_details.fill_blank_id > question_fill_blanks.id // ✅ Correct FK (Unique ID)

// ✅ علاقات السيرفر للوسائط
Ref: media_assets.school_id > schools.id

Ref: schools.logo_media_asset_id > media_assets.id
Ref: subjects.cover_media_asset_id > media_assets.id
Ref: lesson_contents.media_asset_id > media_assets.id

Ref: questions.question_image_asset_id      > media_assets.id
Ref: questions.question_audio_asset_id      > media_assets.id
Ref: questions.explanation_image_asset_id   > media_assets.id
Ref: questions.explanation_audio_asset_id   > media_assets.id

Ref: question_options.image_asset_id        > media_assets.id
Ref: question_options.audio_asset_id        > media_assets.id

Ref: question_matching_pairs.left_image_asset_id   > media_assets.id
Ref: question_matching_pairs.left_audio_asset_id   > media_assets.id
Ref: question_matching_pairs.right_image_asset_id  > media_assets.id
Ref: question_matching_pairs.right_audio_asset_id  > media_assets.id

Ref: question_ordering_items.image_asset_id        > media_assets.id
Ref: question_ordering_items.audio_asset_id        > media_assets.id
//////////////////////////////////////////////////////
// Relationships (Refs) — علاقات جلسات الرفع
//////////////////////////////////////////////////////

Ref: media_upload_sessions.school_id > schools.id
Ref: media_upload_sessions.uploader_user_id > users.id
Ref: media_upload_sessions.media_asset_id > media_assets.id

