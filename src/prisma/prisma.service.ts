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
   *
   * ⚠️ يدخل فقط في الكائنات العادية (plain objects) والمصفوفات.
   * أنواع Prisma الخاصة (Decimal، Buffer/Uint8Array لحقول Bytes، Date) تُعاد كما هي —
   * إعادة بنائها ككائن عادي كانت تُفسدها (السعر "[object Object]" وفشل فك تشفير الرموز).
   */
  private convertBigInts(data: any): any {
    if (data === null || data === undefined) return data;
    if (typeof data === 'bigint') return Number(data);
    if (Array.isArray(data)) return data.map((item) => this.convertBigInts(item));
    if (typeof data === 'object') {
      const proto = Object.getPrototypeOf(data);
      if (proto !== Object.prototype && proto !== null) return data;
      const converted: any = {};
      for (const key of Object.keys(data)) {
        converted[key] = this.convertBigInts(data[key]);
      }
      return converted;
    }
    return data;
  }
}
