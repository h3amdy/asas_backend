// src/common/user-code/user-code.module.ts
import { Global, Module } from '@nestjs/common';
import { UserCodeGeneratorService } from './user-code-generator.service';

/** وحدة عامة: المولّد متاح لكل الوحدات دون استيراد صريح */
@Global()
@Module({
  providers: [UserCodeGeneratorService],
  exports: [UserCodeGeneratorService],
})
export class UserCodeModule {}

