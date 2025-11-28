// لاختبار وإنشاء كلمة المرور

const bcrypt = require('bcrypt');

async function run() {
  const hash = await bcrypt.hash('faroq19?', 10);
  console.log('HASH => ', hash);
}

run();