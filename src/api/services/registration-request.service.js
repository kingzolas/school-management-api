const mongoose = require('mongoose');
const RegistrationRequest = require('../models/registration-request.model');
const Student = require('../models/student.model');
const Tutor = require('../models/tutor.model');

class RegistrationRequestService {

    /**
     * Cria uma solicitação vinda de um link público (Sem autenticação)
     */
    async createPublicRequest(data) {
        const { school_id, registrationType, studentData, tutorData } = data;

        if (!school_id) throw new Error('O ID da escola é obrigatório.');

        const newRequest = new RegistrationRequest({
            school_id,
            registrationType,
            studentData,
            tutorData,
            status: 'PENDING'
        });

        return await newRequest.save();
    }

    /**
     * Lista solicitações pendentes para o Dashboard
     */
    async listPendingRequests(schoolId) {
        return await RegistrationRequest.find({ 
            school_id: schoolId, 
            status: 'PENDING' 
        }).sort({ createdAt: -1 });
    }

    /**
     * LÓGICA CORE: Aprova a solicitação e cria os registros oficiais (Student/Tutor)
     * Usa Transaction para garantir integridade.
     */
    async approveRequest(requestId, schoolId, userId, finalStudentData, finalTutorData) {
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            const request = await RegistrationRequest.findOne({ _id: requestId, school_id: schoolId }).session(session);
            
            if (!request) throw new Error('Solicitação não encontrada.');
            if (request.status !== 'PENDING') throw new Error('Esta solicitação já foi processada.');

            // Usa os dados editados pelo gestor ou os originais da solicitação
            const sData = finalStudentData || request.studentData;
            const tData = finalTutorData || request.tutorData;
            
            let createdTutor = null;
            let createdStudent = null;

            // --- CASO 1: ALUNO MENOR (Precisa de Tutor) ---
            if (request.registrationType === 'MINOR_STUDENT') {
                if (!tData || !tData.cpf) throw new Error('Dados do tutor incompletos para menor de idade.');

                // Verifica se Tutor já existe pelo CPF na mesma escola
                let existingTutor = await Tutor.findOne({ cpf: tData.cpf, school_id: schoolId }).session(session);
                
                if (existingTutor) {
                    createdTutor = existingTutor;
                } else {
                    createdTutor = await new Tutor({
                        ...tData,
                        school_id: schoolId
                    }).save({ session });
                }

                // Cria aluno vinculado ao Tutor
                createdStudent = await new Student({
                    ...sData,
                    school_id: schoolId,
                    financialResp: 'TUTOR',
                    financialTutorId: createdTutor._id,
                    tutors: [{
                        tutorId: createdTutor._id,
                        relationship: tData.relationship || 'Outro'
                    }]
                }).save({ session });
            } 
            
            // --- CASO 2: ALUNO ADULTO (Responsável por si mesmo) ---
            else {
                createdStudent = await new Student({
                    ...sData,
                    school_id: schoolId,
                    financialResp: 'STUDENT',
                    tutors: [] // Lista vazia, validação do Model permite se > 18 anos
                }).save({ session });
            }

            // Atualiza a Solicitação
            request.status = 'APPROVED';
            request.reviewedBy = userId;
            await request.save({ session });

            await session.commitTransaction();
            session.endSession();

            return { 
                success: true, 
                message: 'Matrícula aprovada e realizada com sucesso!', 
                student: createdStudent 
            };

        } catch (error) {
            await session.abortTransaction();
            session.endSession();
            throw error;
        }
    }

    /**
     * Rejeita a solicitação
     */
    async rejectRequest(requestId, schoolId, userId, reason) {
        const request = await RegistrationRequest.findOne({ _id: requestId, school_id: schoolId });
        if (!request) throw new Error('Solicitação não encontrada.');

        request.status = 'REJECTED';
        request.rejectionReason = reason;
        request.reviewedBy = userId;

        return await request.save();
    }
}

module.exports = new RegistrationRequestService();