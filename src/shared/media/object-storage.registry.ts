// src/shared/media/object-storage.registry.ts
// 🗂️ VIDEO P4-2 — اختيار المزود حسب عمود media_assets.storage_provider (المهاجرة M2)
import { Injectable } from '@nestjs/common';
import { ObjectStorageProvider } from './object-storage.interface';
import { LocalObjectStorageProvider } from './local-object-storage.provider';
import { R2StorageProvider } from './r2-storage.provider';
import { StorageOperationError } from './storage-errors';

@Injectable()
export class ObjectStorageRegistry {
  constructor(
    private readonly local: LocalObjectStorageProvider,
    private readonly r2: R2StorageProvider,
  ) {}

  /** 'LOCAL' (القيمة الافتراضية لكل الأصول الحالية) أو 'R2' (الفيديو). أي قيمة أخرى خطأ صريح. */
  get(storageProvider: string | null | undefined): ObjectStorageProvider {
    switch (storageProvider ?? 'LOCAL') {
      case 'LOCAL':
        return this.local;
      case 'R2':
        return this.r2;
      default:
        throw new StorageOperationError(
          'INVALID_INPUT',
          'UNKNOWN_STORAGE_PROVIDER',
          false,
          undefined,
          'registry',
        );
    }
  }
}
