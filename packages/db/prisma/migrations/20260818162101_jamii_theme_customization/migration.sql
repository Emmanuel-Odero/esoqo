-- CreateEnum
CREATE TYPE "JamiiThemeMode" AS ENUM ('DARK', 'LIGHT');

-- AlterTable
ALTER TABLE "jamii_page" ADD COLUMN     "brandAccentThree" TEXT,
ADD COLUMN     "brandAccentTwo" TEXT,
ADD COLUMN     "themeDefaultMode" "JamiiThemeMode" NOT NULL DEFAULT 'DARK',
ADD COLUMN     "visionShort" TEXT;
