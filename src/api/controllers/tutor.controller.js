// src/api/controllers/tutor.controller.js
const TutorService = require('../services/tutor.service');

// Helper de verificação de SchoolId
const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuário não autenticado ou não associado a uma escola.');
    }
    return req.user.school_id;
};

class TutorController {

    async getAll(req, res) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            // [MODIFICADO] Passa o schoolId para o service
            const tutors = await TutorService.getAllTutors(schoolId);
            res.status(200).json(tutors);
        } catch (error) {
             if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao buscar todos os tutores', error: error.message });
        }
    }

    async update(req, res) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            const id = req.params.id;
            const tutorData = req.body;

            console.log(`[API] Recebida requisição PUT para tutor ID: ${id}`);
            
            // [MODIFICADO] Passa o schoolId para o service
            const updatedTutor = await TutorService.updateTutor(id, tutorData, schoolId);

            res.status(200).json(updatedTutor);

        } catch (error) {
            console.error(`[API] Erro ao processar PUT para tutor: ${error.message}`);
             if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
             if (error.message.includes('não encontrado')) {
                 return res.status(404).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao atualizar tutor', error: error.message });
        }
    }

    async getById(req, res) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            const id = req.params.id;

            // [MODIFICADO] Passa o schoolId para o service
            const tutor = await TutorService.getTutorById(id, schoolId);
            
            res.status(200).json(tutor);
        } catch (error)
        {
             if (error.message.includes('não autenticado')) {
                 return res.status(403).json({ message: error.message });
            }
             if (error.message.includes('não encontrado')) {
                 return res.status(404).json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao buscar tutor por ID', error: error.message });
        }
    }

    async findByCpf(req, res) {
        try {
            // [MODIFICADO] Pega o schoolId do usuário logado
            const schoolId = getSchoolId(req);
            const cpf = req.params.cpf;
            console.log(`[API] Recebida busca por CPF: ${cpf}`);

            // [MODIFICADO] Passa o schoolId para o service
            const tutor = await TutorService.findTutorByCpf(cpf, schoolId);
            
            if (!tutor) {
                console.log(`[API] CPF ${cpf} não encontrado no banco.`);
                return res.status(404).json({ message: 'Tutor não encontrado.' });
            }
            
            console.log(`[API] CPF ${cpf} encontrado. Enviando dados...`);
            res.status(200).json(tutor);

        } catch (error) {
            console.error(`[API] Erro ao processar busca por CPF: ${error.message}`);
             if (error.message.includes('não autenticado')) {
                 return res.status('403').send('Click to view file').json({ message: error.message });
            }
            res.status(500).json({ message: 'Erro ao buscar tutor por CPF', error: error.message });
        }
    }

    /* * NOTA: A função 'updateTutorRelationship' foi removida deste arquivo
     * pois ela pertence ao 'student.controller.js'.
     */
}

module.exports = new TutorController();