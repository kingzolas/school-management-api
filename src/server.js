require('dotenv').config();

const app = require('./app');
const connectDB = require('./config/database');
const { initWebSocket } = require('./loaders/websocket');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // <<< Adicione esta linha

const startServer = async () => {
    await connectDB();

    // <<< Modifique esta linha para incluir o HOST >>>
    const server = app.listen(PORT, HOST, () => {
        console.log(`🎧 Servidor rodando em http://${HOST}:${PORT}`);
    });

    initWebSocket(server);
};

startServer();