import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAdminDto } from './dto/create-admin.dto';
import { UpdateAdminDto } from './dto/update-admin.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AdminsService {
  constructor(private prisma: PrismaService) { }

  // إنشاء مدير مدرسة جديد
  async create(dto: CreateAdminDto) {
    // 1) نتأكد أن المدرسة موجودة
    const school = await this.prisma.school.findUnique({
      where: { uuid: dto.schoolUuid },
    });

    if (!school) {
      throw new NotFoundException('لم يتم العثور على المدرسة');
    }

    // 2) نتأكد أن البريد غير مستخدم
    if (dto.email) {
      const exists = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (exists) {
        throw new BadRequestException('البريد مستخدم مسبقاً');
      }
    }

    // 3) تشفير كلمة المرور
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // 4) إنشاء المستخدم كـ ADMIN
    const admin = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        userType: 'ADMIN', // انتبه: من enum UserType
        school: {
          connect: { id: school.id },
        },
        isActive: true,
      },
    });

    return {
      uuid: admin.uuid,
      name: admin.name,
      email: admin.email,
      phone: admin.phone,
      userType: admin.userType,
      school: {
        uuid: school.uuid,
        name: school.name,
        schoolCode: school.schoolCode,
      },
    };
  }

  // جميع مدراء المدارس (للمالك)
  async findAll() {
    const admins = await this.prisma.user.findMany({
      where: { userType: 'ADMIN' },
      include: { school: true },
      orderBy: { createdAt: 'desc' },
    });

    return admins.map((a) => ({
      uuid: a.uuid,
      name: a.name,
      email: a.email,
      phone: a.phone,
      isActive: a.isActive,
      school: a.school
        ? {
          uuid: a.school.uuid,
          name: a.school.name,
          schoolCode: a.school.schoolCode,
          appType: a.school.appType,
        }
        : null,
    }));
  }

  // مدراء مدرسة معيّنة
  async findBySchool(schoolUuid: string) {
    const school = await this.prisma.school.findUnique({
      where: { uuid: schoolUuid },
    });

    if (!school) {
      throw new NotFoundException('لم يتم العثور على المدرسة');
    }

    const admins = await this.prisma.user.findMany({
      where: { schoolId: school.id, userType: 'ADMIN' },
      orderBy: { createdAt: 'desc' },
    });

    return admins.map((a) => ({
      uuid: a.uuid,
      name: a.name,
      email: a.email,
      phone: a.phone,
      isActive: a.isActive,
    }));
  }

  // تحديث بيانات مدير
  async update(uuid: string, dto: UpdateAdminDto) {
    await this.ensureExists(uuid);

    return this.prisma.user.update({
      where: { uuid },
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        // لن نسمح بتغيير المدرسة ولا كلمة المرور من هنا الآن
      },
    });
  }

  // تفعيل / إيقاف مدير
  async updateStatus(uuid: string, isActive: boolean) {
    await this.ensureExists(uuid);

    return this.prisma.user.update({
      where: { uuid },
      data: { isActive },
    });
  }

  private async ensureExists(uuid: string) {
    const user = await this.prisma.user.findUnique({ where: { uuid } });
    if (!user || user.userType !== 'ADMIN') {
      throw new NotFoundException('لم يتم العثور على المدير');
    }
  }
}