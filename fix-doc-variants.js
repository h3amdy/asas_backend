// fix-doc-variants.js — Fix DOCUMENT assets with null variantsJson
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const crypto = require('crypto');
const prisma = new PrismaClient();

async function fix() {
  const docs = await prisma.mediaAsset.findMany({
    where: { kind: 'DOCUMENT', variantsJson: null, isDeleted: false }
  });
  console.log('Found', docs.length, 'documents without variantsJson');

  for (const doc of docs) {
    if (doc.storageKey === null || doc.storageKey === undefined) {
      console.log('Skip', doc.uuid, '- no storageKey (null)');
      continue;
    }

    const basePath = process.env.MEDIA_STORAGE_PATH || './storage/media';
    const filePath = basePath + '/' + doc.storageKey;

    if (fs.existsSync(filePath) === false) {
      console.log('Skip', doc.uuid, '- file not found at', filePath);
      continue;
    }

    const buf = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha256').update(buf).digest('hex').substring(0, 32);
    const etag = '"' + hash + '"';
    const variantsJson = JSON.stringify({
      original: {
        storage_key: doc.storageKey,
        etag: etag,
        size_bytes: buf.length,
        content_type: doc.contentType,
      },
    });

    await prisma.mediaAsset.update({
      where: { id: doc.id },
      data: { variantsJson, sizeBytes: BigInt(buf.length), etag },
    });
    console.log('Fixed', doc.uuid, '- size:', buf.length);
  }

  await prisma.$disconnect();
  console.log('Done!');
}

fix().catch(e => { console.error(e); process.exit(1); });
