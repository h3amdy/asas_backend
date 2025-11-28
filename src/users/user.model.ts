export type UserType = 'OWNER' | 'ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT';

export interface User {
  id: number;
  uuid: string;
  schoolId?: number | null;

  userType: UserType;
  code: number;
  
  name: string;
  phone?: string;
  email?: string;
  password?: string; // mock فقط

  isActive: boolean;
  createdAt: Date;
}
