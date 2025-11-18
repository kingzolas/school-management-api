// src/api/services/tutor.service.js
const Tutor = require('../models/tutor.model');

class TutorService {

    /**
     * [MODIFICADO] Busca todos os tutores FILTRADOS POR ESCOLA.
     */
    async getAllTutors(schoolId) {
        try {
            // [MODIFICADO] Adiciona o filtro { school_id: schoolId }
            const tutors = await Tutor.find({ school_id: schoolId })
                                      .populate('students');
            return tutors;
        } catch (error) {
            console.error("Erro no service ao buscar todos os tutores:", error.message);
            throw new Error(`Erro ao buscar tutores: ${error.message}`);
        }
    }

    /**
     * [MODIFICADO] Busca um tutor por ID, garantindo que ele pertença à escola.
     */
    async getTutorById(id, schoolId) {
        try {
            // [MODIFICADO] Troca findById por findOne com filtro de _id E school_id
            const tutor = await Tutor.findOne({ _id: id, school_id: schoolId })
                                     .populate('students');
            if (!tutor) {
                 throw new Error('Tutor não encontrado ou não pertence a esta escola.');
            }
            return tutor;
        } catch (error) {
            console.error(`Erro no service ao buscar tutor por ID (${id}):`, error.message);
            throw new Error(`Erro ao buscar tutor: ${error.message}`);
        }
    }

    /**
     * [MODIFICADO] Atualiza um tutor, garantindo que ele pertença à escola.
     */
    async updateTutor(id, tutorData, schoolId) {
        try {
            // [MODIFICADO] Usa findOneAndUpdate para checar o school_id
            const updatedTutor = await Tutor.findOneAndUpdate(
                { _id: id, school_id: schoolId }, // Condição
                tutorData,                       // Atualização
                { new: true }                    // Opções
            );
            
            if (!updatedTutor) {
                console.warn(`[SERVICE] Tentativa de atualizar tutor não encontrado: ${id}`);
                throw new Error('Tutor não encontrado ou não pertence a esta escola.');
            }

            return updatedTutor; 
        } catch (error) {
            console.error(`Erro no service ao ATUALIZAR tutor por ID (${id}):`, error.message);
            throw new Error(`Erro ao atualizar tutor: ${error.message}`);
        }
    }

    /**
     * [MODIFICADO] Busca um tutor por CPF, garantindo que ele pertença à escola.
     */
    async findTutorByCpf(cpf, schoolId) {
        try {
            // [MODIFICADO] Adiciona o filtro { school_id: schoolId }
            const tutor = await Tutor.findOne({ cpf: cpf, school_id: schoolId });
            return tutor; // Retorna o tutor ou null (o controller trata o 404)
        } catch (error) {
            console.error(`Erro no service ao buscar tutor por CPF (${cpf}):`, error.message);
            throw new Error(`Erro ao buscar tutor por CPF: ${error.message}`);
        }
    }

    /* * NOTA: A função 'updateTutorRelationship' foi removida deste arquivo
     * pois ela pertence e foi implementada no 'student.service.js'.
     */
}

module.exports = new TutorService();