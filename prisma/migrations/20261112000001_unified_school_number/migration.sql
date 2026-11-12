-- ═══════════════════════════════════════════════════════════════════════════
-- SRS-SCH-NUM-001 — الرقم المدرسي الموحد على مستوى المنصة
--
-- 1. جدول نطاقات البادئات user_code_ranges (22..29) مع algorithm_version.
-- 2. دالة التبديل asas_permute_five_digits_v1 (مطابقة حرفياً لـ permuteFiveDigitsV1 في TS).
-- 3. فحوص مسبقة (متجهات ذهبية لكل البادئات + السعة) قبل أي تعديل على users.
-- 4. إعادة ترقيم كل صفوف users (بما فيها OWNER والمحذوفة منطقياً) بالتتابع على البادئات.
-- 5. NOT NULL + UNIQUE على users.code.
-- 6. فحوص ما بعد الترقيم داخل المعاملة نفسها.
--
-- المعاملة صريحة: أي RAISE EXCEPTION يلغي كل شيء وتبقى users.code كما كانت.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. جدول نطاقات البادئات
CREATE TABLE "user_code_ranges" (
    "prefix"            INTEGER      NOT NULL,
    "allocated_count"   INTEGER      NOT NULL DEFAULT 0,
    "capacity"          INTEGER      NOT NULL DEFAULT 100000,
    "algorithm_version" INTEGER      NOT NULL DEFAULT 1,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_code_ranges_pkey" PRIMARY KEY ("prefix"),
    CONSTRAINT "user_code_ranges_count_chk"
        CHECK ("allocated_count" >= 0 AND "allocated_count" <= "capacity")
);

INSERT INTO "user_code_ranges" ("prefix", "allocated_count", "capacity", "algorithm_version", "updated_at")
SELECT p, 0, 100000, 1, CURRENT_TIMESTAMP FROM generate_series(22, 29) AS p;

-- 2. دالة التبديل — الإصدار 1 (مجمّدة)
CREATE OR REPLACE FUNCTION asas_permute_five_digits_v1(p_counter INT, p_prefix INT)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE STRICT
AS $$
DECLARE
    v_x INT := p_counter;
    v_l INT;
    v_r INT;
    v_f INT;
    v_tmp INT;
    v_round INT;
BEGIN
    IF p_counter < 0 OR p_counter >= 100000 THEN
        RAISE EXCEPTION 'USER_CODE_COUNTER_OUT_OF_RANGE: %', p_counter;
    END IF;
    LOOP
        v_l := (v_x >> 9) & 511;
        v_r := v_x & 511;
        FOR v_round IN 0..3 LOOP
            v_f := ((((v_r * 313 + p_prefix * 97 + v_round * 131) # (v_r >> 3)) * 251) & 511);
            v_tmp := v_r;
            v_r := v_l # v_f;
            v_l := v_tmp;
        END LOOP;
        v_x := (v_l << 9) | v_r;
        EXIT WHEN v_x < 100000;
    END LOOP;
    RETURN v_x;
END $$;

-- 3. الفحوص المسبقة — أي فشل يلغي المعاملة قبل لمس جدول users
DO $$
DECLARE
    v_mismatch INT;
    v_total INT;
BEGIN
    SELECT COUNT(*) INTO v_mismatch
    FROM (VALUES
        (22,0,2261431),(22,1,2228871),(22,99999,2210066),
        (23,0,2314604),(23,1,2366903),(23,99999,2373459),
        (24,0,2479742),(24,1,2417992),(24,99999,2491043),
        (25,0,2595208),(25,1,2587701),(25,99999,2506304),
        (26,0,2648348),(26,1,2630073),(26,99999,2636206),
        (27,0,2727244),(27,1,2751666),(27,99999,2781837),
        (28,0,2825956),(28,1,2874785),(28,99999,2806849),
        (29,0,2987141),(29,1,2973209),(29,99999,2902192)
    ) AS g(prefix, counter, expected)
    WHERE g.prefix * 100000 + asas_permute_five_digits_v1(g.counter, g.prefix) <> g.expected;

    IF v_mismatch > 0 THEN
        RAISE EXCEPTION 'USER_CODE_GOLDEN_VECTORS_MISMATCH: % mismatches', v_mismatch;
    END IF;

    SELECT COUNT(*) INTO v_total FROM "users";
    IF v_total > 800000 THEN
        RAISE EXCEPTION 'USER_CODE_CAPACITY_EXCEEDED: % users', v_total;
    END IF;
END $$;

-- 4. إعادة الترقيم بالتتابع على البادئات
UPDATE "users" SET "code" = NULL;

DO $$
DECLARE
    v_total INT;
    v_capacity INT := 100000;
BEGIN
    SELECT COUNT(*) INTO v_total FROM "users";

    -- rn = 0..N-1 ؛ البادئة = 22 + rn / 100000 ؛ العداد = rn % 100000
    WITH ordered AS (
        SELECT id, (ROW_NUMBER() OVER (ORDER BY id ASC) - 1)::INT AS rn
        FROM "users"
    )
    UPDATE "users" u
    SET "code" = (22 + o.rn / v_capacity) * 100000
               + asas_permute_five_digits_v1(o.rn % v_capacity, 22 + o.rn / v_capacity)
    FROM ordered o
    WHERE u.id = o.id;

    UPDATE "user_code_ranges" r
    SET "allocated_count" = LEAST(GREATEST(v_total - (r."prefix" - 22) * v_capacity, 0), v_capacity),
        "updated_at" = CURRENT_TIMESTAMP;
END $$;

-- 5. NOT NULL + UNIQUE
ALTER TABLE "users" ALTER COLUMN "code" SET NOT NULL;
CREATE UNIQUE INDEX "users_code_key" ON "users"("code");

-- 6. فحوص ما بعد الترقيم
DO $$
DECLARE
    v_bad INT;
BEGIN
    SELECT COUNT(*) INTO v_bad FROM "users"
    WHERE "code" < 2200000 OR "code" > 2999999;
    IF v_bad > 0 THEN RAISE EXCEPTION 'POST_CHECK_RANGE: %', v_bad; END IF;

    SELECT COUNT(*) - COUNT(DISTINCT "code") INTO v_bad FROM "users";
    IF v_bad > 0 THEN RAISE EXCEPTION 'POST_CHECK_DUPLICATES: %', v_bad; END IF;

    SELECT COUNT(*) INTO v_bad
    FROM "user_code_ranges" r
    LEFT JOIN (
        SELECT ("code" / 100000) AS prefix, COUNT(*)::INT AS n
        FROM "users" GROUP BY 1
    ) u ON u.prefix = r."prefix"
    WHERE COALESCE(u.n, 0) <> r."allocated_count";
    IF v_bad > 0 THEN RAISE EXCEPTION 'POST_CHECK_RANGE_COUNTS: %', v_bad; END IF;
END $$;

COMMIT;

