const mongoose = require('mongoose');
require('dotenv').config(); // Para ler seu .env se necessário

// --- IMPORTAR SEUS MODELS ---
// Ajuste os caminhos conforme sua estrutura de pastas
const Attendance = require('./src/api/models/attendance.model');
const Enrollment = require('./src/api/models/enrollment.model');

// --- CONFIGURAÇÕES ---
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/school_management_db"; 
const SCHOOL_ID = "6917401a69974b9683ca06eb"; // ID fornecido por você
const CLASS_ID = "6907a489546430bc0dc7efbd"; // <--- IMPORTANTE: Cole o ID da turma 1ºB aqui

// Configuração de Realismo
const START_DATE = new Date('2025-01-01T00:00:00.000Z');
const END_DATE = new Date('2025-12-08T23:59:59.999Z'); // Data de hoje nas imagens
const ABSENCE_CHANCE = 0.15; // 15% de chance de falta (ajuste se quiser mais/menos)

const runSeed = async () => {
    try {
        console.log('🔌 Conectando ao MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Conectado!');

        // 1. Buscar Alunos da Turma
        // Usando a query exata do seu Service anterior (school_id snake_case, class sem Id)
        const enrollments = await Enrollment.find({
            school_id: SCHOOL_ID,
            class: CLASS_ID,
            status: 'Ativa'
        });

        if (enrollments.length === 0) {
            console.error('❌ Nenhum aluno encontrado para essa turma. Verifique o CLASS_ID.');
            process.exit(1);
        }

        console.log(`👥 Encontrados ${enrollments.length} alunos matriculados.`);
        const studentIds = enrollments.map(e => e.student); // Array de IDs dos alunos

        // 2. Loop de Datas
        let currentDate = new Date(START_DATE);
        const bulkOps = [];
        let daysCount = 0;

        while (currentDate <= END_DATE) {
            // Ignora Sábado (6) e Domingo (0)
            const dayOfWeek = currentDate.getDay();
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                
                // Gera a lista de presença para este dia
                const records = studentIds.map(studentId => {
                    // Sorteia se veio ou faltou
                    const isAbsent = Math.random() < ABSENCE_CHANCE;
                    
                    return {
                        studentId: studentId,
                        status: isAbsent ? 'ABSENT' : 'PRESENT',
                        observation: isAbsent ? 'Gerado automaticamente' : ''
                    };
                });

                // Estatísticas do dia para o metadata do documento
                const presentCount = records.filter(r => r.status === 'PRESENT').length;
                const absentCount = records.filter(r => r.status === 'ABSENT').length;

                // Cria o objeto de Chamada
                // Usamos as 12:00 para evitar problemas de fuso horário no dia
                const dateToSave = new Date(currentDate);
                dateToSave.setHours(12, 0, 0, 0);

                // Prepara a operação de inserção (upsert para não duplicar se rodar 2x)
                bulkOps.push({
                    updateOne: {
                        filter: { 
                            schoolId: SCHOOL_ID, 
                            classId: CLASS_ID, 
                            date: { 
                                $gte: new Date(dateToSave.setHours(0,0,0,0)), 
                                $lte: new Date(dateToSave.setHours(23,59,59,999)) 
                            } 
                        },
                        update: {
                            $set: {
                                schoolId: SCHOOL_ID,
                                classId: CLASS_ID,
                                teacherId: "68f3c331e491b4e18a498ec6", // Opcional se seu model não obrigar
                                date: dateToSave,
                                records: records,
                                metadata: {
                                    syncedAt: new Date(),
                                    deviceInfo: "Seed Script"
                                }
                            }
                        },
                        upsert: true
                    }
                });
                daysCount++;
            }

            // Avança um dia
            currentDate.setDate(currentDate.getDate() + 1);
        }

        // 3. Executar Gravação em Massa
        console.log(`💾 Preparando para salvar chamadas de ${daysCount} dias letivos...`);
        if (bulkOps.length > 0) {
            await Attendance.bulkWrite(bulkOps);
            console.log('🚀 Sucesso! Histórico populado com dados realistas.');
        } else {
            console.log('⚠️ Nenhuma operação pendente.');
        }

    } catch (error) {
        console.error('❌ Erro ao rodar seed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('👋 Desconectado.');
    }
};

runSeed();