const Student = require('../models/student.model');
const Tutor = require('../models/tutor.model'); // <-- Importe o Tutor

/**
 * Define a população padrão para buscar os dados completos do tutor.
 */
const tutorPopulation = {
    path: 'tutors.tutorId', // O caminho dentro do schema de Student
    model: 'Tutor',        // O nome do Model de Tutor
    select: '-students -__v' // Opcional: Exclui campos desnecessários do Tutor (se configurado no Tutor model)
};


class StudentService {

    /**
     * Cria um novo aluno.
     * Esta função faz a "mágica" de encontrar ou criar os tutores.
     */
    async createStudent(studentData) {
        // 1. Separa os dados do aluno dos dados dos tutores que vieram do Flutter
        const { tutors: tutorsFromFlutter, ...studentInfo } = studentData; 
        
        // 2. Este é o array que o StudentSchema espera
        const tutorsForStudentSchema = []; 

        if (tutorsFromFlutter && tutorsFromFlutter.length > 0) {
            
            // 3. Loop em cada tutor enviado (pode ser Mãe, Pai, etc.)
            for (const tutorData of tutorsFromFlutter) {
                
                // 4. Separa o 'relationship' do resto dos dados do tutor
                const { relationship, ...tutorDetails } = tutorData;

                // 5. O 'relationship' (parentesco) é vital para o link.
                if (!relationship) {
                    console.warn("Pulando tutor sem 'relationship' (parentesco).");
                    continue; 
                }

                let tutorDoc; // Variável para armazenar o documento do tutor

                // 6. Verificamos se o CPF foi fornecido
                if (tutorDetails.cpf) {
                    // 6.1. TEM CPF: "encontrar ou criar"
                    tutorDoc = await Tutor.findOne({ cpf: tutorDetails.cpf });
                    if (tutorDoc) {
                        Object.assign(tutorDoc, tutorDetails);
                        await tutorDoc.save();
                    } else {
                        tutorDoc = new Tutor(tutorDetails);
                        await tutorDoc.save();
                    }
                } else {
                    // 6.2. NÃO TEM CPF: Sempre criamos um novo
                    console.warn(`Tutor ${tutorDetails.fullName || 'sem nome'} sendo criado SEM CPF.`);
                    tutorDoc = new Tutor(tutorDetails);
                    await tutorDoc.save();
                }
                
                // 9. Adiciona no array o formato que o StudentSchema espera
                tutorsForStudentSchema.push({
                    tutorId: tutorDoc._id,
                    relationship: relationship 
                });
            }
        } 
        
        // 11. Cria o novo aluno
        const newStudent = new Student({
            ...studentInfo,
            tutors: tutorsForStudentSchema 
        });

        // 12. Salva o aluno
        await newStudent.save();

        // 13. Atualiza os tutores para adicionar a referência ao aluno
        await Tutor.updateMany(
            { _id: { $in: tutorsForStudentSchema.map(t => t.tutorId) } },
            { $addToSet: { students: newStudent._id } } 
        );

        // [CORREÇÃO APLICADA AQUI NA VERSÃO ANTERIOR] Popula antes de retornar
        const populatedStudent = await Student.findById(newStudent._id)
                                              .populate(tutorPopulation);
        
        return populatedStudent; // <-- Retorna o aluno com os dados completos

        // [CORREÇÃO] Removido o 'return newStudent;' duplicado daqui.
    }

    /**
     * Busca todos os alunos e popula os dados dos tutores.
     */
    async getAllStudents() {
        // .populate(tutorPopulation) troca os IDs de tutor pelos documentos completos
        const students = await Student.find().populate(tutorPopulation);
        return students;
    }

    /**
     * Busca um aluno por ID e popula os dados dos tutores.
     */
    async getStudentById(id) {
        const student = await Student.findById(id).populate(tutorPopulation);
        return student;
    }

    /**
     * Atualiza um aluno por ID.
     */
    async updateStudent(id, studentData) {
        // NOTA: Esta lógica não lida com a atualização/criação de tutores como o createStudent faz.
        // Ela só atualiza os campos diretos do aluno.
        const updatedStudent = await Student.findByIdAndUpdate(id, studentData, { 
            new: true, // Retorna o documento atualizado
            runValidators: true // Roda os validadores do schema
        }).populate(tutorPopulation); // [SUGESTÃO] Popula o resultado atualizado também
        return updatedStudent;
    }

    /**
     * Deleta um aluno por ID e remove a referência dele dos tutores.
     */
    async deleteStudent(id) {
        const student = await Student.findById(id);
        if (!student) {
            return null;
        }
        const tutorIds = student.tutors.map(t => t.tutorId);
        await Student.findByIdAndDelete(id);
        await Tutor.updateMany(
            { _id: { $in: tutorIds } },
            { $pull: { students: student._id } } 
        );
        return student; // Retorna o aluno que foi deletado (antes da deleção)
    }

    // ==========================================================
    // INÍCIO DA CORREÇÃO getUpcomingBirthdays
    // ==========================================================
    /**
     * Busca TODOS os alunos, ordenados pelo próximo aniversário e POPULADOS.
     */
    async getUpcomingBirthdays() {
        try {
            // --- ETAPA 1: Agregação para obter a ORDEM CORRETA dos IDs ---
            const sortedStudentInfos = await Student.aggregate([
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
                // Retorna APENAS o _id na ordem correta
                { $project: { _id: 1 } } 
            ]);

            // Extrai apenas os IDs na ordem correta
            const sortedIds = sortedStudentInfos.map(info => info._id);

            if (sortedIds.length === 0) {
                return []; // Nenhum aluno encontrado, retorna array vazio
            }

            // --- ETAPA 2: Busca e Popula os alunos usando os IDs ordenados ---
            const populatedStudents = await Student.find({ 
                _id: { $in: sortedIds } 
            }).populate(tutorPopulation); // Popula os tutores aqui

            // --- ETAPA 3: Reordena os resultados populados ---
            // Cria um mapa para busca rápida: { 'idString': studentDocument }
            const studentMap = new Map(populatedStudents.map(student => [student._id.toString(), student]));
            // Usa os IDs ordenados para reconstruir o array na ordem correta
            const correctlySortedStudents = sortedIds.map(id => studentMap.get(id.toString())).filter(student => student != null); 

            return correctlySortedStudents;

        } catch (error) {
            console.error("Erro na busca/população de aniversariantes (ordenado):", error);
            throw new Error('Erro ao processar busca de aniversariantes');
        }
    }
    // ==========================================================
    // FIM DA CORREÇÃO getUpcomingBirthdays
    // ==========================================================
}

module.exports = new StudentService();