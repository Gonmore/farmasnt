-- Update existing warehouse codes to have SUC- prefix
UPDATE "Warehouse" SET "code" = CONCAT('SUC-', "code") WHERE "code" NOT LIKE 'SUC-%';