// src/shared/validation/person/person.constants.ts

/** Single Source of Truth — حدود حقول User المشتركة */
export const PERSON = {
  /** الحد الأدنى لطول الاسم (بعد trim + collapse whitespace) */
  NAME_MIN: 1,

  /** الحد الأقصى لطول الاسم */
  NAME_MAX: 200,

  /** الحد الأدنى لعدد أرقام الهاتف */
  PHONE_MIN: 7,

  /** الحد الأقصى لعدد أرقام الهاتف */
  PHONE_MAX: 15,

  /** Regex للهاتف بعد التطبيع — أرقام ASCII فقط */
  PHONE_REGEX: /^\d{7,15}$/,

  /** الحد الأقصى لطول المحافظة */
  PROVINCE_MAX: 100,

  /** الحد الأقصى لطول المديرية */
  DISTRICT_MAX: 100,

  /** الحد الأقصى لطول المنطقة */
  ADDRESS_AREA_MAX: 100,

  /** الحد الأقصى لتفاصيل العنوان */
  ADDRESS_DETAILS_MAX: 500,

  /** الحد الأدنى لكلمة المرور */
  PASSWORD_MIN: 6,
} as const;
