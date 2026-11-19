import {
  evaluateQuestionAnswer,
  getGradeLabel,
  parseAnswerValue,
} from './answer-evaluator';

describe('answer-evaluator (Wave 2 — SEC-QUIZ-02 / SEC-R3-12)', () => {
  it('evaluates MCQ and TRUE_FALSE both as object and as stringified Flutter JSON', () => {
    const mcq = {
      type: 'MCQ',
      options: [
        { uuid: 'opt-wrong', isCorrect: false },
        { uuid: 'opt-right', isCorrect: true },
      ],
    };

    expect(evaluateQuestionAnswer(mcq, { selectedOptionUuid: 'opt-right' })).toBe(true);
    expect(
      evaluateQuestionAnswer(mcq, JSON.stringify({ selectedOptionUuid: 'opt-right' })),
    ).toBe(true);
    expect(evaluateQuestionAnswer(mcq, { selectedOptionUuid: 'opt-wrong' })).toBe(false);
    expect(evaluateQuestionAnswer(mcq, { selectedOptionUuid: '' })).toBe(false);
    expect(evaluateQuestionAnswer(mcq, 'invalid-json')).toBe(false);

    const tf = {
      type: 'TRUE_FALSE',
      options: [
        { uuid: 'tf-true', isCorrect: true },
        { uuid: 'tf-false', isCorrect: false },
      ],
    };
    expect(evaluateQuestionAnswer(tf, { selectedOptionUuid: 'tf-true' })).toBe(true);
    expect(evaluateQuestionAnswer(tf, { selectedOptionUuid: 'tf-false' })).toBe(false);
  });

  it('rejects duplicate pairKeys, mismatched pairs, and partial pairs in MATCHING', () => {
    const matching = {
      type: 'MATCHING',
      matchingPairs: [{ pairKey: 'p1' }, { pairKey: 'p2' }],
    };

    expect(
      evaluateQuestionAnswer(matching, {
        pairs: [
          { leftPairKey: 'p1', rightPairKey: 'p1' },
          { leftPairKey: 'p2', rightPairKey: 'p2' },
        ],
      }),
    ).toBe(true);

    // Duplicate same valid pairKey
    expect(
      evaluateQuestionAnswer(matching, {
        pairs: [
          { leftPairKey: 'p1', rightPairKey: 'p1' },
          { leftPairKey: 'p1', rightPairKey: 'p1' },
        ],
      }),
    ).toBe(false);

    // Mismatched pair
    expect(
      evaluateQuestionAnswer(matching, {
        pairs: [
          { leftPairKey: 'p1', rightPairKey: 'p2' },
          { leftPairKey: 'p2', rightPairKey: 'p1' },
        ],
      }),
    ).toBe(false);

    // Empty pairs
    expect(evaluateQuestionAnswer(matching, { pairs: [] })).toBe(false);
  });

  it('evaluates ORDERING and IMAGE_STEP_SORTING without mutating original orderingItems array', () => {
    const originalItems = [
      { uuid: 'step-3', correctIndex: 3 },
      { uuid: 'step-1', correctIndex: 1 },
      { uuid: 'step-2', correctIndex: 2 },
    ];
    const question = {
      type: 'ORDERING',
      orderingItems: originalItems,
    };

    expect(
      evaluateQuestionAnswer(question, {
        orderedItemUuids: ['step-1', 'step-2', 'step-3'],
      }),
    ).toBe(true);

    // Ensure original array was NOT sorted in place (SEC-R3-12)
    expect(originalItems.map((i) => i.uuid)).toEqual(['step-3', 'step-1', 'step-2']);

    expect(
      evaluateQuestionAnswer(
        { type: 'IMAGE_STEP_SORTING', orderingItems: originalItems },
        { orderedItemUuids: ['step-2', 'step-1', 'step-3'] },
      ),
    ).toBe(false);
  });

  it('blocks empty blanks: [] bypass and enforces full blank coverage in FILL (SEC-QUIZ-02)', () => {
    const fillQuestion = {
      type: 'FILL',
      fillBlanks: [{ blankKey: 'b1' }, { blankKey: 'b2' }],
      fillAnswers: [
        { blankKey: 'b1', answerText: 'الرياض' },
        { blankKey: 'b2', answerText: 'السعودية' },
      ],
    };

    // Previously returned true! Now strictly false
    expect(evaluateQuestionAnswer(fillQuestion, { blanks: [] })).toBe(false);

    // Partial blanks -> false
    expect(
      evaluateQuestionAnswer(fillQuestion, {
        blanks: [{ blankKey: 'b1', answer: 'الرياض' }],
      }),
    ).toBe(false);

    // Duplicate blankKey -> false
    expect(
      evaluateQuestionAnswer(fillQuestion, {
        blanks: [
          { blankKey: 'b1', answer: 'الرياض' },
          { blankKey: 'b1', answer: 'الرياض' },
        ],
      }),
    ).toBe(false);

    // Full valid answers (with trim/case folding) -> true
    expect(
      evaluateQuestionAnswer(fillQuestion, {
        blanks: [
          { blankKey: 'b1', answer: ' الرياض ' },
          { blankKey: 'b2', answer: 'السعودية' },
        ],
      }),
    ).toBe(true);
  });

  it('parses answerValue safely and computes grade labels deterministically', () => {
    expect(parseAnswerValue('  ')).toBeNull();
    expect(parseAnswerValue('{"a":1}')).toEqual({ a: 1 });
    expect(getGradeLabel(95)).toBe('ممتاز');
    expect(getGradeLabel(85)).toBe('جيد جداً');
    expect(getGradeLabel(75)).toBe('جيد');
    expect(getGradeLabel(65)).toBe('مقبول');
    expect(getGradeLabel(40)).toBe('ضعيف');
  });

  it('defends against prototype-pollution keys, unknown blankKeys, and non-string items', () => {
    const ordering = {
      type: 'ORDERING',
      orderingItems: [
        { uuid: 'step-1', correctIndex: 1 },
        { uuid: 'step-2', correctIndex: 2 },
      ],
    };
    expect(evaluateQuestionAnswer(ordering, { orderedItemUuids: [null, 'step-2'] })).toBe(false);
    expect(evaluateQuestionAnswer(ordering, { orderedItemUuids: [1, 2] })).toBe(false);

    const fill = {
      type: 'FILL',
      fillBlanks: [{ blankKey: 'b1' }, { blankKey: 'constructor' }],
      fillAnswers: [
        { blankKey: 'b1', answerText: 'أ' },
        { blankKey: 'b1', answerText: 'ا' },
        { blankKey: 'constructor', answerText: 'ب' },
      ],
    };
    // Multiple accepted answers for b1 + safe Map key 'constructor'
    expect(
      evaluateQuestionAnswer(fill, {
        blanks: [
          { blankKey: 'b1', answer: 'ا' },
          { blankKey: 'constructor', answer: 'ب' },
        ],
      }),
    ).toBe(true);

    // Same length as fillBlanks (2) but unknown blankKey / __proto__ injection attempt -> false
    const pollutedPayload = JSON.parse(
      '{"blanks":[{"blankKey":"__proto__","answer":"أ"},{"blankKey":"constructor","answer":"ب"}]}',
    );
    expect(evaluateQuestionAnswer(fill, pollutedPayload)).toBe(false);
  });
});
