// srs/tools/
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { allocateUserCodeForFixture } from '../common/user-code/user-code.testing';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.OWNER_SEED_EMAIL;
  const password = process.env.OWNER_SEED_PASSWORD;

  if (!email || !password) {
    console.error('❌ يجب تعريف OWNER_SEED_EMAIL و OWNER_SEED_PASSWORD في متغيرات البيئة');
    process.exit(1);
  }
  const name = 'مالك النظام';

  const exists = await prisma.user.findFirst({
    where: { email, userType: 'OWNER', isDeleted: false },
  });

  if (exists) {
    console.log('OWNER already exists:', exists.email);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const code = await allocateUserCodeForFixture(prisma);

  const owner = await prisma.user.create({
    data: {
      userType: 'OWNER',
      name,
      email,
      passwordHash,
      code,
      isActive: true,
      isDeleted: false,
      schoolId: null,
    },
    select: { uuid: true, email: true, name: true, code: true },
  });

  console.log('OWNER created:', owner);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
