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