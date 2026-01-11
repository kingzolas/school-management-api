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

    // [NOVO] Método para editar os dados da solicitação
    async updateRequestData(requestId, schoolId, studentData, tutorData) {
        const request = await RegistrationRequest.findOne({ _id: requestId, school_id: schoolId });
        
        if (!request) throw new Error('Solicitação não encontrada.');
        if (request.status !== 'PENDING') throw new Error('Apenas solicitações pendentes podem ser editadas.');

        // Atualiza Student Data (Merge)
        if (studentData) {
            request.studentData = { ...request.studentData, ...studentData };
        }

        // Atualiza Tutor Data (Merge)
        if (tutorData) {
            // Se antes não tinha tutor (ex: adulto) e agora tem, ou vice-versa
            request.tutorData = request.tutorData ? { ...request.tutorData, ...tutorData } : tutorData;
        }

        // Marca como modificado para garantir que o Mongoose salve objetos mistos
        request.markModified('studentData');
        if(tutorData) request.markModified('tutorData');

        return await request.save();
    }

    async approveRequest(requestId, schoolId, userId, finalStudentData, finalTutorData) {
        try {
            const request = await RegistrationRequest.findOne({ _id: requestId, school_id: schoolId });
            
            if (!request) throw new Error('Solicitação não encontrada.');
            if (request.status !== 'PENDING') throw new Error('Esta solicitação já foi processada.');

            const sData = finalStudentData || request.studentData;
            const tData = finalTutorData || request.tutorData;
            
            let createdTutor = null;
            let createdStudent = null;

            // Gera Matrícula Automática
            const currentYear = new Date().getFullYear();
            const randomPart = Math.floor(100000 + Math.random() * 900000);
            const generatedEnrollment = `${currentYear}${randomPart}`;

            // --- CENÁRIO 1: ALUNO MENOR ---
            if (request.registrationType === 'MINOR_STUDENT') {
                if (!tData || !tData.cpf) throw new Error('Dados do tutor incompletos.');

                let existingTutor = await Tutor.findOne({ cpf: tData.cpf, school_id: schoolId });
                
                if (existingTutor) {
                    createdTutor = existingTutor;
                } else {
                    createdTutor = await new Tutor({
                        ...tData,
                        school_id: schoolId
                    }).save(); 
                }

                createdStudent = await new Student({
                    ...sData, 
                    enrollmentNumber: generatedEnrollment,
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
                }).save();
            } 
            
            // --- CENÁRIO 2: ALUNO ADULTO ---
            else {
                createdStudent = await new Student({
                    ...sData,
                    enrollmentNumber: generatedEnrollment,
                    healthInfo: sData.healthInfo,
                    authorizedPickups: sData.authorizedPickups,
                    address: sData.address,
                    school_id: schoolId,
                    financialResp: 'STUDENT',
                    tutors: [] 
                }).save();
            }

            request.status = 'APPROVED';
            request.reviewedBy = userId;
            await request.save();

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