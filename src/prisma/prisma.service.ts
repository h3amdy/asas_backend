// src/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();

    // ── تحويل BigInt → Number تلقائياً في كل query ──
    this.$use(async (params, next) => {
      const result = await next(params);
      return this.convertBigInts(result);
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * تحويل جميع BigInt في النتيجة إلى Number بشكل recursif
   * يحل مشكلة: TypeError: Do not know how to serialize a BigInt
   */
  private convertBigInts(data: any): any {
    if (data === null || data === undefined) return data;
    if (typeof data === 'bigint') return Number(data);
    if (Array.isArray(data)) return data.map((item) => this.convertBigInts(item));
    if (typeof data === 'object' && !(data instanceof Date)) {
      const converted: any = {};
      for (const key of Object.keys(data)) {
        converted[key] = this.convertBigInts(data[key]);
      }
      return converted;
    }
    return data;
  }
}
