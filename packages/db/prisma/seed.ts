import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const prisma = new PrismaClient();

/**
 * Reference data only.
 *
 * Deliberately NO fake registrations, NO fake parties, NO fake prices
 * beyond today's genuine collection structure. A stakeholder who mistakes
 * seeded rows for traction makes decisions on fiction, and you are the
 * one who has to correct it later.
 */

const COUNTIES = [
  ['047','Nairobi',true,true,'4.4M'],
  ['023','Turkana',true,true,'1.0M'],
  ['028','Elgeyo Marakwet',true,true,'0.5M'],
  ['024','West Pokot',true,true,'0.7M'],
  ['027','Uasin Gishu',true,true,'1.2M'],
  ['022','Kiambu',true,true,'2.4M'],
  ['032','Nakuru',true,true,'2.2M'],
  ['026','Trans Nzoia',true,true,'1.0M'],
  ['016','Machakos',false,false,'1.4M'],
  ['042','Kisumu',false,false,'1.2M'],
  ['001','Mombasa',false,false,'1.2M'],
] as const;

const ISSUERS = [
  ['Ministry of Labour & Social Protection','MoL','MINISTRY',['GROUP_REGISTERED']],
  ['Business Registration Service','BRS','AGENCY',['BUSINESS_REGISTERED']],
  ['Kenya Revenue Authority','KRA','AGENCY',['KRA_PIN','ETIMS_ACTIVE']],
  ['Judiciary Mediation Directorate','Judiciary','JUDICIARY',['MEDIATION_TRAINED']],
  ['Nairobi City County','Nairobi County','COUNTY',['SINGLE_BUSINESS_PERMIT','FOOD_HANDLER','HEALTH_CLEARANCE']],
  ['Child & Elder Care Foundation','CECF','NGO',['FIELD_VISIT','MEDIATION_TRAINED']],
] as const;

const MARKETS = [
  ['Wakulima','047','Daily',true],['Gikomba','047','Daily',true],['Marikiti','047','Daily',true],
  ['Lodwar','023','Mon & Thu',true],['Kakuma','023','Wed',false],
  ['Iten','028','Tue & Sat',true],['Kapsowar','028','Fri',true],
  ['Kapenguria','024','Mon & Thu',true],
  ['Eldoret','027','Daily',true],['Limuru','022','Tue & Fri',true],['Thika','022','Daily',true],
  ['Nakuru Wakulima','032','Daily',true],['Kitale','026','Mon, Wed & Sat',true],
] as const;

const PRICING_RULES = [
  ['SUBDOMAIN_SETUP_FEE', 'Custom subdomain — setup', 1500, null, 'ONE_TIME'],
  ['SUBDOMAIN_MONTHLY_FEE', 'Custom subdomain — hosting', 300, null, 'MONTHLY'],
  ['POS_MONTHLY_FEE', 'PoS terminal add-on', 400, null, 'MONTHLY'],
  ['PLATFORM_FEE_PCT', 'Platform fee on checkout sales', null, 1.5, 'PER_ORDER'],
] as const;

const COMMODITIES = [
  ['Sukuma wiki','bunch','veg'],['Cabbage','head','veg'],['Tomatoes','crate','veg'],
  ['Onions, red','net 13kg','veg'],['Irish potatoes','bag 50kg','veg'],['Carrots','bag 90kg','veg'],
  ['Maize','bag 90kg','cereal'],['Beans, rosecoco','bag 90kg','cereal'],['Rice, pishori','bag 50kg','cereal'],
  ['Avocado, Hass','kg','fruit'],['French beans','kg','fruit'],['Banana','bunch','fruit'],
  ['Goat, mature','head','live'],['Cattle, mature','head','live'],['Milk, raw','litre','live'],
  ['Chicken, kienyeji','bird','live'],['Tilapia','kg','live'],
  ['Mitumba bale, grade A','bale','goods'],['DAP fertiliser','bag 50kg','goods'],['Cement, 50kg','bag','goods'],
] as const;

async function main() {
  console.log('seeding reference data…');

  for (const [code, name, officer, prices, pop] of COUNTIES) {
    await prisma.county.upsert({
      where: { code },
      update: { hasFieldOfficer: officer, pricesLive: prices },
      create: { code, name, hasFieldOfficer: officer, pricesLive: prices, population: pop },
    });
  }
  console.log(`  counties: ${COUNTIES.length}`);

  for (const [name, short, kind, claims] of ISSUERS) {
    await prisma.issuer.upsert({
      where: { name },
      update: { active: true },
      create: { name, shortName: short, kind, allowedClaims: claims as never },
    });
  }
  console.log(`  issuers: ${ISSUERS.length}`);

  for (const [name, countyCode, days, reporting] of MARKETS) {
    await prisma.market.upsert({
      where: { name_countyCode: { name, countyCode } },
      update: { reporting },
      create: { name, countyCode, marketDays: days, reporting },
    });
  }
  console.log(`  markets: ${MARKETS.length}`);

  for (const [name, unit, category] of COMMODITIES) {
    await prisma.commodity.upsert({ where: { name }, update: {}, create: { name, unit, category } });
  }
  console.log(`  commodities: ${COMMODITIES.length}`);

  for (const [key, label, amountKes, amountPct, billingPeriod] of PRICING_RULES) {
    await prisma.pricingRule.upsert({
      where: { key },
      update: {},
      create: { key, label, amountKes, amountPct, billingPeriod },
    });
  }
  console.log(`  pricing rules: ${PRICING_RULES.length} (edit these from the admin app, not by re-seeding)`);

  // One operations account so the admin app is reachable on first run.
  const pin = process.env.SEED_ADMIN_PIN ?? '482915';
  const precomputedHash = process.env.SEED_ADMIN_HASH;
  const pinHash = precomputedHash || await hash(pin, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  await prisma.staffUser.upsert({
    where: { email: 'ops@esoko.co.ke' },
    update: {},
    create: {
      email: 'ops@esoko.co.ke',
      name: 'Operations',
      pinHash,
      capabilities: ['*'],
    },
  });
  console.log(`  staff: ops@esoko.co.ke  (PIN ${pin} — change before any deployment)`);

  console.log('\nNo registrations, parties or prices were seeded. Those come from real use.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
