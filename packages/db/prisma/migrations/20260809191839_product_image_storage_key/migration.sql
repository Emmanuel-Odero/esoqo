/*
  Warnings:

  - Added the required column `storageKey` to the `product_image` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "product_image" ADD COLUMN     "storageKey" TEXT NOT NULL;
