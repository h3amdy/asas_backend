// src/platform/books/platform-books.module.ts
import { Module } from '@nestjs/common';
import { PlatformBooksController } from './platform-books.controller';
import { PlatformBooksService } from './platform-books.service';

@Module({
    controllers: [PlatformBooksController],
    providers: [PlatformBooksService],
    exports: [PlatformBooksService],
})
export class PlatformBooksModule {}
