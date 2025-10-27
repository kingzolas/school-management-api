const Enrollment = require('../models/enrollment.model');
const Student = require('../models/student.model');
const Class = require('../models/class.model');

// População padrão para retornar dados úteis ao frontend
const defaultPopulation = [
    { path: 'student', select: 'fullName birthDate' }, // Seleciona campos específicos do aluno
    { path: 'class', select: 'name schoolYear grade shift' } // Seleciona campos específicos da turma
];

class EnrollmentService {

    /**
     * Cria uma nova matrícula (matricula um aluno em uma turma).
     */
    async createEnrollment(enrollmentData) {
        const { studentId, classId, agreedFee } = enrollmentData;

        // 1. Valida se aluno e turma existem
        const student = await Student.findById(studentId);
        if (!student) throw new Error(`Aluno com ID ${studentId} não encontrado.`);
        const classDoc = await Class.findById(classId);
        if (!classDoc) throw new Error(`Turma com ID ${classId} não encontrada.`);

        // 2. Verifica se o aluno já está matriculado neste ano letivo
        const existingEnrollment = await Enrollment.findOne({
            student: studentId,
            academicYear: classDoc.schoolYear
        });
        if (existingEnrollment) {
            throw new Error(`Aluno ${student.fullName} já possui matrícula (${existingEnrollment.status}) no ano letivo ${classDoc.schoolYear}.`);
        }

        // 3. (Opcional) Verifica capacidade da turma
        if (classDoc.capacity) {
            const currentEnrollments = await Enrollment.countDocuments({ class: classId, status: 'Ativa' });
            if (currentEnrollments >= classDoc.capacity) {
                throw new Error(`Turma ${classDoc.name} (${classDoc.schoolYear}) atingiu a capacidade máxima de ${classDoc.capacity} alunos.`);
            }
        }

        // 4. Determina a mensalidade (usa a acordada ou a base da turma)
        const fee = agreedFee !== undefined && agreedFee !== null ? agreedFee : classDoc.monthlyFee;
        if (fee < 0) { // Validação extra
             throw new Error('A mensalidade acordada não pode ser negativa.');
        }

        // 5. Cria a matrícula
        const newEnrollment = new Enrollment({
            student: studentId,
            class: classId,
            academicYear: classDoc.schoolYear,
            agreedFee: fee,
            // enrollmentDate e status usam o default do schema
        });

        await newEnrollment.save();

        // 6. Popula os dados antes de retornar para o controller
        await newEnrollment.populate(defaultPopulation);

        return newEnrollment;
    }

    /**
     * Busca matrículas com base em filtros. Popula aluno e turma.
     * Ex: getEnrollments({ student: studentId })
     * Ex: getEnrollments({ class: classId, status: 'Ativa' })
     */
    async getEnrollments(filter = {}) {
        const enrollments = await Enrollment.find(filter).populate(defaultPopulation);
        return enrollments;
    }

    /**
     * Busca uma matrícula pelo ID. Popula aluno e turma.
     */
    async getEnrollmentById(id) {
        const enrollment = await Enrollment.findById(id).populate(defaultPopulation);
        if (!enrollment) {
            throw new Error(`Matrícula com ID ${id} não encontrada.`);
        }
        return enrollment;
    }

    /**
     * Atualiza uma matrícula (principalmente status ou mensalidade acordada).
     */
    async updateEnrollment(id, updateData) {
        // Validação simples para evitar campos não permitidos no update
        const allowedUpdates = ['agreedFee', 'status', 'observations']; // Adicione outros se necessário
        const updates = Object.keys(updateData);
        const isValidOperation = updates.every(update => allowedUpdates.includes(update));

        if (!isValidOperation) {
            throw new Error('Atualização inválida! Campos não permitidos.');
        }
         if (updateData.agreedFee !== undefined && updateData.agreedFee < 0) {
             throw new Error('A mensalidade acordada não pode ser negativa.');
         }

        const updatedEnrollment = await Enrollment.findByIdAndUpdate(id, updateData, {
            new: true,
            runValidators: true // Valida enums, etc.
        }).populate(defaultPopulation); // Popula o resultado

        if (!updatedEnrollment) {
            throw new Error(`Matrícula com ID ${id} não encontrada para atualização.`);
        }
        return updatedEnrollment;
    }

    /**
     * Deleta (cancela) uma matrícula.
     */
    async deleteEnrollment(id) {
        const deletedEnrollment = await Enrollment.findByIdAndDelete(id);
        if (!deletedEnrollment) {
            throw new Error(`Matrícula com ID ${id} não encontrada para deleção.`);
        }
        // Retorna o objeto deletado (sem população, pois já foi removido)
        return deletedEnrollment;
    }
}

module.exports = new EnrollmentService();