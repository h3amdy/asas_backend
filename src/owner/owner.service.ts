import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { UpdateOwnerDto } from './dto/update-owner.dto';

@Injectable()
export class OwnerService {
  constructor(private prisma: PrismaService) { }

  async updateOwnerProfile(dto: UpdateOwnerDto) {
    // هنا نفترض دائماً أن المالك هو أول مستخدم userType = OWNER
    const owner = await this.prisma.user.findFirst({
      where: { userType: 'OWNER' },
    });

    if (!owner) throw new NotFoundException('No owner found');

    const data: any = {};

    if (dto.name) data.name = dto.name;
    if (dto.email) data.email = dto.email;
    if (dto.phone) data.phone = dto.phone;

    if (dto.newPassword) {
      data.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    }

    return this.prisma.user.update({
      where: { id: owner.id },
      data,
      select: {
        uuid: true,
        name: true,
        email: true,
        phone: true,
        userType: true,
        isActive: true,
      },
    });

  }

  async getOwner() {
    return this.prisma.user.findFirst({
      where: { userType: 'OWNER' },
      select: {
        uuid: true,
        name: true,
        email: true,
        phone: true,
        userType: true,
        isActive: true,
      },
    });
  }
}