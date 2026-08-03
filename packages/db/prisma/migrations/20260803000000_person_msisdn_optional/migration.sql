-- Staff can now add a group member with just a name, leaving phone blank
-- ("pending") until a real number is on file. Postgres treats multiple
-- NULLs as distinct under a unique constraint, so the existing unique
-- index on msisdn still holds for every row that does have one.
ALTER TABLE "person" ALTER COLUMN "msisdn" DROP NOT NULL;
