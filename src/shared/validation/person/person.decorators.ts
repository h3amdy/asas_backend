// src/shared/validation/person/person.decorators.ts

import { applyDecorators } from '@nestjs/common';
import {
  IsString, MinLength, MaxLength, Matches, IsIn,
  IsOptional, IsEmail as ClassIsEmail,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { PERSON } from './person.constants';
import { normalizePhone, normalizePersonName } from './person.normalizers';

// ─── Name ─────────────────────────────────────────────────────

/**
 * اسم الشخص (إلزامي): Transform(normalize) → 1..200
 *
 * يُطبّع أولاً (trim + collapse whitespace) ثم يتحقق من الطول.
 *
 * @example
 *   @PersonName()
 *   name!: string;
 */
export function PersonName() {
  return applyDecorators(
    Transform(({ value }) => normalizePersonName(value)),
    IsString(),
    MinLength(PERSON.NAME_MIN, {
      message: `الاسم يجب أن يكون ${PERSON.NAME_MIN} حرف على الأقل`,
    }),
    MaxLength(PERSON.NAME_MAX, {
      message: `الاسم يجب ألا يتجاوز ${PERSON.NAME_MAX} حرف`,
    }),
  );
}

// ─── Phone ────────────────────────────────────────────────────

/**
 * هاتف إلزامي: Transform(normalize) → digits 7..15
 *
 * يُطبّع أولاً (Arabic→ASCII, إزالة تنسيق) ثم يتحقق بـ Regex.
 * مناسب لـ: Parent
 *
 * @example
 *   @PersonPhone()
 *   phone!: string;
 */
export function PersonPhone() {
  return applyDecorators(
    Transform(({ value }) => normalizePhone(value)),
    IsString(),
    Matches(PERSON.PHONE_REGEX, {
      message: `رقم الهاتف يجب أن يحتوي على ${PERSON.PHONE_MIN} إلى ${PERSON.PHONE_MAX} رقمًا فقط`,
    }),
  );
}

/**
 * هاتف اختياري: undefined/null/""/whitespace → undefined (يُتجاهل)
 *
 * عند وجود قيمة فعلية: normalize → validate
 * Non-string (مثل number) يبقى كما هو ← IsString() يرفضه
 * مناسب لـ: Student + Teacher
 *
 * لا تضع @IsOptional() خارجياً عند استخدام هذا الـ decorator.
 *
 * @example
 *   @OptionalPersonPhone()
 *   phone?: string;
 */
export function OptionalPersonPhone() {
  return applyDecorators(
    Transform(({ value }) => {
      const normalized = normalizePhone(value);
      // null/undefined → undefined لتفعيل @IsOptional
      // non-string يبقى كما هو ← IsString يرفضه
      return normalized ?? undefined;
    }),
    IsOptional(),
    IsString(),
    Matches(PERSON.PHONE_REGEX, {
      message: `رقم الهاتف يجب أن يحتوي على ${PERSON.PHONE_MIN} إلى ${PERSON.PHONE_MAX} رقمًا فقط`,
    }),
  );
}

// ─── Gender ───────────────────────────────────────────────────

/**
 * الجنس: MALE | FEMALE
 *
 * @example
 *   @PersonGender()
 *   gender!: string;
 */
export function PersonGender() {
  return applyDecorators(
    IsString(),
    IsIn(['MALE', 'FEMALE'], { message: 'gender must be MALE or FEMALE' }),
  );
}

// ─── Email ────────────────────────────────────────────────────

/**
 * البريد الإلكتروني (موحد)
 *
 * @example
 *   @IsOptional()
 *   @PersonEmail()
 *   email?: string;
 */
export function PersonEmail() {
  return applyDecorators(
    ClassIsEmail({}, { message: 'البريد الإلكتروني غير صالح' }),
  );
}
