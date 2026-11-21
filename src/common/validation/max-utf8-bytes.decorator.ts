// src/common/validation/max-utf8-bytes.decorator.ts
import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';

/**
 * يتحقق من أن طول السلسلة بترميز UTF-8 لا يتجاوز `maxBytes` بايت.
 * مهم خصوصاً مع `bcrypt` الذي يقتطع كلمات المرور صمتاً عند 72 بايت UTF-8
 * (وليس 72 محرفاً من محارف Unicode مثل العربية).
 */
export function MaxUtf8Bytes(
  maxBytes: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'maxUtf8Bytes',
      target: object.constructor,
      propertyName,
      constraints: [maxBytes],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments): boolean {
          const limit = args.constraints[0] as number;
          return (
            typeof value === 'string' &&
            Buffer.byteLength(value, 'utf8') <= limit
          );
        },
        defaultMessage(args: ValidationArguments): string {
          const limit = args.constraints[0] as number;
          return `${args.property} must not exceed ${limit} UTF-8 bytes`;
        },
      },
    });
  };
}

