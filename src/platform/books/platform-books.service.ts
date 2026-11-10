// src/platform/books/platform-books.service.ts
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MediaAccessPolicyService } from '../../shared/media/media-access-policy.service';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';

// الحقول المُرجعة دائماً مع الكتاب
const BOOK_INCLUDE = {
    subjectDictionary: { select: { id: true, defaultName: true, code: true } },
    gradeDictionary: { select: { id: true, defaultName: true } },
    coverMediaAsset: { select: { uuid: true } },
    pdfMediaAsset: { select: { uuid: true, sizeBytes: true } },
} as const;

@Injectable()
export class PlatformBooksService {
    private readonly mediaAccessPolicy: MediaAccessPolicyService;

    constructor(
        private readonly prisma: PrismaService,
        @Optional() mediaAccessPolicy?: MediaAccessPolicyService,
    ) {
        this.mediaAccessPolicy =
            mediaAccessPolicy ?? new MediaAccessPolicyService(this.prisma);
    }

    // ═══════ القراءة ═══════

    async findAll(filters?: {
        gradeDictionaryId?: number;
        subjectDictionaryId?: number;
        semester?: string;
        search?: string;
        isActive?: boolean;
    }) {
        const books = await this.prisma.schoolBook.findMany({
            where: {
                isDeleted: false,
                ...(filters?.gradeDictionaryId && { gradeDictionaryId: filters.gradeDictionaryId }),
                ...(filters?.subjectDictionaryId && { subjectDictionaryId: filters.subjectDictionaryId }),
                ...(filters?.semester && { semester: filters.semester as any }),
                ...(filters?.isActive !== undefined && { isActive: filters.isActive }),
                ...(filters?.search && {
                    title: { contains: filters.search, mode: 'insensitive' as const },
                }),
            },
            include: BOOK_INCLUDE,
            orderBy: [
                { gradeDictionary: { sortOrder: 'asc' } },
                { subjectDictionary: { sortOrder: 'asc' } },
                { sortOrder: 'asc' },
                { title: 'asc' },
            ],
        });
        return books.map((b) => this.serializeBook(b));
    }

    async findById(id: number) {
        const book = await this.prisma.schoolBook.findFirst({
            where: { id, isDeleted: false },
            include: BOOK_INCLUDE,
        });
        if (!book) throw new NotFoundException('BOOK_NOT_FOUND');
        return this.serializeBook(book);
    }

    // ═══════ الإنشاء ═══════

    async create(dto: CreateBookDto) {
        // 1. تحقق من وجود المادة والصف
        const subject = await this.prisma.subjectDictionary.findFirst({
            where: { id: dto.subjectDictionaryId, isDeleted: false },
        });
        if (!subject) throw new BadRequestException('SUBJECT_DICTIONARY_NOT_FOUND');

        const grade = await this.prisma.gradeDictionary.findFirst({
            where: { id: dto.gradeDictionaryId, isDeleted: false },
        });
        if (!grade) throw new BadRequestException('GRADE_DICTIONARY_NOT_FOUND');

        // 2. تحقق من أن المادة تابعة للصف
        if (subject.gradeDictionaryId !== dto.gradeDictionaryId) {
            throw new BadRequestException('SUBJECT_NOT_BELONGS_TO_GRADE');
        }

        // 3. resolve media asset IDs
        const coverMediaAssetId = await this.resolveMediaAssetId(dto.coverMediaAssetUuid, 'IMAGE');
        const pdfMediaAssetId = await this.resolveMediaAssetId(dto.pdfMediaAssetUuid, 'DOCUMENT');

        // 4. إنشاء الكتاب
        try {
            const book = await this.prisma.schoolBook.create({
                data: {
                    title: dto.title,
                    description: dto.description,
                    semester: dto.semester as any,
                    subjectDictionaryId: dto.subjectDictionaryId,
                    gradeDictionaryId: dto.gradeDictionaryId,
                    coverMediaAssetId,
                    pdfMediaAssetId,
                },
                include: BOOK_INCLUDE,
            });
            return this.serializeBook(book);
        } catch (e) {
            if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
                throw new ConflictException('BOOK_ALREADY_EXISTS');
            }
            throw e;
        }
    }

    // ═══════ التعديل ═══════

    async update(id: number, dto: UpdateBookDto) {
        const book = await this.prisma.schoolBook.findFirst({
            where: { id, isDeleted: false },
        });
        if (!book) throw new NotFoundException('BOOK_NOT_FOUND');

        const data: any = {};

        if (dto.title !== undefined) data.title = dto.title;
        if (dto.description !== undefined) data.description = dto.description;
        if (dto.semester !== undefined) data.semester = dto.semester;
        if (dto.isActive !== undefined) data.isActive = dto.isActive;

        // غلاف
        if (dto.coverMediaAssetUuid !== undefined) {
            data.coverMediaAssetId = dto.coverMediaAssetUuid
                ? await this.resolveMediaAssetId(dto.coverMediaAssetUuid, 'IMAGE')
                : null;
        }

        // PDF
        if (dto.pdfMediaAssetUuid !== undefined) {
            data.pdfMediaAssetId = dto.pdfMediaAssetUuid
                ? await this.resolveMediaAssetId(dto.pdfMediaAssetUuid, 'DOCUMENT')
                : null;
        }

        const updated = await this.prisma.schoolBook.update({
            where: { id },
            data,
            include: BOOK_INCLUDE,
        });
        return this.serializeBook(updated);
    }

    // ═══════ التفعيل/الإيقاف ═══════

    async toggle(id: number) {
        const book = await this.prisma.schoolBook.findFirst({
            where: { id, isDeleted: false },
        });
        if (!book) throw new NotFoundException('BOOK_NOT_FOUND');

        const toggled = await this.prisma.schoolBook.update({
            where: { id },
            data: { isActive: !book.isActive },
            include: BOOK_INCLUDE,
        });
        return this.serializeBook(toggled);
    }

    // ═══════ الحذف الناعم ═══════

    async softDelete(id: number) {
        const book = await this.prisma.schoolBook.findFirst({
            where: { id, isDeleted: false },
        });
        if (!book) throw new NotFoundException('BOOK_NOT_FOUND');

        await this.prisma.schoolBook.update({
            where: { id },
            data: { isDeleted: true, deletedAt: new Date(), isActive: false },
        });

        return { success: true };
    }

    // ═══════ Helpers ═══════

    /**
     * تحويل BigInt (مثل sizeBytes) إلى Number لأن JSON.stringify
     * لا يدعم BigInt ويرمي TypeError
     */
    private serializeBook(book: any) {
        if (book?.pdfMediaAsset?.sizeBytes !== undefined) {
            book.pdfMediaAsset.sizeBytes = Number(book.pdfMediaAsset.sizeBytes);
        }
        return book;
    }

    /**
     * P4-5 Hardening (F-P45-01) — يحل UUID أصل الغلاف/الـ PDF مع فرض سياسة W-061:
     *  - ملكية PLATFORM حصراً (أصل مدرسة → يُعامل كغير موجود لمنع الاستكشاف)
     *  - منع VIDEO (400 VIDEO_NOT_ALLOWED_HERE)
     *  - الغلاف IMAGE فقط، والـ PDF DOCUMENT فقط (400 MEDIA_KIND_MISMATCH)
     * يحافظ على عقد الخطأ القديم لعدم الوجود: 400 `MEDIA_ASSET_NOT_FOUND: <uuid>`.
     */
    private async resolveMediaAssetId(
        uuid: string | null | undefined,
        allowedKind: 'IMAGE' | 'DOCUMENT',
    ): Promise<number | null> {
        if (!uuid) return null;
        try {
            const asset = await this.mediaAccessPolicy.assertCanLinkNonVideoAsset(
                this.prisma,
                uuid,
                { targetOwnerType: 'PLATFORM', allowedKinds: [allowedKind] },
            );
            return asset.id;
        } catch (e) {
            if (e instanceof NotFoundException) {
                throw new BadRequestException(`MEDIA_ASSET_NOT_FOUND: ${uuid}`);
            }
            throw e;
        }
    }
}
