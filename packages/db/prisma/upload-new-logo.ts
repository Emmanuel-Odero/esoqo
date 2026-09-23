import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { sniff, makeStorageKey, putObject } from "../src/storage";

const prisma = new PrismaClient();

/**
 * Upload the new ESOQO logo and update all Store and JamiiPage records
 * to use it.
 */

const NEW_LOGO_PATH =
  "/Users/ochiengodero/Dev/Apps/esoko/assets/branding/esoqo-full-logo-removebg-preview.png";

async function main() {
  console.log("Uploading new ESOQO logo...");

  // Read and sniff the new logo
  const buf = await readFile(NEW_LOGO_PATH);
  const check = sniff(buf, "image/png", "ESOQO-full-name-removebg-logo.png");

  if (!check.ok || !check.mime) {
    console.error(
      "Logo file did not pass the upload sniff check:",
      check.reason,
    );
    process.exit(1);
  }

  const storageKey = makeStorageKey(check.mime);
  await putObject(storageKey, buf);
  const newLogoUrl = `/img/${storageKey}`;

  console.log(`Uploaded logo with key: ${storageKey}`);
  console.log(`Logo URL: ${newLogoUrl}`);

  // Update all Store records
  const storeResult = await prisma.store.updateMany({
    data: {
      logoStorageKey: storageKey,
      logoUrl: newLogoUrl,
    },
  });
  console.log(`Updated ${storeResult.count} Store records`);

  // Update all JamiiPage records
  const jamiiResult = await prisma.jamiiPage.updateMany({
    data: {
      logoStorageKey: storageKey,
      logoUrl: newLogoUrl,
    },
  });
  console.log(`Updated ${jamiiResult.count} JamiiPage records`);

  // Update all ParcelOrg records
  const parcelOrgResult = await prisma.parcelOrg.updateMany({
    data: {
      logoStorageKey: storageKey,
      logoUrl: newLogoUrl,
    },
  });
  console.log(`Updated ${parcelOrgResult.count} ParcelOrg records`);

  console.log("Done! All logos updated.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
