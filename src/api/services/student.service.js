// src/api/services/student.service.js
const mongoose = require('mongoose'); 
const Student = require('../models/student.model');
const Tutor = require('../models/tutor.model'); 
// [NOVO] Importamos o helper
const dbHelper = require('../../helpers/dbHelper'); 

const tutorPopulation = {
    path: 'tutors.tutorId', 
    model: 'Tutor', 
    select: '-students -__v' 
};

class StudentService {

    /**
     * Cria um novo aluno, GERA MATRÍCULA e salva FOTO.
     * [ALTERAÇÃO] Adicionado param 'user' para auditoria
     */
    async createStudent(studentData, schoolId, photoFile, user) {
        const { tutors: tutorsFromFlutter, ...studentInfo } = studentData; 
        
        // 1. Processamento da Imagem
        if (photoFile) {
            studentInfo.profilePicture = {
                data: photoFile.buffer,
                contentType: photoFile.mimetype
            };
        }

        const tutorsForStudentSchema = []; 

        // Lógica de Tutores (Mantida igual)
        if (tutorsFromFlutter && tutorsFromFlutter.length > 0) {
            for (const tutorData of tutorsFromFlutter) {
                const { relationship, ...tutorDetails } = tutorData;
                if (!relationship) continue; 

                let tutorDoc; 
                const tutorDataWithSchool = { ...tutorDetails, school_id: schoolId };

                // [NOTA] Se quisesse auditar a criação de tutores, passaria user aqui também
                if (tutorDetails.cpf) {
                    tutorDoc = await Tutor.findOne({ cpf: tutorDetails.cpf, school_id: schoolId });
                    if (tutorDoc) {
                        Object.assign(tutorDoc, tutorDataWithSchool);
                        await tutorDoc.save();
                    } else {
                        tutorDoc = new Tutor(tutorDataWithSchool);
                        await tutorDoc.save();
                    }
                } else {
                    tutorDoc = new Tutor(tutorDataWithSchool);
                    await tutorDoc.save();
                }
                
                tutorsForStudentSchema.push({
                    tutorId: tutorDoc._id,
                    relationship: relationship 
                });
            }
        } 
        
        // 2. Instancia o aluno
        const newStudent = new Student({
            ...studentInfo,
            tutors: tutorsForStudentSchema,
            school_id: schoolId 
        });

        // 3. Gera matrícula
        newStudent.enrollmentNumber = newStudent._id.toString().substring(0, 8).toUpperCase();

        // [AUDITORIA] Injetamos o usuário no documento antes de salvar
        // O Plugin vai ler essa propriedade '._user' para criar o log
        if (user) newStudent._user = user;

        await newStudent.save();

        // Atualiza os tutores
        await Tutor.updateMany(
            { _id: { $in: tutorsForStudentSchema.map(t => t.tutorId) } },
            { $addToSet: { students: newStudent._id } } 
        );

        // 4. Retorno leve
        const populatedStudent = await Student.findById(newStudent._id)
                                              .select('-profilePicture.data') 
                                              .populate(tutorPopulation);
        
        return populatedStudent;
    }

    // --- Métodos de Leitura (Não mudam, pois não geram log) ---

    async getAllStudents(schoolId) {
        return await Student.find({ school_id: schoolId })
                            .select('-profilePicture.data') 
                            .populate(tutorPopulation);
    }

    async getStudentById(id, schoolId) {
        const student = await Student.findOne({ _id: id, school_id: schoolId })
                                     .select('-profilePicture.data')
                                     .populate(tutorPopulation);
        if (!student) throw new Error('Aluno não encontrado.');
        return student;
    }

    async getStudentPhoto(id, schoolId) {
        const student = await Student.findOne({ _id: id, school_id: schoolId })
                                     .select('profilePicture');
        if (!student?.profilePicture?.data) throw new Error('Foto não encontrada.');
        return student.profilePicture; 
    }

    /**
     * Atualiza aluno.
     * [ALTERAÇÃO] Adicionado 'user' e 'reason'
     * [USO] Utiliza dbHelper.updateWithAudit
     */
    async updateStudent(id, studentData, schoolId, photoFile, user, reason) {
        
        const updatePayload = { ...studentData };

        if (photoFile) {
            updatePayload.profilePicture = {
                data: photoFile.buffer,
                contentType: photoFile.mimetype
            };
        }

        // [AUDITORIA] Usando o dbHelper
        // Assumindo que seu dbHelper foi ajustado para aceitar (Model, Query, Data, Options)
        // ou você chama o Model direto com as options se o helper for só para controllers.
        
        // Opção A: Chamada direta Mongoose (Mais limpa para Services)
        const updatedStudent = await Student.findOneAndUpdate(
            { _id: id, school_id: schoolId }, 
            updatePayload,                      
            { 
                new: true, 
                runValidators: true,
                user: user,     // Passa o contexto pro Plugin
                reason: reason  // Passa o motivo pro Plugin
            }
        )
        .select('-profilePicture.data')
        .populate(tutorPopulation);
        
        // Opção B: Se usar dbHelper.updateWithAudit(Student, id, data, req), 
        // você teria que passar 'req', o que suja o Service. 
        // Recomendo a Opção A acima para Services.

        if (!updatedStudent) {
            throw new Error('Aluno não encontrado ou não pertence a esta escola.');
        }
        return updatedStudent;
    }

    /**
     * Deleta aluno.
     * [ALTERAÇÃO] Adicionado 'user' e 'reason'
     */
    async deleteStudent(id, schoolId, user, reason) {
        // Primeiro buscamos para garantir que existe e pegar IDs dos tutores
        const student = await Student.findOne({ _id: id, school_id: schoolId });
        
        if (!student) throw new Error('Aluno não encontrado.');
        
        const tutorIds = student.tutors.map(t => t.tutorId);
        
        // [AUDITORIA] Usamos findOneAndDelete passando as options
        // O Plugin deve ter um hook para 'findOneAndDelete' para isso funcionar 100%
        // Se o plugin só tiver 'save' e 'update', o delete não gera log automático.
        // Assumindo que adicionamos o hook de delete no plugin:
        await Student.findOneAndDelete(
            { _id: id }, 
            { user: user, reason: reason } // Passa contexto
        ); 
        
        await Tutor.updateMany(
            { _id: { $in: tutorIds } },
            { $pull: { students: student._id } } 
        );
        return student; 
    }

    // --- MÉTODOS AUXILIARES ---

    async getUpcomingBirthdays(schoolId) {
        // ... (Código mantido idêntico - Apenas leitura) ...
        const { ObjectId } = mongoose.Types; 
        try {
            const sortedStudentInfos = await Student.aggregate([
                { $match: { school_id: new ObjectId(schoolId) } },
                { $addFields: { "__todayDayOfYear": { $dayOfYear: new Date() }, "__birthdayDayOfYear": { $dayOfYear: "$birthDate" } } },
                { $addFields: { "__diff": { $subtract: [ "$__birthdayDayOfYear", "$__todayDayOfYear" ] } } },
                { $addFields: { "sortKey": { $cond: { if: { $lt: ["$__diff", 0] }, then: { $add: ["$__diff", 366] }, else: "$__diff" } } } },
                { $sort: { "sortKey": 1 } },
                { $project: { _id: 1 } } 
            ]);

            const sortedIds = sortedStudentInfos.map(info => info._id);
            if (sortedIds.length === 0) return []; 

            const populatedStudents = await Student.find({ 
                _id: { $in: sortedIds },
                school_id: schoolId 
            })
            .select('-profilePicture.data') 
            .populate(tutorPopulation); 

            const studentMap = new Map(populatedStudents.map(student => [student._id.toString(), student]));
            return sortedIds.map(id => studentMap.get(id.toString())).filter(student => student != null); 
        } catch (error) {
            throw new Error('Erro ao processar busca de aniversariantes');
        }
    }

    /**
     * Atualiza relacionamento com tutor.
     * [ALTERAÇÃO] Adicionado 'user' para logar a mudança no histórico
     */
    async updateTutorRelationship(studentId, tutorId, newRelationship, schoolId, user) {
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) throw new Error('Aluno não encontrado.');

        const tutorLink = student.tutors.find(t => t.tutorId.toString() === tutorId);
        if (!tutorLink) throw new Error('Vínculo não encontrado.');

        tutorLink.relationship = newRelationship;

        // [AUDITORIA] Injeta user antes de salvar
        if (user) student._user = user;
        
        // Como estamos usando .save(), o plugin vai comparar o student carregado com o novo
        // Atenção: O plugin precisa da lógica de "pre('save')" ou "pre('validate')" correta 
        // para detectar mudanças em subdocumentos arrays, o que pode ser complexo.
        // Mas o log de "UPDATE" na entidade Student será gerado.
        await student.save();

        // ... (restante da lógica de retorno mantida)
        const studentObj = student.toObject();
        if(studentObj.profilePicture) delete studentObj.profilePicture.data;
        
        // Re-popula para retorno
        await student.populate(tutorPopulation);
        
        const populatedTutors = student.tutors.map(link => ({
            relationship: link.relationship,
            tutorInfo: link.tutorId 
        }));
        
        const updatedPopulatedLink = populatedTutors.find(
             (t) => t.tutorInfo._id.toString() === tutorId
        );

        return { updatedLink: updatedPopulatedLink, student: studentObj }; 
    }

    // [ALTERAÇÃO] user adicionado em todos os métodos de histórico
    async addHistoryRecord(studentId, recordData, schoolId, user) {
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) throw new Error('Aluno não encontrado.');

        student.academicHistory.push(recordData);
        
        if (user) student._user = user; // Auditoria
        await student.save();
        
        const result = student.toObject();
        if(result.profilePicture) delete result.profilePicture.data;
        return result; 
    }

    async updateHistoryRecord(studentId, recordId, updatedData, schoolId, user) {
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) throw new Error('Aluno não encontrado.');

        const record = student.academicHistory.id(recordId);
        if (!record) throw new Error('Registro não encontrado.');

        Object.assign(record, updatedData);
        
        if (user) student._user = user; // Auditoria
        await student.save();
        
        const result = student.toObject();
        if(result.profilePicture) delete result.profilePicture.data;
        return result; 
    }

    async deleteHistoryRecord(studentId, recordId, schoolId, user) {
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) throw new Error('Aluno não encontrado.');

        student.academicHistory.pull(recordId);
        
        if (user) student._user = user; // Auditoria
        await student.save();
        
        const result = student.toObject();
        if(result.profilePicture) delete result.profilePicture.data;
        return result; 
    }
    
    // Contagem (Leitura apenas, sem user)
    async getCountByAgeAndBirthday(minAge, maxAge, birthdayMonth, schoolId) {
       // ... (Código mantido idêntico) ...
       const today = new Date();
       today.setHours(0, 0, 0, 0); 
       const latestBirthDate = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
       const earliestBirthDate = new Date(today.getFullYear() - (maxAge + 1), today.getMonth(), today.getDate() + 1);
   
       const query = {
           school_id: schoolId,
           birthDate: { $gte: earliestBirthDate, $lte: latestBirthDate },
           isActive: true, 
           $expr: { $eq: [{ $month: '$birthDate' }, birthdayMonth] },
       };
       return await Student.countDocuments(query);
    }
}

module.exports = new StudentService();