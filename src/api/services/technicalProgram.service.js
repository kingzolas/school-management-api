const TechnicalProgram = require('../models/technicalProgram.model');
const { getProgramModuleWorkloadSummary } = require('./technicalCurriculum.helper');

const normalizeOptionalWorkload = (value, fieldLabel) => {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${fieldLabel} precisa ser um número válido.`);
    }

    return parsed;
};

const normalizeCboCodes = (value) => {
    if (value === undefined || value === null || value === '') {
        return [];
    }

    if (!Array.isArray(value)) {
        throw new Error('Os CBOs do programa precisam ser enviados como lista.');
    }

    return value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
};

const normalizeProgramPayload = (payload = {}) => {
    const normalizedPayload = { ...payload };

    if (Object.prototype.hasOwnProperty.call(normalizedPayload, 'code')) {
        normalizedPayload.code = normalizedPayload.code
            ? String(normalizedPayload.code).trim()
            : null;
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPayload, 'apprenticeshipProgramName')) {
        normalizedPayload.apprenticeshipProgramName = normalizedPayload.apprenticeshipProgramName
            ? String(normalizedPayload.apprenticeshipProgramName).trim()
            : null;
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPayload, 'occupationalArc')) {
        normalizedPayload.occupationalArc = normalizedPayload.occupationalArc
            ? String(normalizedPayload.occupationalArc).trim()
            : null;
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPayload, 'cboCodes')) {
        normalizedPayload.cboCodes = normalizeCboCodes(normalizedPayload.cboCodes);
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPayload, 'theoreticalWorkloadHours')) {
        normalizedPayload.theoreticalWorkloadHours = normalizeOptionalWorkload(
            normalizedPayload.theoreticalWorkloadHours,
            'A carga horária teórica do programa'
        );
    }

    if (Object.prototype.hasOwnProperty.call(normalizedPayload, 'practicalWorkloadHours')) {
        normalizedPayload.practicalWorkloadHours = normalizeOptionalWorkload(
            normalizedPayload.practicalWorkloadHours,
            'A carga horária prática do programa'
        );
    }

    return normalizedPayload;
};

const assertProgramWorkloadBreakdown = ({ theoreticalWorkloadHours, practicalWorkloadHours, totalWorkloadHours }) => {
    const theory = theoreticalWorkloadHours ?? null;
    const practice = practicalWorkloadHours ?? null;
    const total = Number(totalWorkloadHours || 0);

    if (theory !== null && theory > total) {
        throw new Error('A carga horária teórica não pode ser maior que a carga horária total do programa.');
    }

    if (practice !== null && practice > total) {
        throw new Error('A carga horária prática não pode ser maior que a carga horária total do programa.');
    }

    if (theory !== null && practice !== null && (theory + practice) > total) {
        throw new Error('A soma das cargas horárias teórica e prática não pode ser maior que a carga horária total do programa.');
    }
};

class TechnicalProgramService {
    async createTechnicalProgram(programData, schoolId) {
        try {
            const normalizedProgramData = normalizeProgramPayload(programData);
            assertProgramWorkloadBreakdown({
                theoreticalWorkloadHours: normalizedProgramData.theoreticalWorkloadHours,
                practicalWorkloadHours: normalizedProgramData.practicalWorkloadHours,
                totalWorkloadHours: normalizedProgramData.totalWorkloadHours
            });

            const newProgram = new TechnicalProgram({
                ...normalizedProgramData,
                school_id: schoolId
            });

            await newProgram.save();
            return newProgram;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`O programa técnico '${programData.name}' já existe nesta escola.`);
            }
            throw error;
        }
    }

    async getAllTechnicalPrograms(filter = {}, schoolId) {
        const query = { ...filter };
        delete query.school_id;

        return await TechnicalProgram.find({
            ...query,
            school_id: schoolId
        }).sort({ name: 1 });
    }

    async getTechnicalProgramById(id, schoolId) {
        const program = await TechnicalProgram.findOne({ _id: id, school_id: schoolId });

        if (!program) {
            throw new Error('Programa técnico não encontrado ou não pertence a esta escola.');
        }

        return program;
    }

    async updateTechnicalProgram(id, updateData, schoolId) {
        const normalizedUpdateData = normalizeProgramPayload(updateData);
        delete normalizedUpdateData.school_id;

        if (normalizedUpdateData.name) {
            const existing = await TechnicalProgram.findOne({
                _id: { $ne: id },
                name: normalizedUpdateData.name,
                school_id: schoolId
            });

            if (existing) {
                throw new Error(`O programa técnico '${normalizedUpdateData.name}' já existe nesta escola.`);
            }
        }

        const currentProgram = await TechnicalProgram.findOne({ _id: id, school_id: schoolId });

        if (!currentProgram) {
            throw new Error('Programa técnico não encontrado para atualizar.');
        }

        if (Object.prototype.hasOwnProperty.call(normalizedUpdateData, 'totalWorkloadHours')) {
            const nextTotalWorkloadHours = Number(normalizedUpdateData.totalWorkloadHours);
            if (!Number.isFinite(nextTotalWorkloadHours) || nextTotalWorkloadHours < 0) {
                throw new Error('A carga horária total do programa precisa ser um número válido.');
            }

            const workloadSummary = await getProgramModuleWorkloadSummary(id, schoolId);
            if (workloadSummary.totalWorkloadHours > nextTotalWorkloadHours) {
                throw new Error('A carga horária total do programa não pode ser menor que a soma das cargas horárias dos módulos já cadastrados.');
            }

            normalizedUpdateData.totalWorkloadHours = nextTotalWorkloadHours;
        }

        assertProgramWorkloadBreakdown({
            theoreticalWorkloadHours: Object.prototype.hasOwnProperty.call(normalizedUpdateData, 'theoreticalWorkloadHours')
                ? normalizedUpdateData.theoreticalWorkloadHours
                : currentProgram.theoreticalWorkloadHours,
            practicalWorkloadHours: Object.prototype.hasOwnProperty.call(normalizedUpdateData, 'practicalWorkloadHours')
                ? normalizedUpdateData.practicalWorkloadHours
                : currentProgram.practicalWorkloadHours,
            totalWorkloadHours: Object.prototype.hasOwnProperty.call(normalizedUpdateData, 'totalWorkloadHours')
                ? normalizedUpdateData.totalWorkloadHours
                : currentProgram.totalWorkloadHours
        });

        const updatedProgram = await TechnicalProgram.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { $set: normalizedUpdateData },
            { new: true, runValidators: true }
        );

        if (!updatedProgram) {
            throw new Error('Programa técnico não encontrado para atualizar.');
        }

        return updatedProgram;
    }

    async inactivateTechnicalProgram(id, schoolId) {
        const program = await TechnicalProgram.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { status: 'Inativo' },
            { new: true, runValidators: true }
        );

        if (!program) {
            throw new Error('Programa técnico não encontrado para inativar.');
        }

        return program;
    }
}

module.exports = new TechnicalProgramService();
