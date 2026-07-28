الكود جيد من ناحية الفكرة، لكن يوجد **مشكلتان**:

---

# 1) يوجد خطأ في الأقواس (Syntax Error)

في `computeSha256` لم يتم إغلاق الدالة قبل تعريف `sanitizeDatabaseUrl`.

أنت الآن لديك:

```ts
private computeSha256(...) {
  return new Promise(...);

  /**
   * تنقية رابط الاتصال...
   */
  private sanitizeDatabaseUrl(...)
```

وهذا غير صحيح.

يجب أن تكون:

```ts
private computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

private sanitizeDatabaseUrl(databaseUrl: string): string {
    ...
}
```

---

# 2) يوجد نفس الخطأ في DbRestoreEngine

أنت أصلحت PgDump فقط.

لكن Restore مازال يستخدم:

```ts
await execFileAsync('psql', [
    databaseUrl,
    '-f',
    sqlPath,
]);
```

وهذا سيمرر:

```
postgresql://.../asasprod?schema=public
```

إلى psql.

قد لا يفشل دائماً، لكنه غير صحيح هندسياً.

يجب أيضاً استخدام:

```ts
const cleanDbUrl = this.sanitizeDatabaseUrl(databaseUrl);

await execFileAsync(
    'psql',
    [
        cleanDbUrl,
        '-f',
        sqlPath,
    ],
    {
        maxBuffer: 100 * 1024 * 1024,
    },
);
```

وأضف نفس الدالة:

```ts
private sanitizeDatabaseUrl(databaseUrl: string): string {
    try {
        const parsed = new URL(databaseUrl);

        parsed.searchParams.delete('schema');
        parsed.searchParams.delete('pgbouncer');
        parsed.searchParams.delete('connection_limit');
        parsed.searchParams.delete('pool_timeout');

        return parsed.toString();
    } catch {
        return databaseUrl;
    }
}
```

---

# 3) تحسين بسيط أوصي به

بدلاً من:

```ts
parsed.searchParams.delete(...)
```

يمكنك جعل الرابط صالحًا لأي أدوات PostgreSQL بإزالة جميع معاملات الاستعلام:

```ts
private sanitizeDatabaseUrl(databaseUrl: string): string {
    try {
        const parsed = new URL(databaseUrl);

        parsed.search = '';

        return parsed.toString();
    } catch {
        return databaseUrl;
    }
}
```

وهذا أفضل للأسباب التالية:

* لا يعتمد على معرفة أسماء معاملات Prisma الحالية.
* إذا أضاف Prisma معاملات جديدة مستقبلاً فلن تتأثر.
* مناسب لكل من:

  * pg_dump
  * pg_restore
  * psql

---

# تقييمي

أنا أوصي بالحل الأخير:

```ts
parsed.search = '';
```

بدلاً من حذف المعاملات واحدًا واحدًا.

لأنه أبسط وأكثر متانة، خاصة وأن أدوات PostgreSQL لا تحتاج أي Query Parameters في `DATABASE_URL` لهذا الاستخدام.

بعد ذلك:

```bash
npm run build
pm2 restart all
```

ثم أعد تنفيذ:

```bash
curl -X POST http://localhost:3010/api/v1/owner/backups/trigger
```

وأتوقع أننا سننتقل إلى المرحلة التالية من Pipeline (الأرشفة أو نسخ الوسائط) بدل التوقف عند `pg_dump`.
