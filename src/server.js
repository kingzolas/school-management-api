require('dotenv').config();
const { initCronJobs } = require('./loaders/cron');
const app = require('./app');
const connectDB = require('./config/database');
const { initWebSocket } = require('./loaders/websocket');
const whatsappSubscriber = require('./api/subscribers/whatsapp.subscriber');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // <<< Adicione esta linha

const startServer = async () => {
    await connectDB();

    // 2. Inicia os Jobs de Cobrança
        initCronJobs();

    whatsappSubscriber();
  console.log('🎧 Subscribers carregados!');

    // <<< Modifique esta linha para incluir o HOST >>>
    const server = app.listen(PORT, HOST, () => {
        console.log(`🎧 Servidor rodando em http://${HOST}:${PORT}`);
    });

    initWebSocket(server);
};

startServer();