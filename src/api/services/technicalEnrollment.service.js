const TechnicalEnrollment = require('../models/technicalEnrollment.model');
const Student = require('../models/student.model');
const Company = require('../models/company.model');
const TechnicalProgram = require('../models/technicalProgram.model');
const Class = require('../models/class.model');

const defaultPopulation = [
    { path: 'studentId', select: 'fullName birthDate cpf' },
    { path: 'companyId', select: 'name legalName cnpj' },
    { path: 'technicalProgramId', select: 'name totalWorkloadHours' },
    { path: 'currentClassId', select: 'name schoolYear grade shift' }
];

const hasValue = (value) => value !== undefined && value !== null && value !== '';

class TechnicalEnrollmentService {
    async createTechnicalEnrollment(enrollmentData, schoolId) {
        const {
            studentId,
            companyId,
            technicalProgramId,
            currentClassId
        } = enrollmentData;

        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) {
            throw new Error(`Participante ${studentId} não encontrado ou não pertence a esta escola.`);
        }

        const company = await Company.findOne({ _id: companyId, school_id: schoolId });
        if (!company) {
            throw new Error(`Empresa ${companyId} não encontrada ou não pertence a esta escola.`);
        }

        const technicalProgram = await TechnicalProgram.findOne({
            _id: technicalProgramId,
            school_id: schoolId
        });
        if (!technicalProgram) {
            throw new Error(`Programa técnico ${technicalProgramId} não encontrado ou não pertence a esta escola.`);
        }

        if (hasValue(currentClassId)) {
            const currentClass = await Class.findOne({ _id: currentClassId, school_id: schoolId });
            if (!currentClass) {
                throw new Error(`Turma ${currentClassId} não encontrada ou não pertence a esta escola.`);
            }
        }

        const existingEnrollment = await TechnicalEnrollment.findOne({
            studentId,
            technicalProgramId,
            school_id: schoolId
        });
        if (existingEnrollment) {
            throw new Error(`O participante ${student.fullName} já possui matrícula técnica neste programa.`);
        }

        try {
            const newEnrollment = new TechnicalEnrollment({
                ...enrollmentData,
                currentClassId: hasValue(currentClassId) ? currentClassId : null,
                status: enrollmentData.status || (hasValue(currentClassId) ? 'Ativa' : 'Pendente'),
                school_id: schoolId
            });

            await newEnrollment.save();
            await newEnrollment.populate(defaultPopulation);

            return newEnrollment;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`Já existe uma matrícula técnica para este participante neste programa.`);
            }
            throw error;
        }
    }

    async getAllTechnicalEnrollments(filter = {}, schoolId) {
        const query = { ...filter };
        delete query.school_id;

        return await TechnicalEnrollment.find({
            ...query,
            school_id: schoolId
        })
            .populate(defaultPopulation)
            .sort({ createdAt: -1 });
    }

    async getTechnicalEnrollmentById(id, schoolId) {
        const enrollment = await TechnicalEnrollment.findOne({
            _id: id,
            school_id: schoolId
        }).populate(defaultPopulation);

        if (!enrollment) {
            throw new Error('Matrícula técnica não encontrada ou não pertence a esta escola.');
        }

        return enrollment;
    }

    async updateTechnicalEnrollment(id, updateData, schoolId) {
        delete updateData.school_id;

        const currentEnrollment = await TechnicalEnrollment.findOne({
            _id: id,
            school_id: schoolId
        });

        if (!currentEnrollment) {
            throw new Error('Matrícula técnica não encontrada para atualizar.');
        }

        if (updateData.studentId) {
            const student = await Student.findOne({
                _id: updateData.studentId,
                school_id: schoolId
            });

            if (!student) {
                throw new Error(`Participante ${updateData.studentId} não encontrado ou não pertence a esta escola.`);
            }
        }

        if (updateData.companyId) {
            const company = await Company.findOne({
                _id: updateData.companyId,
                school_id: schoolId
            });

            if (!company) {
                throw new Error(`Empresa ${updateData.companyId} não encontrada ou não pertence a esta escola.`);
            }
        }

        if (updateData.technicalProgramId) {
            const technicalProgram = await TechnicalProgram.findOne({
                _id: updateData.technicalProgramId,
                school_id: schoolId
            });

            if (!technicalProgram) {
                throw new Error(`Programa técnico ${updateData.technicalProgramId} não encontrado ou não pertence a esta escola.`);
            }
        }

        if (Object.prototype.hasOwnProperty.call(updateData, 'currentClassId')) {
            if (hasValue(updateData.currentClassId)) {
                const currentClass = await Class.findOne({
                    _id: updateData.currentClassId,
                    school_id: schoolId
                });

                if (!currentClass) {
                    throw new Error(`Turma ${updateData.currentClassId} não encontrada ou não pertence a esta escola.`);
                }
            }

            if (!Object.prototype.hasOwnProperty.call(updateData, 'status')) {
                updateData.status = hasValue(updateData.currentClassId) ? 'Ativa' : 'Pendente';
            }
        }

        const nextStudentId = updateData.studentId || currentEnrollment.studentId;
        const nextTechnicalProgramId = updateData.technicalProgramId || currentEnrollment.technicalProgramId;

        const existingEnrollment = await TechnicalEnrollment.findOne({
            _id: { $ne: id },
            studentId: nextStudentId,
            technicalProgramId: nextTechnicalProgramId,
            school_id: schoolId
        });

        if (existingEnrollment) {
            throw new Error('Já existe outra matrícula técnica para este participante neste programa.');
        }

        const updatedEnrollment = await TechnicalEnrollment.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate(defaultPopulation);

        if (!updatedEnrollment) {
            throw new Error('Matrícula técnica não encontrada para atualizar.');
        }

        return updatedEnrollment;
    }
}

module.exports = new TechnicalEnrollmentService();
