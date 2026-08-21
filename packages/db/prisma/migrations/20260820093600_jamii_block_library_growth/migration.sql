-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JamiiBlockType" ADD VALUE 'HERO';
ALTER TYPE "JamiiBlockType" ADD VALUE 'CTA_BUTTON';
ALTER TYPE "JamiiBlockType" ADD VALUE 'IMAGE_TEXT';
ALTER TYPE "JamiiBlockType" ADD VALUE 'VIDEO_EMBED';
ALTER TYPE "JamiiBlockType" ADD VALUE 'MAP_EMBED';
ALTER TYPE "JamiiBlockType" ADD VALUE 'COLUMNS';
ALTER TYPE "JamiiBlockType" ADD VALUE 'SPACER';
ALTER TYPE "JamiiBlockType" ADD VALUE 'PROGRAMS_LIST';
ALTER TYPE "JamiiBlockType" ADD VALUE 'TEAM_GRID';
ALTER TYPE "JamiiBlockType" ADD VALUE 'GALLERY_GRID';
ALTER TYPE "JamiiBlockType" ADD VALUE 'FAQ_ACCORDION';
ALTER TYPE "JamiiBlockType" ADD VALUE 'CONTACT_FORM';
