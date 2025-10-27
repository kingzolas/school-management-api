// src/config/database.js

const mongoose = require('mongoose');
// require('dotenv').config(); // Linha removida, está correto

const connectDB = async () => {
    try {
        // A LINHA DO ERRO ESTÁ AQUI:
        // await mongoose.connect(process.env.MONGODB_URI); // <-- ERRADO

        // CORRIJA PARA:
        await mongoose.connect(process.env.MONGO_URI); // <-- CORRETO (sem o "DB")

        console.log('✅ Conexão com o MongoDB estabelecida com sucesso!');
    } catch (error) {
        console.error('❌ Erro ao conectar com o MongoDB:', error.message);
        process.exit(1);
    }
};

module.exports = connectDB;