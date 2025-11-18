// src/api/services/student.service.js
const mongoose = require('mongoose'); // Necessário para o ObjectId na agregação
const Student = require('../models/student.model');
const Tutor = require('../models/tutor.model'); 

const tutorPopulation = {
    path: 'tutors.tutorId', 
    model: 'Tutor', 
    select: '-students -__v' 
};


class StudentService {

    /**
     * [MODIFICADO] Cria um novo aluno, agora vinculado ao schoolId.
     * Também filtra a busca/criação de tutores pelo schoolId.
     */
    async createStudent(studentData, schoolId) {
        const { tutors: tutorsFromFlutter, ...studentInfo } = studentData; 
        
        const tutorsForStudentSchema = []; 

        if (tutorsFromFlutter && tutorsFromFlutter.length > 0) {
            
            for (const tutorData of tutorsFromFlutter) {
                
                const { relationship, ...tutorDetails } = tutorData;

                if (!relationship) {
                    console.warn("Pulando tutor sem 'relationship' (parentesco).");
                    continue; 
                }

                let tutorDoc; 

                // [NOVO] Adiciona o schoolId aos dados do tutor para criação
                const tutorDataWithSchool = { ...tutorDetails, school_id: schoolId };

                if (tutorDetails.cpf) {
                    // [MODIFICADO] Busca o tutor POR CPF E POR ESCOLA
                    tutorDoc = await Tutor.findOne({ cpf: tutorDetails.cpf, school_id: schoolId });
                    
                    if (tutorDoc) {
                        Object.assign(tutorDoc, tutorDataWithSchool);
                        await tutorDoc.save();
                    } else {
                        // Cria o novo tutor já com o school_id
                        tutorDoc = new Tutor(tutorDataWithSchool);
                        await tutorDoc.save();
                    }
                } else {
                    console.warn(`Tutor ${tutorDetails.fullName || 'sem nome'} sendo criado SEM CPF.`);
                    // Cria o novo tutor já com o school_id
                    tutorDoc = new Tutor(tutorDataWithSchool);
                    await tutorDoc.save();
                }
                
                tutorsForStudentSchema.push({
                    tutorId: tutorDoc._id,
                    relationship: relationship 
                });
            }
        } 
        
        // [MODIFICADO] Cria o novo aluno com o school_id
        const newStudent = new Student({
            ...studentInfo,
            tutors: tutorsForStudentSchema,
            school_id: schoolId // <<< O "CARIMBO" DA ESCOLA
        });

        await newStudent.save();

        // Atualiza os tutores (inalterado, já está correto)
        await Tutor.updateMany(
            { _id: { $in: tutorsForStudentSchema.map(t => t.tutorId) } },
            { $addToSet: { students: newStudent._id } } 
        );

        // Busca o aluno recém-criado (findById é seguro pois acabamos de criar)
        const populatedStudent = await Student.findById(newStudent._id)
                                              .populate(tutorPopulation);
        
        return populatedStudent;
    }

    /**
     * [MODIFICADO] Busca todos os alunos FILTRADOS POR ESCOLA.
     */
    async getAllStudents(schoolId) {
        // [MODIFICADO] Adiciona o filtro { school_id: schoolId }
        const students = await Student.find({ school_id: schoolId })
                                      .populate(tutorPopulation);
        return students;
    }

    /**
     * [MODIFICADO] Busca um aluno por ID, garantindo que ele pertença à escola.
     */
    async getStudentById(id, schoolId) {
        // [MODIFICADO] Troca findById por findOne com filtro de _id E school_id
        const student = await Student.findOne({ _id: id, school_id: schoolId })
                                     .populate(tutorPopulation);
        if (!student) {
             throw new Error('Aluno não encontrado ou não pertence a esta escola.');
        }
        return student;
    }

    /**
     * [MODIFICADO] Atualiza um aluno por ID, garantindo que ele pertença à escola.
     */
    async updateStudent(id, studentData, schoolId) {
        // [MODIFICADO] Usa findOneAndUpdate para garantir a checagem do school_id
        const updatedStudent = await Student.findOneAndUpdate(
            { _id: id, school_id: schoolId }, // Condição de busca
            studentData,                      // Dados da atualização
            { 
                new: true, // Retorna o documento atualizado
                runValidators: true // Roda os validadores do schema
            }
        ).populate(tutorPopulation); 
        
        if (!updatedStudent) {
            throw new Error('Aluno não encontrado ou não pertence a esta escola.');
        }
        return updatedStudent;
    }

    /**
     * [MODIFICADO] Deleta um aluno por ID, garantindo que ele pertença à escola.
     */
    async deleteStudent(id, schoolId) {
        // [MODIFICADO] Busca com findOne para checar a escola
        const student = await Student.findOne({ _id: id, school_id: schoolId });
        if (!student) {
             throw new Error('Aluno não encontrado ou não pertence a esta escola.');
        }
        
        const tutorIds = student.tutors.map(t => t.tutorId);
        
        // Deleta o aluno
        await Student.findByIdAndDelete(id); // Seguro, pois já verificamos o schoolId
        
        // Atualiza os tutores (inalterado)
        await Tutor.updateMany(
            { _id: { $in: tutorIds } },
            { $pull: { students: student._id } } 
        );
        return student; // Retorna o aluno que foi deletado
    }

    /**
     * [MODIFICADO] Busca aniversariantes FILTRADOS POR ESCOLA.
     */
    async getUpcomingBirthdays(schoolId) {
        const { ObjectId } = mongoose.Types; // Importa o construtor ObjectId

        try {
            // [MODIFICADO] Adiciona um $match no início do pipeline
            const sortedStudentInfos = await Student.aggregate([
                {
                    // FILTRO DE ESCOLA: Garante que só buscamos da escola certa
                    $match: { school_id: new ObjectId(schoolId) }
                },
                {
                    $addFields: {
                        "__todayDayOfYear": { $dayOfYear: new Date() },
                        "__birthdayDayOfYear": { $dayOfYear: "$birthDate" } 
                    }
                },
                {
                    $addFields: {
                        "__diff": { $subtract: [ "$__birthdayDayOfYear", "$__todayDayOfYear" ] }
                    }
                },
                {
                    $addFields: {
                        "sortKey": {
                            $cond: {
                                if: { $lt: ["$__diff", 0] },
                                then: { $add: ["$__diff", 366] },
                                else: "$__diff"
                            }
                        }
                    }
                },
                { $sort: { "sortKey": 1 } },
                { $project: { _id: 1 } } 
            ]);

            const sortedIds = sortedStudentInfos.map(info => info._id);

            if (sortedIds.length === 0) {
                return []; 
            }

            // [MODIFICADO] Adiciona filtro de school_id também no find (redundância segura)
            const populatedStudents = await Student.find({ 
                _id: { $in: sortedIds },
                school_id: schoolId // Garante a segurança
            }).populate(tutorPopulation); 

            // Reordenação (inalterada)
            const studentMap = new Map(populatedStudents.map(student => [student._id.toString(), student]));
            const correctlySortedStudents = sortedIds.map(id => studentMap.get(id.toString())).filter(student => student != null); 

            return correctlySortedStudents;

        } catch (error) {
            console.error("Erro na busca/população de aniversariantes (ordenado):", error);
            throw new Error('Erro ao processar busca de aniversariantes');
        }
    }

    /**
     * [MODIFICADO] Atualiza relacionamento, garantindo que o aluno pertença à escola.
     */
    async updateTutorRelationship(studentId, tutorId, newRelationship, schoolId) {
        try {
            console.log(`[SERVICE] Atualizando relacionamento: Aluno ${studentId}, Tutor ${tutorId}`);
            
            // [MODIFICADO] Busca o aluno com o escopo da escola
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

            // Lógica de população (inalterada)
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

            return updatedPopulatedLink; 

        } catch (error) {
            console.error(`Erro no service ao ATUALIZAR relacionamento:`, error.message);
            throw new Error(`Erro ao atualizar relacionamento: ${error.message}`);
        }
    }

    /**
     * [MODIFICADO] Adiciona registro de histórico, garantindo que o aluno pertença à escola.
     */
    async addHistoryRecord(studentId, recordData, schoolId) {
        // [MODIFICADO] Busca o aluno com o escopo da escola
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) {
            throw new Error('Aluno não encontrado ou não pertence a esta escola.');
        }

        student.academicHistory.push(recordData);
        await student.save();
        return student; 
    }

    /**
     * [MODIFICADO] Atualiza registro de histórico, garantindo que o aluno pertença à escola.
     */
    async updateHistoryRecord(studentId, recordId, updatedData, schoolId) {
        // [MODIFICADO] Busca o aluno com o escopo da escola
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) {
            throw new Error('Aluno não encontrado ou não pertence a esta escola.');
        }

        const record = student.academicHistory.id(recordId);
        if (!record) {
            throw new Error('Registro acadêmico não encontrado.');
        }

        Object.assign(record, updatedData);
        await student.save();
        return student;
    }

    /**
     * [MODIFICADO] Deleta registro de histórico, garantindo que o aluno pertença à escola.
     */
    async deleteHistoryRecord(studentId, recordId, schoolId) {
        // [MODIFICADO] Busca o aluno com o escopo da escola
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) {
            throw new Error('Aluno não encontrado ou não pertence a esta escola.');
        }

        // Lógica de remoção (inalterada)
        student.academicHistory.pull(recordId);
        await student.save();
        return student;
    }
    
    /**
     * [MODIFICADO] Conta alunos, garantindo que a contagem seja da escola.
     */
    async getCountByAgeAndBirthday(minAge, maxAge, birthdayMonth, schoolId) {
        console.log(`[StudentService] Buscando contagem: ${minAge}-${maxAge} anos, Mês ${birthdayMonth}`);
    
        const today = new Date();
        today.setHours(0, 0, 0, 0); 
    
        const latestBirthDate = new Date(
            today.getFullYear() - minAge,
            today.getMonth(),
            today.getDate()
        );
        const earliestBirthDate = new Date(
            today.getFullYear() - (maxAge + 1),
            today.getMonth(),
            today.getDate() + 1 
        );
    
        // [MODIFICADO] Adiciona school_id à query
        const query = {
            school_id: schoolId, // <<< FILTRO DE ESCOLA
            birthDate: {
                $gte: earliestBirthDate,
                $lte: latestBirthDate,
            },
            isActive: true, 
            $expr: {
                $eq: [
                    { $month: '$birthDate' }, 
                    birthdayMonth, 
                ],
            },
        };
    
        try {
            const count = await Student.countDocuments(query);
            console.log(`[StudentService] Contagem encontrada: ${count}`);
            return count;
        } catch (error) {
            console.error('[StudentService] Erro ao contar alunos:', error);
            throw new Error('Falha ao consultar banco de dados de alunos.');
        }
    }
}

module.exports = new StudentService();