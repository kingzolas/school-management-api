const SubjectService = require('../services/subject.service');
const appEmitter = require('../../loaders/eventEmitter'); // Seu emissor global

class SubjectController {

    async create(req, res, next) {
        try {
            const newSubject = await SubjectService.createSubject(req.body);
            
            // Emite o evento APÓS salvar com sucesso
            appEmitter.emit('subject:created', newSubject);
            console.log(`📡 EVENTO EMITIDO: subject:created para ${newSubject.name}`);
            
            res.status(201).json(newSubject);
        } catch (error) {
            console.error('❌ ERRO [SubjectController.create]:', error.message);
            // Trata erro de duplicata vindo do service
            if (error.message.includes('já existe')) {
                return res.status(409).json({ message: error.message }); // 409 Conflict
            }
            // Passa para o middleware de erro
            next(error); 
        }
    }

    /**
     * [CORRIGIDO] Cria múltiplas disciplinas (em lote).
     */
    async createBulk(req, res, next) {
        const { subjects } = req.body; 

        if (!subjects || !Array.isArray(subjects) || subjects.length === 0) {
            return res.status(400).json({ message: 'O corpo da requisição deve conter um array "subjects" não-vazio.' });
        }

        try {
            // Agora o service retorna um array vazio [] se nada foi criado,
            // ou um array com os docs criados. Ele não lança mais o erro de duplicata.
            const createdSubjects = await SubjectService.createMultipleSubjects(subjects);

            // Emite evento WebSocket apenas para os que foram realmente criados
            createdSubjects.forEach(subject => {
                appEmitter.emit('subject:created', subject);
                console.log(`📡 EVENTO EMITIDO (Lote): subject:created para ${subject.name}`);
            });

            // Resposta de sucesso (201 Created), mesmo que 0 tenham sido criados
            res.status(201).json({
                message: `${createdSubjects.length} de ${subjects.length} disciplinas foram criadas com sucesso (duplicatas ignoradas).`,
                createdSubjects
            });

        } catch (error) {
            // Pega apenas erros reais (ex: validação de 'level' falhou)
            console.error('❌ ERRO [SubjectController.createBulk]:', error.message);
            res.status(400).json({ message: error.message }); // Envia o erro real
            // next(error); // Alternativa
        }
    }

    async getAll(req, res, next) {
        try {
            // Permite filtrar por query, ex: /api/subjects?level=Ensino Médio
            const subjects = await SubjectService.getAllSubjects(req.query);
            res.status(200).json(subjects);
        } catch (error) {
            console.error('❌ ERRO [SubjectController.getAll]:', error.message);
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const subject = await SubjectService.getSubjectById(req.params.id);
            res.status(200).json(subject);
        } catch (error) {
            console.error(`❌ ERRO [SubjectController.getById ${req.params.id}]:`, error.message);
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async update(req, res, next) {
        try {
            const updatedSubject = await SubjectService.updateSubject(req.params.id, req.body);
            
            appEmitter.emit('subject:updated', updatedSubject);
            console.log(`📡 EVENTO EMITIDO: subject:updated para ${updatedSubject.name}`);
            
            res.status(200).json(updatedSubject);
        } catch (error) {
            console.error(`❌ ERRO [SubjectController.update ${req.params.id}]:`, error.message);
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('já existe')) {
                return res.status(409).json({ message: error.message });
            }
            next(error);
        }
    }

    async delete(req, res, next) {
        try {
            const deletedSubject = await SubjectService.deleteSubject(req.params.id);
            
            appEmitter.emit('subject:deleted', { id: req.params.id }); // Emite o ID
            console.log(`📡 EVENTO EMITIDO: subject:deleted para ID ${req.params.id}`);
            
            res.status(200).json({ message: 'Disciplina deletada com sucesso', deletedSubject });
        } catch (error) {
            console.error(`❌ ERRO [SubjectController.delete ${req.params.id}]:`, error.message);
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            // Erro de "em uso" vindo do service
            if (error.message.includes('está em uso')) {
                return res.status(400).json({ message: error.message }); // 400 Bad Request
            }
            next(error);
        }
    }
}

module.exports = new SubjectController();