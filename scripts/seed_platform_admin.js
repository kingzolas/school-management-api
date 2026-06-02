require('dotenv').config();

const connectDB = require('../src/config/database');
const PlatformAdmin = require('../src/api/models/platformAdmin.model');

async function main() {
  const name = String(process.env.PLATFORM_ADMIN_NAME || '').trim();
  const email = String(process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.PLATFORM_ADMIN_PASSWORD || '');

  if (!name || !email || !password) {
    throw new Error('Defina PLATFORM_ADMIN_NAME, PLATFORM_ADMIN_EMAIL e PLATFORM_ADMIN_PASSWORD no .env.');
  }

  await connectDB();

  const existingByEmail = await PlatformAdmin.findOne({ email }).select('_id email').lean();
  if (existingByEmail) {
    console.log('PlatformAdmin ja existe para o e-mail informado. Nenhum registro criado.');
    return;
  }

  const existingCount = await PlatformAdmin.countDocuments();
  if (existingCount > 0) {
    console.log('Ja existe pelo menos um PlatformAdmin. Seed inicial nao cria outro administrador.');
    return;
  }

  const passwordHash = await PlatformAdmin.hashPassword(password);
  const admin = await PlatformAdmin.create({
    name,
    email,
    passwordHash,
    role: 'superAdmin',
    isActive: true,
  });

  console.log(`PlatformAdmin inicial criado com sucesso: ${admin.email}`);
}

main()
  .catch((error) => {
    console.error(`Falha ao criar PlatformAdmin inicial: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    const mongoose = require('mongoose');
    await mongoose.connection.close().catch(() => {});
  });
