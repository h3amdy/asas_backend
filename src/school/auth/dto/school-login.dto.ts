// src/school/auth/dto/school-login.dto.ts
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * DTO لتسجيل دخول مستخدمي المدرسة (SRS-SCH-NUM-001 §4.3)
 *
 * - `identifier`: الرقم المدرسي الموحد فقط (7 خانات) — أُلغي الدخول برقم الهاتف لجميع الفئات.
 *   لا نرفض الصيغة هنا بـ 400 حتى لا نميّز «صيغة خاطئة» عن «بيانات خاطئة»؛
 *   الخدمة ترجع INVALID_CREDENTIALS الموحّدة لأي معرّف غير صالح.
 * - `schoolUuid`: اختياري.
 *   • التطبيق العام لا يرسله — الخادم يستنتج المدرسة من حساب المستخدم.
 *   • التطبيق الخاص (White Label) يرسله — ويُستخدم للتقييد فقط (رفض مستخدمي مدرسة أخرى)،
 *     ولا يُستخدم أبداً لتحديد هوية المستخدم.
 */
export class SchoolLoginDto {
  @IsOptional()
  @IsUUID()
  schoolUuid?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : String(value)))
  @IsString()
  identifier!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  password!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  deviceFingerprint!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsIn(['ANDROID', 'IOS', 'WEB'])
  deviceType!: 'ANDROID' | 'IOS' | 'WEB';

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  pushToken?: string;
}
