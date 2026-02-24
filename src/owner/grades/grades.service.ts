import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateGradeDto } from './dto/create-grade.dto';
import { UpdateGradeDto } from './dto/update-grade.dto';

@Injectable()
export class GradesService {
  constructor(private prisma: PrismaService) { }

  async findAll() {
    return this.prisma.gradeDictionary.findMany({
      where: { isDeleted: false },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findByUuid(uuid: string) {
    const grade = await this.prisma.gradeDictionary.findUnique({
      where: { uuid },
    });

    if (!grade || grade.isDeleted) {
      throw new NotFoundException('لم يتم العثور على الصف');
    }

    return grade;
  }

  async create(dto: CreateGradeDto & { uuid?: string }) {
    const data: Prisma.GradeDictionaryCreateInput = {
      code: dto.code,
      defaultName: dto.defaultName,
      shortName: dto.shortName ?? null,
      stage: (dto.stage as any) ?? null,
      sortOrder: dto.sortOrder ?? 0,
      isActive: true,
      isDeleted: false,
    };

    // لو جاء uuid من Flutter، نستخدمه
    if (dto.uuid) {
      (data as any).uuid = dto.uuid;
    }

    return this.prisma.gradeDictionary.create({ data });
  }

  async update(uuid: string, dto: UpdateGradeDto) {
    const existing = await this.prisma.gradeDictionary.findUnique({
      where: { uuid },
    });

    if (!existing || existing.isDeleted) {
      throw new NotFoundException('لم يتم العثور على الصف');
    }

    const data: Prisma.GradeDictionaryUpdateInput = {};

    if (dto.code !== undefined) data.code = dto.code;
    if (dto.defaultName !== undefined) data.defaultName = dto.defaultName;
    if (dto.shortName !== undefined) data.shortName = dto.shortName;
    if (dto.stage !== undefined) data.stage = dto.stage as any;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    return this.prisma.gradeDictionary.update({
      where: { uuid },
      data,
    });
  }

  async updateStatus(uuid: string, isActive: boolean) {
    const existing = await this.prisma.gradeDictionary.findUnique({
      where: { uuid },
      select: { id: true, isDeleted: true },
    });

    if (!existing || existing.isDeleted) {
      throw new NotFoundException('لم يتم العثور على الصف');
    }

    return this.prisma.gradeDictionary.update({
      where: { uuid },
      data: { isActive },
    });
  }

  // 🔥 Soft delete (للاستخدام من لوحة المالك مثلاً)
  async softDelete(uuid: string) {
    const existing = await this.prisma.gradeDictionary.findUnique({
      where: { uuid },
    });

    if (!existing || existing.isDeleted) {
      throw new NotFoundException('لم يتم العثور على الصف');
    }

    return this.prisma.gradeDictionary.update({
      where: { uuid },
      data: {
        isDeleted: true,
        isActive: false,
        deletedAt: new Date(),
      },
    });
  }
}