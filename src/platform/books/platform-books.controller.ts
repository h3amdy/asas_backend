// src/platform/books/platform-books.controller.ts
import {
    Body, Controller, Delete, Get, Param, ParseIntPipe,
    Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { PlatformBooksService } from './platform-books.service';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';
import { PlatformJwtAuthGuard } from '../auth/guards/platform-jwt-auth.guard';

@Controller('platform/books')
@UseGuards(PlatformJwtAuthGuard)
export class PlatformBooksController {
    constructor(private readonly service: PlatformBooksService) {}

    @Get()
    findAll(
        @Query('gradeDictionaryId') gradeDictionaryId?: string,
        @Query('subjectDictionaryId') subjectDictionaryId?: string,
        @Query('semester') semester?: string,
        @Query('search') search?: string,
        @Query('isActive') isActive?: string,
    ) {
        return this.service.findAll({
            gradeDictionaryId: gradeDictionaryId ? +gradeDictionaryId : undefined,
            subjectDictionaryId: subjectDictionaryId ? +subjectDictionaryId : undefined,
            semester: semester || undefined,
            search: search || undefined,
            isActive: isActive !== undefined ? isActive === 'true' : undefined,
        });
    }

    @Get(':id')
    findById(@Param('id', ParseIntPipe) id: number) {
        return this.service.findById(id);
    }

    @Post()
    create(@Body() dto: CreateBookDto) {
        return this.service.create(dto);
    }

    @Patch(':id')
    update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBookDto) {
        return this.service.update(id, dto);
    }

    @Patch(':id/toggle')
    toggle(@Param('id', ParseIntPipe) id: number) {
        return this.service.toggle(id);
    }

    @Delete(':id')
    delete(@Param('id', ParseIntPipe) id: number) {
        return this.service.softDelete(id);
    }
}
