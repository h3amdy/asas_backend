// src/platform/media/dto/from-url.dto.ts
import { IsIn, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * POST /platform/media/from-url
 * MEDIA-R2 B1 (SEC-MEDIA-01): تحقق صارم من شكل الطلب قبل الوصول للخدمة.
 */
export class FromUrlDto {
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
