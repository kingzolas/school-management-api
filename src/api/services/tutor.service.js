// src/api/services/tutor.service.js
const Tutor = require('../models/tutor.model');
const tutorFinancialScoreService = require('./tutorFinancialScore.service');

class TutorService {

    async ensureTutorFinancialScore(tutor, schoolId = null) {
        try {
            if (!tutor) return tutor;

            if (!tutorFinancialScoreService.tutorNeedsFinancialScoreBackfill(tutor)) {
                return tutor;
            }

            if (schoolId) {
                await tutorFinancialScoreService.calculateTutorScore(tutor._id, schoolId);
                return await Tutor.findById(tutor._id).populate('students');
            }

            tutor.financialScore = tutorFinancialScoreService.buildDefaultFinancialScore();
            await tutor.save();

            return tutor;
        } catch (error) {
            console.error(`[SERVICE] Erro ao garantir financialScore do tutor ${tutor?._id}:`, error.message);
            throw new Error(`Erro ao garantir financialScore do tutor: ${error.message}`);
        }
    }

    async ensureTutorsFinancialScore(tutors = [], schoolId) {
        try {
            const normalizedTutors = [];

            for (const tutor of tutors) {
                const normalizedTutor = await this.ensureTutorFinancialScore(tutor, schoolId);
                normalizedTutors.push(normalizedTutor);
            }

            return normalizedTutors;
        } catch (error) {
            console.error('[SERVICE] Erro ao garantir financialScore da lista de tutores:', error.message);
            throw new Error(`Erro ao garantir financialScore dos tutores: ${error.message}`);
        }
    }

    async getAllTutors(schoolId) {
        try {
            const tutors = await Tutor.find({ school_id: schoolId })
                .populate('students');

            return await this.ensureTutorsFinancialScore(tutors, schoolId);
        } catch (error) {
            console.error("Erro no service ao buscar todos os tutores:", error.message);
            throw new Error(`Erro ao buscar tutores: ${error.message}`);
        }
    }

    async getTutorById(id, schoolId) {
        try {
            const tutor = await Tutor.findOne({ _id: id, school_id: schoolId })
                .populate('students');

            if (!tutor) {
                throw new Error('Tutor não encontrado ou não pertence a esta escola.');
            }

            return await this.ensureTutorFinancialScore(tutor, schoolId);
        } catch (error) {
            console.error(`Erro no service ao buscar tutor por ID (${id}):`, error.message);
            throw new Error(`Erro ao buscar tutor: ${error.message}`);
        }
    }

    async updateTutor(id, tutorData, schoolId) {
        try {
            const tutor = await Tutor.findOne({ _id: id, school_id: schoolId });

            if (!tutor) {
                console.warn(`[SERVICE] Tentativa de atualizar tutor não encontrado: ${id}`);
                throw new Error('Tutor não encontrado ou não pertence a esta escola.');
            }

            Object.keys(tutorData).forEach((key) => {
                if (key !== 'financialScore') {
                    tutor[key] = tutorData[key];
                }
            });

            if (tutorData.financialScore) {
                tutor.financialScore = tutorFinancialScoreService.normalizeScorePayload(
                    tutor.financialScore || {},
                    tutorData.financialScore
                );
            } else if (!tutor.financialScore) {
                tutor.financialScore = tutorFinancialScoreService.buildDefaultFinancialScore();
            }

            await tutor.save();

            return await Tutor.findOne({ _id: id, school_id: schoolId }).populate('students');
        } catch (error) {
            console.error(`Erro no service ao ATUALIZAR tutor por ID (${id}):`, error.message);
            throw new Error(`Erro ao atualizar tutor: ${error.message}`);
        }
    }

    async findTutorByCpf(cpf, schoolId) {
        try {
            const tutor = await Tutor.findOne({ cpf: cpf, school_id: schoolId })
                .populate('students');

            if (!tutor) {
                return null;
            }

            return await this.ensureTutorFinancialScore(tutor, schoolId);
        } catch (error) {
            console.error(`Erro no service ao buscar tutor por CPF (${cpf}):`, error.message);
            throw new Error(`Erro ao buscar tutor por CPF: ${error.message}`);
        }
    }

    async updateTutorFinancialScore(id, financialScoreData, schoolId) {
        try {
            const tutor = await Tutor.findOne({ _id: id, school_id: schoolId }).populate('students');

            if (!tutor) {
                throw new Error('Tutor não encontrado ou não pertence a esta escola.');
            }

            tutor.financialScore = tutorFinancialScoreService.normalizeScorePayload(
                tutor.financialScore || {},
                financialScoreData || {}
            );

            await tutor.save();

            return tutor;
        } catch (error) {
            console.error(`Erro no service ao atualizar financialScore do tutor (${id}):`, error.message);
            throw new Error(`Erro ao atualizar financialScore do tutor: ${error.message}`);
        }
    }

    async backfillTutorsFinancialScore(schoolId) {
        try {
            return await tutorFinancialScoreService.recalculateAllTutors(schoolId);
        } catch (error) {
            console.error('[SERVICE] Erro ao executar backfill do financialScore:', error.message);
            throw new Error(`Erro ao executar backfill do financialScore: ${error.message}`);
        }
    }

    async getTutorFinancialScore(id, schoolId) {
        try {
            const tutor = await Tutor.findOne({ _id: id, school_id: schoolId });

            if (!tutor) {
                throw new Error('Tutor não encontrado ou não pertence a esta escola.');
            }

            if (tutorFinancialScoreService.tutorNeedsFinancialScoreBackfill(tutor)) {
                await tutorFinancialScoreService.calculateTutorScore(id, schoolId);
                const updatedTutor = await Tutor.findOne({ _id: id, school_id: schoolId });
                return updatedTutor.financialScore;
            }

            return tutor.financialScore;
        } catch (error) {
            console.error(`Erro no service ao buscar financialScore do tutor (${id}):`, error.message);
            throw new Error(`Erro ao buscar financialScore do tutor: ${error.message}`);
        }
    }

    async recalculateTutorFinancialScore(id, schoolId) {
        try {
            await tutorFinancialScoreService.calculateTutorScore(id, schoolId);

            const tutor = await Tutor.findOne({ _id: id, school_id: schoolId }).populate('students');

            if (!tutor) {
                throw new Error('Tutor não encontrado ou não pertence a esta escola.');
            }

            return tutor;
        } catch (error) {
            console.error(`Erro no service ao recalcular financialScore do tutor (${id}):`, error.message);
            throw new Error(`Erro ao recalcular financialScore do tutor: ${error.message}`);
        }
    }
}

module.exports = new TutorService();