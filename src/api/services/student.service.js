// src/api/services/student.service.js
const mongoose = require('mongoose'); 
const Student = require('../models/student.model');
const Tutor = require('../models/tutor.model'); 

const tutorPopulation = {
    path: 'tutors.tutorId', 
    model: 'Tutor', 
    select: '-students -__v' 
};

class StudentService {

    /**
     * Cria um novo aluno, GERA MATRÍCULA e salva FOTO (se enviada).
     * @param {object} studentData - Dados do corpo da requisição
     * @param {string} schoolId - ID da escola
     * @param {object} photoFile - Arquivo de foto vindo do Multer (opcional)
     */
    async createStudent(studentData, schoolId, photoFile) {
        const { tutors: tutorsFromFlutter, ...studentInfo } = studentData; 
        
        // 1. Processamento da Imagem (se houver)
        if (photoFile) {
            studentInfo.profilePicture = {
                data: photoFile.buffer,
                contentType: photoFile.mimetype
            };
        }

        const tutorsForStudentSchema = []; 

        // Lógica de Tutores
        if (tutorsFromFlutter && tutorsFromFlutter.length > 0) {
            for (const tutorData of tutorsFromFlutter) {
                const { relationship, ...tutorDetails } = tutorData;
                if (!relationship) continue; 

                let tutorDoc; 
                const tutorDataWithSchool = { ...tutorDetails, school_id: schoolId };

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

        // 3. Gera matrícula (8 primeiros caracteres do ID em uppercase)
        newStudent.enrollmentNumber = newStudent._id.toString().substring(0, 8).toUpperCase();

        await newStudent.save();

        // Atualiza os tutores
        await Tutor.updateMany(
            { _id: { $in: tutorsForStudentSchema.map(t => t.tutorId) } },
            { $addToSet: { students: newStudent._id } } 
        );

        // 4. Busca o aluno populado e SEM O BUFFER DA FOTO para retorno leve
        const populatedStudent = await Student.findById(newStudent._id)
                                              .select('-profilePicture.data') 
                                              .populate(tutorPopulation);
        
        return populatedStudent;
    }

    /**
     * Busca todos os alunos SEM o binário da foto (Performance).
     */
    async getAllStudents(schoolId) {
        const students = await Student.find({ school_id: schoolId })
                                      .select('-profilePicture.data') 
                                      .populate(tutorPopulation);
        return students;
    }

    /**
     * Busca um aluno por ID SEM o binário da foto.
     */
    async getStudentById(id, schoolId) {
        const student = await Student.findOne({ _id: id, school_id: schoolId })
                                     .select('-profilePicture.data')
                                     .populate(tutorPopulation);
        if (!student) {
             throw new Error('Aluno não encontrado ou não pertence a esta escola.');
        }
        return student;
    }

    /**
     * Método específico para buscar APENAS a foto (Lazy Loading).
     */
    async getStudentPhoto(id, schoolId) {
        const student = await Student.findOne({ _id: id, school_id: schoolId })
                                     .select('profilePicture');
        
        if (!student || !student.profilePicture || !student.profilePicture.data) {
            throw new Error('Foto não encontrada.');
        }
        return student.profilePicture; // Retorna { data, contentType }
    }

    /**
     * Atualiza aluno e permite atualizar a foto.
     */
    async updateStudent(id, studentData, schoolId, photoFile) {
        
        const updatePayload = { ...studentData };

        // Se veio arquivo novo, atualiza a estrutura da foto
        if (photoFile) {
            updatePayload.profilePicture = {
                data: photoFile.buffer,
                contentType: photoFile.mimetype
            };
        }

        const updatedStudent = await Student.findOneAndUpdate(
            { _id: id, school_id: schoolId }, 
            updatePayload,                      
            { 
                new: true, 
                runValidators: true 
            }
        )
        .select('-profilePicture.data') // Não retorna o binário na resposta do update
        .populate(tutorPopulation); 
        
        if (!updatedStudent) {
            throw new Error('Aluno não encontrado ou não pertence a esta escola.');
        }
        return updatedStudent;
    }

    async deleteStudent(id, schoolId) {
        const student = await Student.findOne({ _id: id, school_id: schoolId });
        if (!student) {
             throw new Error('Aluno não encontrado ou não pertence a esta escola.');
        }
        
        const tutorIds = student.tutors.map(t => t.tutorId);
        
        await Student.findByIdAndDelete(id); 
        
        await Tutor.updateMany(
            { _id: { $in: tutorIds } },
            { $pull: { students: student._id } } 
        );
        return student; 
    }

    // --- MÉTODOS AUXILIARES (Aniversários, Histórico, Count) ---

    async getUpcomingBirthdays(schoolId) {
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

            // Busca os alunos ordenados, SEM A FOTO PESADA
            const populatedStudents = await Student.find({ 
                _id: { $in: sortedIds },
                school_id: schoolId 
            })
            .select('-profilePicture.data') 
            .populate(tutorPopulation); 

            const studentMap = new Map(populatedStudents.map(student => [student._id.toString(), student]));
            const correctlySortedStudents = sortedIds.map(id => studentMap.get(id.toString())).filter(student => student != null); 

            return correctlySortedStudents;
        } catch (error) {
            console.error("Erro na busca de aniversariantes:", error);
            throw new Error('Erro ao processar busca de aniversariantes');
        }
    }

    async updateTutorRelationship(studentId, tutorId, newRelationship, schoolId) {
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        
        if (!student) {
            throw new Error('Aluno não encontrado ou não pertence a esta escola.');
        }

        const tutorLink = student.tutors.find(
            (t) => t.tutorId.toString() === tutorId
        );

        if (!tutorLink) {
            throw new Error('Vínculo com tutor não encontrado no aluno.');
        }

        tutorLink.relationship = newRelationship;
        await student.save();

        const studentObj = student.toObject();
        if(studentObj.profilePicture) delete studentObj.profilePicture.data;

        await student.populate({
            path: 'tutors.tutorId',
            model: 'Tutor' 
        });
        
        const populatedTutors = student.tutors.map(link => ({
            relationship: link.relationship,
            tutorInfo: link.tutorId 
        }));
        
        const updatedPopulatedLink = populatedTutors.find(
             (t) => t.tutorInfo._id.toString() === tutorId
        );

        return { 
            updatedLink: updatedPopulatedLink, 
            student: studentObj 
        }; 
    }

    async addHistoryRecord(studentId, recordData, schoolId) {
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) throw new Error('Aluno não encontrado ou não pertence a esta escola.');

        student.academicHistory.push(recordData);
        await student.save();
        
        const result = student.toObject();
        if(result.profilePicture) delete result.profilePicture.data;
        return result; 
    }

    async updateHistoryRecord(studentId, recordId, updatedData, schoolId) {
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) throw new Error('Aluno não encontrado ou não pertence a esta escola.');

        const record = student.academicHistory.id(recordId);
        if (!record) throw new Error('Registro acadêmico não encontrado.');

        Object.assign(record, updatedData);
        await student.save();
        
        const result = student.toObject();
        if(result.profilePicture) delete result.profilePicture.data;
        return result; 
    }

    async deleteHistoryRecord(studentId, recordId, schoolId) {
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) throw new Error('Aluno não encontrado ou não pertence a esta escola.');

        student.academicHistory.pull(recordId);
        await student.save();
        
        const result = student.toObject();
        if(result.profilePicture) delete result.profilePicture.data;
        return result; 
    }
    
    async getCountByAgeAndBirthday(minAge, maxAge, birthdayMonth, schoolId) {
        const today = new Date();
        today.setHours(0, 0, 0, 0); 
    
        const latestBirthDate = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
        const earliestBirthDate = new Date(today.getFullYear() - (maxAge + 1), today.getMonth(), today.getDate() + 1);
    
        const query = {
            school_id: schoolId,
            birthDate: {
                $gte: earliestBirthDate,
                $lte: latestBirthDate,
            },
            isActive: true, 
            $expr: {
                $eq: [{ $month: '$birthDate' }, birthdayMonth],
            },
        };
    
        try {
            const count = await Student.countDocuments(query);
            return count;
        } catch (error) {
            console.error('[StudentService] Erro ao contar alunos:', error);
            throw new Error('Falha ao consultar banco de dados de alunos.');
        }
    }
}

module.exports = new StudentService();