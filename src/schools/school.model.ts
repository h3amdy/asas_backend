// src/schools/school.model.ts

export type AppType = 'PUBLIC' | 'PRIVATE';

export interface School {
  id: number;           // رقم داخلي مؤقت
  uuid: string;         // لاحقًا من DB، الآن نحط قيمة وهمية
  name: string;
  schoolCode: number;   // كود المدرسة القصير
  appType: AppType;
  phone?: string;
  email?: string;
  province?: string;
  city?: string;
  address?: string;
  educationType?: string;    // حكومي / أهلي
  isActive: boolean;
  createdAt: Date;
}
