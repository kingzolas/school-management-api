const School = require('../models/school.model');

class SchoolService {

    async createSchool(schoolData, logoFile) {
        const data = { ...schoolData };

        if (logoFile) {
            data.logo = {
                data: logoFile.buffer,
                contentType: logoFile.mimetype
            };
        }

        const newSchool = new School(data);
        await newSchool.save();
        
        const schoolObject = newSchool.toObject();
        if (schoolObject.logo) {
            delete schoolObject.logo.data;
        }
        
        return schoolObject;
    }

    async updateSchool(id, updateData, logoFile) {
        // [CORREÇÃO CRÍTICA]: 
        // Buscamos a escola INCLUINDO as chaves privadas ocultas.
        // Isso é essencial para não perdermos os dados antigos durante o merge.
        const school = await School.findById(id).select(
            '+coraConfig.sandbox.clientId +coraConfig.sandbox.certificateContent +coraConfig.sandbox.privateKeyContent +coraConfig.production.clientId +coraConfig.production.certificateContent +coraConfig.production.privateKeyContent'
        );

        if (!school) {
            throw new Error('Escola não encontrada.');
        }

        // --- LÓGICA DE MERGE PARA CORA (Sandbox vs Production) ---
        // Recuperamos o objeto estruturado que criamos no Controller
        if (updateData.coraConfigStructured) {
            const cora = updateData.coraConfigStructured;
            
            // Garante inicialização dos objetos se não existirem
            if (!school.coraConfig) school.coraConfig = { sandbox: {}, production: {} };
            if (!school.coraConfig.sandbox) school.coraConfig.sandbox = {};
            if (!school.coraConfig.production) school.coraConfig.production = {};

            // 1. Atualiza Flag de Ambiente
            if (cora.isSandbox !== undefined) {
                school.coraConfig.isSandbox = cora.isSandbox;
            }

            // 2. Atualiza Sandbox (Merge Inteligente)
            if (cora.sandbox) {
                // Só atualiza o ID se ele veio no request
                if (cora.sandbox.clientId) {
                    school.coraConfig.sandbox.clientId = cora.sandbox.clientId;
                }
                
                // Só atualiza o Certificado se ele veio (se veio vazio do front, mantém o do banco)
                if (cora.sandbox.certificateContent) {
                    school.coraConfig.sandbox.certificateContent = cora.sandbox.certificateContent;
                }

                // Só atualiza a Chave se ela veio
                if (cora.sandbox.privateKeyContent) {
                    school.coraConfig.sandbox.privateKeyContent = cora.sandbox.privateKeyContent;
                }
            }

            // 3. Atualiza Production (Merge Inteligente)
            if (cora.production) {
                // Só atualiza o ID se ele veio no request
                if (cora.production.clientId) {
                    school.coraConfig.production.clientId = cora.production.clientId;
                }

                // Só atualiza o Certificado se ele veio
                if (cora.production.certificateContent) {
                    school.coraConfig.production.certificateContent = cora.production.certificateContent;
                }

                // Só atualiza a Chave se ela veio
                if (cora.production.privateKeyContent) {
                    school.coraConfig.production.privateKeyContent = cora.production.privateKeyContent;
                }
            }

            school.coraConfig.isConfigured = true;
            
            // Remove o objeto temporário para não tentar salvar no Mongoose (pois não existe no Schema)
            delete updateData.coraConfigStructured;
        }

        // Atualiza os demais campos (via Object.assign)
        // Nota: Object.assign ignora campos undefined, mas sobrescreve com null/strings.
        // Como tratamos o Cora acima manualmente, isso aqui vai tratar nome, endereço, etc.
        Object.assign(school, updateData);

        if (logoFile) {
            school.logo = {
                data: logoFile.buffer,
                contentType: logoFile.mimetype
            };
        }

        await school.save();

        const schoolObject = school.toObject();
        if (schoolObject.logo) {
            delete schoolObject.logo.data;
        }
        
        return schoolObject;
    }

    async getAllSchools() {
        return await School.find().select('-logo.data');
    }

    async getSchoolById(id) {
        const school = await School.findById(id).select('-logo.data');
        if (!school) {
            throw new Error('Escola não encontrada.');
        }
        return school;
    }

    // --- [MÉTODO CRÍTICO] ---
    // Usado pelo InvoiceService para gerar boletos
    async getSchoolWithCredentials(id) {
        const school = await School.findById(id)
            .select('+mercadoPagoConfig.prodAccessToken +coraConfig.sandbox.clientId +coraConfig.sandbox.certificateContent +coraConfig.sandbox.privateKeyContent +coraConfig.production.clientId +coraConfig.production.certificateContent +coraConfig.production.privateKeyContent');
        
        if (!school) throw new Error('Escola não encontrada para credenciais.');
        return school;
    }

    async getSchoolLogo(id) {
        const school = await School.findById(id).select('logo');
        if (!school || !school.logo || !school.logo.data) {
            throw new Error('Logo não encontrada.');
        }
        return school.logo;
    }

    async inactivateSchool(id) {
        const school = await School.findByIdAndUpdate(
            id, 
            { status: 'Inativa' }, 
            { new: true }
        ).select('-logo.data');

        if (!school) {
            throw new Error('Escola não encontrada.');
        }
        return school;
    }
}

module.exports = new SchoolService();