const AssessmentService = require('../services/assessment.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) throw new Error('Acesso negado: Escola não identificada.');
    return req.user.school_id;
};

class AssessmentController {

    async createDraft(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const teacherId = req.user.id;
            
            // Ex: { topic: "Leis de Newton", difficultyLevel: "Médio", quantity: 5, classId: "...", subjectId: "..." }
            const draft = await AssessmentService.createDraftWithAI(req.body, schoolId, teacherId);
            
            res.status(201).json(draft);
        } catch (error) {
            next(error);
        }
    }

    async update(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const updated = await AssessmentService.updateAssessment(req.params.id, req.body, schoolId);
            res.status(200).json(updated);
        } catch (error) {
            next(error);
        }
    }

    async publish(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const published = await AssessmentService.publishAssessment(req.params.id, schoolId);
            res.status(200).json(published);
        } catch (error) {
            next(error);
        }
    }

    async getByClass(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const { classId } = req.params;
            const list = await AssessmentService.getByClass(classId, schoolId);
            res.status(200).json(list);
        } catch (error) {
            next(error);
        }
    }

       async getById(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const assessment = await AssessmentService.getById(req.params.id, schoolId);
            res.status(200).json(assessment);
        } catch (error) {
            next(error);
        }
    }

    // [NOVO]
    async delete(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const result = await AssessmentService.deleteAssessment(req.params.id, schoolId);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    }
}

module.exports = new AssessmentController();