// Importa as bibliotecas necessárias (exceto o faker)
const mongoose = require('mongoose');
require('dotenv').config();

// Importa nosso model de Aluno e a função de conexão
const Student = require('./api/models/student.model');
const connectDB = require('./config/database');

const seedStudents = async () => {
  try {
    // --- CORREÇÃO APLICADA AQUI ---
    // Usamos o import() dinâmico para carregar a biblioteca ESM
    const { fakerPT_BR } = await import('@faker-js/faker');

    // 1. Conecta ao banco de dados
    await connectDB();
    console.log('🌱 Conexão com o MongoDB estabelecida para o seeding...');

    // 2. Limpa a coleção de alunos existente
    console.log('🧹 Limpando a coleção de alunos...');
    await Student.deleteMany({});

    // 3. Cria 20 alunos aleatórios
    const students = [];
    for (let i = 0; i < 20; i++) {
      const studentAddress = {
        street: fakerPT_BR.location.streetAddress(),
        neighborhood: fakerPT_BR.location.county(),
        houseNumber: fakerPT_BR.location.buildingNumber(),
        city: fakerPT_BR.location.city(),
        state: fakerPT_BR.location.state({ abbreviated: true }),
      };

      const tutor = {
        fullName: fakerPT_BR.person.fullName(),
        birthDate: fakerPT_BR.date.birthdate({ min: 1960, max: 1995, mode: 'year' }),
        gender: fakerPT_BR.helpers.arrayElement(['Masculino', 'Feminino']),
        nationality: 'Brasileira',
        phoneNumber: fakerPT_BR.phone.number(),
        email: fakerPT_BR.internet.email().toLowerCase(),
        relationship: fakerPT_BR.helpers.arrayElement(['Mãe', 'Pai', 'Tia', 'Avô']),
        address: studentAddress,
      };

      const student = new Student({
        fullName: fakerPT_BR.person.fullName(),
        birthDate: fakerPT_BR.date.birthdate({ min: 2005, max: 2015, mode: 'year' }),
        gender: fakerPT_BR.helpers.arrayElement(['Masculino', 'Feminino']),
        nationality: 'Brasileira',
        phoneNumber: fakerPT_BR.phone.number(),
        email: fakerPT_BR.internet.email().toLowerCase(),
        address: studentAddress,
        tutors: [tutor],
      });

      students.push(student);
    }

    // 4. Insere todos os alunos de uma vez no banco
    console.log('🚀 Inserindo 20 alunos no banco de dados...');
    await Student.insertMany(students);

    console.log('✅ Sucesso! O banco de dados foi populado com 20 alunos.');

  } catch (error) {
    console.error('❌ Erro ao popular o banco de dados:', error);
  } finally {
    // 5. Fecha a conexão com o banco
    console.log('🔌 Fechando a conexão com o MongoDB.');
    await mongoose.connection.close();
  }
};

// Executa a função
seedStudents();

