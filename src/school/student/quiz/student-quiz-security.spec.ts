import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { StudentQuizService } from './student-quiz.service';

describe('StudentQuizService Security (Wave 2 — SEC-QUIZ-01 / SEC-QUIZ-02 / SEC-R3-01 / SEC-R3-02 / SEC-R3-07)', () => {
  function createMockService() {
    const q1 = {
      id: 101,
      uuid: '11111111-1111-4111-8111-111111111101',
      templateId: 50,
      type: 'MCQ',
      score: 5,
      options: [
        { uuid: 'opt-1a', isCorrect: true },
        { uuid: 'opt-1b', isCorrect: false },
      ],
      matchingPairs: [],
      orderingItems: [],
      fillBlanks: [],
      fillAnswers: [],
    };
    const q2 = {
      id: 102,
      uuid: '11111111-1111-4111-8111-111111111102',
      templateId: 50,
      type: 'FILL',
      score: 5,
      options: [],
      matchingPairs: [],
      orderingItems: [],
      fillBlanks: [{ blankKey: 'b1' }],
      fillAnswers: [{ blankKey: 'b1', answerText: 'مكة' }],
    };

    const createdResults: any[] = [];
    const upsertedAnswers: any[] = [];
    const upsertedProgress: any[] = [];
    const lockCalls: any[] = [];

    const tx: any = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 10, student: { userId: 10 } }),
      },
      studentEnrollment: {
        findFirst: jest.fn().mockResolvedValue({ sectionId: 7 }),
      },
      lesson: {
        findFirst: jest.fn().mockResolvedValue({
          id: 20,
          templateId: 50,
          template: { questionsRevision: 4 },
        }),
      },
      $executeRaw: jest.fn().mockImplementation((q) => {
        lockCalls.push(q);
        return Promise.resolve(1);
      }),
      processedClientChange: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      studentLessonResult: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _max: { version: 2 } }),
        create: jest.fn().mockImplementation(({ data }) => {
          const row = { id: 900, uuid: 'res-uuid-900', ...data };
          createdResults.push(row);
          return Promise.resolve(row);
        }),
      },
      question: {
        findMany: jest.fn().mockResolvedValue([q1, q2]),
      },
      studentAnswer: {
        upsert: jest.fn().mockImplementation((args) => {
          upsertedAnswers.push(args);
          return Promise.resolve({});
        }),
      },
      studentLessonProgress: {
        upsert: jest.fn().mockImplementation((args) => {
          upsertedProgress.push(args);
          return Promise.resolve({});
        }),
      },
    };

    const prisma: any = {
      user: tx.user,
      studentEnrollment: tx.studentEnrollment,
      lesson: tx.lesson,
      question: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(tx)),
    };

    return {
      service: new StudentQuizService(prisma),
      prisma,
      tx,
      q1,
      q2,
      createdResults,
      upsertedAnswers,
      upsertedProgress,
      lockCalls,
    };
  }

  it('ignores forged isCorrect=true, computes real server score, enforces revision & atomic progress upsert', async () => {
    const {
      service,
      q1,
      q2,
      createdResults,
      upsertedAnswers,
      upsertedProgress,
      lockCalls,
    } = createMockService();

    const res = await service.submitQuiz(1, 'stu-uuid', 'lesson-uuid', {
      questionsRevision: 999, // Forged client revision must be ignored
      answers: [
        {
          questionUuid: q1.uuid,
          answerValue: { selectedOptionUuid: 'opt-1b' }, // WRONG option!
          isCorrect: true, // FORGED by client
        },
        {
          questionUuid: q2.uuid,
          answerValue: { blanks: [] }, // FORGED empty FILL!
          isCorrect: true, // FORGED by client
        },
      ],
    });

    expect(res.correctQuestions).toBe(0);
    expect(res.earnedPoints).toBe(0);
    expect(res.percent).toBe(0);
    expect(res.gradeLabel).toBe('ضعيف');
    expect(lockCalls).toHaveLength(1);
    expect(createdResults).toHaveLength(1);
    expect(createdResults[0].version).toBe(3); // _max(2) + 1
    expect(createdResults[0].questionsRevisionAtSubmit).toBe(4); // From DB template, NOT 999
    expect(upsertedAnswers[0].create.isCorrect).toBe(false);
    expect(upsertedAnswers[0].create.scoreAwarded).toBe(0);
    expect(upsertedProgress[0].where).toEqual({
      studentId_lessonId: { studentId: 10, lessonId: 20 },
    });
  });

  it('rejects duplicate questionUuid in submitQuiz (Decision #6 / SEC-QUIZ-01)', async () => {
    const { service, prisma, q1 } = createMockService();

    await expect(
      service.submitQuiz(1, 'stu-uuid', 'lesson-uuid', {
        answers: [
          { questionUuid: q1.uuid, answerValue: { selectedOptionUuid: 'opt-1a' }, isCorrect: true },
          { questionUuid: q1.uuid, answerValue: { selectedOptionUuid: 'opt-1a' }, isCorrect: true },
        ],
      }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects foreign questionUuid belonging to another lesson/template inside submitQuiz and checkAnswer', async () => {
    const { service, prisma, tx } = createMockService();

    await expect(
      service.submitQuiz(1, 'stu-uuid', 'lesson-uuid', {
        answers: [
          {
            questionUuid: '22222222-2222-4222-8222-222222222222',
            answerValue: { selectedOptionUuid: 'opt-other' },
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    expect(tx.studentLessonResult.create).not.toHaveBeenCalled();

    // checkAnswer scopes query strictly by templateId: lesson.templateId
    await expect(
      service.checkAnswer(
        1,
        'stu-uuid',
        'lesson-uuid',
        '22222222-2222-4222-8222-222222222222',
        { selectedOptionUuid: 'opt-other' },
      ),
    ).rejects.toThrow(NotFoundException);

    expect(prisma.question.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          uuid: '22222222-2222-4222-8222-222222222222',
          templateId: 50,
          isDeleted: false,
        }),
      }),
    );
  });

  it('executes markLessonRead inside $transaction with advisory lock and returns early if result already exists', async () => {
    const { service, tx, upsertedProgress, lockCalls } = createMockService();
    tx.question.count = jest.fn().mockResolvedValue(0);
    tx.studentLessonResult.findFirst = jest.fn().mockResolvedValue({ id: 55 });

    const res = await service.markLessonRead(1, 'stu-uuid', 'lesson-uuid');
    expect(res).toEqual({ message: 'تم إنجاز الدرس مسبقاً', alreadyCompleted: true });
    expect(lockCalls).toHaveLength(1);
    expect(tx.studentLessonResult.create).not.toHaveBeenCalled();
    expect(upsertedProgress[0].where).toEqual({
      studentId_lessonId: { studentId: 10, lessonId: 20 },
    });
  });

  it('rejects questionless submitQuiz (B-3) and cross-lesson/non-quiz clientAttemptUuid reuse without fall-through (B-2)', async () => {
    // B-3: Questionless lesson must fail with LESSON_HAS_NO_QUESTIONS
    const m1 = createMockService();
    m1.tx.question.findMany = jest.fn().mockResolvedValue([]);
    await expect(
      m1.service.submitQuiz(1, 'stu-uuid', 'lesson-uuid', { answers: [] }),
    ).rejects.toThrow(BadRequestException);
    expect(m1.tx.studentLessonResult.create).not.toHaveBeenCalled();

    // B-2 (a): Reusing sync clientChangeUuid (non-'quiz_submission') in submitQuiz -> ConflictException
    const m2 = createMockService();
    m2.tx.processedClientChange.findUnique = jest.fn().mockResolvedValue({
      studentId: 10,
      entityType: 'student_answer',
      entityUuid: 'q-1',
    });
    await expect(
      m2.service.submitQuiz(1, 'stu-uuid', 'lesson-uuid', {
        clientAttemptUuid: 'reused-sync-uuid',
        answers: [],
      }),
    ).rejects.toThrow(ConflictException);
    expect(m2.tx.studentLessonResult.create).not.toHaveBeenCalled();

    // B-2 (b): Reusing quiz_submission clientAttemptUuid on a DIFFERENT lesson (priorResult == null) -> ConflictException
    const m3 = createMockService();
    m3.tx.processedClientChange.findUnique = jest.fn().mockResolvedValue({
      studentId: 10,
      entityType: 'quiz_submission',
      entityUuid: 'other-lesson-result-uuid',
    });
    m3.tx.studentLessonResult.findFirst = jest.fn().mockResolvedValue(null);
    await expect(
      m3.service.submitQuiz(1, 'stu-uuid', 'lesson-uuid', {
        clientAttemptUuid: 'other-lesson-attempt-uuid',
        answers: [],
      }),
    ).rejects.toThrow(ConflictException);
    expect(m3.tx.studentLessonResult.create).not.toHaveBeenCalled();
  });
});
