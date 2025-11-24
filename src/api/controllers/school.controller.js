const SchoolService = require('../services/school.service');

/**
 * IMPORTANTE: Para este controlador funcionar, você precisará
 * de um middleware de upload de arquivos (como o 'multer')
 * nas suas rotas de 'create' e 'update'.
 */

class SchoolController {

    async create(req, res, next) {
        try {
            // Tratamento similar ao update, caso no futuro você crie escola com endereço via form-data
            let createData = { ...req.body };
            
            if (createData['address[street]']) {
                createData.address = {
                    zipCode: createData['address[zipCode]'],
                    street: createData['address[street]'],
                    number: createData['address[number]'],
                    district: createData['address[district]'],
                    city: createData['address[city]'],
                    state: createData['address[state]']
                };
            }

            const newSchool = await SchoolService.createSchool(createData, req.file);
            res.status(201).json(newSchool);
        } catch (error) {
            console.error('❌ ERRO [SchoolController.create]:', error.message);
            if (error.code === 11000) { 
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

    async getLogo(req, res, next) {
        try {
            const logo = await SchoolService.getSchoolLogo(req.params.id);
            res.set('Content-Type', logo.contentType);
            res.status(200).send(logo.data);
        } catch (error) {
            console.error('❌ ERRO [SchoolController.getLogo]:', error.message);
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    // --- [CORREÇÃO AQUI] ---
    async update(req, res, next) {
        try {
            const cleanString = (value) => {
                if (typeof value === 'string') {
                    return value.replace(/^"|"$/g, '').trim();
                }
                return value;
            };

            let rawBody = { ...req.body };
            let updateData = {};

            // Limpa aspas
            Object.keys(rawBody).forEach(key => {
                updateData[key] = cleanString(rawBody[key]);
            });

            // Verifica campos achatados
            if (updateData['address[street]'] || updateData['address[cep]'] || updateData['address[zipCode]'] || updateData['address[neighborhood]']) {
                
                // 1. Bairro: Pega 'neighborhood' (novo) ou 'district' (antigo)
                const bairroValue = updateData['address[neighborhood]'] || updateData['address[district]'];
                
                // 2. CEP: Pega 'cep' (novo) ou 'zipCode' (antigo)
                const cepValue = updateData['address[cep]'] || updateData['address[zipCode]'];

                updateData.address = {
                    // --- Mapeamento Correto para o Schema ---
                    cep: cleanString(cepValue),           // Salva em 'cep'
                    neighborhood: cleanString(bairroValue), // Salva em 'neighborhood'
                    street: cleanString(updateData['address[street]']),
                    number: cleanString(updateData['address[number]']),
                    city: cleanString(updateData['address[city]']),
                    state: cleanString(updateData['address[state]'])
                };

                // Limpa lixo do objeto principal
                delete updateData['address[cep]'];
                delete updateData['address[zipCode]'];
                delete updateData['address[street]'];
                delete updateData['address[number]'];
                delete updateData['address[neighborhood]'];
                delete updateData['address[district]'];
                delete updateData['address[city]'];
                delete updateData['address[state]'];
            }

            const school = await SchoolService.updateSchool(req.params.id, updateData, req.file);
            res.status(200).json(school);

        } catch (error) {
            console.error('❌ ERRO [SchoolController.update]:', error.message);
            if (error.message.includes('não encontrada')) return res.status(404).json({ message: error.message });
            if (error.name === 'ValidationError') return res.status(400).json({ message: error.message, details: error.errors });
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