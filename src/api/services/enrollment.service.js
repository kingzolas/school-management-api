// src/api/services/enrollment.service.js
const Enrollment = require('../models/enrollment.model');
const Student = require('../models/student.model');
const Class = require('../models/class.model');

const defaultPopulation = [
    { path: 'student', select: 'fullName birthDate' }, 
    { path: 'class', select: 'name schoolYear grade shift' } 
];

class EnrollmentService {

    /**
     * Cria uma nova matrícula, validando a posse das referências.
     */
    async createEnrollment(enrollmentData, schoolId) {
        const { studentId, classId, agreedFee } = enrollmentData;

        // 1. Validação de Segurança: Aluno e Turma devem pertencer à escola
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) throw new Error(`Aluno ${studentId} não encontrado ou não pertence a esta escola.`);
        
        const classDoc = await Class.findOne({ _id: classId, school_id: schoolId });
        if (!classDoc) throw new Error(`Turma ${classId} não encontrada ou não pertence a esta escola.`);

        // 2. Verifica se o aluno já está matriculado neste ano letivo (na mesma escola)
        const existingEnrollment = await Enrollment.findOne({
            student: studentId,
            academicYear: classDoc.schoolYear,
            school_id: schoolId // [CRÍTICO] Filtro de isolamento
        });
        if (existingEnrollment) {
            throw new Error(`Aluno ${student.fullName} já possui matrícula (${existingEnrollment.status}) no ano letivo ${classDoc.schoolYear}.`);
        }

        // 3. (Opcional) Verifica capacidade da turma
        if (classDoc.capacity) {
            const currentEnrollments = await Enrollment.countDocuments({ class: classId, status: 'Ativa', school_id: schoolId });
            if (currentEnrollments >= classDoc.capacity) {
                throw new Error(`Turma ${classDoc.name} (${classDoc.schoolYear}) atingiu a capacidade máxima de ${classDoc.capacity} alunos.`);
            }
        }

        // 4. Cria a matrícula
        const fee = agreedFee !== undefined && agreedFee !== null ? agreedFee : classDoc.monthlyFee;
        if (fee < 0) { throw new Error('A mensalidade acordada não pode ser negativa.'); }

        const newEnrollment = new Enrollment({
            student: studentId,
            class: classId,
            academicYear: classDoc.schoolYear,
            agreedFee: fee,
            school_id: schoolId // [CRÍTICO] Salva a referência da escola
        });

        await newEnrollment.save();
        await newEnrollment.populate(defaultPopulation);

        return newEnrollment;
    }

    /**
     * Busca matrículas com base em filtros, LIMITADO PELA ESCOLA.
     */
    async getEnrollments(filter = {}, schoolId) {
        // [CRÍTICO] Adiciona o filtro de escola
        const query = { ...filter, school_id: schoolId }; 
        const enrollments = await Enrollment.find(query).populate(defaultPopulation);
        return enrollments;
    }

    /**
     * Busca uma matrícula pelo ID, LIMITADO PELA ESCOLA.
     */
    async getEnrollmentById(id, schoolId) {
        // [CRÍTICO] Adiciona o filtro de escola
        const enrollment = await Enrollment.findOne({ _id: id, school_id: schoolId }).populate(defaultPopulation);
        
        if (!enrollment) {
            throw new Error(`Matrícula com ID ${id} não encontrada ou não pertence a esta escola.`);
        }
        return enrollment;
    }

    /**
     * Atualiza uma matrícula.
     */
    async updateEnrollment(id, updateData, schoolId) {
        // [AJUSTE] Mapeia 'classId' (do frontend) para 'class' (do modelo)
        if (updateData.classId) {
            updateData.class = updateData.classId;
            delete updateData.classId;
        }

        // [AJUSTE] Adicionado 'class' na lista de campos permitidos
        const allowedUpdates = ['agreedFee', 'status', 'observations', 'class']; 
        const updates = Object.keys(updateData);
        const isValidOperation = updates.every(update => allowedUpdates.includes(update));

        if (!isValidOperation) { throw new Error('Atualização inválida! Campos não permitidos.'); }
        if (updateData.agreedFee !== undefined && updateData.agreedFee < 0) { throw new Error('A mensalidade acordada não pode ser negativa.'); }
        
        // Garante que o school_id não pode ser alterado via body
        delete updateData.school_id;

        // [AJUSTE] Se estiver trocando de turma, valida se a nova turma existe
        if (updateData.class) {
            const newClassDoc = await Class.findOne({ _id: updateData.class, school_id: schoolId });
            if (!newClassDoc) {
                throw new Error(`Nova turma ${updateData.class} não encontrada ou não pertence a esta escola.`);
            }
            // Atualiza também o ano letivo para garantir consistência com a nova turma
            updateData.academicYear = newClassDoc.schoolYear;
        }

        const updatedEnrollment = await Enrollment.findOneAndUpdate(
            { _id: id, school_id: schoolId }, // [CRÍTICO] Query de segurança
            updateData, 
            { new: true, runValidators: true }
        ).populate(defaultPopulation); 

        if (!updatedEnrollment) {
            throw new Error(`Matrícula com ID ${id} não encontrada ou não pertence a esta escola para atualização.`);
        }
        return updatedEnrollment;
    }

    /**
     * Deleta (cancela) uma matrícula.
     */
    async deleteEnrollment(id, schoolId) {
        const deletedEnrollment = await Enrollment.findOneAndDelete({ _id: id, school_id: schoolId }); // [CRÍTICO] Query de segurança
        
        if (!deletedEnrollment) {
            throw new Error(`Matrícula com ID ${id} não encontrada ou não pertence a esta escola para deleção.`);
        }
        return deletedEnrollment;
    }
}

module.exports = new EnrollmentService();