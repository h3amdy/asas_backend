-- SEC-MEDIA-06: فهرس لعمود شعار المدرسة (يُستعمل في كل طلب GET /public/media/:uuid)
CREATE INDEX IF NOT EXISTS "School_logo_media_asset_id_idx" ON "School"("logo_media_asset_id");
