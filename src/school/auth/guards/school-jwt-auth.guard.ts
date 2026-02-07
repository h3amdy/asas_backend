// src/school/auth/guards/school-jwt-auth.guard.ts
import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class SchoolJwtAuthGuard extends AuthGuard('school-jwt') { }
