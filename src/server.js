// server.js
require('dotenv').config();
const { initCronJobs } = require('./loaders/cron');
const app = require('./app');
const connectDB = require('./config/database');
const { initWebSocket } = require('./loaders/websocket');
const whatsappSubscriber = require('./api/subscribers/whatsapp.subscriber');

const { runCoraPaidAtFixIfEnabled } = require('./loaders/migrations'); // ✅

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const startServer = async () => {
  await connectDB();

  initCronJobs();
  whatsappSubscriber();
  console.log('🎧 Subscribers carregados!');

  const server = app.listen(PORT, HOST, () => {
    console.log(`🎧 Servidor rodando em http://${HOST}:${PORT}`);
  });

  initWebSocket(server);

  // ✅ roda em background, com lock + checkpoint
  runCoraPaidAtFixIfEnabled().catch((e) => {
    console.error('❌ [Migration] cora paidAt fix failed:', e.message);
  });
};

startServer();
