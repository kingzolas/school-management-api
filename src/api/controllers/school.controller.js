const SchoolService = require('../services/school.service'); // Ajuste o caminho se necessário

class SchoolController {

    async create(req, res, next) {
        try {
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

    // --- [UPDATE CORRIGIDO] ---
    async update(req, res, next) {
        try {
            const cleanString = (value) => {
                if (typeof value === 'string') {
                    const trimmed = value.replace(/^"|"$/g, '').trim();
                    return trimmed === '' ? undefined : trimmed; // Retorna undefined se vazio para não apagar dados
                }
                return value;
            };

            let rawBody = { ...req.body };
            let updateData = {};

            // 1. Limpeza inicial
            Object.keys(rawBody).forEach(key => {
                const cleaned = cleanString(rawBody[key]);
                if (cleaned !== undefined) {
                    updateData[key] = cleaned;
                }
            });

            // 2. Tratamento de Endereço
            if (updateData['address[street]']) {
                updateData.address = {
                    cep: updateData['address[cep]'] || updateData['address[zipCode]'],
                    neighborhood: updateData['address[neighborhood]'] || updateData['address[district]'],
                    street: updateData['address[street]'],
                    number: updateData['address[number]'],
                    city: updateData['address[city]'],
                    state: updateData['address[state]']
                };
                
                // Remove chaves antigas do objeto raiz
                const addrKeys = ['address[street]', 'address[number]', 'address[cep]', 'address[zipCode]', 
                                  'address[neighborhood]', 'address[district]', 'address[city]', 'address[state]'];
                addrKeys.forEach(k => delete updateData[k]);
            }

            // 3. Tratamento Mercado Pago
            const mpAccessToken = updateData['mercadoPagoConfig[prodAccessToken]'];
            if (mpAccessToken) {
                updateData.mercadoPagoConfig = {
                    prodAccessToken: mpAccessToken,
                    prodPublicKey: updateData['mercadoPagoConfig[prodPublicKey]'],
                    prodClientId: updateData['mercadoPagoConfig[prodClientId]'],
                    prodClientSecret: updateData['mercadoPagoConfig[prodClientSecret]'],
                    isConfigured: true
                };
                // Remove chaves antigas
                Object.keys(updateData).forEach(k => {
                    if (k.startsWith('mercadoPagoConfig[')) delete updateData[k];
                });
            }

            // 4. Tratamento CORA (Sandbox e Produção separados)
            // Prepara a estrutura, mas só preenche o que veio na requisição
            let coraUpdate = {
                hasUpdate: false,
                isSandbox: undefined,
                sandbox: {},
                production: {}
            };

            // 4.1 Flag de Ambiente
            if (rawBody['coraConfig[isSandbox]'] !== undefined) {
                coraUpdate.isSandbox = String(rawBody['coraConfig[isSandbox]']) === 'true';
                coraUpdate.hasUpdate = true;
                delete updateData['coraConfig[isSandbox]'];
            }

            // 4.2 Dados SANDBOX
            if (updateData['coraConfig[sandbox][clientId]']) {
                coraUpdate.sandbox.clientId = updateData['coraConfig[sandbox][clientId]'];
                coraUpdate.hasUpdate = true;
            }
            if (updateData['coraConfig[sandbox][certificateContent]']) {
                coraUpdate.sandbox.certificateContent = updateData['coraConfig[sandbox][certificateContent]'];
                coraUpdate.hasUpdate = true;
            }
            if (updateData['coraConfig[sandbox][privateKeyContent]']) {
                coraUpdate.sandbox.privateKeyContent = updateData['coraConfig[sandbox][privateKeyContent]'];
                coraUpdate.hasUpdate = true;
            }

            // 4.3 Dados PRODUÇÃO
            if (updateData['coraConfig[production][clientId]']) {
                coraUpdate.production.clientId = updateData['coraConfig[production][clientId]'];
                coraUpdate.hasUpdate = true;
            }
            if (updateData['coraConfig[production][certificateContent]']) {
                coraUpdate.production.certificateContent = updateData['coraConfig[production][certificateContent]'];
                coraUpdate.hasUpdate = true;
            }
            if (updateData['coraConfig[production][privateKeyContent]']) {
                coraUpdate.production.privateKeyContent = updateData['coraConfig[production][privateKeyContent]'];
                coraUpdate.hasUpdate = true;
            }

            // Limpa as chaves planas da Cora do updateData para não sujar o root
            Object.keys(updateData).forEach(k => {
                if (k.startsWith('coraConfig[')) delete updateData[k];
            });

            // Anexa o objeto estruturado se houve mudança
            if (coraUpdate.hasUpdate) {
                updateData.coraConfigStructured = coraUpdate; 
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