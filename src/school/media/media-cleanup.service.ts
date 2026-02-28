// src/school/media/media-cleanup.service.ts
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from './storage.service';
import { MediaUploadStatus } from '@prisma/client';

/**
 * 🧹 خدمة تنظيف الوسائط — MVP Cleanup
 *
 * ① كل ساعة: تنظيف جلسات الرفع المنتهية + ملفات temp
 * ② كل يوم: حذف ملفات الوسائط المحذوفة (soft-deleted > 30 يوم)
 *
 * يستخدم setInterval بدلاً من @nestjs/schedule لتقليل التبعيات
 */
@Injectable()
export class MediaCleanupService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(MediaCleanupService.name);
    private hourlyInterval: NodeJS.Timeout | null = null;
    private dailyInterval: NodeJS.Timeout | null = null;

    constructor(
        private readonly prisma: PrismaService,
        private readonly storage: StorageService,
    ) { }

    onModuleInit() {
        // كل ساعة: تنظيف sessions المنتهية
        this.hourlyInterval = setInterval(
            () => this.cleanupExpiredSessions().catch(e => this.logger.error('Hourly cleanup failed:', e)),
            60 * 60 * 1000, // 1 hour
        );

        // كل 24 ساعة: حذف ملفات الوسائط القديمة المحذوفة
        this.dailyInterval = setInterval(
            () => this.cleanupDeletedAssets().catch(e => this.logger.error('Daily cleanup failed:', e)),
            24 * 60 * 60 * 1000, // 24 hours
        );

        // Run initial cleanup after 5 minutes (let app settle)
        setTimeout(() => {
            this.cleanupExpiredSessions().catch(e => this.logger.error('Initial cleanup failed:', e));
        }, 5 * 60 * 1000);

        this.logger.log('🧹 Media cleanup service started');
    }

    onModuleDestroy() {
        if (this.hourlyInterval) clearInterval(this.hourlyInterval);
        if (this.dailyInterval) clearInterval(this.dailyInterval);
    }

    /**
     * ① تنظيف جلسات الرفع المنتهية
     * - البحث عن sessions لم تكتمل وانتهت صلاحيتها
     * - حذف ملفات temp
     * - تحديث حالة session → CANCELED
     * - soft-delete placeholder asset
     */
    async cleanupExpiredSessions(): Promise<void> {
        const now = new Date();

        // Find expired, non-completed sessions
        const expiredSessions = await this.prisma.mediaUploadSession.findMany({
            where: {
                expiresAt: { lt: now },
                status: {
                    notIn: [MediaUploadStatus.COMPLETED, MediaUploadStatus.CANCELED],
                },
            },
            include: {
                mediaAsset: { select: { id: true, uuid: true, isDeleted: true } },
            },
            take: 100, // Process in batches
        });

        if (expiredSessions.length === 0) return;

        this.logger.log(`🧹 Cleaning up ${expiredSessions.length} expired upload sessions`);

        let cleaned = 0;
        for (const session of expiredSessions) {
            try {
                // 1) Delete temp file
                if (session.tempStorageKey) {
                    await this.storage.deleteTempFile(session.uuid);
                }

                // 2) Mark session as CANCELED
                await this.prisma.mediaUploadSession.update({
                    where: { id: session.id },
                    data: {
                        status: MediaUploadStatus.CANCELED,
                        canceledAt: now,
                    },
                });

                // 3) Soft-delete the placeholder asset (if not already)
                if (session.mediaAsset && !session.mediaAsset.isDeleted) {
                    await this.prisma.mediaAsset.update({
                        where: { id: session.mediaAsset.id },
                        data: {
                            isDeleted: true,
                            deletedAt: now,
                        },
                    });
                }

                cleaned++;
            } catch (e: any) {
                this.logger.error(`Failed to cleanup session ${session.uuid}: ${e.message}`);
            }
        }

        this.logger.log(`🧹 Cleaned ${cleaned} expired sessions`);
    }

    /**
     * ② حذف ملفات الوسائط المحذوفة القديمة (> 30 يوم)
     * - البحث عن media_assets soft-deleted أكثر من 30 يوم
     * - حذف الملفات الفعلية من التخزين
     * - حذف السجل نهائياً من DB
     */
    async cleanupDeletedAssets(): Promise<void> {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        // Find old soft-deleted assets
        const deletedAssets = await this.prisma.mediaAsset.findMany({
            where: {
                isDeleted: true,
                deletedAt: { lt: thirtyDaysAgo },
            },
            include: {
                school: { select: { uuid: true } },
            },
            take: 50, // Process in batches
        });

        if (deletedAssets.length === 0) return;

        this.logger.log(`🗑️ Purging ${deletedAssets.length} old deleted assets`);

        let purged = 0;
        for (const asset of deletedAssets) {
            try {
                // 1) Delete all variant files from storage
                await this.storage.deleteAssetDir(asset.school.uuid, asset.uuid);

                // 2) Delete related upload sessions
                await this.prisma.mediaUploadSession.deleteMany({
                    where: { mediaAssetId: asset.id },
                });

                // 3) Hard-delete the asset record
                await this.prisma.mediaAsset.delete({
                    where: { id: asset.id },
                });

                purged++;
            } catch (e: any) {
                this.logger.error(`Failed to purge asset ${asset.uuid}: ${e.message}`);
            }
        }

        this.logger.log(`🗑️ Purged ${purged} old deleted assets`);
    }
}
