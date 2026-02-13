// src/public/schools/dto/public-school.dto.ts
export class PublicSchoolDto {
  uuid!: string;
  displayName!: string;
  schoolCode!: number;
  appType!: 'PUBLIC' | 'PRIVATE';
  isActive!: boolean;
  phone!: string | null;
  email!: string | null;

  province!: string | null;
  district!: string | null;
  addressArea!: string | null;
  address!: string | null;

  educationType!: string | null;
  deliveryPolicy!: 'OPEN' | 'SCHEDULED' | 'MANUAL';

  logoMediaAssetId!: number | null;
  primaryColor!: string | null;
  secondaryColor!: string | null;
  backgroundColor!: string | null;
}
