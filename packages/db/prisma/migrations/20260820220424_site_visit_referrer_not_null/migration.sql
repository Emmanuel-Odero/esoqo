/*
  Warnings:

  - Made the column `referrerHost` on table `site_visit` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "site_visit" ALTER COLUMN "referrerHost" SET NOT NULL,
ALTER COLUMN "referrerHost" SET DEFAULT '';
