ALTER TABLE "Customer" ADD COLUMN "customerCode" TEXT;

-- Data migration: generate customerCode for existing customers
-- Pattern: C + random 3 alphanumeric chars + 3-letter city acronym
DO $$
DECLARE
  r RECORD;
  acr TEXT;
  rand_char TEXT;
  new_code TEXT;
BEGIN
  FOR r IN
    SELECT id, city FROM "Customer" WHERE "customerCode" IS NULL
  LOOP
    -- Determine acronym from city
    CASE
      WHEN lower(coalesce(r.city, '')) LIKE '%santa cruz%' THEN acr := 'SCZ';
      WHEN lower(coalesce(r.city, '')) LIKE '%cochin%' THEN acr := 'CBC';
      WHEN lower(coalesce(r.city, '')) LIKE '%la paz%' THEN acr := 'LPZ';
      WHEN lower(coalesce(r.city, '')) LIKE '%oruro%' THEN acr := 'ORU';
      WHEN lower(coalesce(r.city, '')) LIKE '%potos%' THEN acr := 'PTS';
      WHEN lower(coalesce(r.city, '')) LIKE '%chuquisaca%' OR lower(coalesce(r.city, '')) LIKE '%sucre%' THEN acr := 'CHU';
      WHEN lower(coalesce(r.city, '')) LIKE '%tarija%' THEN acr := 'TAR';
      WHEN lower(coalesce(r.city, '')) LIKE '%trinidad%' THEN acr := 'TRI';
      WHEN lower(coalesce(r.city, '')) LIKE '%cobija%' THEN acr := 'COB';
      WHEN lower(coalesce(r.city, '')) LIKE '%beni%' THEN acr := 'BEN';
      WHEN lower(coalesce(r.city, '')) LIKE '%pando%' THEN acr := 'PAN';
      ELSE acr := 'GEN';
    END CASE;

    -- Generate 3 random alphanumeric characters
    rand_char := '';
    FOR i IN 1..3 LOOP
      rand_char := rand_char || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', floor(random() * 36)::int + 1, 1);
    END LOOP;

    new_code := 'C' || rand_char || acr;

    -- Ensure uniqueness within tenant
    WHILE EXISTS (SELECT 1 FROM "Customer" WHERE "customerCode" = new_code) LOOP
      rand_char := '';
      FOR i IN 1..3 LOOP
        rand_char := rand_char || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', floor(random() * 36)::int + 1, 1);
      END LOOP;
      new_code := 'C' || rand_char || acr;
    END LOOP;

    UPDATE "Customer" SET "customerCode" = new_code WHERE id = r.id;
  END LOOP;
END $$;
