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
        // [CORREÇÃO APLICADA]: Utilização de Update Atômico ($set).
        // Ao usar findByIdAndUpdate com $set, garantimos que apenas os campos enviados (ex: 'authorizationProtocol')
        // sejam alterados no banco. Isso impede que o Mongoose regrave o objeto 'coraConfig' inteiro,
        // o que causava a perda dos campos 'select: false' (certificados/chaves) que não estavam carregados.
        
        const updatePayload = { ...updateData };

        // Se houver nova logo, adicionamos ao payload do update
        if (logoFile) {
            updatePayload['logo.data'] = logoFile.buffer;
            updatePayload['logo.contentType'] = logoFile.mimetype;
        }

        const school = await School.findByIdAndUpdate(
            id,
            { $set: updatePayload }, // O operador $set funde os dados novos com os existentes
            { 
                new: true, // Retorna o documento já atualizado
                runValidators: true // Garante validações de tipo do Schema
            }
        ).select('-logo.data'); // Oculta o buffer da logo no retorno para não pesar a resposta

        if (!school) {
            throw new Error('Escola não encontrada.');
        }

        // Não precisamos converter toObject ou deletar logo.data manualmente aqui,
        // pois o .select('-logo.data') acima já resolveu isso.
        return school;
    }

    async getAllSchools() {
        // Retorna todas as escolas ocultando o buffer pesado da logo
        return await School.find().select('-logo.data');
    }

    async getSchoolById(id) {
        const school = await School.findById(id).select('-logo.data');
        if (!school) {
            throw new Error('Escola não encontrada.');
        }
        return school;
    }

    async getSchoolWithCredentials(id) {
        // Método utilizado pelo InvoiceService para emitir boletos com as chaves reais
        const school = await School.findById(id)
            .select('+mercadoPagoConfig.prodAccessToken +coraConfig.sandbox.clientId +coraConfig.sandbox.certificateContent +coraConfig.sandbox.privateKeyContent +coraConfig.production.clientId +coraConfig.production.certificateContent +coraConfig.production.privateKeyContent');
        
        if (!school) throw new Error('Escola não encontrada para credenciais.');
        return school;
    }

    async getSchoolLogo(id) {
        // Seleciona explicitamente o campo binário que é oculto por padrão no Schema
        const school = await School.findById(id).select('+logo.data');
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