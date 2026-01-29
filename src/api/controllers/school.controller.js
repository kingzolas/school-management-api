const SchoolService = require('../services/school.service');

class SchoolController {

    async create(req, res, next) {
        try {
            let createData = { ...req.body };
            
            // Tratamento estruturado para criação de nova escola
            if (createData['address[street]']) {
                createData.address = {
                    zipCode: createData['address[zipCode]'] || createData['address[cep]'],
                    street: createData['address[street]'],
                    number: createData['address[number]'],
                    district: createData['address[district]'] || createData['address[neighborhood]'],
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

    // --- [UPDATE REFORMULADO COM DOT NOTATION] ---
    async update(req, res, next) {
        try {
            const rawBody = { ...req.body };
            const updateData = {};

            // Função interna para limpar aspas e remover strings vazias vindas do FormData
            const cleanValue = (val) => {
                if (typeof val === 'string') {
                    const v = val.replace(/^"|"$/g, '').trim();
                    return v === '' ? undefined : v;
                }
                return val;
            };

            // Mapeamento Dinâmico: Transforma chaves "Objeto[campo]" em "Objeto.campo"
            Object.keys(rawBody).forEach(key => {
                const value = cleanValue(rawBody[key]);
                if (value === undefined) return;

                // 1. Tratamento de Endereço
                if (key.startsWith('address[')) {
                    const field = key.match(/\[(.*?)\]/)[1];
                    // Normaliza CEP e Bairro para os nomes de campos usados no Model
                    const dbField = (field === 'cep' || field === 'zipCode') ? 'zipCode' :
                                   (field === 'neighborhood' || field === 'district') ? 'district' : field;
                    updateData[`address.${dbField}`] = value;
                } 
                // 2. Tratamento Mercado Pago
                else if (key.startsWith('mercadoPagoConfig[')) {
                    const field = key.match(/\[(.*?)\]/)[1];
                    updateData[`mercadoPagoConfig.${field}`] = value;
                    updateData['mercadoPagoConfig.isConfigured'] = true;
                }
                // 3. Tratamento Cora (Com suporte a aninhamento duplo)
                else if (key.startsWith('coraConfig[')) {
                    // Captura todos os níveis dentro de colchetes, ex: [sandbox][clientId]
                    const matches = key.match(/\[(.*?)\]/g).map(m => m.replace(/[\[\]]/g, ''));
                    
                    if (matches.length === 1) { // ex: coraConfig[isSandbox]
                        const field = matches[0];
                        // Converte string 'true' do FormData para booleano real
                        updateData[`coraConfig.${field}`] = (value === 'true' || value === true);
                    } else if (matches.length === 2) { // ex: coraConfig[sandbox][clientId]
                        const sub = matches[0]; // sandbox | production | defaultFine
                        const field = matches[1]; 
                        updateData[`coraConfig.${sub}.${field}`] = value;
                    }
                    updateData['coraConfig.isConfigured'] = true;
                }
                // 4. Campos de Primeiro Nível (name, cnpj, preferredGateway, etc)
                else {
                    updateData[key] = value;
                }
            });

            const school = await SchoolService.updateSchool(req.params.id, updateData, req.file);
            res.status(200).json(school);

        } catch (error) {
            console.error('❌ ERRO [SchoolController.update]:', error.message);
            if (error.message.includes('não encontrada')) return res.status(404).json({ message: error.message });
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