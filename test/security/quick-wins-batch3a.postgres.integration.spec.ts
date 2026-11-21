/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  AppPlatform,
  AppType,
  DistributionStatus,
  ManagedAppStatus,
  ManagedAppType,
  MediaKind,
  MediaUploadStatus,
  PlatformRole,
  ProcessingStatus,
  ReleaseChannel,
  ReleaseStatus,
  RevokeReason,
  UpdatePolicy,
  UserType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { execFile } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { UserCodeGeneratorService } from '../../src/common/user-code/user-code-generator.service';
import { PlatformLessonsService } from '../../src/platform/lessons/platform-lessons.service';
import { PlatformMediaUploadService } from '../../src/platform/media/platform-media-upload.service';
import { PlatformQuestionsService } from '../../src/platform/questions/platform-questions.service';
import { PlatformUnitsService } from '../../src/platform/units/platform-units.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AppPlatform as DtoAppPlatform } from '../../src/releases/dto/check-update.dto';
import { UpdateCheckService } from '../../src/releases/update-check/update-check.service';
import { SCHOOL_AUTH_ERRORS, SCHOOL_AUTH_JWT } from '../../src/school/auth/constants';
import { LoginLockoutService } from '../../src/school/auth/login-lockout.service';
import { SchoolAuthService } from '../../src/school/auth/school-auth.service';
import { SchoolJwtStrategy } from '../../src/school/auth/strategies/school-jwt.strategy';
import { MediaUploadService } from '../../src/school/media/media-upload.service';
import { MediaCleanupService } from '../../src/school/media/media-cleanup.service';
import { SchoolInfoService } from '../../src/school/manager/school-info/school-info.service';
import { ProfileService } from '../../src/school/profile/profile.service';
import { SessionsService } from '../../src/school/sessions/sessions.service';
import { PlatformContentService } from '../../src/school/shared/platform-content/platform-content.service';
import { TeacherLessonsService } from '../../src/school/teacher/lessons/teacher-lessons.service';
import { MediaAccessPolicyService } from '../../src/shared/media/media-access-policy.service';
import { MediaLifecycleService } from '../../src/shared/media/media-lifecycle.service';
import { StorageService } from '../../src/shared/media/storage.service';
import { UploadValidationHelper } from '../../src/shared/media/upload-validation.helper';
import { VideoMediaConfig } from '../../src/shared/media/video-media.config';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

function resolvePgBinary(name: 'createdb' | 'dropdb'): string {
  const candidates = [
    `/usr/local/opt/libpq/bin/${name}`,
    `/opt/homebrew/opt/libpq/bin/${name}`,
    `/usr/local/bin/${name}`,
    `/usr/bin/${name}`,
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return name;
}

function assertSafeTestDb(dbName: string): void {
  if (!/^asas_qw_batch3a_pg_test_\d+_[a-f0-9]+$/.test(dbName)) {
    throw new Error(`SAFETY: invalid test database name "${dbName}".`);
  }
}

function buildValidPngBuffer(size = 512): Buffer {
  const buf = Buffer.alloc(size, 0xaa);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  return buf;
}

function buildValidPdfBuffer(size = 512): Buffer {
  const buf = Buffer.alloc(size, 0x20);
  Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'ascii').copy(
    buf,
    0,
  );
  return buf;
}

describe('Quick Wins Batch 3A — Real 2-Connection PostgreSQL Concurrency & Security Suite', () => {
  jest.setTimeout(120_000);

  let tempDbName = '';
  let tempDbUrl = '';
  let dbCreated = false;
  let tmpMediaDir = '';

  let prismaA: PrismaService;
  let prismaB: PrismaService;

  let storage: StorageService;
  let platformUnitsA: PlatformUnitsService;
  let platformLessonsA: PlatformLessonsService;
  let platformQuestionsA: PlatformQuestionsService;
  let platformContentA: PlatformContentService;
  let profileA: ProfileService;
  let schoolInfoB: SchoolInfoService;
  let teacherLessonsB: TeacherLessonsService;
  let sessionsA: SessionsService;
  let sessionsB: SessionsService;
  let authServiceA: SchoolAuthService;
  let jwtService: JwtService;
  let jwtStrategyA: SchoolJwtStrategy;
  let schoolMediaA: MediaUploadService;
  let schoolMediaB: MediaUploadService;
  let cleanupB: MediaCleanupService;
  let platformMediaA: PlatformMediaUploadService;
  let platformMediaB: PlatformMediaUploadService;
  let updateCheckA: UpdateCheckService;

  const originalStorageEnv = process.env.MEDIA_STORAGE_PATH;
  const originalR2Bucket = process.env.R2_BUCKET_NAME;
  const originalJwtSecret = process.env.JWT_SECRET;
  const originalLockoutKey = process.env.LOGIN_LOCKOUT_HMAC_KEY;

  beforeAll(async () => {
    tempDbName = `asas_qw_batch3a_pg_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    assertSafeTestDb(tempDbName);

    const dbUser = process.env.PGUSER || process.env.USER || 'postgres';
    tempDbUrl = `postgresql://${dbUser}@localhost:5432/${tempDbName}?connection_limit=20`;

    await execFileAsync(resolvePgBinary('createdb'), [
      '-h',
      'localhost',
      '-p',
      '5432',
      tempDbName,
    ]);
    dbCreated = true;

    await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, DATABASE_URL: tempDbUrl },
    });

    tmpMediaDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'qw-batch3a-media-'),
    );
    process.env.MEDIA_STORAGE_PATH = tmpMediaDir;
    process.env.R2_BUCKET_NAME = 'batch3a-test-bucket';
    process.env.JWT_SECRET = 'batch3a-test-jwt-secret-key-min-32-chars!!';
    process.env.LOGIN_LOCKOUT_HMAC_KEY =
      'batch3a-test-lockout-hmac-key-min-32-chars!!';

    prismaA = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    prismaB = new PrismaService({ datasourceUrl: tempDbUrl } as any);
    await Promise.all([prismaA.onModuleInit(), prismaB.onModuleInit()]);

    const rows: Array<{ db: string }> = await prismaA.$queryRawUnsafe(
      'SELECT current_database() AS db',
    );
    if (rows[0]?.db !== tempDbName) {
      throw new Error(`Wrong DB connected: ${rows[0]?.db}`);
    }

    storage = new StorageService();
    const videoConfig = new VideoMediaConfig();

    // مثيلا التحقق منفصلان عمداً لإجبار التنافس على القفل الفعلي في PostgreSQL (بلا قفل مشترك في الذاكرة)
    const validationA = new UploadValidationHelper(videoConfig);
    const validationB = new UploadValidationHelper(videoConfig);

    const policyA = new MediaAccessPolicyService(prismaA);
    const policyB = new MediaAccessPolicyService(prismaB);
    const lifecycleB = new MediaLifecycleService(policyB);

    const r2DisabledConfig = { resolveTargetProvider: () => 'LOCAL' } as any;
    const r2Mock = { deleteObject: jest.fn() } as any;
    const processingMock = {
      processAsset: jest.fn().mockResolvedValue(undefined),
    } as any;

    platformUnitsA = new PlatformUnitsService(prismaA);
    platformLessonsA = new PlatformLessonsService(prismaA);
    platformQuestionsA = new PlatformQuestionsService(prismaA);
    platformContentA = new PlatformContentService(prismaA);
    profileA = new ProfileService(prismaA);
    schoolInfoB = new SchoolInfoService(prismaB);
    teacherLessonsB = new TeacherLessonsService(prismaB, lifecycleB, policyB);

    sessionsA = new SessionsService(prismaA);
    sessionsB = new SessionsService(prismaB);
    jwtService = new JwtService({
      secret: process.env.JWT_SECRET,
      signOptions: {
        issuer: SCHOOL_AUTH_JWT.issuer,
        audience: SCHOOL_AUTH_JWT.audience,
      },
    });
    authServiceA = new SchoolAuthService(
      prismaA,
      jwtService,
      sessionsA,
      new LoginLockoutService(prismaA),
    );
    jwtStrategyA = new SchoolJwtStrategy(prismaA);

    schoolMediaA = new MediaUploadService(
      prismaA,
      storage,
      processingMock,
      {} as any,
      validationA,
      policyA,
    );
    schoolMediaB = new MediaUploadService(
      prismaB,
      storage,
      processingMock,
      {} as any,
      validationB,
      policyB,
    );
    cleanupB = new MediaCleanupService(
      prismaB,
      storage,
      lifecycleB,
      videoConfig,
    );
    platformMediaA = new PlatformMediaUploadService(
      prismaA,
      storage,
      processingMock,
      {} as any,
      validationA,
      policyA,
      r2DisabledConfig,
      r2Mock,
    );
    platformMediaB = new PlatformMediaUploadService(
      prismaB,
      storage,
      processingMock,
      {} as any,
      validationB,
      policyB,
      r2DisabledConfig,
      r2Mock,
    );
    updateCheckA = new UpdateCheckService(prismaA);
  });

  afterAll(async () => {
    if (originalStorageEnv === undefined) delete process.env.MEDIA_STORAGE_PATH;
    else process.env.MEDIA_STORAGE_PATH = originalStorageEnv;
    if (originalR2Bucket === undefined) delete process.env.R2_BUCKET_NAME;
    else process.env.R2_BUCKET_NAME = originalR2Bucket;
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    if (originalLockoutKey === undefined)
      delete process.env.LOGIN_LOCKOUT_HMAC_KEY;
    else process.env.LOGIN_LOCKOUT_HMAC_KEY = originalLockoutKey;

    try {
      if (tmpMediaDir) {
        await fs.promises.rm(tmpMediaDir, { recursive: true, force: true });
      }
      if (prismaA) await prismaA.onModuleDestroy();
      if (prismaB) await prismaB.onModuleDestroy();
    } finally {
      if (dbCreated && tempDbName) {
        assertSafeTestDb(tempDbName);
        await execFileAsync(resolvePgBinary('dropdb'), [
          '-h',
          'localhost',
          '-p',
          '5432',
          '--if-exists',
          tempDbName,
        ]);
      }
    }
  });

  it('SEC-PLT-02: revokes access across PlatformUnitsService, PlatformLessonsService, and PlatformQuestionsService when PlatformUserSubject is soft-deleted', async () => {
    const passHash = await bcrypt.hash('PlatformPass#1', 10);
    const platformAdmin = await prismaA.platformUser.create({
      data: {
        username: 'p_admin_3a',
        email: 'p_admin_3a@test.local',
        passwordHash: passHash,
        name: 'مدير منصة',
        role: PlatformRole.PLATFORM_ADMIN,
        isActive: true,
      },
    });
    const platformTeacher = await prismaA.platformUser.create({
      data: {
        username: 'p_teacher_3a',
        email: 'p_teacher_3a@test.local',
        passwordHash: passHash,
        name: 'معلم منصة',
        role: PlatformRole.PLATFORM_TEACHER,
        isActive: true,
      },
    });

    const gradeDict = await prismaA.gradeDictionary.create({
      data: { code: 'G_3A_PLT', defaultName: 'الصف السابع', sortOrder: 1 },
    });
    const subjectDict = await prismaA.subjectDictionary.create({
      data: {
        gradeDictionaryId: gradeDict.id,
        code: 'SUB_3A_PLT',
        defaultName: 'العلوم',
        sortOrder: 1,
      },
    });

    const assignment = await prismaA.platformUserSubject.create({
      data: {
        platformUserId: platformTeacher.id,
        subjectDictionaryId: subjectDict.id,
      },
    });

    const unit = await prismaA.unit.create({
      data: {
        ownerType: 'PLATFORM',
        subjectDictionaryId: subjectDict.id,
        title: 'الوحدة الأولى',
        orderIndex: 1,
      },
    });
    const lesson = await prismaA.lessonTemplate.create({
      data: {
        ownerType: 'PLATFORM',
        subjectDictionaryId: subjectDict.id,
        unitId: unit.id,
        title: 'الدرس الأول',
        orderIndex: 1,
        createdByPlatformUserId: platformTeacher.id,
      },
    });
    const question = await prismaA.question.create({
      data: {
        templateId: lesson.id,
        type: 'MCQ',
        orderIndex: 1,
        questionText: 'ما هو الكوكب الأحمر؟',
      },
    });

    await expect(
      platformUnitsA.getUnits(platformTeacher.uuid, subjectDict.uuid),
    ).resolves.toMatchObject({
      units: [expect.objectContaining({ uuid: unit.uuid })],
    });
    await expect(
      platformLessonsA.getLessonsByUnits(platformTeacher.uuid, subjectDict.uuid),
    ).resolves.toMatchObject({
      units: [expect.objectContaining({ uuid: unit.uuid })],
    });
    await expect(
      platformQuestionsA.getQuestion(platformTeacher.uuid, question.uuid),
    ).resolves.toMatchObject({ uuid: question.uuid });

    await prismaA.platformUserSubject.update({
      where: { id: assignment.id },
      data: { isDeleted: true, deletedAt: new Date() },
    });

    await expect(
      platformUnitsA.getUnits(platformTeacher.uuid, subjectDict.uuid),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      platformLessonsA.getLessonsByUnits(platformTeacher.uuid, subjectDict.uuid),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      platformLessonsA.updateLesson(platformTeacher.uuid, lesson.uuid, {
        title: 'تعديل غير مصرح',
      }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      platformQuestionsA.getQuestions(platformTeacher.uuid, lesson.uuid),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      platformQuestionsA.getQuestion(platformTeacher.uuid, question.uuid),
    ).rejects.toThrow(ForbiddenException);

    await expect(
      platformQuestionsA.getQuestion(platformAdmin.uuid, question.uuid),
    ).resolves.toMatchObject({ uuid: question.uuid });

    // SEC-PLT-02 (تكميلي): إعادة تفعيل الإسناد ثم تعطيل SubjectDictionary يرفض وصول المعلم في الدروس والأسئلة
    await prismaA.platformUserSubject.update({
      where: { id: assignment.id },
      data: { isDeleted: false, deletedAt: null },
    });
    await prismaA.subjectDictionary.update({
      where: { id: subjectDict.id },
      data: { isActive: false },
    });
    await expect(
      platformLessonsA.updateLesson(platformTeacher.uuid, lesson.uuid, {
        title: 'محاولة على مادة معطلة',
      }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      platformQuestionsA.getQuestions(platformTeacher.uuid, lesson.uuid),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      platformQuestionsA.getQuestion(platformTeacher.uuid, question.uuid),
    ).rejects.toThrow(ForbiddenException);
  });

  it('SEC-TCH-03: enforces full schoolId + active section/subject/teacher chain and rejects inactive/deleted/cross-school assignments', async () => {
    const passHash = await bcrypt.hash('TeacherPass#1', 10);
    const school1 = await prismaA.school.create({
      data: {
        name: 'SEC-TCH-03 School 1',
        schoolCode: 9301,
        appType: AppType.PUBLIC,
        isActive: true,
      },
    });
    const school2 = await prismaA.school.create({
      data: {
        name: 'SEC-TCH-03 School 2',
        schoolCode: 9302,
        appType: AppType.PUBLIC,
        isActive: true,
      },
    });
    const gradeDict = await prismaA.gradeDictionary.create({
      data: { code: 'G_3A_TCH03', defaultName: 'الثامن', sortOrder: 2 },
    });
    const dictMath = await prismaA.subjectDictionary.create({
      data: {
        gradeDictionaryId: gradeDict.id,
        code: 'SUB_MATH_03',
        defaultName: 'الرياضيات',
        sortOrder: 1,
      },
    });
    const dictPhysics = await prismaA.subjectDictionary.create({
      data: {
        gradeDictionaryId: gradeDict.id,
        code: 'SUB_PHYS_03',
        defaultName: 'الفيزياء',
        sortOrder: 2,
      },
    });

    const platformAdmin = await prismaA.platformUser.create({
      data: {
        username: 'dist_admin_03',
        email: 'dist_admin_03@test.local',
        passwordHash: passHash,
        name: 'ناشر المنصة',
        role: PlatformRole.PLATFORM_ADMIN,
        isActive: true,
      },
    });

    const mathLesson = await prismaA.lessonTemplate.create({
      data: {
        ownerType: 'PLATFORM',
        subjectDictionaryId: dictMath.id,
        title: 'درس الرياضيات الموزع',
        orderIndex: 1,
        status: 'PUBLISHED',
      },
    });
    const physicsLesson = await prismaA.lessonTemplate.create({
      data: {
        ownerType: 'PLATFORM',
        subjectDictionaryId: dictPhysics.id,
        title: 'درس الفيزياء الموزع',
        orderIndex: 1,
        status: 'PUBLISHED',
      },
    });

    await prismaA.contentDistribution.createMany({
      data: [
        {
          schoolId: school1.id,
          sourceLessonTemplateId: mathLesson.id,
          status: DistributionStatus.ACTIVE,
          distributedByPlatformUserId: platformAdmin.id,
        },
        {
          schoolId: school1.id,
          sourceLessonTemplateId: physicsLesson.id,
          status: DistributionStatus.ACTIVE,
          distributedByPlatformUserId: platformAdmin.id,
        },
        {
          schoolId: school2.id,
          sourceLessonTemplateId: physicsLesson.id,
          status: DistributionStatus.ACTIVE,
          distributedByPlatformUserId: platformAdmin.id,
        },
      ],
    });

    const school1Grade = await prismaA.schoolGrade.create({
      data: {
        schoolId: school1.id,
        dictionaryId: gradeDict.id,
        displayName: 'الثامن',
        sortOrder: 1,
        isActive: true,
      },
    });
    const section1 = await prismaA.section.create({
      data: {
        gradeId: school1Grade.id,
        name: 'أ',
        orderIndex: 1,
        isActive: true,
      },
    });
    const school1Math = await prismaA.subject.create({
      data: {
        schoolId: school1.id,
        gradeId: school1Grade.id,
        dictionaryId: dictMath.id,
        displayName: 'الرياضيات',
        isActive: true,
      },
    });
    const mathSection1 = await prismaA.subjectSection.create({
      data: { subjectId: school1Math.id, sectionId: section1.id, isActive: true },
    });

    // المدرسة 2 لديها مادة الفيزياء مسندة للمعلم هناك فقط
    const school2Grade = await prismaA.schoolGrade.create({
      data: {
        schoolId: school2.id,
        dictionaryId: gradeDict.id,
        displayName: 'الثامن',
        sortOrder: 1,
        isActive: true,
      },
    });
    const section2 = await prismaA.section.create({
      data: {
        gradeId: school2Grade.id,
        name: 'أ',
        orderIndex: 1,
        isActive: true,
      },
    });
    const school2Physics = await prismaA.subject.create({
      data: {
        schoolId: school2.id,
        gradeId: school2Grade.id,
        dictionaryId: dictPhysics.id,
        displayName: 'الفيزياء',
        isActive: true,
      },
    });
    const physSection2 = await prismaA.subjectSection.create({
      data: {
        subjectId: school2Physics.id,
        sectionId: section2.id,
        isActive: true,
      },
    });

    const userCodeGen = new UserCodeGeneratorService();
    const [teacherCode1, teacherCode2] = await prismaA.$transaction((tx) =>
      userCodeGen.allocateCodes(2, tx),
    );
    const teacher1 = await prismaA.user.create({
      data: {
        schoolId: school1.id,
        userType: UserType.TEACHER,
        code: teacherCode1,
        name: 'معلم المدرسة 1',
        passwordHash: passHash,
        isActive: true,
      },
    });
    await prismaA.teacher.create({ data: { userId: teacher1.id } });
    const sst1 = await prismaA.subjectSectionTeacher.create({
      data: {
        subjectSectionId: mathSection1.id,
        teacherId: teacher1.id,
        isActive: true,
      },
    });

    const teacher2 = await prismaA.user.create({
      data: {
        schoolId: school2.id,
        userType: UserType.TEACHER,
        code: teacherCode2,
        name: 'معلم المدرسة 2',
        passwordHash: passHash,
        isActive: true,
      },
    });
    await prismaA.teacher.create({ data: { userId: teacher2.id } });
    await prismaA.subjectSectionTeacher.create({
      data: {
        subjectSectionId: physSection2.id,
        teacherId: teacher2.id,
        isActive: true,
      },
    });

    // 1) Active teacher1 in school1 can access Math, NOT Physics
    const allowedDetail = await platformContentA.getPlatformLessonDetail(
      school1.id,
      teacher1.uuid,
      mathLesson.uuid,
    );
    expect(allowedDetail.uuid).toBe(mathLesson.uuid);
    await expect(
      platformContentA.getPlatformLessonDetail(
        school1.id,
        teacher1.uuid,
        physicsLesson.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);

    // 2) Cross-school isolation: teacher2 belongs to school2 and CANNOT pass schoolId=school1
    await expect(
      platformContentA.getPlatformLessonDetail(
        school1.id,
        teacher2.uuid,
        physicsLesson.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);

    // 3) تعطيل كل حلقة في سلسلة الإسناد يرفض الوصول (isActive=false / isDeleted=true)
    await prismaA.subjectSectionTeacher.update({
      where: { id: sst1.id },
      data: { isActive: false },
    });
    await expect(
      platformContentA.getPlatformLessonDetail(
        school1.id,
        teacher1.uuid,
        mathLesson.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);

    await prismaA.subjectSectionTeacher.update({
      where: { id: sst1.id },
      data: { isActive: true, isDeleted: true },
    });
    await expect(
      platformContentA.getPlatformLessonDetail(
        school1.id,
        teacher1.uuid,
        mathLesson.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);

    await prismaA.subjectSectionTeacher.update({
      where: { id: sst1.id },
      data: { isDeleted: false },
    });
    await prismaA.subjectSection.update({
      where: { id: mathSection1.id },
      data: { isActive: false },
    });
    await expect(
      platformContentA.getPlatformLessonDetail(
        school1.id,
        teacher1.uuid,
        mathLesson.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);

    await prismaA.subjectSection.update({
      where: { id: mathSection1.id },
      data: { isActive: true },
    });
    await prismaA.section.update({
      where: { id: section1.id },
      data: { isDeleted: true },
    });
    await expect(
      platformContentA.getPlatformLessonDetail(
        school1.id,
        teacher1.uuid,
        mathLesson.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);

    await prismaA.section.update({
      where: { id: section1.id },
      data: { isDeleted: false, isActive: false },
    });
    await expect(
      platformContentA.getPlatformLessons(school1.id, teacher1.uuid),
    ).resolves.toEqual({ subjects: [] });
    await expect(
      platformContentA.getPlatformLessonDetail(
        school1.id,
        teacher1.uuid,
        mathLesson.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      platformContentA.forkLesson(school1.id, teacher1.uuid, mathLesson.uuid),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      platformContentA.forkForPublish(
        school1.id,
        teacher1.uuid,
        mathLesson.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);

    await prismaA.section.update({
      where: { id: section1.id },
      data: { isActive: true },
    });
    await prismaA.subject.update({
      where: { id: school1Math.id },
      data: { isActive: false },
    });
    await expect(
      platformContentA.getPlatformLessonDetail(
        school1.id,
        teacher1.uuid,
        mathLesson.uuid,
      ),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      platformContentA.forkLesson(school1.id, teacher1.uuid, mathLesson.uuid),
    ).rejects.toThrow(BadRequestException);
    await expect(
      platformContentA.forkForPublish(
        school1.id,
        teacher1.uuid,
        mathLesson.uuid,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('SEC-AUTH-06: real 2-connection PostgreSQL concurrency blocks login/session issuance & refresh on concurrently disabled devices', async () => {
    const plainPass = 'AuthRacePass#1';
    const passHash = await bcrypt.hash(plainPass, 10);
    const school = await prismaA.school.create({
      data: {
        name: 'Batch3A Auth School',
        schoolCode: 9303,
        appType: AppType.PUBLIC,
        isActive: true,
      },
    });
    const userCodeGen = new UserCodeGeneratorService();
    const [teacherCode] = await prismaA.$transaction((tx) =>
      userCodeGen.allocateCodes(1, tx),
    );
    const teacher = await prismaA.user.create({
      data: {
        schoolId: school.id,
        userType: UserType.TEACHER,
        code: teacherCode,
        name: 'معلم دخول',
        passwordHash: passHash,
        isActive: true,
      },
    });

    const fp = 'pg-conc-fp-1';
    const initialLogin = await authServiceA.login(
      {
        identifier: String(teacher.code),
        password: plainPass,
        deviceFingerprint: fp,
        deviceType: 'ANDROID',
        pushToken: 'orig-push-tok',
      },
      { clientIp: '198.51.100.10' },
    );
    expect(initialLogin.sessionId).toBeTruthy();

    const devRow = await prismaA.userDevice.findUniqueOrThrow({
      where: {
        userId_deviceFingerprint: { userId: teacher.id, deviceFingerprint: fp },
      },
    });
    await prismaA.authSession.updateMany({
      where: { userId: teacher.id },
      data: { revokedAt: new Date(), revokeReason: RevokeReason.LOGOUT },
    });

    // 1) سباق حتمي عبر قفل صف على الاتصال B:
    // الاتصال B يقفل user_devices (FOR UPDATE)، يعطل الجهاز، ويتأخر قليلاً قبل COMMIT،
    // بينما الاتصال A يبدأ SchoolAuthService.login ويدخل upsertDeviceAndCreateSession منتظراً القفل.
    let connBHoldDone = false;
    const adminDisableHoldPromise = prismaB.$transaction(async (txB) => {
      await txB.$queryRaw`
        SELECT id FROM user_devices WHERE id = ${devRow.id} FOR UPDATE
      `;
      await new Promise((r) => setTimeout(r, 150));
      await txB.userDevice.update({
        where: { id: devRow.id },
        data: { isActive: false },
      });
      await txB.authSession.updateMany({
        where: { deviceId: devRow.id, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: RevokeReason.ADMIN_REVOKE },
      });
      connBHoldDone = true;
    });

    // تأخير بسيط لضمان استحواذ B على FOR UPDATE قبل login A
    await new Promise((r) => setTimeout(r, 35));

    const loginDuringDisable = await authServiceA
      .login(
        {
          identifier: String(teacher.code),
          password: plainPass,
          deviceFingerprint: fp,
          deviceType: 'ANDROID',
          pushToken: 'hijack-push-tok',
        },
        { clientIp: '198.51.100.11' },
      )
      .then(
        (v) => ({ ok: true as const, value: v }),
        (e) => ({ ok: false as const, error: e }),
      );

    await adminDisableHoldPromise;
    expect(connBHoldDone).toBe(true);
    expect(loginDuringDisable.ok).toBe(false);
    if (!loginDuringDisable.ok) {
      expect(loginDuringDisable.error).toBeInstanceOf(ForbiddenException);
      expect(loginDuringDisable.error.message).toBe(
        SCHOOL_AUTH_ERRORS.DEVICE_INACTIVE,
      );
    }

    // التحقق أن الجهاز ما زال معطلاً، ولم يُعدّل pushToken، ولم يُصدر أي AuthSession نشطة
    const devAfterDisable = await prismaA.userDevice.findUniqueOrThrow({
      where: { id: devRow.id },
    });
    expect(devAfterDisable.isActive).toBe(false);
    expect(devAfterDisable.pushToken).toBe('orig-push-tok');
    expect(
      await prismaA.authSession.count({
        where: { userId: teacher.id, revokedAt: null },
      }),
    ).toBe(0);

    // 2) سباق الترتيب الحر (Promise.allSettled) على جهاز جديد نشط:
    // إعادة تفعيل الجهاز ثم إطلاق login (Conn A) + تعطيل إداري مع إبطال الجلسات (Conn B) بالتوازي
    await prismaA.userDevice.update({
      where: { id: devRow.id },
      data: { isActive: true },
    });

    const [raceLoginRes] = await Promise.allSettled([
      authServiceA.login(
        {
          identifier: String(teacher.code),
          password: plainPass,
          deviceFingerprint: fp,
          deviceType: 'ANDROID',
          pushToken: 'race-tok',
        },
        { clientIp: '198.51.100.12' },
      ),
      prismaB.$transaction(async (txB) => {
        await txB.$queryRaw`
          SELECT id FROM user_devices WHERE id = ${devRow.id} FOR UPDATE
        `;
        await txB.userDevice.update({
          where: { id: devRow.id },
          data: { isActive: false },
        });
        await txB.authSession.updateMany({
          where: { deviceId: devRow.id, revokedAt: null },
          data: {
            revokedAt: new Date(),
            revokeReason: RevokeReason.ADMIN_REVOKE,
          },
        });
      }),
    ]);

    // الثابت الحرج بعد السباق:
    // مستحيل أن تبقى أي جلسة صالحة لجهاز معطّل، ومستحيل قبول JWT في Strategy
    expect(
      await prismaA.authSession.count({
        where: { deviceId: devRow.id, revokedAt: null },
      }),
    ).toBe(0);

    if (raceLoginRes.status === 'fulfilled') {
      const payload = jwtService.verify(raceLoginRes.value.accessToken, {
        issuer: SCHOOL_AUTH_JWT.issuer,
        audience: SCHOOL_AUTH_JWT.audience,
      });
      await expect(jwtStrategyA.validate(payload)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(
        sessionsB.validateAndRotateRefresh({
          sessionUuid: raceLoginRes.value.sessionId,
          refreshTokenPlain: raceLoginRes.value.refreshToken,
          deviceFingerprint: fp,
          deviceType: 'ANDROID',
        }),
      ).rejects.toThrow(ForbiddenException);
    }

    // 3) سباقات validateAndRotateRefresh على PostgreSQL بـ 2 connections وترتيب أقفال خالٍ من الجمود:
    await prismaA.userDevice.update({
      where: { id: devRow.id },
      data: { isActive: true },
    });
    const loginForRefresh1 = await authServiceA.login(
      {
        identifier: String(teacher.code),
        password: plainPass,
        deviceFingerprint: fp,
        deviceType: 'ANDROID',
      },
      { clientIp: '198.51.100.13' },
    );

    // 3أ) سباق refresh (Conn A) مع تعطيل إداري للجلسة (Conn B holds auth_sessions FOR UPDATE)
    const holdRevokeSession = prismaB.$transaction(async (txB) => {
      await txB.$queryRaw`
        SELECT id FROM auth_sessions WHERE uuid = ${loginForRefresh1.sessionId} FOR UPDATE
      `;
      await new Promise((r) => setTimeout(r, 120));
      await txB.authSession.update({
        where: { uuid: loginForRefresh1.sessionId },
        data: {
          revokedAt: new Date(),
          revokeReason: RevokeReason.ADMIN_REVOKE,
        },
      });
    });
    await new Promise((r) => setTimeout(r, 30));
    await expect(
      sessionsA.validateAndRotateRefresh({
        sessionUuid: loginForRefresh1.sessionId,
        refreshTokenPlain: loginForRefresh1.refreshToken,
        deviceFingerprint: fp,
        deviceType: 'ANDROID',
      }),
    ).rejects.toThrow(new ForbiddenException(SCHOOL_AUTH_ERRORS.SESSION_REVOKED));
    await holdRevokeSession;

    // 3ب) استدعاء refresh مكرر متزامن (Conn A vs Conn B) بنفس الـ refresh token -> ينجح واحد فقط ويرفض الآخر
    const loginForRefresh2 = await authServiceA.login(
      {
        identifier: String(teacher.code),
        password: plainPass,
        deviceFingerprint: fp,
        deviceType: 'ANDROID',
      },
      { clientIp: '198.51.100.14' },
    );
    const [dupRefreshA, dupRefreshB] = await Promise.allSettled([
      sessionsA.validateAndRotateRefresh({
        sessionUuid: loginForRefresh2.sessionId,
        refreshTokenPlain: loginForRefresh2.refreshToken,
        deviceFingerprint: fp,
        deviceType: 'ANDROID',
      }),
      sessionsB.validateAndRotateRefresh({
        sessionUuid: loginForRefresh2.sessionId,
        refreshTokenPlain: loginForRefresh2.refreshToken,
        deviceFingerprint: fp,
        deviceType: 'ANDROID',
      }),
    ]);
    const refreshSuccesses = [dupRefreshA, dupRefreshB].filter(
      (r) => r.status === 'fulfilled',
    );
    const refreshFailures = [dupRefreshA, dupRefreshB].filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(refreshSuccesses).toHaveLength(1);
    expect(refreshFailures).toHaveLength(1);
    expect(refreshFailures[0].reason).toBeInstanceOf(ForbiddenException);
    expect(refreshFailures[0].reason.message).toBe(
      SCHOOL_AUTH_ERRORS.REFRESH_TOKEN_INVALID,
    );

    // 3ج) فحص غياب الجمود (Deadlock-Free: user_devices -> auth_sessions):
    // Conn B يقفل user_devices (is_active=false) ثم auth_sessions (revoked_at=NOW()) بينما Conn A يستدعي refresh
    const loginForRefresh3 = await authServiceA.login(
      {
        identifier: String(teacher.code),
        password: plainPass,
        deviceFingerprint: fp,
        deviceType: 'ANDROID',
      },
      { clientIp: '198.51.100.15' },
    );
    const deadlockFreeDisable = prismaB.$transaction(async (txB) => {
      await txB.$queryRaw`
        SELECT id FROM user_devices WHERE id = ${devRow.id} FOR UPDATE
      `;
      await txB.userDevice.update({
        where: { id: devRow.id },
        data: { isActive: false },
      });
      await new Promise((r) => setTimeout(r, 100));
      await txB.authSession.updateMany({
        where: { deviceId: devRow.id, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: RevokeReason.ADMIN_REVOKE },
      });
    });
    await new Promise((r) => setTimeout(r, 25));
    await expect(
      sessionsA.validateAndRotateRefresh({
        sessionUuid: loginForRefresh3.sessionId,
        refreshTokenPlain: loginForRefresh3.refreshToken,
        deviceFingerprint: fp,
        deviceType: 'ANDROID',
      }),
    ).rejects.toThrow(ForbiddenException);
    await deadlockFreeDisable;
  });

  it('SEC-PRF-01: real 2-connection PostgreSQL TOCTOU race prevents linking the same image as both avatar and LessonBlockItem', async () => {
    const passHash = await bcrypt.hash('PrfRacePass#1', 10);
    const school = await prismaA.school.create({
      data: {
        name: 'Batch3A Profile School',
        schoolCode: 9304,
        appType: AppType.PUBLIC,
        isActive: true,
      },
    });
    const grade = await prismaA.schoolGrade.create({
      data: {
        schoolId: school.id,
        displayName: 'الأول',
        sortOrder: 1,
        isActive: true,
      },
    });
    const section = await prismaA.section.create({
      data: { gradeId: grade.id, name: 'أ', orderIndex: 1, isActive: true },
    });
    const subject = await prismaA.subject.create({
      data: {
        schoolId: school.id,
        gradeId: grade.id,
        displayName: 'عربي',
        isActive: true,
      },
    });
    const ss = await prismaA.subjectSection.create({
      data: { subjectId: subject.id, sectionId: section.id, isActive: true },
    });

    const userCodeGen = new UserCodeGeneratorService();
    const [teacherCode, studentCode] = await prismaA.$transaction((tx) =>
      userCodeGen.allocateCodes(2, tx),
    );
    const teacher = await prismaA.user.create({
      data: {
        schoolId: school.id,
        userType: UserType.TEACHER,
        code: teacherCode,
        name: 'معلم',
        passwordHash: passHash,
        isActive: true,
      },
    });
    await prismaA.teacher.create({ data: { userId: teacher.id } });
    await prismaA.subjectSectionTeacher.create({
      data: { subjectSectionId: ss.id, teacherId: teacher.id, isActive: true },
    });

    const student = await prismaA.user.create({
      data: {
        schoolId: school.id,
        userType: UserType.STUDENT,
        code: studentCode,
        name: 'طالب',
        passwordHash: passHash,
        isActive: true,
      },
    });

    const lesson = await prismaA.lessonTemplate.create({
      data: {
        ownerType: 'SCHOOL',
        schoolId: school.id,
        subjectId: subject.id,
        title: 'درس تجربة',
        orderIndex: 1,
        createdByUserId: teacher.id,
      },
    });
    const block = await prismaA.lessonContentBlock.create({
      data: { templateId: lesson.id, title: 'فقرة', orderIndex: 1 },
    });

    const createOwnedCompletedImage = async (uploaderUserId: number) => {
      const asset = await prismaA.mediaAsset.create({
        data: {
          schoolId: school.id,
          ownerType: 'SCHOOL',
          kind: MediaKind.IMAGE,
          contentType: 'image/png',
          processingStatus: ProcessingStatus.DONE,
        },
      });
      await prismaA.mediaUploadSession.create({
        data: {
          mediaAssetId: asset.id,
          schoolId: school.id,
          ownerType: 'SCHOOL',
          uploaderUserId,
          kind: MediaKind.IMAGE,
          contentType: 'image/png',
          chunkSizeBytes: 1024,
          status: MediaUploadStatus.COMPLETED,
          expiresAt: new Date(Date.now() + 3600_000),
        },
      });
      return asset;
    };

    // 1) سرقة صورة مستخدم آخر مرفوضة
    const asset1 = await createOwnedCompletedImage(teacher.id);
    await expect(
      profileA.updateMe(student.uuid, { avatarMediaAssetUuid: asset1.uuid }),
    ).rejects.toThrow(ForbiddenException);

    // 2) سباق التزامن الحقيقي: Conn A (updateMe -> avatar) vs Conn B (createBlockItem -> lesson)
    const [avatarRaceOutcome, lessonRaceOutcome] = await Promise.allSettled([
      profileA.updateMe(teacher.uuid, { avatarMediaAssetUuid: asset1.uuid }),
      teacherLessonsB.createBlockItem(
        school.id,
        teacher.uuid,
        lesson.uuid,
        block.uuid,
        { itemType: 'IMAGE', orderIndex: 1, mediaAssetUuid: asset1.uuid },
      ),
    ]);

    const fulfilledCount = [avatarRaceOutcome, lessonRaceOutcome].filter(
      (r) => r.status === 'fulfilled',
    ).length;
    expect(fulfilledCount).toBe(1);

    const freshTeacher = await prismaA.user.findUniqueOrThrow({
      where: { id: teacher.id },
    });
    const linkedBlockCount = await prismaA.lessonBlockItem.count({
      where: { mediaAssetId: asset1.id, isDeleted: false },
    });
    // استحالة الربط المزدوج
    expect(
      (freshTeacher.avatarMediaAssetId === asset1.id ? 1 : 0) + linkedBlockCount,
    ).toBe(1);

    // 3) اختبار حتمي في الاتجاه العكسي:
    // إذا كان الأصل مربوطاً فعلاً بصورة المعلم أولاً، فمحاولة createBlockItem على نفس الأصل ترفض بـ AVATAR_ASSET_IN_USE،
    // وإذا قفل Conn B الصف وبني BlockItem أولاً، فمحاولة ProfileService تنتظر القفل ثم ترفض بـ AVATAR_ASSET_IN_USE.
    const asset2 = await createOwnedCompletedImage(teacher.id);
    await profileA.updateMe(teacher.uuid, { avatarMediaAssetUuid: asset2.uuid });
    const reverseLinkErr = await teacherLessonsB
      .createBlockItem(school.id, teacher.uuid, lesson.uuid, block.uuid, {
        itemType: 'IMAGE',
        orderIndex: 2,
        mediaAssetUuid: asset2.uuid,
      })
      .catch((e) => e);
    expect(reverseLinkErr).toBeInstanceOf(BadRequestException);
    expect(reverseLinkErr.getResponse()).toMatchObject({
      code: 'AVATAR_ASSET_IN_USE',
    });

    const asset3 = await createOwnedCompletedImage(teacher.id);
    const holdConnB = prismaB.$transaction(async (txB) => {
      await txB.$queryRaw`
        SELECT id FROM media_assets WHERE id = ${asset3.id} FOR UPDATE
      `;
      await new Promise((r) => setTimeout(r, 120));
      await txB.lessonBlockItem.create({
        data: {
          blockId: block.id,
          itemType: 'IMAGE',
          orderIndex: 99,
          mediaAssetId: asset3.id,
        },
      });
    });
    await new Promise((r) => setTimeout(r, 30));
    const prfWaitErr = await profileA
      .updateMe(teacher.uuid, { avatarMediaAssetUuid: asset3.uuid })
      .catch((e) => e);
    await holdConnB;
    expect(prfWaitErr).toBeInstanceOf(BadRequestException);
    expect(prfWaitErr.getResponse()).toMatchObject({
      code: 'AVATAR_ASSET_IN_USE',
    });

    // 4) مسار SchoolInfoService.updateSchoolInfo:
    // 4أ) رفض حتمي عند استخدام صورة شخصية لمستخدم كشعار للمدرسة
    const logoBypassErr = await schoolInfoB
      .updateSchoolInfo(school.id, { logoMediaAssetUuid: asset2.uuid })
      .catch((e) => e);
    expect(logoBypassErr).toBeInstanceOf(BadRequestException);
    expect(logoBypassErr.getResponse()).toMatchObject({
      code: 'AVATAR_ASSET_IN_USE',
    });

    // 4ب) سباق التزامن الحقيقي بـ 2 connections: ProfileService.updateMe (Conn A) مقابل SchoolInfoService.updateSchoolInfo (Conn B)
    const asset4 = await createOwnedCompletedImage(teacher.id);
    const [avatarLogoA, avatarLogoB] = await Promise.allSettled([
      profileA.updateMe(teacher.uuid, { avatarMediaAssetUuid: asset4.uuid }),
      schoolInfoB.updateSchoolInfo(school.id, { logoMediaAssetUuid: asset4.uuid }),
    ]);
    expect(
      [avatarLogoA, avatarLogoB].filter((r) => r.status === 'fulfilled'),
    ).toHaveLength(1);
    const logoRaceRej = [avatarLogoA, avatarLogoB].find(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );
    expect(logoRaceRej?.reason).toBeInstanceOf(BadRequestException);
    expect(logoRaceRej?.reason.getResponse()).toMatchObject({
      code: 'AVATAR_ASSET_IN_USE',
    });

    const teacherAfterLogoRace = await prismaA.user.findUniqueOrThrow({
      where: { id: teacher.id },
    });
    const schoolAfterLogoRace = await prismaA.school.findUniqueOrThrow({
      where: { id: school.id },
    });
    expect(
      (teacherAfterLogoRace.avatarMediaAssetId === asset4.id ? 1 : 0) +
        (schoolAfterLogoRace.logoMediaAssetId === asset4.id ? 1 : 0),
    ).toBe(1);
  });

  it('SEC-MED-04: real 2-connection PostgreSQL races (complete vs cancel, duplicate complete, expiry under lock, & file restore recovery) for School & Platform', async () => {
    const passHash = await bcrypt.hash('MediaPass#1', 10);
    const school = await prismaA.school.create({
      data: {
        name: 'Batch3A Media School',
        schoolCode: 9305,
        appType: AppType.PUBLIC,
        isActive: true,
      },
    });
    const userCodeGen = new UserCodeGeneratorService();
    const [teacherCode] = await prismaA.$transaction((tx) =>
      userCodeGen.allocateCodes(1, tx),
    );
    const user = await prismaA.user.create({
      data: {
        schoolId: school.id,
        userType: UserType.TEACHER,
        code: teacherCode,
        name: 'رافع وسائط',
        passwordHash: passHash,
        isActive: true,
      },
    });
    const platformTeacher = await prismaA.platformUser.create({
      data: {
        username: 'med_pt_3a',
        email: 'med_pt_3a@test.local',
        passwordHash: passHash,
        name: 'رافع منصة',
        role: PlatformRole.PLATFORM_TEACHER,
        isActive: true,
      },
    });

    const pngPayload = buildValidPngBuffer(512);
    const pdfPayload = buildValidPdfBuffer(512);

    const createUploadedSchoolSession = async () => {
      const init = await schoolMediaA.initSession(
        {
          kind: MediaKind.IMAGE,
          contentType: 'image/png',
          totalSizeBytes: pngPayload.length,
        },
        school.id,
        school.uuid,
        { userId: user.id, role: 'TEACHER' },
      );
      await schoolMediaA.uploadChunk(
        init.upload_session_uuid,
        school.id,
        `bytes 0-${pngPayload.length - 1}/${pngPayload.length}`,
        pngPayload,
        user.id,
      );
      return init;
    };

    // 1) سباق completeSession (Conn A) مقابل cancelSession (Conn B) بـ UploadValidationHelper مستقلين
    const race1Init = await createUploadedSchoolSession();
    const [compRes1, cancelRes1] = await Promise.allSettled([
      schoolMediaA.completeSession(
        race1Init.upload_session_uuid,
        school.id,
        school.uuid,
        user.id,
      ),
      schoolMediaB.cancelSession(
        race1Init.upload_session_uuid,
        school.id,
        user.id,
      ),
    ]);
    // أحدهما فقط ينجح والآخر يرفض بـ 409 (SESSION_ALREADY_COMPLETED أو SESSION_CANCELED)
    expect(
      [compRes1, cancelRes1].filter((r) => r.status === 'fulfilled'),
    ).toHaveLength(1);
    const rej1 = [compRes1, cancelRes1].find((r) => r.status === 'rejected') as
      | PromiseRejectedResult
      | undefined;
    expect(rej1?.reason).toBeInstanceOf(ConflictException);

    const r1Session = await prismaA.mediaUploadSession.findUniqueOrThrow({
      where: { uuid: race1Init.upload_session_uuid },
    });
    const r1Asset = await prismaA.mediaAsset.findUniqueOrThrow({
      where: { uuid: race1Init.media_asset_uuid },
    });
    const r1FinalKey = storage.buildStorageKey(
      school.uuid,
      race1Init.media_asset_uuid,
      'original',
      'png',
    );
    if (r1Session.status === MediaUploadStatus.COMPLETED) {
      expect(r1Asset.isDeleted).toBe(false);
      expect(await storage.fileExists(r1FinalKey)).toBe(true);
    } else {
      expect(r1Session.status).toBe(MediaUploadStatus.CANCELED);
      expect(r1Asset.isDeleted).toBe(true);
      expect(await storage.fileExists(r1FinalKey)).toBe(false);
    }
    expect(fs.existsSync(storage.getTempPath(race1Init.upload_session_uuid))).toBe(
      false,
    );

    // 2) سباق عمليتي completeSession متزامنتين (Conn A & Conn B) — School IMAGE: كلاهما ينجح (Idempotent بلا ENOENT)
    const dupSchool = await createUploadedSchoolSession();
    const [dupA, dupB] = await Promise.all([
      schoolMediaA.completeSession(
        dupSchool.upload_session_uuid,
        school.id,
        school.uuid,
        user.id,
      ),
      schoolMediaB.completeSession(
        dupSchool.upload_session_uuid,
        school.id,
        school.uuid,
        user.id,
      ),
    ]);
    expect(dupA.media_asset_uuid).toBe(dupSchool.media_asset_uuid);
    expect(dupB.media_asset_uuid).toBe(dupSchool.media_asset_uuid);
    expect(
      await storage.fileExists(
        storage.buildStorageKey(
          school.uuid,
          dupSchool.media_asset_uuid,
          'original',
          'png',
        ),
      ),
    ).toBe(true);

    // إلغاء جلسة COMPLETED الآن يُرفض بـ 409 عبر الاتصالين ولا يحذف الأصل
    await expect(
      schoolMediaB.cancelSession(dupSchool.upload_session_uuid, school.id, user.id),
    ).rejects.toThrow(new ConflictException('SESSION_ALREADY_COMPLETED'));
    const dupAssetAfterCancel = await prismaA.mediaAsset.findUniqueOrThrow({
      where: { uuid: dupSchool.media_asset_uuid },
    });
    expect(dupAssetAfterCancel.isDeleted).toBe(false);

    // 3) Platform IMAGE + PDF: سباق completeSession المزدوج + حظر إلغاء COMPLETED
    const platActor = {
      platformUserId: platformTeacher.id,
      role: 'PLATFORM_TEACHER',
    };
    const platInit = await platformMediaA.initSession(
      {
        kind: MediaKind.IMAGE,
        contentType: 'image/png',
        totalSizeBytes: pngPayload.length,
      },
      platActor,
    );
    await platformMediaA.uploadChunk(
      platInit.upload_session_uuid,
      `bytes 0-${pngPayload.length - 1}/${pngPayload.length}`,
      pngPayload,
      platActor,
    );
    const [pDupA, pDupB] = await Promise.all([
      platformMediaA.completeSession(platInit.upload_session_uuid, platActor),
      platformMediaB.completeSession(platInit.upload_session_uuid, platActor),
    ]);
    expect(pDupA.media_asset_uuid).toBe(platInit.media_asset_uuid);
    expect(pDupB.media_asset_uuid).toBe(platInit.media_asset_uuid);
    await expect(
      platformMediaB.cancelSession(platInit.upload_session_uuid, platActor),
    ).rejects.toThrow(new ConflictException('SESSION_ALREADY_COMPLETED'));

    const platPdfInit = await platformMediaA.initSession(
      {
        kind: MediaKind.DOCUMENT,
        contentType: 'application/pdf',
        totalSizeBytes: pdfPayload.length,
      },
      platActor,
    );
    await platformMediaA.uploadChunk(
      platPdfInit.upload_session_uuid,
      `bytes 0-${pdfPayload.length - 1}/${pdfPayload.length}`,
      pdfPayload,
      platActor,
    );
    const pdfComplete = await platformMediaA.completeSession(
      platPdfInit.upload_session_uuid,
      platActor,
    );
    expect(pdfComplete.processing_status).toBe('DONE');
    await expect(
      platformMediaB.cancelSession(platPdfInit.upload_session_uuid, platActor),
    ).rejects.toThrow(new ConflictException('SESSION_ALREADY_COMPLETED'));

    // 4) انتهاء expiresAt أثناء انتظار القفل:
    const expInit = await createUploadedSchoolSession();
    const holdExpireConnB = prismaB.$transaction(async (txB) => {
      await txB.$queryRaw`
        SELECT id FROM media_upload_sessions WHERE uuid = ${expInit.upload_session_uuid} FOR UPDATE
      `;
      await new Promise((r) => setTimeout(r, 120));
      await txB.mediaUploadSession.update({
        where: { uuid: expInit.upload_session_uuid },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
    });
    await new Promise((r) => setTimeout(r, 30));
    await expect(
      schoolMediaA.completeSession(
        expInit.upload_session_uuid,
        school.id,
        school.uuid,
        user.id,
      ),
    ).rejects.toThrow(new GoneException('SESSION_EXPIRED'));
    await holdExpireConnB;
    expect(
      await storage.fileExists(
        storage.buildStorageKey(
          school.uuid,
          expInit.media_asset_uuid,
          'original',
          'png',
        ),
      ),
    ).toBe(false);
    expect(fs.existsSync(storage.getTempPath(expInit.upload_session_uuid))).toBe(
      true,
    );

    // 5) استعادة الملف بعد تراجع DB وإعادة المحاولة الآمنة:
    const recInit = await createUploadedSchoolSession();
    const recFinalKey = storage.buildStorageKey(
      school.uuid,
      recInit.media_asset_uuid,
      'original',
      'png',
    );
    const origTxFn = prismaA.$transaction.bind(prismaA);
    let injectedOnce = false;
    const txSpy = jest
      .spyOn(prismaA, '$transaction')
      .mockImplementationOnce(async (fnOrArr: any, opts?: any) => {
        if (typeof fnOrArr === 'function' && !injectedOnce) {
          injectedOnce = true;
          return origTxFn(async (tx) => {
            const wrappedTx = new Proxy(tx, {
              get(target, prop) {
                if (prop === 'mediaAsset') {
                  return {
                    ...target.mediaAsset,
                    update: async () => {
                      throw new Error('INJECTED_DB_FAILURE_AFTER_MOVE');
                    },
                  };
                }
                return (target as any)[prop];
              },
            });
            return fnOrArr(wrappedTx);
          }, opts);
        }
        return origTxFn(fnOrArr, opts);
      });

    await expect(
      schoolMediaA.completeSession(
        recInit.upload_session_uuid,
        school.id,
        school.uuid,
        user.id,
      ),
    ).rejects.toThrow('INJECTED_DB_FAILURE_AFTER_MOVE');
    txSpy.mockRestore();

    // الملف المؤقت عاد إلى tmp/، والملف النهائي غير موجود، والجلسة لم تصبح COMPLETED
    expect(await storage.fileExists(recFinalKey)).toBe(false);
    expect(fs.existsSync(storage.getTempPath(recInit.upload_session_uuid))).toBe(
      true,
    );

    // إعادة المحاولة تنجح الآن وتنقل الملف وتُسجل COMPLETED
    const recovered = await schoolMediaA.completeSession(
      recInit.upload_session_uuid,
      school.id,
      school.uuid,
      user.id,
    );
    expect(recovered.media_asset_uuid).toBe(recInit.media_asset_uuid);
    expect(await storage.fileExists(recFinalKey)).toBe(true);

    // 6) سباق MediaCleanupService.cleanupExpiredSessions مقابل الإكمال + استعادة الانهيار (SIGKILL recovery):
    // 6أ) جلسة مكتملة عبر قفل FOR UPDATE لا تُلغى أبداً من cleanupExpiredSessions حتى لو انقضى expiresAt أثناء الإكمال
    const raceCleanInit = await createUploadedSchoolSession();
    const raceCleanFinalKey = storage.buildStorageKey(
      school.uuid,
      raceCleanInit.media_asset_uuid,
      'original',
      'png',
    );
    await prismaA.mediaUploadSession.update({
      where: { uuid: raceCleanInit.upload_session_uuid },
      data: { expiresAt: new Date(Date.now() + 90) },
    });

    const holdCompleteTx = prismaA.$transaction(async (txA) => {
      const [row] = await txA.$queryRaw<Array<{ id: number }>>`
        SELECT id FROM media_upload_sessions WHERE uuid = ${raceCleanInit.upload_session_uuid} FOR UPDATE
      `;
      await new Promise((r) => setTimeout(r, 150));
      await storage.moveToFinal(raceCleanInit.upload_session_uuid, raceCleanFinalKey);
      await txA.mediaUploadSession.update({
        where: { id: row.id },
        data: {
          status: MediaUploadStatus.COMPLETED,
          completedAt: new Date(),
          processingStatus: ProcessingStatus.PROCESSING,
        },
      });
      await txA.mediaAsset.update({
        where: { uuid: raceCleanInit.media_asset_uuid },
        data: { storageKey: raceCleanFinalKey },
      });
    });

    // انتظار انتهاء expiresAt قبل COMMIT ثم تشغيل cleanupExpiredSessions لتتعارض على صف الجلسة المقفول
    await new Promise((r) => setTimeout(r, 110));
    const cleanupPromise = cleanupB.cleanupExpiredSessions();
    await Promise.all([holdCompleteTx, cleanupPromise]);

    const raceCleanSession = await prismaA.mediaUploadSession.findUniqueOrThrow({
      where: { uuid: raceCleanInit.upload_session_uuid },
    });
    const raceCleanAsset = await prismaA.mediaAsset.findUniqueOrThrow({
      where: { uuid: raceCleanInit.media_asset_uuid },
    });
    expect(raceCleanSession.status).toBe(MediaUploadStatus.COMPLETED);
    expect(raceCleanAsset.isDeleted).toBe(false);
    expect(await storage.fileExists(raceCleanFinalKey)).toBe(true);

    // 6ب) جلسة متروكة منتهية الصلاحية تُلغى ذرّياً وتُحذف .part ويُعلّم أصلها isDeleted=true
    const abandonedInit = await createUploadedSchoolSession();
    await prismaA.mediaUploadSession.update({
      where: { uuid: abandonedInit.upload_session_uuid },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await expect(cleanupB.cleanupExpiredSessions()).resolves.toBeGreaterThanOrEqual(
      1,
    );
    const abandonedSession = await prismaA.mediaUploadSession.findUniqueOrThrow({
      where: { uuid: abandonedInit.upload_session_uuid },
    });
    const abandonedAsset = await prismaA.mediaAsset.findUniqueOrThrow({
      where: { uuid: abandonedInit.media_asset_uuid },
    });
    expect(abandonedSession.status).toBe(MediaUploadStatus.CANCELED);
    expect(abandonedAsset.isDeleted).toBe(true);
    expect(fs.existsSync(storage.getTempPath(abandonedInit.upload_session_uuid))).toBe(
      false,
    );

    // 6ج) استعادة الانهيار (SIGKILL بعد moveToFinal وقبل COMMIT): إعادة المحاولة تستعيد الملف اليتيم وتكتمل بنجاح
    const crashInit = await createUploadedSchoolSession();
    const crashFinalKey = storage.buildStorageKey(
      school.uuid,
      crashInit.media_asset_uuid,
      'original',
      'png',
    );
    await storage.moveToFinal(crashInit.upload_session_uuid, crashFinalKey);
    expect(fs.existsSync(storage.getTempPath(crashInit.upload_session_uuid))).toBe(
      false,
    );
    expect(await storage.fileExists(crashFinalKey)).toBe(true);

    const crashRecovered = await schoolMediaA.completeSession(
      crashInit.upload_session_uuid,
      school.id,
      school.uuid,
      user.id,
    );
    expect(crashRecovered.media_asset_uuid).toBe(crashInit.media_asset_uuid);
    const crashAsset = await prismaA.mediaAsset.findUniqueOrThrow({
      where: { uuid: crashInit.media_asset_uuid },
    });
    expect(crashAsset.storageKey).toBe(crashFinalKey);
    expect(await storage.fileExists(crashFinalKey)).toBe(true);
  });

  it('SEC-PUB-01: refuses DB device_installations writes for unregistered/inactive apps and writes only for active apps in PostgreSQL', async () => {
    const activeApp = await prismaA.app.create({
      data: {
        code: 'BATCH3A_ACTIVE_APP',
        name: 'Active App',
        appType: ManagedAppType.PUBLIC,
        status: ManagedAppStatus.ACTIVE,
        platforms: [AppPlatform.ANDROID],
      },
    });
    await prismaA.app.create({
      data: {
        code: 'BATCH3A_DISABLED_APP',
        name: 'Disabled App',
        appType: ManagedAppType.PUBLIC,
        status: ManagedAppStatus.DISABLED,
        platforms: [AppPlatform.ANDROID],
      },
    });
    const targetSchool = await prismaA.school.create({
      data: {
        name: 'Update Check Target School',
        schoolCode: 9306,
        appType: AppType.PUBLIC,
        isActive: true,
      },
    });

    const release = await prismaA.release.create({
      data: {
        appId: activeApp.id,
        versionName: '2.1.0',
        versionCode: 21,
        buildNumber: 21,
        channel: ReleaseChannel.STABLE,
        status: ReleaseStatus.PUBLISHED,
        updatePolicy: UpdatePolicy.OPTIONAL,
      },
    });

    await updateCheckA.checkUpdate({
      appCode: 'DOES_NOT_EXIST',
      platform: DtoAppPlatform.ANDROID,
      currentVersion: '1.0.0',
      currentBuild: 0,
      installationId: 'pg-ghost-1',
    });
    await updateCheckA.checkUpdate({
      appCode: 'BATCH3A_DISABLED_APP',
      platform: DtoAppPlatform.ANDROID,
      currentVersion: '1.0.0',
      currentBuild: 0,
      installationId: 'pg-disabled-1',
    });
    expect(await prismaA.deviceInstallation.count()).toBe(0);

    const res = await updateCheckA.checkUpdate({
      appCode: 'BATCH3A_ACTIVE_APP',
      platform: DtoAppPlatform.ANDROID,
      currentVersion: '1.0.0',
      currentBuild: 1,
      installationId: 'pg-valid-1',
      schoolCode: targetSchool.schoolCode,
    });
    expect(res.updateAvailable).toBe(true);
    expect(res.latestVersion).toBe('2.1.0');
    const saved = await prismaA.deviceInstallation.findUnique({
      where: { installationId: 'pg-valid-1' },
    });
    expect(saved?.appId).toBe(activeApp.id);
    expect(saved?.releaseId).toBe(release.id);
    expect(saved?.schoolId).toBe(targetSchool.id);
  });
});
