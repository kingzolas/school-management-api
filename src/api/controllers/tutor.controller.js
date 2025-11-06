const TutorService = require('../services/tutor.service');

class TutorController {

    async getAll(req, res) {
        try {
            const tutors = await TutorService.getAllTutors();
            res.status(200).json(tutors);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar todos os tutores', error: error.message });
        }
    }

    async updateTutorRelationship(req, res) {
        try {
            const { studentId, tutorId } = req.params;
            const { relationship } = req.body; // Pega o 'relationship' do body

            if (!relationship) {
                 return res.status(400).json({ message: 'O campo "relationship" é obrigatório.' });
            }
            
            console.log(`[API] PUT /students/${studentId}/tutors/${tutorId}`);
            console.log(`[API] Novo relacionamento: ${relationship}`);

            const updatedLink = await StudentService.updateTutorRelationship(
                studentId,
                tutorId,
                relationship
            );
            
            // Retorna o objeto TutorInStudent (o "vínculo") atualizado
            res.status(200).json(updatedLink); 

        } catch (error) {
            console.error(`[API] Erro ao atualizar relacionamento: ${error.message}`);
            // Verifica se o erro foi "não encontrado"
            if (error.message.includes('não encontrado')) {
                 return res.status(404).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro interno ao atualizar relacionamento.', error: error.message });
        }
    }

async update(req, res) {
        try {
            const id = req.params.id;
            const tutorData = req.body; // Dados vêm do Flutter (fullName, email, etc.)

            console.log(`[API] Recebida requisição PUT para tutor ID: ${id}`);
            console.log(`[API] Dados para atualização:`, tutorData);

            const updatedTutor = await TutorService.updateTutor(id, tutorData);

            if (!updatedTutor) {
                return res.status(404).json({ message: 'Tutor não encontrado para atualização.' });
            }

            // Sucesso! Envia o tutor atualizado de volta para o Flutter
            res.status(200).json(updatedTutor);

        } catch (error) {
            console.error(`[API] Erro ao processar PUT para tutor: ${error.message}`);
            res.status(500).json({ message: 'Erro ao atualizar tutor', error: error.message });
        }
    }

    async getById(req, res) {
        try {
            const id = req.params.id;
            const tutor = await TutorService.getTutorById(id);
            
            if (!tutor) {
                return res.status(404).json({ message: 'Tutor não encontrado.' });
            }
            
            res.status(200).json(tutor);
        } catch (error) {
            res.status(500).json({ message: 'Erro ao buscar tutor por ID', error: error.message });
        }
    }

    /**
     * Controller para a sua nova rota de busca por CPF.
     */
    async findByCpf(req, res) {
        try {
            const cpf = req.params.cpf;
            console.log(`[API] Recebida busca por CPF: ${cpf}`); // Log no servidor

            const tutor = await TutorService.findTutorByCpf(cpf);
            
            if (!tutor) {
                // Isso não é um erro do servidor, é um 'Não Encontrado'.
                console.log(`[API] CPF ${cpf} não encontrado no banco.`);
                return res.status(404).json({ message: 'Tutor não encontrado.' });
            }
            
            // Sucesso! Envia os dados do tutor para o Flutter
            console.log(`[API] CPF ${cpf} encontrado. Enviando dados...`);
            res.status(200).json(tutor);

        } catch (error) {
            console.error(`[API] Erro ao processar busca por CPF: ${error.message}`);
            res.status(500).json({ message: 'Erro ao buscar tutor por CPF', error: error.message });
        }
    }
}

module.exports = new TutorController();