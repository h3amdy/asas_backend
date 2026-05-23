// src/platform/books/platform-books.service.ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
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
    constructor(private readonly prisma: PrismaService) {}

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
        const coverMediaAssetId = await this.resolveMediaAssetId(dto.coverMediaAssetUuid);
        const pdfMediaAssetId = await this.resolveMediaAssetId(dto.pdfMediaAssetUuid);

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
                ? await this.resolveMediaAssetId(dto.coverMediaAssetUuid)
                : null;
        }

        // PDF
        if (dto.pdfMediaAssetUuid !== undefined) {
            data.pdfMediaAssetId = dto.pdfMediaAssetUuid
                ? await this.resolveMediaAssetId(dto.pdfMediaAssetUuid)
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

    private async resolveMediaAssetId(uuid?: string | null): Promise<number | null> {
        if (!uuid) return null;
        const asset = await this.prisma.mediaAsset.findFirst({
            where: { uuid, isDeleted: false },
            select: { id: true },
        });
        if (!asset) throw new BadRequestException(`MEDIA_ASSET_NOT_FOUND: ${uuid}`);
        return asset.id;
    }
}
