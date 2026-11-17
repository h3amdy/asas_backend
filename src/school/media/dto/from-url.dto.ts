// src/school/media/dto/from-url.dto.ts
import { IsIn, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * POST /school/media/from-url
 * الموجة C: استيراد وسائط المدرسة من الروابط عبر الخادم.
 */
export class SchoolFromUrlDto {
  @IsString()
  @MaxLength(2048)
  @IsUrl(
    {
      protocols: ['https'],
      require_protocol: true,
      require_valid_protocol: true,
      allow_underscores: true,
    },
    { message: 'يجب أن يكون الرابط صالحاً ويبدأ بـ https://' },
  )
  url!: string;

  @IsIn(['IMAGE', 'AUDIO'], { message: 'النوع يجب أن يكون IMAGE أو AUDIO' })
  kind!: 'IMAGE' | 'AUDIO';
}

