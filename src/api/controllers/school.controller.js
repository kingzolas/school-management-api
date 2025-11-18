// src/api/controllers/school.controller.js
const SchoolService = require('../services/school.service');

/**
 * IMPORTANTE: Para este controlador funcionar, você precisará
 * de um middleware de upload de arquivos (como o 'multer')
 * nas suas rotas de 'create' e 'update'.
 * * Ex (na rota):
 * const upload = multer({ storage: multer.memoryStorage() }); // Armazena na memória
 * router.post('/', upload.single('logo'), SchoolController.create);
 * router.patch('/:id', upload.single('logo'), SchoolController.update);
 */

class SchoolController {

    async create(req, res, next) {
        try {
            // req.body contém os dados (name, cnpj, ...)
            // req.file contém a logo (do multer)
            const newSchool = await SchoolService.createSchool(req.body, req.file);
            res.status(201).json(newSchool);
        } catch (error) {
            console.error('❌ ERRO [SchoolController.create]:', error.message);
            if (error.code === 11000) { // Erro de duplicata (CNPJ ou Nome)
                return res.status(409).json({ message: 'Erro de duplicata: Nome ou CNPJ já cadastrado.', error: error.message });
            }
            if (error.name === 'ValidationError') {
                return res.status(400).json({ message: 'Erro de validação.', error: error.message });
            }
            next(error);
        }
    }

    async getAll(req, res, next) {
        try {
            // O service já otimizou isso para não trazer o buffer da logo
            const schools = await SchoolService.getAllSchools();
            res.status(200).json(schools);
        } catch (error) {
            console.error('❌ ERRO [SchoolController.getAll]:', error.message);
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const school = await SchoolService.getSchoolById(req.params.id);
            res.status(200).json(school);
        } catch (error) {
            console.error('❌ ERRO [SchoolController.getById]:', error.message);
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    /**
     * [NOVO] Endpoint especial para servir a imagem da logo.
     * A rota para isso seria algo como: GET /schools/:id/logo
     */
    async getLogo(req, res, next) {
        try {
            const logo = await SchoolService.getSchoolLogo(req.params.id);
            
            // Define o tipo de conteúdo da resposta (ex: 'image/png')
            res.set('Content-Type', logo.contentType);
            
            // Envia os dados binários da imagem
            res.status(200).send(logo.data);

        } catch (error) {
            console.error('❌ ERRO [SchoolController.getLogo]:', error.message);
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async update(req, res, next) {
        try {
            const school = await SchoolService.updateSchool(req.params.id, req.body, req.file);
            res.status(200).json(school);
        } catch (error) {
            console.error('❌ ERRO [SchoolController.update]:', error.message);
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async inactivate(req, res, next) {
        try {
            const school = await SchoolService.inactivateSchool(req.params.id);
            res.status(200).json({ message: 'Escola inativada com sucesso', school });
        } catch (error) {
            console.error('❌ ERRO [SchoolController.inactivate]:', error.message);
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }
}

module.exports = new SchoolController();