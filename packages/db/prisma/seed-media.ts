import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * The platform-wide media-placeholder library — see JamiiMediaAsset's
 * schema comment and apps/jamii/src/components/placeholders/patterns.tsx.
 * Idempotent (upsert by key), so it's safe to rerun after adding a new
 * pattern to the code-authored registry.
 */
const ASSETS: { key: string; label: string; category: 'HERO' | 'GALLERY' | 'POST'; patternKey: string; position: number }[] = [
  { key: 'hero-waves', label: 'Waves', category: 'HERO', patternKey: 'waves', position: 0 },
  { key: 'hero-concentric', label: 'Concentric circles', category: 'HERO', patternKey: 'concentric', position: 1 },
  { key: 'hero-radial', label: 'Radial lines', category: 'HERO', patternKey: 'radial-lines', position: 2 },
  { key: 'gallery-dots', label: 'Dot grid', category: 'GALLERY', patternKey: 'dots-grid', position: 0 },
  { key: 'gallery-blob', label: 'Soft blob', category: 'GALLERY', patternKey: 'blob-soft', position: 1 },
  { key: 'gallery-chevrons', label: 'Chevrons', category: 'GALLERY', patternKey: 'chevrons', position: 2 },
  { key: 'post-waves', label: 'Waves', category: 'POST', patternKey: 'waves', position: 0 },
  { key: 'post-dots', label: 'Dot grid', category: 'POST', patternKey: 'dots-grid', position: 1 },
  { key: 'post-chevrons', label: 'Chevrons', category: 'POST', patternKey: 'chevrons', position: 2 },
];

async function main() {
  for (const asset of ASSETS) {
    await prisma.jamiiMediaAsset.upsert({
      where: { key: asset.key },
      update: { label: asset.label, category: asset.category, patternKey: asset.patternKey, position: asset.position },
      create: asset,
    });
  }
  console.log(`Seeded ${ASSETS.length} media placeholders.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
