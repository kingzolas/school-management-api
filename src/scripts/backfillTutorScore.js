const tutorFinancialScoreService = require('../api/services/tutorFinancialScore.service');
const mongoose = require('mongoose');

async function run() {
    try {

        await mongoose.connect(process.env.MONGO_URI);

        const schoolId = "ID_DA_ESCOLA";

        const result = await tutorFinancialScoreService.recalculateAllTutors(schoolId);

        console.log("Backfill finalizado:", result);

        process.exit();

    } catch (error) {
        console.error("Erro no backfill:", error);
        process.exit(1);
    }
}

run();