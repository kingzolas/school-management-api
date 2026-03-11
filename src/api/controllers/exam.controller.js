const examService = require('../services/exam.service'); // Ajuste o caminho se necessário

class ExamController {
    async create(req, res) {
        try {
            console.log('\n======================================================');
            console.log('📥 [POST] /exams - SOLICITAÇÃO DE CRIAÇÃO DE PROVA');
            console.log('Payload recebido:', JSON.stringify(req.body, null, 2));
            
            const schoolId = req.user.school_id;
            const exam = await examService.createExam(req.body, schoolId);
            
            console.log('✅ Prova salva com sucesso! ID:', exam._id);
            console.log('======================================================\n');
            
            res.status(201).json(exam);
        } catch (error) {
            console.error('❌ ERRO AO SALVAR PROVA:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async getAll(req, res) {
        try {
            const schoolId = req.user.school_id;
            const exams = await examService.getExams(req.query, schoolId);
            res.status(200).json(exams);
        } catch (error) {
            console.error('❌ ERRO AO BUSCAR PROVAS:', error);
            res.status(500).json({ message: error.message });
        }
    }

    async getById(req, res) {
        try {
            const schoolId = req.user.school_id;
            const exam = await examService.getExamById(req.params.id, schoolId);
            res.status(200).json(exam);
        } catch (error) {
            console.error('❌ ERRO AO BUSCAR PROVA POR ID:', error);
            res.status(404).json({ message: error.message });
        }
    }

    async generateSheets(req, res) {
        try {
            console.log('\n======================================================');
            console.log(`📥 [POST] /exams/${req.params.id}/generate-sheets`);
            
            const schoolId = req.user.school_id;
            const examId = req.params.id;
            const { studentIds } = req.body; 

            const result = await examService.generateExamSheets(examId, schoolId, studentIds);
            
            console.log('✅ Lote de provas gerado com sucesso!');
            console.log('======================================================\n');
            res.status(200).json(result);
        } catch (error) {
            console.error('❌ ERRO AO GERAR LOTE:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async scanSheet(req, res) {
        try {
            console.log('\n======================================================');
            console.log('📥 [POST] /exams/scan - LEITURA DE QR CODE');
            console.log('Payload:', req.body);
            
            const schoolId = req.user.school_id;
            const { qrCodeUuid, grade } = req.body;

            const sheet = await examService.scanExamSheet(qrCodeUuid, grade, schoolId);
            console.log(`✅ Nota ${grade} computada para QR Code ${qrCodeUuid}`);
            console.log('======================================================\n');
            
            res.status(200).json({ message: 'Nota computada com sucesso!', sheet });
        } catch (error) {
            console.error('❌ ERRO AO LER QR CODE:', error.message);
            res.status(400).json({ message: error.message });
        }
    }
}

module.exports = new ExamController();