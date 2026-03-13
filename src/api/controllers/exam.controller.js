const examService = require('../services/exam.service'); 
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const crypto = require('crypto');
const os = require('os');

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

    // 👇 [NOVO] Controlador para atualizar uma prova existente
    async update(req, res) {
        try {
            console.log('\n======================================================');
            console.log(`📥 [PUT] /exams/${req.params.id} - ATUALIZAÇÃO DE PROVA`);
            
            const schoolId = req.user.school_id;
            const examId = req.params.id;
            const updateData = req.body;

            const updatedExam = await examService.updateExam(examId, updateData, schoolId);
            
            console.log('✅ Prova atualizada com sucesso!');
            console.log('======================================================\n');
            
            res.status(200).json(updatedExam);
        } catch (error) {
            console.error('❌ ERRO AO ATUALIZAR PROVA:', error.message);
            // Se o erro for de status bloqueado, manda 403 Forbidden
            if (error.message.includes('não pode mais ser alterada')) {
                return res.status(403).json({ message: error.message });
            }
            res.status(400).json({ message: error.message });
        }
    }

    // 👇 [NOVO] Controlador para duplicar uma prova
    async duplicate(req, res) {
        try {
            console.log('\n======================================================');
            console.log(`📥 [POST] /exams/${req.params.id}/duplicate - DUPLICAR PROVA`);
            
            const schoolId = req.user.school_id;
            const examId = req.params.id;

            const duplicatedExam = await examService.duplicateExam(examId, schoolId);
            
            console.log('✅ Prova duplicada com sucesso! Novo ID:', duplicatedExam._id);
            console.log('======================================================\n');
            
            res.status(201).json(duplicatedExam);
        } catch (error) {
            console.error('❌ ERRO AO DUPLICAR PROVA:', error.message);
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
            console.log('📥 [POST] /exams/scan - LEITURA DE QR CODE (MANUAL/IA)');
            console.log('Payload:', JSON.stringify(req.body, null, 2));
            
            const schoolId = req.user.school_id;

            const sheet = await examService.scanExamSheet(req.body, schoolId);
            
            console.log(`✅ Resultados computados para QR Code ${req.body.qrCodeUuid}`);
            console.log('======================================================\n');
            
            res.status(200).json({ message: 'Computado com sucesso!', sheet });
        } catch (error) {
            console.error('❌ ERRO AO PROCESSAR RESULTADO:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async verifySheet(req, res) {
        try {
            const schoolId = req.user.school_id;
            const { uuid } = req.params;
            const info = await examService.verifyExamSheet(uuid, schoolId);
            res.status(200).json(info);
        } catch (error) {
            console.error('❌ ERRO AO VERIFICAR QR CODE:', error.message);
            res.status(400).json({ message: error.message });
        }
    }

    async getSheetsByExam(req, res) {
        try {
            const schoolId = req.user.school_id;
            const examId = req.params.id; 
            const result = await examService.getExamSheetsByExamId(examId, schoolId);
            res.status(200).json(result);
        } catch (error) {
            console.error('❌ ERRO AO BUSCAR ALUNOS DA PROVA:', error);
            res.status(404).json({ message: error.message });
        }
    }

    async processOMRImage(req, res) {
        try {
            console.log('\n📸 [POST] /exams/process-omr - ANALISANDO GABARITO PELA IA');
            const { imageBase64 } = req.body;

            if (!imageBase64) throw new Error("Imagem não enviada.");

            const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
            
            const tempFileName = `temp_${crypto.randomUUID()}.jpg`;
            const tempFilePath = path.join(os.tmpdir(), tempFileName); 
            
            fs.writeFileSync(tempFilePath, base64Data, { encoding: 'base64' });

            const scriptPath = path.join(__dirname, '../../scripts/process_omr.py'); 
            
            exec(`python "${scriptPath}" "${tempFilePath}"`, (error, stdout, stderr) => {
                if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);

                if (error) {
                    console.error("❌ ERRO NO PYTHON:", stderr || error.message);
                    return res.status(200).json({ success: false, message: "IA falhou ao ler a imagem." });
                }

                try {
                    const result = JSON.parse(stdout);
                    console.log("✅ IA Retornou:", result);
                    res.status(200).json(result);
                } catch(e) {
                    console.error("❌ Falha ao dar parse no retorno da IA:", stdout);
                    res.status(200).json({ success: false, message: "Retorno inválido da IA" });
                }
            });

        } catch (error) {
            console.error('❌ ERRO NO ENDPOINT DE IMAGEM:', error.message);
            res.status(400).json({ success: false, message: error.message });
        }
    }
}

module.exports = new ExamController();