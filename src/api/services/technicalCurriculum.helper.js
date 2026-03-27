const TechnicalProgramModule = require('../models/technicalProgramModule.model');

async function getProgramModuleWorkloadSummary(technicalProgramId, schoolId, excludeModuleId = null) {
    const query = {
        technicalProgramId,
        school_id: schoolId
    };

    if (excludeModuleId) {
        query._id = { $ne: excludeModuleId };
    }

    const modules = await TechnicalProgramModule.find(query).select('workloadHours');

    const totalWorkloadHours = modules.reduce((total, module) => {
        const workloadHours = Number(module.workloadHours) || 0;
        return total + workloadHours;
    }, 0);

    return {
        moduleCount: modules.length,
        totalWorkloadHours
    };
}

module.exports = {
    getProgramModuleWorkloadSummary
};
