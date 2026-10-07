-- G1: Province / District / Mafhoom District Routing
-- Reference data tables for student self-registration routing

-- CreateTable: provinces (22 Yemeni governorates)
CREATE TABLE "provinces" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provinces_pkey" PRIMARY KEY ("id")
);

-- CreateTable: districts (333 Yemeni directorates)
CREATE TABLE "districts" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "province_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "districts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: mafhoom_district_routing (maps district → section "أ" or "ب")
CREATE TABLE "mafhoom_district_routing" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL,
    "district_id" INTEGER NOT NULL,
    "target_section" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mafhoom_district_routing_pkey" PRIMARY KEY ("id")
);

-- CHECK CONSTRAINT: target_section must be "أ" or "ب"
ALTER TABLE "mafhoom_district_routing"
    ADD CONSTRAINT "mafhoom_district_routing_target_section_check"
    CHECK ("target_section" IN ('أ', 'ب'));

-- Indexes: provinces
CREATE UNIQUE INDEX "provinces_uuid_key" ON "provinces"("uuid");
CREATE UNIQUE INDEX "provinces_name_key" ON "provinces"("name");

-- Indexes: districts
CREATE UNIQUE INDEX "districts_uuid_key" ON "districts"("uuid");
CREATE INDEX "districts_province_id_idx" ON "districts"("province_id");
CREATE UNIQUE INDEX "districts_province_id_name_key" ON "districts"("province_id", "name");

-- Indexes: mafhoom_district_routing
CREATE UNIQUE INDEX "mafhoom_district_routing_uuid_key" ON "mafhoom_district_routing"("uuid");
CREATE UNIQUE INDEX "mafhoom_district_routing_district_id_key" ON "mafhoom_district_routing"("district_id");

-- ForeignKeys
ALTER TABLE "districts" ADD CONSTRAINT "districts_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "provinces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mafhoom_district_routing" ADD CONSTRAINT "mafhoom_district_routing_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "districts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
