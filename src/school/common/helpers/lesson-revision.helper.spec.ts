// src/school/common/helpers/lesson-revision.helper.spec.ts
//
// DEC-026 Phase 13: Unit tests for revision helpers
//
// Tests the core invariant:
//   - contentRevision and questionsRevision are independent
//   - touchRelatedLessons updates updatedAt and excludes ARCHIVED
//

import {
    bumpContentRevision,
    bumpQuestionsRevision,
    touchRelatedLessons,
} from './lesson-revision.helper';

// ── Mock Factory ──────────────────────────────────────────────────────────

function createMockTx() {
    return {
        lessonTemplate: {
            update: jest.fn().mockResolvedValue({}),
        },
        lesson: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    };
}

// ── touchRelatedLessons ──────────────────────────────────────────────────

describe('touchRelatedLessons', () => {
    it('updates updatedAt on related lessons', async () => {
        const tx = createMockTx();
        await touchRelatedLessons(tx as any, 42);

        expect(tx.lesson.updateMany).toHaveBeenCalledTimes(1);
        const call = tx.lesson.updateMany.mock.calls[0][0];
        expect(call.where.templateId).toBe(42);
        expect(call.data.updatedAt).toBeInstanceOf(Date);
    });

    it('excludes ARCHIVED lessons', async () => {
        const tx = createMockTx();
        await touchRelatedLessons(tx as any, 1);

        const call = tx.lesson.updateMany.mock.calls[0][0];
        expect(call.where.status).toEqual({ not: 'ARCHIVED' });
    });

    it('excludes deleted lessons', async () => {
        const tx = createMockTx();
        await touchRelatedLessons(tx as any, 1);

        const call = tx.lesson.updateMany.mock.calls[0][0];
        expect(call.where.isDeleted).toBe(false);
    });
});

// ── bumpContentRevision ─────────────────────────────────────────────────

describe('bumpContentRevision', () => {
    it('increments contentRevision by 1', async () => {
        const tx = createMockTx();
        await bumpContentRevision(tx as any, 10);

        expect(tx.lessonTemplate.update).toHaveBeenCalledTimes(1);
        const call = tx.lessonTemplate.update.mock.calls[0][0];
        expect(call.where).toEqual({ id: 10 });
        expect(call.data.contentRevision).toEqual({ increment: 1 });
    });

    it('does NOT modify questionsRevision', async () => {
        const tx = createMockTx();
        await bumpContentRevision(tx as any, 10);

        const call = tx.lessonTemplate.update.mock.calls[0][0];
        expect(call.data.questionsRevision).toBeUndefined();
    });

    it('calls touchRelatedLessons with same templateId', async () => {
        const tx = createMockTx();
        await bumpContentRevision(tx as any, 99);

        expect(tx.lesson.updateMany).toHaveBeenCalledTimes(1);
        const call = tx.lesson.updateMany.mock.calls[0][0];
        expect(call.where.templateId).toBe(99);
    });
});

// ── bumpQuestionsRevision ───────────────────────────────────────────────

describe('bumpQuestionsRevision', () => {
    it('increments questionsRevision by 1', async () => {
        const tx = createMockTx();
        await bumpQuestionsRevision(tx as any, 20);

        expect(tx.lessonTemplate.update).toHaveBeenCalledTimes(1);
        const call = tx.lessonTemplate.update.mock.calls[0][0];
        expect(call.where).toEqual({ id: 20 });
        expect(call.data.questionsRevision).toEqual({ increment: 1 });
    });

    it('does NOT modify contentRevision', async () => {
        const tx = createMockTx();
        await bumpQuestionsRevision(tx as any, 20);

        const call = tx.lessonTemplate.update.mock.calls[0][0];
        expect(call.data.contentRevision).toBeUndefined();
    });

    it('calls touchRelatedLessons with same templateId', async () => {
        const tx = createMockTx();
        await bumpQuestionsRevision(tx as any, 55);

        expect(tx.lesson.updateMany).toHaveBeenCalledTimes(1);
        const call = tx.lesson.updateMany.mock.calls[0][0];
        expect(call.where.templateId).toBe(55);
    });
});
