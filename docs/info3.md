lcome to Ubuntu 24.04.3 LTS (GNU/Linux 6.8.0-117-generic x86_64)

 * Documentation:  https://help.ubuntu.com
 * Management:     https://landscape.canonical.com
 * Support:        https://ubuntu.com/pro

 System information as of Wed Jul 29 13:41:38 UTC 2026

  System load:  0.07               Processes:             137
  Usage of /:   56.7% of 47.39GB   Users logged in:       1
  Memory usage: 30%                IPv4 address for eth0: 168.231.115.146
  Swap usage:   0%                 IPv6 address for eth0: 2a02:4780:f:99c9::1

 * Strictly confined Kubernetes makes edge and IoT secure. Learn how MicroK8s
   just raised the bar for easy, resilient and secure K8s cluster deployment.

   https://ubuntu.com/engage/secure-kubernetes-at-the-edge

Expanded Security Maintenance for Applications is not enabled.

73 updates can be applied immediately.
1 of these updates is a standard security update.
To see these additional updates run: apt list --upgradable

Enable ESM Apps to receive additional future security updates.
See https://ubuntu.com/esm or run: sudo pro status


1 updates could not be installed automatically. For more details,
see /var/log/unattended-upgrades/unattended-upgrades.log

*** System restart required ***
Last login: Wed Jul 29 13:40:34 2026 from 127.0.0.1
root@srv992229:~# find / -name "*.tar.gz" -path "*backup*" 2>/dev/null
find / -name "*.dump" 2>/dev/null | head -20
/var/backups/mafhooom/completed/backup_2026-07-29_00-13-11.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-28_22-17-37.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-28_16-34-50.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-28_22-03-49.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-29_00-07-33.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-28_14-56-13.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-28_15-10-32.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-28_23-00-13.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-28_21-43-23.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-28_22-07-51.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-28_16-56-47.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-28_22-21-08.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-28_16-32-07.tar.gz
/var/backups/mafhooom/completed/backup_2026-07-28_16-29-42.tar.gz
/root/api-mafhooom-nginx-backup.tar.gz
/root/asasprod_before_content_blocks.dump
/root/asasprod_backup.dump
root@srv992229:~# ls -lRh /www/node-projects/asas-backend/backups/temp/ 2>/dev/null
ls -lRh /var/backups/ 2>/dev/null | head -20
/www/node-projects/asas-backend/backups/temp/:
total 0
/var/backups/:
total 2.6M
-rw-r--r-- 1 root root  80K Jul 25 00:00 alternatives.tar.0
-rw-r--r-- 1 root root 5.5K Jul 19 00:00 alternatives.tar.1.gz
-rw-r--r-- 1 root root 5.5K Jul 16 00:00 alternatives.tar.2.gz
-rw-r--r-- 1 root root 5.5K Jul  8 00:00 alternatives.tar.3.gz
-rw-r--r-- 1 root root 5.5K Jul  5 00:00 alternatives.tar.4.gz
-rw-r--r-- 1 root root 5.5K Jun 27 00:00 alternatives.tar.5.gz
-rw-r--r-- 1 root root 5.5K Jun 21 00:00 alternatives.tar.6.gz
-rw-r--r-- 1 root root  48K Jul 18 06:48 apt.extended_states.0
-rw-r--r-- 1 root root 5.1K Jul  3 06:51 apt.extended_states.1.gz
-rw-r--r-- 1 root root 5.1K Jun  4 06:10 apt.extended_states.2.gz
-rw-r--r-- 1 root root 5.1K May 20 06:02 apt.extended_states.3.gz
-rw-r--r-- 1 root root 5.1K May  6 06:18 apt.extended_states.4.gz
-rw-r--r-- 1 root root 5.1K Apr 17 06:39 apt.extended_states.5.gz
-rw-r--r-- 1 root root 5.1K Apr  3 06:07 apt.extended_states.6.gz
drwxr-xr-x 2 root root 4.0K Jul 28 13:44 asas
-rw-r--r-- 1 root root    0 Jul 29 00:00 dpkg.arch.0
-rw-r--r-- 1 root root   32 Jul 26 00:00 dpkg.arch.1.gz
-rw-r--r-- 1 root root   32 Jul 25 00:00 dpkg.arch.2.gz
root@srv992229:~# cat /www/node-projects/asas-backend/.env | grep -i backup
BACKUP_STORAGE_PATH=/var/backups/mafhooom
root@srv992229:~# psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as total_units FROM units;
"
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as total_lessons FROM lesson_templates;
"
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as total_contents FROM lesson_contents;
"
 total_units 
-------------
         206
(1 row)

 total_lessons 
---------------
           965
(1 row)

 total_contents 
----------------
            191
(1 row)

root@srv992229:~# pg_dump -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -Fc -f /root/asasprod_before_recovery_$(date +%F_%H%M).dump
root@srv992229:~# sudo -u postgres createdb asas_recovery_temp
createdb: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory
        Is the server running locally and accepting connections on that socket?
root@srv992229:~# sudo -u postgres createdb asas_recovery_temp
createdb: error: connection to server on socket "/var/run/postgresql/.s.PGSQL.5432" failed: No such file or directory
        Is the server running locally and accepting connections on that socket?
root@srv992229:~# mkdir -p /tmp/safety_check
cd /tmp/safety_check
tar -xzf /var/backups/mafhooom/completed/backup_2026-07-29_00-13-11.tar.gz
ls -la
total 24
drwxr-xr-x  5 root root 4096 Jul 29 00:13 .
drwxrwxrwt 12 root root 4096 Jul 29 13:48 ..
drwxr-xr-x  2 root root 4096 Jul 29 00:13 config
drwxr-xr-x  2 root root 4096 Jul 29 00:13 database
-rw-r--r--  1 root root 2081 Jul 29 00:13 manifest.json
drwxr-xr-x  9 root root 4096 Jul 29 00:13 media
root@srv992229:/tmp/safety_check# createdb -h 127.0.0.1 -p 5432 -U asasuser asas_recovery_temp
createdb: error: database creation failed: ERROR:  permission denied to create database
root@srv992229:/tmp/safety_check# ls -lah /tmp/safety_check/database
total 4.4M
drwxr-xr-x 2 root root 4.0K Jul 29 00:13 .
drwxr-xr-x 5 root root 4.0K Jul 29 00:13 ..
-rw-r--r-- 1 root root 4.4M Jul 29 00:13 postgres.sql.gz
root@srv992229:/tmp/safety_check# cd /tmp/safety_check/database

gunzip -c postgres.sql.gz > postgres.sql
root@srv992229:/tmp/safety_check/database# head -40 postgres.sql
--
-- PostgreSQL database dump
--

\restrict 5Uz8zIpcyjWCr6vvha4vcUsDofBUIJnt5YIZKrt5PR7uyFehsNVrabjvPFhItmH

-- Dumped from database version 16.1
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

ALTER TABLE IF EXISTS ONLY public.years DROP CONSTRAINT IF EXISTS years_school_id_fkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_school_id_fkey;
ALTER TABLE IF EXISTS ONLY public.users DROP CONSTRAINT IF EXISTS users_avatar_media_asset_id_fkey;
ALTER TABLE IF EXISTS ONLY public.user_devices DROP CONSTRAINT IF EXISTS user_devices_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.units DROP CONSTRAINT IF EXISTS units_subject_id_fkey;
ALTER TABLE IF EXISTS ONLY public.units DROP CONSTRAINT IF EXISTS units_subject_dictionary_id_fkey;
ALTER TABLE IF EXISTS ONLY public.units DROP CONSTRAINT IF EXISTS units_school_id_fkey;
ALTER TABLE IF EXISTS ONLY public.timetables DROP CONSTRAINT IF EXISTS timetables_year_id_fkey;
ALTER TABLE IF EXISTS ONLY public.timetables DROP CONSTRAINT IF EXISTS timetables_term_id_fkey;
ALTER TABLE IF EXISTS ONLY public.timetables DROP CONSTRAINT IF EXISTS timetables_section_id_fkey;
ALTER TABLE IF EXISTS ONLY public.timetable_slots DROP CONSTRAINT IF EXISTS timetable_slots_timetable_id_fkey;
ALTER TABLE IF EXISTS ONLY public.timetable_slots DROP CONSTRAINT IF EXISTS timetable_slots_subject_section_id_fkey;
ALTER TABLE IF EXISTS ONLY public.terms DROP CONSTRAINT IF EXISTS terms_year_id_fkey;
ALTER TABLE IF EXISTS ONLY public.teachers DROP CONSTRAINT IF EXISTS teachers_user_id_fkey;
ALTER TABLE IF EXISTS ONLY public.teacher_scopes DROP CONSTRAINT IF EXISTS teacher_scopes_teacher_id_fkey;
ALTER TABLE IF EXISTS ONLY public.teacher_scopes DROP CONSTRAINT IF EXISTS teacher_scopes_section_id_fkey;
ALTER TABLE IF EXISTS ONLY public.teacher_scopes DROP CONSTRAINT IF EXISTS teacher_scopes_grade_id_fkey;
ALTER TABLE IF EXISTS ONLY public.teacher_extra_permissions DROP CONSTRAINT IF EXISTS teacher_extra_permissions_teacher_id_fkey;
ALTER TABLE IF EXISTS ONLY public.subjects DROP CONSTRAINT IF EXISTS subjects_school_id_fkey;
ALTER TABLE IF EXISTS ONLY public.subjects DROP CONSTRAINT IF EXISTS subjects_grade_id_fkey;
root@srv992229:/tmp/safety_check/database# grep -n "COPY public.lesson_contents" postgres.sql | head
grep -n "COPY public.lesson_templates" postgres.sql | head
grep -n "COPY public.units" postgres.sql | head
14950:COPY public.lesson_contents (id, uuid, template_id, type, title, media_asset_id, content_text, order_index, created_at, updated_at, is_deleted, deleted_at) FROM stdin;
15442:COPY public.lesson_templates (id, uuid, owner_type, school_id, subject_id, unit_id, order_index, title, status, cover_media_asset_id, template_version, source_template_id, created_by_user_id, is_active, created_at, updated_at, is_deleted, deleted_at, created_by_platform_user_id, subject_dictionary_id, source_version) FROM stdin;
64394:COPY public.units (id, uuid, subject_id, owner_type, school_id, title, order_index, description, created_at, updated_at, is_deleted, deleted_at, subject_dictionary_id) FROM stdin;
root@srv992229:/tmp/safety_check/database# cd /tmp/safety_check/database

# عد الصفوف في lesson_contents
echo "=== lesson_contents ==="
sed -n '/^COPY public.lesson_contents /,/^\\\.$/p' postgres.sql | tail -n +2 | head -n -1 | wc -l

echo "=== units ==="
sed -n '/^COPY public.units /,/^\\\.$/p' postgres.sql | tail -n +2 | head -n -1 | wc -l

echo "=== lesson_templates ==="
sed -n '/^COPY public.lesson_templates /,/^\\\.$/p' postgres.sql | tail -n +2 | head -n -1 | wc -l
=== lesson_contents ===
191
=== units ===
185
=== lesson_templates ===
841
root@srv992229:/tmp/safety_check/database# psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT id, backup_instance_id, safety_backup_id, status, created_at
  FROM restore_jobs 
  ORDER BY created_at DESC LIMIT 5;
"
 id | backup_instance_id | safety_backup_id |  status   |       created_at        
----+--------------------+------------------+-----------+-------------------------
  1 |                    |                  | COMPLETED | 2026-07-29 00:14:17.543
(1 row)

root@srv992229:/tmp/safety_check/database# psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT s.id, s.name, s.code, g.name as grade_name,
         (SELECT COUNT(*) FROM units u WHERE u.subject_id = s.id AND u.is_deleted = false) as units_count,
         (SELECT COUNT(*) FROM lesson_templates lt 
          JOIN units u ON lt.unit_id = u.id 
          WHERE u.subject_id = s.id AND lt.is_deleted = false) as lessons_count
  FROM subjects s 
  JOIN grades g ON s.grade_id = g.id
  WHERE s.name ILIKE '%كيم%' OR s.name ILIKE '%فيز%' OR s.name ILIKE '%chem%' OR s.name ILIKE '%phys%'
  ORDER BY g.name, s.name;
"
ERROR:  relation "grades" does not exist
LINE 8:   JOIN grades g ON s.grade_id = g.id
               ^
root@srv992229:/tmp/safety_check/database# mkdir -p /tmp/check_evening
cd /tmp/check_evening
tar -xzf /var/backups/mafhooom/completed/backup_2026-07-28_23-00-13.tar.gz
gunzip -c database/postgres.sql.gz > database/postgres.sql

echo "=== lesson_contents ==="
sed -n '/^COPY public.lesson_contents /,/^\\\.$/p' database/postgres.sql | tail -n +2 | head -n -1 | wc -l

echo "=== units ==="
sed -n '/^COPY public.units /,/^\\\.$/p' database/postgres.sql | tail -n +2 | head -n -1 | wc -l

echo "=== lesson_templates ==="
sed -n '/^COPY public.lesson_templates /,/^\\\.$/p' database/postgres.sql | tail -n +2 | head -n -1 | wc -l
=== lesson_contents ===
191
=== units ===
185
=== lesson_templates ===
841
root@srv992229:/tmp/check_evening# 
*** System restart required ***
Last login: Wed Jul 29 13:41:39 2026 from 127.0.0.1
root@srv992229:~# # 1. ما الجداول الموجودة أصلاً؟
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "\dt" | grep -iE "grade|subject|content|question|lesson|unit|block"

# 2. المواد وعلاقتها
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT id, name, code FROM subjects 
  WHERE name ILIKE '%كيم%' OR name ILIKE '%فيز%' 
  LIMIT 10;
"

# 3. هل يوجد content_blocks؟
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as current_blocks FROM content_blocks;
" 2>&1

# 4. قارن content_blocks مع النسخة
cd /tmp/safety_check/database
echo "=== content_blocks in safety backup ==="
sed -n '/^COPY public.content_blocks /,/^\\\.$/p' postgres.sql | tail -n +2 | head -n -1 | wc sed -n '/^COPY public.questions /,/^\\\.$/p' postgres.sql | tail -n +2 | head -n -1 | wc -l
 public | GradeDictionary            | table | asasuser
 public | content_distributions      | table | asasuser
 public | lesson_block_items         | table | asasuser
 public | lesson_content_blocks      | table | asasuser
 public | lesson_contents            | table | asasuser
 public | lesson_delivery_logs       | table | asasuser
 public | lesson_targets             | table | asasuser
 public | lesson_templates           | table | asasuser
 public | lesson_timetable_slots     | table | asasuser
 public | lessons                    | table | asasuser
 public | platform_user_subjects     | table | asasuser
 public | question_fill_answers      | table | asasuser
 public | question_fill_blanks       | table | asasuser
 public | question_matching_pairs    | table | asasuser
 public | question_options           | table | asasuser
 public | question_ordering_items    | table | asasuser
 public | questions                  | table | asasuser
 public | school_grades              | table | asasuser
 public | student_lesson_progress    | table | asasuser
 public | student_lesson_results     | table | asasuser
 public | subject_dictionary         | table | asasuser
 public | subject_section_teachers   | table | asasuser
 public | subject_sections           | table | asasuser
 public | subjects                   | table | asasuser
 public | units                      | table | asasuser
ERROR:  column "name" does not exist
LINE 2:   SELECT id, name, code FROM subjects 
                     ^
ERROR:  relation "content_blocks" does not exist
LINE 2:   SELECT COUNT(*) as current_blocks FROM content_blocks;
                                                 ^
=== content_blocks in safety backup ===
0
 current_questions 
-------------------
             12710
(1 row)

=== questions in safety backup ===
11149
root@srv992229:/tmp/safety_check/database# 



root@srv992229:/tmp/safety_check/database# cd /tmp/safety_check/database

# 1. المحتوى الفعلي للدروس
echo "=== lesson_content_blocks (backup) ==="
sed -n '/^COPY public.lesson_content_blocks /,/^\\\.$/p' postgres.sql | tail -n +2 | head -n -1 | wc -l

echo "=== lesson_block_items (backup) ==="
sed -n '/^COPY public.lesson_block_items /,/^\\\.$/p' postgres.sql | tail -n +2 | head -n -1 | wc -l

# 2. الحالي في DB
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT 
    (SELECT COUNT(*) FROM lesson_content_blocks) as content_blocks,
    (SELECT COUNT(*) FROM lesson_block_items) as block_items;
"

# 3. ابحث عن مواد الكيمياء والفيزياء بالكود
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
grep -E "S01-PH|SP1-CH" postgres.sql | head -20onary_id = sd.iddeletedE '%CH%';
=== lesson_content_blocks (backup) ===
4437
=== lesson_block_items (backup) ===
5445
 content_blocks | block_items 
----------------+-------------
           5108 |        6142
(1 row)

ERROR:  column "title" does not exist
LINE 2:   SELECT id, code, title FROM subject_dictionary 
                           ^
 id | title | subject_dictionary_id | code | is_deleted 
----+-------+-----------------------+------+------------
(0 rows)

=== units with PH/CH in backup ===
28      dd565437-99fc-4fcb-99d2-9bce952c2628    6       1       TEACHERS        PREVIEW {"_schema":"asas_teachers_import_v1","teachers":[{"first_name":"نبيل","second_name":"حسن","last_name":"صالح","phone":"773000901","gender":"MALE","specialization":"رياضيات وحاسوب","assignments":[{"subject_code":"B07-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B08-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B09-MA","section_name":"ب","role":"PRIMARY"}]},{"first_name":"منال","second_name":"خالد","last_name":"الحداد","phone":"773000902","gender":"FEMALE","specialization":"لغة إنجليزية","assignments":[{"subject_code":"B04-EN","section_name":"أ","role":"PRIMARY"},{"subject_code":"B05-EN","section_name":"ب","role":"PRIMARY"}]},{"first_name":"رائد","last_name":"الهمداني","phone":"773000903","gender":"MALE","specialization":"علوم وفيزياء","assignments":[{"subject_code":"B07-SC","section_name":"أ","role":"PRIMARY"},{"subject_code":"S01-PH","section_name":"","role":"PRIMARY"}]},{"first_name":"أروى","second_name":"سعيد","last_name":"باشراحيل","phone":"773000904","gender":"FEMALE","specialization":"قرآن كريم","assignments":[{"subject_code":"KG1-QR","section_name":"أ","role":"PRIMARY"},{"subject_code":"KG2-QR","section_name":"ب","role":"PRIMARY"}]},{"first_name":"سالم","last_name":"الربيعي","phone":"773000905","gender":"MALE","specialization":"تربية رياضية"}]}      [{"index":0,"name":"نبيل حسن صالح","status":"ERROR","errors":["كود المادة \\"B07-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B08-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B09-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000901","isDuplicate":false,"assignments":[]}},{"index":1,"name":"منال خالد الحداد","status":"ERROR","errors":["ود المادة \\"B04-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B05-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000902","isDuplicate":false,"assignments":[]}},{"index":2,"name":"رائد الهمداني","status":"ERROR","errors":["كود المادة \\"B07-SC\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"S01-PH\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000903","isDuplicate":false,"assignments":[]}},{"index":3,"name":"أروى سعيد باشراحيل","status":"ERROR","errors":["كود المادة \\"KG1-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"KG2-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000904","isDuplicate":false,"assignments":[]}},{"index":4,"name":"سالم الربيعي","status":"NEW","errors":[],"details":{"phone":"773000905","isDuplicate":false,"assignments":[]}}]    5       1       0       4       0    0\N      \N      \N      2026-06-13 21:46:54.306 2026-06-13 21:46:54.306
29      74909303-3f49-4f0f-83a1-e32ecfa3cee9    7       1       TEACHERS        COMPLETED    {"_schema":"asas_teachers_import_v1","teachers":[{"first_name":"نبيل","second_name":"حسن","last_name":"صالح","phone":"773000901","gender":"MALE","specialization":"رياضيات وحاسوب","assignments":[{"subject_code":"B07-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B08-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B09-MA","section_name":"ب","role":"PRIMARY"}]},{"first_name":"منال","second_name":"خالد","last_name":"الحداد","phone":"773000902","gender":"FEMALE","specialization":"لغة إنجليزية","assignments":[{"subject_code":"B04-EN","section_name":"أ","role":"PRIMARY"},{"subject_code":"B05-EN","section_name":"ب","role":"PRIMARY"}]},{"first_name":"رائد","last_name":"الهمداني","phone":"773000903","gender":"MALE","specialization":"علوم وفيزياء","assignments":[{"subject_code":"B07-SC","section_name":"أ","role":"PRIMARY"},{"subject_code":"S01-PH","section_name":"أ","role":"PRIMARY"}]},{"first_name":"أروى","second_name":"سعيد","last_name":"باشراحيل","phone":"773000904","gender":"FEMALE","specialization":"قرآن كريم","assignments":[{"subject_code":"KG1-QR","section_name":"أ","role":"PRIMARY"},{"subject_code":"KG2-QR","section_name":"ب","role":"PRIMARY"}]},{"first_name":"سالم","last_name":"الربيعي","phone":"773000905","gender":"MALE","specialization":"تربية رياضية"}]}        [{"index":0,"name":"نبيل حسن صالح","status":"ERROR","errors":["الشعبة \\"ب\\" غير موجودة في الصف \\"التاسع الأساسي\\""],"details":{"phone":"773000901","isDuplicate":false,"assignments":[{"subject_code":"B07-MA","subject_name":"الرياضيات","section":"أ","role":"PRIMARY","subjectId":86,"sectionId":61,"gradeId":55},{"subject_code":"B08-MA","subject_name":"الرياضيات","section":"أ","role":"PRIMARY","subjectId":93,"sectionId":62,"gradeId":56}]}},{"index":1,"name":"منال خالد الحداد","status":"ERROR","errors":["كود المادة \\"B04-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B05-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000902","isDuplicate":false,"assignments":[]}},{"index":2,"name":"رائد الهمداني","status":"NEW","errors":[],"details":{"phone":"773000903","isDuplicate":false,"assignments":[{"subject_code":"B07-SC","subject_name":"العلوم","section":"أ","role":"PRIMARY","subjectId":87,"sectionId":61,"gradeId":55},{"subject_code":"S01-PH","subject_name":"الفيزياء","section":"أ","role":"PRIMARY","subjectId":108,"sectionId":64,"gradeId":58}]}},{"index":3,"name":"أروى سعيد باشراحيل","status":"ERROR","errors":["كود المادة \\"KG1-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"KG2-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000904","isDuplicate":false,"assignments":[]}},{"index":4,"name":"سالم الربيعي","status":"NEW","errors":[],"details":{"phone":"773000905","isDuplicate":false,"assignments":[]}}]      5    20       3       2       0       [{"name":"رائد الهمداني","schoolNumber":21,"password":"21","role":"TEACHER","phone":"773000903"},{"name":"سالم الربيعي","schoolNumber":22,"password":"22","role":"TEACHER","phone":"773000905"}]    2026-06-13 21:47:49.531 2026-06-13 21:47:49.684 2026-06-13 21:47:35.754       2026-06-13 21:47:49.686
30      7e6810ee-a12e-4372-a158-884b94abf5a2    7       1       TEACHERS        PREVIEW {"_schema":"asas_teachers_import_v1","teachers":[{"first_name":"نبيل","second_name":"حسن","last_name":"صالح","phone":"773000901","gender":"MALE","specialization":"رياضيات وحاسوب","assignments":[{"subject_code":"B07-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B08-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B09-MA","section_name":"ب","role":"PRIMARY"}]},{"first_name":"منال","second_name":"خالد","last_name":"الحداد","phone":"773000902","gender":"FEMALE","specialization":"لغة إنجليزية","assignments":[{"subject_code":"B04-EN","section_name":"أ","role":"PRIMARY"},{"subject_code":"B05-EN","section_name":"ب","role":"PRIMARY"}]},{"first_name":"رائد","last_name":"الهمداني","phone":"773000903","gender":"MALE","specialization":"علوم وفيزياء","assignments":[{"subject_code":"B07-SC","section_name":"أ","role":"PRIMARY"},{"subject_code":"S01-PH","section_name":"أ","role":"PRIMARY"}]},{"first_name":"أروى","second_name":"سعيد","last_name":"باشراحيل","phone":"773000904","gender":"FEMALE","specialization":"قرآن كريم","assignments":[{"subject_code":"KG1-QR","section_name":"أ","role":"PRIMARY"},{"subject_code":"KG2-QR","section_name":"ب","role":"PRIMARY"}]},{"first_name":"سالم","last_name":"الربيعي","phone":"773000905","gender":"MALE","specialization":"تربية رياضية"}]}     [{"index":0,"name":"نبيل حسن صالح","status":"ERROR","errors":["الشعبة \\"ب\\" غير موجودة في الصف \\"التاسع الأساسي\\""],"details":{"phone":"773000901","isDuplicate":false,"assignments":[{"subject_code":"B07-MA","subject_name":"الرياضيات","section":"أ","role":"PRIMARY","subjectId":86,"sectionId":61,"gradeId":55},{"subject_code":"B08-MA","subject_name":"الرياضيات","section":"أ","role":"PRIMARY","subjectId":93,"sectionId":62,"gradeId":56}]}},{"index":1,"name":"منال خالد الحداد","status":"ERROR","errors":["كود المادة \\"B04-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B05-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000902","isDuplicate":false,"assignments":[]}},{"index":2,"name":"رائد الهمداني","status":"ERROR","errors":["المادة \\"العلوم\\" في الشعبة \\"أ\\" مسندة لمعلم آخر (PRIMARY)","المادة \\"الفيزياء\\" في الشعبة \\"أ\\" مسندة لمعلم آخر (PRIMARY)"],"details":{"phone":"773000903","isDuplicate":true,"assignments":[]}},{"index":3,"name":"أروى سعيد باشراحيل","status":"ERROR","errors":["كود المادة \\"KG1-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"KG2-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000904","isDuplicate":false,"assignments":[]}},{"index":4,"name":"سالم الربيعي","status":"DUPLICATE","errors":[],"details":{"phone":"773000905","isDuplicate":true,"assignments":[]}}]       5       0       1       4    00       \N      \N      \N      2026-06-13 21:48:05.41  2026-06-13 21:48:05.41
32      6258e82f-1f78-48b8-8816-373139befcf6    6       1       TEACHERS        PREVIEW {"_schema":"asas_teachers_import_v1","teachers":[{"first_name":"نبيل","second_name":"حسن","last_name":"صالح","phone":"773000901","gender":"MALE","specialization":"رياضيات وحاسوب","assignments":[{"subject_code":"B07-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B08-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B09-MA","section_name":"ب","role":"PRIMARY"}]},{"first_name":"منال","second_name":"خالد","last_name":"الحداد","phone":"773000902","gender":"FEMALE","specialization":"لغة إنجليزية","assignments":[{"subject_code":"B04-EN","section_name":"أ","role":"PRIMARY"},{"subject_code":"B05-EN","section_name":"ب","role":"PRIMARY"}]},{"first_name":"رائد","last_name":"الهمداني","phone":"773000903","gender":"MALE","specialization":"علوم وفيزياء","assignments":[{"subject_code":"B07-SC","section_name":"أ","role":"PRIMARY"},{"subject_code":"S01-PH","section_name":"أ","role":"PRIMARY"}]},{"first_name":"أروى","second_name":"سعيد","last_name":"باشراحيل","phone":"773000904","gender":"FEMALE","specialization":"قرآن كريم","assignments":[{"subject_code":"KG1-QR","section_name":"أ","role":"PRIMARY"},{"subject_code":"KG2-QR","section_name":"ب","role":"PRIMARY"}]},{"first_name":"سالم","last_name":"الربيعي","phone":"773000905","gender":"MALE","specialization":"تربية رياضية"}]}     [{"index":0,"name":"نبيل حسن صالح","status":"ERROR","errors":["كود المادة \\"B07-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B08-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B09-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000901","isDuplicate":false,"assignments":[]}},{"index":1,"name":"منال خالد الحداد","status":"ERROR","errors":["كود المادة \\"B04-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B05-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000902","isDuplicate":false,"assignments":[]}},{"index":2,"name":"رائد الهمداني","status":"ERROR","errors":["كود المادة \\"B07-SC\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"S01-PH\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000903","isDuplicate":false,"assignments":[]}},{"index":3,"name":"أروى سعيد باشراحيل","status":"ERROR","errors":["كود المادة \\"KG1-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"KG2-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000904","isDuplicate":false,"assignments":[]}},{"index":4,"name":"سالم الربيعي","status":"NEW","errors":[],"details":{"phone":"773000905","isDuplicate":false,"assignments":[]}}]   5       1       0       4       0    0\N      \N      \N      2026-06-13 22:03:26.726 2026-06-13 22:03:26.726
33      1eadd708-c8ac-449c-bd89-8e6f9b22f147    7       1       TEACHERS        COMPLETED    {"_schema":"asas_teachers_import_v1","teachers":[{"first_name":"نبيل","second_name":"حسن","last_name":"صالح","phone":"773000901","gender":"MALE","specialization":"رياضيات وحاسوب","assignments":[{"subject_code":"B07-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B08-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B09-MA","section_name":"ب","role":"PRIMARY"}]},{"first_name":"منال","second_name":"خالد","last_name":"الحداد","phone":"773000902","gender":"FEMALE","specialization":"لغة إنجليزية","assignments":[{"subject_code":"B04-EN","section_name":"أ","role":"PRIMARY"},{"subject_code":"B05-EN","section_name":"ب","role":"PRIMARY"}]},{"first_name":"رائد","last_name":"الهمداني","phone":"773000903","gender":"MALE","specialization":"علوم وفيزياء","assignments":[{"subject_code":"B07-SC","section_name":"أ","role":"PRIMARY"},{"subject_code":"S01-PH","section_name":"أ","role":"PRIMARY"}]},{"first_name":"أروى","second_name":"سعيد","last_name":"باشراحيل","phone":"773000904","gender":"FEMALE","specialization":"قرآن كريم","assignments":[{"subject_code":"KG1-QR","section_name":"أ","role":"PRIMARY"},{"subject_code":"KG2-QR","section_name":"ب","role":"PRIMARY"}]},{"first_name":"سالم","last_name":"الربيعي","phone":"773000905","gender":"MALE","specialization":"تربية رياضية"}]}        [{"index":0,"name":"نبيل حسن صالح","status":"ERROR","errors":["الشعبة \\"ب\\" غير موجودة في الصف \\"التاسع الأساسي\\""],"details":{"phone":"773000901","isDuplicate":false,"assignments":[{"subject_code":"B07-MA","subject_name":"الرياضيات","section":"أ","role":"PRIMARY","subjectId":86,"sectionId":61,"gradeId":55},{"subject_code":"B08-MA","subject_name":"الرياضيات","section":"أ","role":"PRIMARY","subjectId":93,"sectionId":62,"gradeId":56}]}},{"index":1,"name":"منال خالد الحداد","status":"ERROR","errors":["كود المادة \\"B04-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B05-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000902","isDuplicate":false,"assignments":[]}},{"index":2,"name":"رائد الهمداني","status":"ERROR","errors":["المادة \\"العلوم\\" في الشعبة \\"أ\\" مسندة لمعلم آخر (PRIMARY)","المادة \\"الفيزياء\\" في الشعبة \\"أ\\" مسندة لمعلم آخر (PRIMARY)"],"details":{"phone":"773000903","isDuplicate":true,"assignments":[]}},{"index":3,"name":"أروى سعيد باشراحيل","status":"ERROR","errors":["كود المادة \\"KG1-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"KG2-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000904","isDuplicate":false,"assignments":[]}},{"index":4,"name":"سالم الربيعي","status":"DUPLICATE","errors":[],"details":{"phone":"773000905","isDuplicate":true,"assignments":[]}}]       5       0       1    41       0       []      2026-06-13 22:04:26.351 2026-06-13 22:04:26.354 2026-06-13 22:03:54.186       2026-06-13 22:04:26.355
35      4901762b-78a6-457f-ba6a-000faaad39e6    1       1       TEACHERS        PREVIEW {"_schema":"asas_teachers_import_v1","teachers":[{"first_name":"نبيل","second_name":"حسن","last_name":"صالح","phone":"773000901","gender":"MALE","specialization":"رياضيات وحاسوب","assignments":[{"subject_code":"B07-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B08-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B09-MA","section_name":"ب","role":"PRIMARY"}]},{"first_name":"منال","second_name":"خالد","last_name":"الحداد","phone":"773000902","gender":"FEMALE","specialization":"لغة إنجليزية","assignments":[{"subject_code":"B04-EN","section_name":"أ","role":"PRIMARY"},{"subject_code":"B05-EN","section_name":"ب","role":"PRIMARY"}]},{"first_name":"رائد","last_name":"الهمداني","phone":"773000903","gender":"MALE","specialization":"علوم وفيزياء","assignments":[{"subject_code":"B07-SC","section_name":"أ","role":"PRIMARY"},{"subject_code":"S01-PH","section_name":"أ","role":"PRIMARY"}]},{"first_name":"أروى","second_name":"سعيد","last_name":"باشراحيل","phone":"773000904","gender":"FEMALE","specialization":"قرآن كريم","assignments":[{"subject_code":"KG1-QR","section_name":"أ","role":"PRIMARY"},{"subject_code":"KG2-QR","section_name":"ب","role":"PRIMARY"}]},{"first_name":"سالم","last_name":"الربيعي","phone":"773000905","gender":"MALE","specialization":"تربية رياضية"}]}     [{"index":0,"name":"نبيل حسن صالح","status":"ERROR","errors":["كود المادة \\"B07-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B08-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B09-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000901","isDuplicate":false,"assignments":[]}},{"index":1,"name":"منال خالد الحداد","status":"ERROR","errors":["كود المادة \\"B04-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B05-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000902","isDuplicate":false,"assignments":[]}},{"index":2,"name":"رائد الهمداني","status":"ERROR","errors":["كود المادة \\"B07-SC\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"S01-PH\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000903","isDuplicate":false,"assignments":[]}},{"index":3,"name":"أروى سعيد باشراحيل","status":"ERROR","errors":["كود المادة \\"KG1-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"KG2-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000904","isDuplicate":false,"assignments":[]}},{"index":4,"name":"سالم الربيعي","status":"NEW","errors":[],"details":{"phone":"773000905","isDuplicate":false,"assignments":[]}}]   5       1       0       4       0    0\N      \N      \N      2026-06-14 18:49:54.528 2026-06-14 18:49:54.528
36      d61772cc-9bbb-4725-a04c-3356642ce406    1       1       TEACHERS        PREVIEW {"_schema":"asas_teachers_import_v1","teachers":[{"first_name":"نبيل","second_name":"حسن","last_name":"صالح","phone":"773000901","gender":"MALE","specialization":"رياضيات وحاسوب","assignments":[{"subject_code":"B07-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B08-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B09-MA","section_name":"ب","role":"PRIMARY"}]},{"first_name":"منال","second_name":"خالد","last_name":"الحداد","phone":"773000902","gender":"FEMALE","specialization":"لغة إنجليزية","assignments":[{"subject_code":"B04-EN","section_name":"أ","role":"PRIMARY"},{"subject_code":"B05-EN","section_name":"ب","role":"PRIMARY"}]},{"first_name":"رائد","last_name":"الهمداني","phone":"773000903","gender":"MALE","specialization":"علوم وفيزياء","assignments":[{"subject_code":"B07-SC","section_name":"أ","role":"PRIMARY"},{"subject_code":"S01-PH","section_name":"أ","role":"PRIMARY"}]},{"first_name":"أروى","second_name":"سعيد","last_name":"باشراحيل","phone":"773000904","gender":"FEMALE","specialization":"قرآن كريم","assignments":[{"subject_code":"KG1-QR","section_name":"أ","role":"PRIMARY"},{"subject_code":"KG2-QR","section_name":"ب","role":"PRIMARY"}]},{"first_name":"سالم","last_name":"الربيعي","phone":"773000905","gender":"MALE","specialization":"ربية رياضية"}]}      [{"index":0,"name":"نبيل حسن صالح","status":"ERROR","errors":["كود المادة \\"B07-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B08-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B09-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000901","isDuplicate":false,"assignments":[]}},{"index":1,"name":"منال خالد الحداد","status":"ERROR","errors":["كود المادة \\"B04-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B05-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000902","isDuplicate":false,"assignments":[]}},{"index":2,"name":"رائد الهمداني","status":"ERROR","errors":["كود المادة \\"B07-SC\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"S01-PH\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000903","isDuplicate":false,"assignments":[]}},{"index":3,"name":"أروى سعيد باشراحيل","status":"ERROR","errors":["كود المادة \\"KG1-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"KG2-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000904","isDuplicate":false,"assignments":[]}},{"index":4,"name":"سالم الربيعي","status":"NEW","errors":[],"details":{"phone":"773000905","isDuplicate":false,"assignments":[]}}]   5       1       0       4       0    0\N      \N      \N      2026-06-14 18:50:48.767 2026-06-14 18:50:48.767
37      63dc21bc-7334-44b3-a684-77f5f1cf92bf    5       1       TEACHERS        PREVIEW {"_schema":"asas_teachers_import_v1","teachers":[{"first_name":"نبيل","second_name":"حسن","last_name":"صالح","phone":"773000901","gender":"MALE","specialization":"رياضيات وحاسوب","assignments":[{"subject_code":"B07-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B08-MA","section_name":"أ","role":"PRIMARY"},{"subject_code":"B09-MA","section_name":"ب","role":"PRIMARY"}]},{"first_name":"منال","second_name":"خالد","last_name":"الحداد","phone":"773000902","gender":"FEMALE","specialization":"لغة إنجليزية","assignments":[{"subject_code":"B04-EN","section_name":"أ","role":"PRIMARY"},{"subject_code":"B05-EN","section_name":"ب","role":"PRIMARY"}]},{"first_name":"رائد","last_name":"الهمداني","phone":"773000903","gender":"MALE","specialization":"علوم وفيزياء","assignments":[{"subject_code":"B07-SC","section_name":"أ","role":"PRIMARY"},{"subject_code":"S01-PH","section_name":"أ","role":"PRIMARY"}]},{"first_name":"أروى","second_name":"سعيد","last_name":"باشراحيل","phone":"773000904","gender":"FEMALE","specialization":"قرآن كريم","assignments":[{"subject_code":"KG1-QR","section_name":"أ","role":"PRIMARY"},{"subject_code":"KG2-QR","section_name":"ب","role":"PRIMARY"}]},{"first_name":"سالم","last_name":"الربيعي","phone":"773000905","gender":"MALE","specialization":"تربية رياضية"}]}     [{"index":0,"name":"نبيل حسن صالح","status":"ERROR","errors":["كود المادة \\"B07-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B08-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B09-MA\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000901","isDuplicate":false,"assignments":[]}},{"index":1,"name":"منال خالد الحداد","status":"ERROR","errors":["كود المادة \\"B04-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"B05-EN\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000902","isDuplicate":false,"assignments":[]}},{"index":2,"name":"رائد الهمداني","status":"ERROR","errors":["كود المادة \\"B07-SC\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"S01-PH\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000903","isDuplicate":false,"assignments":[]}},{"index":3,"name":"أروى سعيد باشراحيل","status":"ERROR","errors":["كود المادة \\"KG1-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة","كود المادة \\"KG2-QR\\" غير موجود في القاموس أو غير مفعل في المدرسة"],"details":{"phone":"773000904","isDuplicate":false,"assignments":[]}},{"index":4,"name":"سالم الربيعي","status":"NEW","errors":[],"details":{"phone":"773000905","isDuplicate":false,"assignments":[]}}]   5       1       0       4       0    0\N      \N      \N      2026-06-14 18:52:35.824 2026-06-14 18:52:35.824
71      9d2e30f2-4ed7-4623-89e4-466dc2773f6a    13      S01-PH  الفيزياء        فيزياء  6    t\N      2026-04-27 09:24:23.143 2026-04-27 09:24:23.143 f       \N
108     2e6fcf0d-b854-4da5-8eec-ffd9ee82eb12    7       58      71      الفيزياء        فيزياء\N      t       2026-05-23 00:03:26.658 2026-05-23 00:03:26.658 f       \N      S01-PH
168     20a1e6b7-12cd-44f5-a92a-6e8923be6e50    3       68      71      الفيزياء        فيزياء\N      t       2026-06-22 18:32:40.766 2026-06-22 18:32:40.766 f       \N      S01-PH
336     547a8650-021b-4e0b-b8f5-f205b5fa8729    10      89      71      الفيزياء        فيزياء\N      t       2026-07-08 15:13:32.921 2026-07-08 15:13:32.921 f       \N      S01-PH
root@srv992229:/tmp/safety_check/database# 






*** System restart required ***
Last login: Wed Jul 29 14:16:11 2026 from 127.0.0.1
root@srv992229:~# # 1. هل subject_dictionary لا زال يحتوي S01-PH و SP1-CH؟
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT id, code FROM subject_dictionary 
  WHERE code IN ('S01-PH', 'SP1-CH');
"

# 2. الوحدات المنصّية (PLATFORM) — مقارنة
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as current_platform_units FROM units 
  WHERE owner_type = 'PLATFORM' AND is_deleted = false;
"
cd /tmp/safety_check/database
echo "=== platform units in backup ==="
grep -c "PLATFORM" <(sed -n '/^COPY public.units /,/^\\\.$/p' postgres.sql)

# 3. الدروس المنصّية — مقارنة
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as current_platform_lessons FROM lesson_templates 
  WHERE owner_type = 'PLATFORM' AND is_deleted = false;
"
" ORDER BY u.created_at;subject_dictionary sd WHERE sd.code IN ('S01-PH', 'SP1-CH')ql)
 id |  code  
----+--------
 71 | S01-PH
(1 row)

 current_platform_units 
------------------------
                    164
(1 row)

=== platform units in backup ===
149
 current_platform_lessons 
--------------------------
                      640
(1 row)

=== platform lessons in backup ===
708
 id | title | subject_id | subject_dictionary_id | owner_type | is_deleted 
----+-------+------------+-----------------------+------------+------------
(0 rows)

ERROR:  column s.subject_dictionary_id does not exist
LINE 5:     SELECT s.id FROM subjects s WHERE s.subject_dictionary_i...
                                              ^
HINT:  Perhaps you meant to reference the column "u.subject_dictionary_id".
root@srv992229:/tmp/safety_check/database# 
# 2. الوحدات المنصّية (PLATFORM) — مقارنة
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as current_platform_units FROM units 
  WHERE owner_type = 'PLATFORM' AND is_deleted = false;
"
cd /tmp/safety_check/database
echo "=== platform units in backup ==="
grep -c "PLATFORM" <(sed -n '/^COPY public.units /,/^\\\.$/p' postgres.sql)
 current_platform_units 
------------------------
                    164
(1 row)

=== platform units in backup ===
149
root@srv992229:/tmp/safety_check/database# psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as current_platform_lessons FROM lesson_templates 
  WHERE owner_type = 'PLATFORM' AND is_deleted = false;
"
 current_platform_lessons 
--------------------------
                      640
(1 row)

root@srv992229:/tmp/safety_check/database# echo "=== platform lessons in backup ==="
grep -c "PLATFORM" <(sed -n '/^COPY public.lesson_templates /,/^\\\.$/p' postgres.sql)
=== platform lessons in backup ===
708
root@srv992229:/tmp/safety_check/database# psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT id, title, subject_id, subject_dictionary_id, owner_type, is_deleted
  FROM units 
  WHERE subject_dictionary_id IN (
    SELECT id FROM subject_dictionary WHERE code IN ('S01-PH', 'SP1-CH')
  );
"
 id | title | subject_id | subject_dictionary_id | owner_type | is_deleted 
----+-------+------------+-----------------------+------------+------------
(0 rows)

root@srv992229:/tmp/safety_check/database# psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT u.id, u.title, u.subject_id, u.owner_type, u.is_deleted, u.created_at
  FROM units u
  WHERE u.subject_id IN (
    SELECT s.id FROM subjects s WHERE s.subject_dictionary_id IN (
      SELECT sd.id FROM subject_dictionary sd WHERE sd.code IN ('S01-PH', 'SP1-CH')
    )
  )
  ORDER BY u.created_at;
"
ERROR:  column s.subject_dictionary_id does not exist
LINE 5:     SELECT s.id FROM subjects s WHERE s.subject_dictionary_i...
                                              ^
HINT:  Perhaps you meant to reference the column "u.subject_dictionary_id".
root@srv992229:/tmp/safety_check/database# 
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT id, code FROM subject_dictionary 
  WHERE code IN ('S01-PH', 'SP1-CH');
"

# 2. الوحدات المنصّية (PLATFORM) — مقارنة
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as current_platform_units FROM units 
  WHERE owner_type = 'PLATFORM' AND is_deleted = false;
"
cd /tmp/safety_check/database
echo "=== platform units in backup ==="
grep -c "PLATFORM" <(sed -n '/^COPY public.units /,/^\\\.$/p' postgres.sql)

# 3. الدروس المنصّية — مقارنة
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as current_platform_lessons FROM lesson_templates 
  WHERE owner_type = 'PLATFORM' AND is_deleted = false;
"
" ORDER BY u.created_at;subject_dictionary sd WHERE sd.code IN ('S01-PH', 'SP1-CH')ql)
 id |  code  
----+--------
 71 | S01-PH
(1 row)

 current_platform_units 
------------------------
                    164
(1 row)

=== platform units in backup ===
149
 current_platform_lessons 
--------------------------
                      640
(1 row)

=== platform lessons in backup ===
708
 id | title | subject_id | subject_dictionary_id | owner_type | is_deleted 
----+-------+------------+-----------------------+------------+------------
(0 rows)

ERROR:  column s.subject_dictionary_id does not exist
LINE 5:     SELECT s.id FROM subjects s WHERE s.subject_dictionary_i...
                                              ^
HINT:  Perhaps you meant to reference the column "u.subject_dictionary_id".
root@srv992229:/tmp/safety_check/database# 
# 2. الوحدات المنصّية (PLATFORM) — مقارنة
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as current_platform_units FROM units 
  WHERE owner_type = 'PLATFORM' AND is_deleted = false;
"
cd /tmp/safety_check/database
echo "=== platform units in backup ==="
grep -c "PLATFORM" <(sed -n '/^COPY public.units /,/^\\\.$/p' postgres.sql)
 current_platform_units 
------------------------
                    164
(1 row)

=== platform units in backup ===
149
root@srv992229:/tmp/safety_check/database# psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as current_platform_lessons FROM lesson_templates 
  WHERE owner_type = 'PLATFORM' AND is_deleted = false;
"
 current_platform_lessons 
--------------------------
                      640
(1 row)

root@srv992229:/tmp/safety_check/database# echo "=== platform lessons in backup ==="
grep -c "PLATFORM" <(sed -n '/^COPY public.lesson_templates /,/^\\\.$/p' postgres.sql)
=== platform lessons in backup ===
708
root@srv992229:/tmp/safety_check/database# psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT id, title, subject_id, subject_dictionary_id, owner_type, is_deleted
  FROM units 
  WHERE subject_dictionary_id IN (
    SELECT id FROM subject_dictionary WHERE code IN ('S01-PH', 'SP1-CH')
  );
"
 id | title | subject_id | subject_dictionary_id | owner_type | is_deleted 
----+-------+------------+-----------------------+------------+------------
(0 rows)

root@srv992229:/tmp/safety_check/database# psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT u.id, u.title, u.subject_id, u.owner_type, u.is_deleted, u.created_at
  FROM units u
  WHERE u.subject_id IN (
    SELECT s.id FROM subjects s WHERE s.subject_dictionary_id IN (
      SELECT sd.id FROM subject_dictionary sd WHERE sd.code IN ('S01-PH', 'SP1-CH')
    )
  )
  ORDER BY u.created_at;
"
ERROR:  column s.subject_dictionary_id does not exist
LINE 5:     SELECT s.id FROM subjects s WHERE s.subject_dictionary_i...
                                              ^
HINT:  Perhaps you meant to reference the column "u.subject_dictionary_id".
root@srv992229:/tmp/safety_check/database# # 1. أعط صلاحية إنشاء DB لـ asasuser
psql -h 127.0.0.1 -p 5432 -U postgres -c "ALTER USER asasuser CREATEDB;"

# إذا طلب كلمة مرور، جرّب هذا بدلاً:
cat /www/node-projects/asas-backend/.env | grep DATABASE_URL
ALTER ROLE
DATABASE_URL="postgresql://asasuser:KkEppfLSJCXwr@127.0.0.1:5432/asasprod?schema=public"
root@srv992229:/tmp/safety_check/database# root@srv992229:/tmp/safety_check/database# # 1. إنشاء قاعدة مؤقتة
createdb -h 127.0.0.1 -p 5432 -U asasuser asas_recovery_temp
root@srv992229:/tmp/safety_check/database# cd /tmp/safety_check/database
sed -i '/^\\restrict/d' postgres.sql
root@srv992229:/tmp/safety_check/database# # 3. استعادة النسخة في القاعدة المؤقتة
psql -h 127.0.0.1 -p 5432 -U asasuser -d asas_recovery_temp -f postgres.sql 2>&1 | tail -5
ALTER TABLE
ALTER TABLE
ALTER TABLE
ALTER TABLE
psql:postgres.sql:69012: error: \unrestrict: not currently in restricted mode
root@srv992229:/tmp/safety_check/database# 
root@srv992229:/tmp/safety_check/database# 
# 4. مقارنة فورية — الوحدات المفقودة للفيزياء
echo "=== وحدات الفيزياء في النسخة ==="
psql -h 127.0.0.1 -p 5432 -U asasuser -d asas_recovery_temp -c "
  SELECT u.id, u.title, u.subject_dictionary_id, u.owner_type, u.is_deleted
  FROM units u 
  WHERE u.subject_dictionary_id = 71
  ORDER BY u.order_index;
"
=== وحدات الفيزياء في النسخة ===
 id | title | subject_dictionary_id | owner_type | is_deleted 
----+-------+-----------------------+------------+------------
(0 rows)

root@srv992229:/tmp/safety_check/database# 
root@srv992229:/tmp/safety_check/database# # 5. دروس الفيزياء المنصّية في النسخة
echo "=== دروس الفيزياء في النسخة ==="
psql -h 127.0.0.1 -p 5432 -U asasuser -d asas_recovery_temp -c "
  SELECT lt.id, lt.title, lt.unit_id, lt.owner_type, lt.is_deleted
  FROM lesson_templates lt
  WHERE lt.unit_id IN (
    SELECT id FROM units WHERE subject_dictionary_id = 71
  )
  ORDER BY lt.unit_id, lt.order_index;
"
=== دروس الفيزياء في النسخة ===
 id | title | unit_id | owner_type | is_deleted 
----+-------+---------+------------+------------
(0 rows)

root@srv992229:/tmp/safety_check/database# 
root@srv992229:/tmp/safety_check/database# 
# 6. كم الدروس المنصّية — المقارنة النهائية
echo "=== platform lessons: backup vs current ==="
psql -h 127.0.0.1 -p 5432 -U asasuser -d asas_recovery_temp -c "
  SELECT COUNT(*) as backup_platform FROM lesson_templates 
  WHERE owner_type = 'PLATFORM' AND is_deleted = false;
"
psql -h 127.0.0.1 -p 5432 -U asasuser -d asasprod -c "
  SELECT COUNT(*) as current_platform FROM lesson_templates 
  WHERE owner_type = 'PLATFORM' AND is_deleted = false;
"
=== platform lessons: backup vs current ===
 backup_platform 
-----------------
             531
(1 row)

 current_platform 
------------------
              643
(1 row)

root@srv992229:/tmp/safety_check/database# 
asas_recovery_temp=> SELECT
    id,
    code,
    default_name,
    short_name
FROM subject_dictionary
WHERE default_name ILIKE '%فيز%'
   OR default_name ILIKE '%كيم%'
   OR code ILIKE '%PH%'
   OR code ILIKE '%CH%'
ORDER BY id;
 id |  code  | default_name | short_name 
----+--------+--------------+------------
 71 | S01-PH | الفيزياء     | فيزياء
 72 | S01-CH | الكيمياء     | كيمياء
 79 | S02-PH | الفيزياء     | فيزياء
 80 | S02-CH | الكيمياء     | كيمياء
 87 | S03-PH | الفيزياء     | فيزياء
 88 | S03-CH | الكيمياء     | كيمياء
(6 rows)

asas_recovery_temp=> 