// srs/tools/
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = 'h3amdy@gmail.com';
  const password = 'faroq19?';
  const name = 'مالك النظام';

  const exists = await prisma.user.findFirst({
    where: { email, userType: 'OWNER', isDeleted: false },
  });

  if (exists) {
    console.log('OWNER already exists:', exists.email);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const owner = await prisma.user.create({
    data: {
      userType: 'OWNER',
      name,
      email,
      passwordHash,
      isActive: true,
      isDeleted: false,
      schoolId: null,
    },
    select: { uuid: true, email: true, name: true },
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
