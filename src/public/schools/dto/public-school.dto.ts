// src/public/schools/dto/public-school.dto.ts
export class PublicSchoolDto {
  uuid!: string;
  displayName!: string; // لا ترجع null لو عندك قاعدة: displayName دائماً موجود
  schoolCode!: number;
  appType!: 'PUBLIC' | 'PRIVATE';
  phone!: string | null;
  email!: string | null;

  province!: string | null;
  district!: string | null;
  addressArea!: string | null;
  address!: string | null;

  logoMediaAssetId!: number | null;
  primaryColor!: string | null;
  secondaryColor!: string | null;
  backgroundColor!: string | null;
}
