سبب: لا يوجد endpoint حذف فصل في السيرفر أصلاً!
في academic-years.controller.ts يوجد هذه الـ endpoints فقط:

Method	Route	الوصف
GET /	list	جلب كل السنوات
GET /current	getCurrent	السنة الحالية
POST /	create	إنشاء سنة
GET /:yearId	getOne	سنة بالمعرف
PATCH /:yearId	update	تعديل سنة
POST /:yearId/advance-term	advanceTerm	التقدم للفصل التالي
PATCH /terms/:termId	updateTerm	تعديل فصل
POST /:yearId/terms	addTerm	إضافة فصل
❌ لا يوجد DELETE /terms/:termId — لذلك السيرفر يرجع 404!

في academic-years.service.ts أيضاً لا يوجد method deleteTerm.

الحل:
نحتاج إضافة في السيرفر:

في academic-years.service.ts — إضافة deleteTerm() (soft delete بـ isDeleted: true)
في academic-years.controller.ts — إضافة @Delete('terms/:termId') handler
هل تريد أن أضيفهما؟

