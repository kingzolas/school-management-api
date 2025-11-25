const mongoose = require('mongoose');
const RegistrationRequest = require('../models/registration-request.model');
const Student = require('../models/student.model');
const Tutor = require('../models/tutor.model');

class RegistrationRequestService {

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

    async listPendingRequests(schoolId) {
        return await RegistrationRequest.find({ 
            school_id: schoolId, 
            status: 'PENDING' 
        }).sort({ createdAt: -1 });
    }

    // --- [MODIFICADO] Removida a Session/Transaction para funcionar no Mongo Local ---
    async approveRequest(requestId, schoolId, userId, finalStudentData, finalTutorData) {
        try {
            // 1. Busca a solicitação (Sem session)
            const request = await RegistrationRequest.findOne({ _id: requestId, school_id: schoolId });
            
            if (!request) throw new Error('Solicitação não encontrada.');
            if (request.status !== 'PENDING') throw new Error('Esta solicitação já foi processada.');

            // Usa os dados finais (editados pelo gestor) ou os originais da solicitação
            const sData = finalStudentData || request.studentData;
            const tData = finalTutorData || request.tutorData;
            
            let createdTutor = null;
            let createdStudent = null;

            // --- CENÁRIO 1: ALUNO MENOR (Cria Tutor + Aluno) ---
            if (request.registrationType === 'MINOR_STUDENT') {
                if (!tData || !tData.cpf) throw new Error('Dados do tutor incompletos.');

                // Verifica existência do Tutor
                let existingTutor = await Tutor.findOne({ cpf: tData.cpf, school_id: schoolId });
                
                if (existingTutor) {
                    createdTutor = existingTutor;
                } else {
                    createdTutor = await new Tutor({
                        ...tData,
                        school_id: schoolId
                    }).save(); // Sem session
                }

                // Cria Aluno Vinculado
                createdStudent = await new Student({
                    ...sData, // Espalha fullName, birthDate, etc.
                    
                    // Mapeamento explícito
                    healthInfo: sData.healthInfo, 
                    authorizedPickups: sData.authorizedPickups,
                    address: sData.address,

                    school_id: schoolId,
                    financialResp: 'TUTOR',
                    financialTutorId: createdTutor._id,
                    tutors: [{
                        tutorId: createdTutor._id,
                        relationship: tData.relationship || 'Outro'
                    }]
                }).save(); // Sem session
            } 
            
            // --- CENÁRIO 2: ALUNO ADULTO ---
            else {
                createdStudent = await new Student({
                    ...sData,
                    healthInfo: sData.healthInfo,
                    authorizedPickups: sData.authorizedPickups,
                    address: sData.address,

                    school_id: schoolId,
                    financialResp: 'STUDENT',
                    tutors: [] 
                }).save(); // Sem session
            }

            // Atualiza Status da Solicitação
            request.status = 'APPROVED';
            request.reviewedBy = userId;
            await request.save(); // Sem session

            return { 
                success: true, 
                message: 'Matrícula aprovada com sucesso!', 
                student: createdStudent 
            };

        } catch (error) {
            console.error("Erro no Service approveRequest:", error);
            throw error;
        }
    }

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