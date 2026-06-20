// src/school/student/sync/helpers/cursor-paginator.ts
import { Prisma } from '@prisma/client';

/**
 * Keyset Pagination Helper
 * 
 * يستخدم (updated_at, uuid) كـ composite cursor لضمان:
 * 1. عدم فقدان سجلات عند الحد بين الصفحات
 * 2. عدم تكرار سجلات
 * 3. أداء ممتاز مع index
 */

export interface SyncCursor {
    updatedAt: Date;
    uuid: string;
}

export interface PaginatedSyncResult<T> {
    items: T[];
    hasMore: boolean;
    cursor: string | null; // "ISO_DATE|uuid" — يُرسل للعميل ليستخدمه في الطلب التالي
}

/**
 * يبني where clause لـ Keyset Pagination
 * 
 * المنطق: (updated_at > cursor_date) OR (updated_at = cursor_date AND uuid > cursor_uuid)
 * هذا يضمن ترتيب ثابت حتى لو تساوى updated_at لعدة سجلات
 */
export function buildCursorWhere(cursor: SyncCursor | null): Prisma.JsonObject | undefined {
    if (!cursor) return undefined;

    return {
        OR: [
            { updatedAt: { gt: cursor.updatedAt } },
            {
                AND: [
                    { updatedAt: cursor.updatedAt },
                    { uuid: { gt: cursor.uuid } },
                ],
            },
        ],
    } as any;
}

/**
 * يبني cursor string من آخر عنصر في النتائج
 */
export function buildCursorFromItem(item: { updatedAt: Date; uuid: string }): string {
    return `${item.updatedAt.toISOString()}|${item.uuid}`;
}

/**
 * يفكك cursor string إلى مكوّناته
 */
export function parseCursor(cursorStr: string | null): SyncCursor | null {
    if (!cursorStr) return null;
    const pipeIndex = cursorStr.indexOf('|');
    if (pipeIndex === -1) return null;

    const dateStr = cursorStr.substring(0, pipeIndex);
    const uuid = cursorStr.substring(pipeIndex + 1);

    const updatedAt = new Date(dateStr);
    if (isNaN(updatedAt.getTime())) return null;

    return { updatedAt, uuid };
}

/**
 * Paginate helper — ينفذ استعلام مع keyset pagination ويرجع النتيجة مع cursor
 */
export function paginateResult<T extends { updatedAt: Date; uuid: string }>(
    items: T[],
    limit: number,
): PaginatedSyncResult<T> {
    const hasMore = items.length > limit;
    const actualItems = hasMore ? items.slice(0, limit) : items;

    const lastItem = actualItems[actualItems.length - 1];
    const cursor = lastItem ? buildCursorFromItem(lastItem) : null;

    return {
        items: actualItems,
        hasMore,
        cursor,
    };
}
