//////////////////////////////////////////////////////
// Core: Schools & Academic Structure
//////////////////////////////////////////////////////


Table schools {
  id                int [pk, increment]
  uuid              varchar [unique]   // معرّف عالمي للمدرسة
  name              varchar
  school_code       int        // unique across platform, not editable
  app_type          varchar    // PUBLIC / PRIVATE
  phone             varchar
  email             varchar
  logo_url          varchar
  address           varchar
  province          varchar     // المحافظة
  education_type    varchar     // حكومي / أهلي


  owner_notes       text [null] // ملاحظات خاصة بالمالك

  next_user_code   int      // default 1, counter for users per school
  primary_color     varchar [null]
  secondary_color   varchar [null]
  background_color  varchar [null]


  is_active         boolean
  created_at        datetime


  indexes {
    (school_code) [unique]
  }
}


Table years {
  id          int [pk, increment]
  uuid        varchar [unique]
  school_id   int
  name        varchar         // e.g. "2025/2026"
  start_date  date
  end_date    date
  is_current  boolean
}


Table terms {
  id          int [pk, increment]
  uuid        varchar [unique]
  year_id     int
  name        varchar         // "الفصل الأول"
  order_index int             // 1..3
  start_date  date    [null]
  end_date    date    [null]
  is_current  boolean
}


Table grade_dictionary {
  id           int [pk, increment]
  uuid         varchar [unique]
  code         varchar        // e.g. "G01"
 short_name   varchar [null]  // مثل "أ.أ" أو "أ.ث"
  default_name varchar
  stage        varchar        // تمهيدي/أساسي/ثانوي...
  sort_order   int
  is_active    boolean
}


Table school_grades {
  id             int [pk, increment]
  uuid           varchar [unique]
  school_id      int
  year_id        int
  dictionary_id  int          // null = صف محلي
  display_name   varchar
  sort_order     int
  is_local       boolean      // true = صف مخصص
  is_active      boolean
}


Table sections {
  id         int [pk, increment]
  uuid       varchar [unique]
  grade_id   int
  name       varchar
  is_active  boolean
}


//////////////////////////////////////////////////////
// Users & Roles
//////////////////////////////////////////////////////


Table users {
  id            int [pk, increment]
  uuid          varchar [unique]
  school_id     int        // null for platform owner
  user_type     varchar    // OWNER/ADMIN/TEACHER/STUDENT/PARENT
  code          int        // unique per school (for teacher/student/manager)
  name          varchar
  phone         varchar
  email         varchar
  password_hash varchar
  is_active     boolean
  created_at    datetime
}


Table students {
  user_id          int [pk] // FK to users.id
  uuid             varchar [unique]
  grade_id         int
  section_id       int
  current_year_id  int
}


Table parents {
  user_id  int [pk] // FK to users.id
  uuid     varchar [unique]
}


Table parent_students {
  id          int [pk, increment]
  uuid        varchar [unique]
  parent_id   int   // FK -> parents.user_id
  student_id  int   // FK -> students.user_id
}


Table teachers {
  user_id       int [pk] // FK -> users.id
  uuid          varchar [unique]
  phone         varchar
  hire_date     date
  is_supervisor boolean
}


Table teacher_scopes {
  id          int [pk, increment]
  uuid        varchar [unique]
  teacher_id  int    // FK -> teachers.user_id
  grade_id    int    // FK -> school_grades.id, nullable
  section_id  int    // FK -> sections.id, nullable
  scope_type  varchar     // TEACH / SUPERVISE
}


Table teacher_extra_permissions {
  id                    int [pk, increment]
  uuid                  varchar [unique]
  teacher_id            int     // FK -> teachers.user_id
  can_manage_subjects   boolean
  can_manage_timetable  boolean
  can_manage_students   boolean
  can_manage_parents    boolean
  can_view_reports      boolean
}


//////////////////////////////////////////////////////
// Subjects & Content
//////////////////////////////////////////////////////


Table subjects {
  id              int [pk, increment]
  uuid            varchar [unique]
  school_id       int
  grade_id        int
  name            varchar
  cover_image_url varchar
  teacher_id      int   // FK -> teachers.user_id
}


Table units {
  id           int [pk, increment]
  uuid         varchar [unique]
  subject_id   int
  title        varchar
  order_index  int
  description  text [null]
}


Table lessons {
  id                 int [pk, increment]
  uuid               varchar [unique]
  subject_id         int
  unit_id            int
  teacher_id         int
  title              varchar         // عنوان الدرس
  cover_image_url    varchar [null]  // صورة بروفايل للدرس
  order_in_subject   int             // ترتيب الدرس داخل المادة
  status             varchar         // DRAFT/READY/PUBLISHED/ARCHIVED
  created_at_device  datetime
  created_at_server  datetime
  publish_at         datetime [null]
  year_id            int
  term_id            int
}


Table lesson_targets {
  id          int [pk, increment]
  uuid        varchar [unique]
  lesson_id   int
  section_id  int
}


Table lesson_contents {
  id            int [pk, increment]
  uuid          varchar [unique]
  lesson_id     int
  type          varchar   // TEXT/IMAGE/AUDIO
  content_text  text    [null]
  image_url     varchar [null]
  audio_url     varchar [null]
  order_index   int
}


//////////////////////////////////////////////////////
// Questions & Options
//////////////////////////////////////////////////////


Table questions {
  id                int [pk, increment]
  uuid              varchar [unique]
  lesson_id         int
  type              varchar   // MCQ / TRUE_FALSE / MATCHING / FILL / ORDERING


  question_text     text    [null]
  question_image    varchar [null]
  question_audio    varchar [null]
  score             float


  explanation_text  text    [null]
  explanation_image varchar [null]
  explanation_audio varchar [null]
}


Table question_options {
  id             int [pk, increment]
  uuid           varchar [unique]
  question_id    int
  option_text    text    [null]
  option_image   varchar [null]
  option_audio   varchar [null]
  is_correct     boolean
  order_index    int
}


Table question_matching_pairs {
  id                 int [pk, increment]
  uuid               varchar [unique]
  question_id        int


  left_text          text    [null]
  left_image         varchar [null]
  left_audio         varchar [null]


  right_text         text    [null]
  right_image        varchar [null]
  right_audio        varchar [null]


  pair_key           varchar         // مفتاح داخلي لربط الإجابة الصحيحة
}


//////////////////////////////////////////////////////
// Progress & Answers
//////////////////////////////////////////////////////


Table student_lesson_progress {
  id            int [pk, increment]
  uuid          varchar [unique]
  student_id    int   // FK -> students.user_id
  lesson_id     int
  status        varchar   // NOT_STARTED/IN_PROGRESS/COMPLETED
  last_position varchar   // JSON or any pointer
  updated_at    datetime
}


Table student_answers {
  id             int [pk, increment]
  uuid           varchar [unique]
  student_id     int   // FK -> students.user_id
  question_id    int
  answer_value   text  // JSON flexible
  is_correct     boolean
  score_awarded  float
}


//////////////////////////////////////////////////////
// Timetable
//////////////////////////////////////////////////////


Table timetables {
  id         int [pk, increment]
  uuid       varchar [unique]
  school_id  int
  year_id    int
  term_id    int
}


Table timetable_slots {
  id            int [pk, increment]
  uuid          varchar [unique]
  timetable_id  int
  grade_id      int
  section_id    int
  weekday       int    // 0-6
  lesson_number int    // 1-8
  subject_id    int
  teacher_id    int


  indexes {
    (teacher_id, weekday, lesson_number) [unique]
  }
}


Table lesson_timetable_slots {
  id                int [pk, increment]
  uuid              varchar [unique]
  lesson_id         int
  timetable_slot_id int
}


//////////////////////////////////////////////////////
// System Jobs, Notifications, Sync
//////////////////////////////////////////////////////


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


Table notification_logs {
  id                int [pk, increment]
  uuid              varchar [unique]
  user_id           int
  notification_type varchar
  title             varchar
  body              text
  created_at        datetime
}


Table sync_changes {
  id               int [pk, increment]
  uuid             varchar [unique]
  user_id          int
  table_name       varchar
  record_id        int          // id في الجدول الأصلي
  record_uuid      varchar [null]  // uuid في الجدول الأصلي (لتسهيل الربط من التطبيق)
  action           varchar      // INSERT/UPDATE/DELETE
  payload_json     text
  device_timestamp datetime
  synced           boolean
}


//////////////////////////////////////////////////////
// Devices (لـ FCM)
//////////////////////////////////////////////////////


Table user_devices {
  id             int [pk, increment]
  uuid           varchar [unique]
  user_id        int        // FK -> users.id
  device_token   varchar    // FCM token
  device_type    varchar    // ANDROID / IOS / WEB
  last_seen_at   datetime
  is_active      boolean


  indexes {
    (user_id)
    (device_token) [unique]
  }
}


//////////////////////////////////////////////////////
// Relationships (Refs) — نفس اللي كتبتها سابقًا
//////////////////////////////////////////////////////


Ref: years.school_id > schools.id
Ref: terms.year_id   > years.id


Ref: school_grades.school_id     > schools.id
Ref: school_grades.year_id       > years.id
Ref: school_grades.dictionary_id > grade_dictionary.id


Ref: sections.grade_id > school_grades.id


Ref: users.school_id > schools.id


Ref: students.user_id         > users.id
Ref: students.grade_id        > school_grades.id
Ref: students.section_id      > sections.id
Ref: students.current_year_id > years.id


Ref: parents.user_id > users.id


Ref: parent_students.parent_id  > parents.user_id
Ref: parent_students.student_id > students.user_id


Ref: teachers.user_id > users.id


Ref: teacher_scopes.teacher_id > teachers.user_id
Ref: teacher_scopes.grade_id   > school_grades.id
Ref: teacher_scopes.section_id > sections.id


Ref: teacher_extra_permissions.teacher_id > teachers.user_id


Ref: subjects.school_id  > schools.id
Ref: subjects.grade_id   > school_grades.id
Ref: subjects.teacher_id > teachers.user_id


Ref: units.subject_id > subjects.id


Ref: lessons.subject_id > subjects.id
Ref: lessons.unit_id    > units.id
Ref: lessons.teacher_id > teachers.user_id
Ref: lessons.year_id    > years.id
Ref: lessons.term_id    > terms.id


Ref: lesson_targets.lesson_id  > lessons.id
Ref: lesson_targets.section_id > sections.id


Ref: lesson_contents.lesson_id > lessons.id


Ref: questions.lesson_id                   > lessons.id
Ref: question_options.question_id          > questions.id
Ref: question_matching_pairs.question_id   > questions.id


Ref: student_lesson_progress.student_id > students.user_id
Ref: student_lesson_progress.lesson_id  > lessons.id


Ref: student_answers.student_id  > students.user_id
Ref: student_answers.question_id > questions.id


Ref: timetables.school_id > schools.id
Ref: timetables.year_id   > years.id
Ref: timetables.term_id   > terms.id


Ref: timetable_slots.timetable_id > timetables.id
Ref: timetable_slots.grade_id     > school_grades.id
Ref: timetable_slots.section_id   > sections.id
Ref: timetable_slots.subject_id   > subjects.id
Ref: timetable_slots.teacher_id   > teachers.user_id


Ref: lesson_timetable_slots.lesson_id         > lessons.id
Ref: lesson_timetable_slots.timetable_slot_id > timetable_slots.id


Ref: missing_lesson_logs.grade_id   > school_grades.id
Ref: missing_lesson_logs.section_id > sections.id
Ref: missing_lesson_logs.subject_id > subjects.id
Ref: missing_lesson_logs.teacher_id > teachers.user_id


Ref: notification_logs.user_id > users.id


Ref: sync_changes.user_id > users.id


Ref: user_devices.user_id > users.id





