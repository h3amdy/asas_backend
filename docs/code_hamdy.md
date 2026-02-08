الذي تفعله الآن (كقرار + تعديل كود) هو:

## ✅ 1) ثبّت قرار: **إنشاء/تعيين مدير المدرسة يتم فقط عبر**

**`POST /schools/:uuid/manager`**

يعني هذا هو “المسار الرسمي الوحيد” لإنشاء مدير المدرسة (ADMIN الأساسي) وتحديثه.

---

## ✅ 2) ماذا تفعل بملفات `admins`؟

خلِّ وحدة `admins` **للعرض والتعديل والتفعيل فقط** (Owner View)، وامنع منها الإنشاء.

### (A) احذف/علّق `@Post()` من `AdminsController`

**AdminsController** يصبح بدون create:

```ts
// srs/owner/admins/admins.controller.ts
@Controller('admins')
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  @Get()
  findAll() {
    return this.adminsService.findAll();
  }

  @Get('by-school/:uuid')
  findBySchool(@Param('uuid') uuid: string) {
    return this.adminsService.findBySchool(uuid);
  }

  // ❌ احذف هذا:
  // @Post()
  // create(@Body() dto: CreateAdminDto) {
  //   return this.adminsService.create(dto);
  // }

  @Patch(':uuid')
  update(@Param('uuid') uuid: string, @Body() dto: UpdateAdminDto) {
    return this.adminsService.update(uuid, dto);
  }

  @Patch(':uuid/status')
  updateStatus(@Param('uuid') uuid: string, @Body() dto: UpdateAdminStatusDto) {
    return this.adminsService.updateStatus(uuid, dto.isActive);
  }
}
```

### (B) احذف `create()` من `AdminsService` (أو خليها private/غير مستخدمة)

أفضل تحذفها لتفادي أي استعمال بالخطأ.

---

## ✅ 3) وثّق وتأكد من REST

بدل:

* `POST /admins` لإنشاء مدير

استخدم:

* `POST /schools/:uuid/manager` لإنشاء/تحديث مدير مدرسة محددة

وباقي `/admins` فقط:

* `GET /admins`
* `GET /admins/by-school/:uuid`
* `PATCH /admins/:uuid`
* `PATCH /admins/:uuid/status`

---

## ✅ 4) لازم تثبّت قيود DB (حتى ما يرجع الخطأ لاحقًا)

نفّذ migration SQL:

### (1) كود فريد داخل المدرسة:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_code_per_school
ON "User" ("schoolId","code")
WHERE "schoolId" IS NOT NULL AND "isDeleted" = false;
```

### (2) (اختياري لكن قوي) مدير واحد فعّال لكل مدرسة:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_one_admin_per_school
ON "User" ("schoolId")
WHERE "userType"='ADMIN' AND "isDeleted"=false;
```

---

---

### الخلاصة التنفيذية

1. **احذف POST /admins** (Controller + Service).
2. اعتمد **POST /schools/:uuid/manager** كمسار الإنشاء الوحيد.
3. أضف الـ indexes في DB.
