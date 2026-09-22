import { PrismaClient } from '@prisma/client';
import { DEFAULT_SCAM_RULES } from '../src/modules/message/scam-engine.ts';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding TrustTrade database...');

  // 1. Seed Scam Rules
  await prisma.scamRule.deleteMany({});
  for (const rule of DEFAULT_SCAM_RULES) {
    await prisma.scamRule.create({
      data: {
        pattern: rule.pattern,
        reason: rule.reason,
        active: true,
      },
    });
  }
  console.log(`Seeded ${DEFAULT_SCAM_RULES.length} scam detection rules.`);

  // 2. Seed Demo Users
  const userAsha = await prisma.user.upsert({
    where: { phone: '+919812340012' },
    update: {},
    create: {
      id: 'u_asha',
      name: 'Asha Verma',
      phone: '+919812340012',
      kycStatus: 'VERIFIED',
      phoneVerifiedAt: new Date(),
    },
  });

  const userRohit = await prisma.user.upsert({
    where: { phone: '+919771230088' },
    update: {},
    create: {
      id: 'u_rohit',
      name: 'Rohit Sharma',
      phone: '+919771230088',
      kycStatus: 'NONE',
      phoneVerifiedAt: new Date(),
    },
  });

  const userNeha = await prisma.user.upsert({
    where: { phone: '+919934560034' },
    update: {},
    create: {
      id: 'u_neha',
      name: 'Neha Kapoor',
      phone: '+919934560034',
      kycStatus: 'VERIFIED',
      phoneVerifiedAt: new Date(),
    },
  });

  // Admin user
  const adminUser = await prisma.user.upsert({
    where: { phone: '+919999999999' },
    update: {},
    create: {
      id: 'u_admin',
      name: 'TrustTrade Admin',
      phone: '+919999999999',
      kycStatus: 'VERIFIED',
      phoneVerifiedAt: new Date(),
    },
  });

  // Grant admin role
  await prisma.adminRole.upsert({
    where: { userId: adminUser.id },
    update: {},
    create: {
      userId: adminUser.id,
    },
  });
  console.log('Seeded demo users & admin account (+919999999999).');

  // 3. Seed Demo Listings
  await prisma.listing.deleteMany({});
  await prisma.listing.createMany({
    data: [
      {
        id: 'l1',
        sellerId: userAsha.id,
        title: 'iPhone 13, 128GB — Excellent condition',
        category: 'ELECTRONICS',
        priceInr: 32000,
        condition: 'USED_LIKE_NEW',
        description: 'One owner, box + charger included, battery health 91%.',
        protectRecommended: true,
        status: 'ACTIVE',
      },
      {
        id: 'l2',
        sellerId: userNeha.id,
        title: 'Study Table + Chair (Sheesham wood)',
        category: 'FURNITURE',
        priceInr: 4500,
        condition: 'USED_GOOD',
        description: 'Moving out sale, minor scratches on top.',
        protectRecommended: false,
        status: 'ACTIVE',
      },
      {
        id: 'l3',
        sellerId: userRohit.id,
        title: 'Royal Enfield Classic 350 (2019)',
        category: 'VEHICLES',
        priceInr: 118000,
        condition: 'USED_GOOD',
        description: 'Single owner, all papers clear, recently serviced.',
        protectRecommended: true,
        status: 'ACTIVE',
      },
    ],
  });
  console.log('Seeded demo listings.');

  console.log('Seeding complete!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
