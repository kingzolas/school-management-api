// src/api/services/subject.service.js
const Subject = require('../models/subject.model');
const StaffProfile = require('../models/staffProfile.model');
const Horario = require('../models/horario.model');

const idString = (value) => {
    if (!value) return '';
    if (value._id) return String(value._id);
    return String(value);
};

class SubjectService {

    /**
     * Cria uma nova disciplina vinculada a uma escola.
     */
    async createSubject(subjectData, schoolId) {
        try {
            const newSubject = new Subject({
                ...subjectData,
                school_id: schoolId // Força o ID da escola
            });
            await newSubject.save();
            return newSubject;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`A disciplina '${subjectData.name}' já existe nesta escola.`);
            }
            throw error;
        }
    }

    /**
     * Busca todas as disciplinas de uma escola específica com filtros opcionais.
     */
    async getAllSubjects(filter = {}, schoolId) {
        // Garante que só busque dados da escola do usuário
        const query = { ...filter, school_id: schoolId };
        return await Subject.find(query).sort({ level: 1, name: 1 });
    }

    /**
     * Busca uma disciplina por ID e Escola (segurança extra).
     */
    async getSubjectById(id, schoolId) {
        const subject = await Subject.findOne({ _id: id, school_id: schoolId });
        
        if (!subject) {
            throw new Error('Disciplina não encontrada ou você não tem permissão para acessá-la.');
        }
        return subject;
    }

    async getManagementSummary(filter = {}, schoolId) {
        const subjects = await this.getAllSubjects(filter, schoolId);
        const subjectIds = subjects.map((subject) => subject._id);

        const [staffProfiles, horarios] = await Promise.all([
            StaffProfile.find({ enabledSubjects: { $in: subjectIds } })
                .populate('user', 'fullName name email roles')
                .populate('enabledSubjects', 'name level')
                .lean(),
            Horario.find({ school_id: schoolId, subjectId: { $in: subjectIds } })
                .populate('classId', 'name gradeName level')
                .populate('teacherId', 'fullName name')
                .populate('termId', 'titulo name')
                .lean(),
        ]);

        const teachersBySubject = new Map();
        for (const profile of staffProfiles) {
            const user = profile.user || {};
            const teacher = {
                id: idString(user),
                name: user.fullName || user.name || user.email || 'Professor sem nome',
                mainRole: profile.mainRole || '',
            };

            for (const enabledSubject of profile.enabledSubjects || []) {
                const subjectId = idString(enabledSubject);
                if (!subjectId) continue;
                const list = teachersBySubject.get(subjectId) || [];
                if (!list.some((item) => item.id === teacher.id)) {
                    list.push(teacher);
                }
                teachersBySubject.set(subjectId, list);
            }
        }

        const classesBySubject = new Map();
        for (const horario of horarios) {
            const subjectId = idString(horario.subjectId);
            if (!subjectId) continue;

            const classId = idString(horario.classId);
            const teacherId = idString(horario.teacherId);
            const entry = {
                classId,
                className: horario.classId?.name || horario.classId?.gradeName || 'Turma sem nome',
                teacherId,
                teacherName: horario.teacherId?.fullName || horario.teacherId?.name || '',
                termId: idString(horario.termId),
                termName: horario.termId?.titulo || horario.termId?.name || '',
            };

            const list = classesBySubject.get(subjectId) || [];
            if (!list.some((item) =>
                item.classId === entry.classId &&
                item.teacherId === entry.teacherId &&
                item.termId === entry.termId
            )) {
                list.push(entry);
            }
            classesBySubject.set(subjectId, list);
        }

        return subjects.map((subject) => {
            const subjectId = idString(subject);
            const teachers = teachersBySubject.get(subjectId) || [];
            const linkedClasses = classesBySubject.get(subjectId) || [];

            return {
                _id: subjectId,
                name: subject.name,
                level: subject.level,
                school_id: idString(subject.school_id),
                status: 'Ativa',
                teachers,
                teachersCount: teachers.length,
                linkedClasses,
                classesCount: new Set(linkedClasses.map((item) => item.classId)).size,
                evaluationConfig: {
                    usesTest: true,
                    usesActivity: true,
                    usesParticipation: true,
                    allowsPracticalEvaluation: subject.name?.toLowerCase?.().includes('educa') &&
                        subject.name?.toLowerCase?.().includes('física'),
                    allowsConcept: false,
                    weightsConfigured: false,
                    averageRule: 'Soma dos componentes limitada a 10',
                },
                createdAt: subject.createdAt,
                updatedAt: subject.updatedAt,
            };
        });
    }

    /**
     * Atualiza uma disciplina.
     */
    async updateSubject(id, updateData, schoolId) {
        // Verificação de duplicidade manual para update (scopada por escola)
        if (updateData.name) {
            const existing = await Subject.findOne({ 
                name: updateData.name, 
                school_id: schoolId, 
                _id: { $ne: id } 
            });
            if (existing) {
                throw new Error(`A disciplina '${updateData.name}' já existe nesta escola.`);
            }
        }
        
        // Impede que o usuário mude a disciplina de escola via update
        delete updateData.school_id; 

        const updatedSubject = await Subject.findOneAndUpdate(
            { _id: id, school_id: schoolId }, // Query de segurança
            updateData,
            { new: true, runValidators: true }
        );

        if (!updatedSubject) {
            throw new Error('Disciplina não encontrada para atualizar.');
        }
        return updatedSubject;
    }

    /**
     * Deleta uma disciplina.
     */
    async deleteSubject(id, schoolId) {
        // 1. Verifica se a disciplina existe e pertence à escola
        const subject = await Subject.findOne({ _id: id, school_id: schoolId });
        if (!subject) {
            throw new Error('Disciplina não encontrada para deletar.');
        }

        // 2. Regra de Negócio: Verifica uso em StaffProfile
        // Nota: StaffProfile também deve ter school_id, mas o ID da disciplina já é único globalmente.
        const usageCount = await StaffProfile.countDocuments({ enabledSubjects: id });

        if (usageCount > 0) {
            throw new Error(`Não é possível excluir. Esta disciplina está habilitada para ${usageCount} funcionário(s).`);
        }

        await Subject.findByIdAndDelete(id);
        return subject;
    }

    /**
     * Cria múltiplas disciplinas (em lote) para uma escola específica.
     */
    async createMultipleSubjects(subjectsData, schoolId) {
        if (!Array.isArray(subjectsData) || subjectsData.length === 0) {
            throw new Error('Dados de entrada inválidos.');
        }

        // Injeta o school_id em todos os objetos do array
        const subjectsWithSchool = subjectsData.map(sub => ({
            ...sub,
            school_id: schoolId
        }));

        let createdSubjects = [];

        try {
            createdSubjects = await Subject.insertMany(subjectsWithSchool, { ordered: false });
            return createdSubjects;

        } catch (error) {
            if (error.name === 'MongoBulkWriteError' && error.code === 11000) {
                console.warn('Aviso de BulkWrite: Duplicatas ignoradas para esta escola.');
                
                if (error.result && error.result.insertedIds && error.result.insertedIds.length > 0) {
                    const insertedIds = error.result.insertedIds.map(doc => doc._id);
                    createdSubjects = await Subject.find({ _id: { $in: insertedIds } });
                    return createdSubjects; 
                } 
                
                return []; 
            }
            
            console.error("Erro no insertMany:", error);
            throw new Error(`Erro ao inserir disciplinas: ${error.message}`);
        }
    }
}

module.exports = new SubjectService();
