// src/grades/grades.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { CreateGradeDto } from './dto/create-grade.dto';
import { UpdateGradeDto } from './dto/update-grade.dto';

@Injectable()
export class GradesService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.gradeDictionary.findMany({
      orderBy: {
        sortOrder: 'asc',
      },
    });
  }

  async findByUuid(uuid: string) {
    const grade = await this.prisma.gradeDictionary.findUnique({
      where: { uuid },
    });

    if (!grade) {
      throw new NotFoundException('لم يتم العثور على الصف');
    }

    return grade;
  }

  async create(dto: CreateGradeDto) {
    const data: Prisma.GradeDictionaryCreateInput = {
      code: dto.code,
      defaultName: dto.defaultName,
      shortName: dto.shortName ?? null,   // 👈 NEW
      stage: dto.stage ?? null,
      sortOrder: dto.sortOrder ?? 0,
    };

    return this.prisma.gradeDictionary.create({ data });
  }

  async update(uuid: string, dto: UpdateGradeDto) {
    await this.ensureExists(uuid);

    const data: Prisma.GradeDictionaryUpdateInput = {
      code: dto.code,
      defaultName: dto.defaultName,
      shortName: dto.shortName,           // 👈 NEW
      stage: dto.stage,
      sortOrder: dto.sortOrder,
    };

    return this.prisma.gradeDictionary.update({
      where: { uuid },
      data,
    });
  }

  async updateStatus(uuid: string, isActive: boolean) {
    await this.ensureExists(uuid);

    return this.prisma.gradeDictionary.update({
      where: { uuid },
      data: { isActive },
    });
  }

  private async ensureExists(uuid: string) {
    const exists = await this.prisma.gradeDictionary.findUnique({
      where: { uuid },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('لم يتم العثور على الصف');
    }
  }
}