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
        // [CORREÇÃO CRÍTICA]: Carregamos explicitamente os campos binários e sensíveis.
        // Se não carregarmos o logo.data e os certificados agora, o Mongoose irá 
        // sobrescrevê-los como nulos ao chamar o .save() no final do método.
        const school = await School.findById(id).select(
            '+logo.data ' +
            '+mercadoPagoConfig.prodAccessToken ' +
            '+coraConfig.sandbox.certificateContent +coraConfig.sandbox.privateKeyContent ' +
            '+coraConfig.production.certificateContent +coraConfig.production.privateKeyContent'
        );

        if (!school) {
            throw new Error('Escola não encontrada.');
        }

        // Aplicação de Update via Dot Notation (ex: updateData['address.city'] = 'São Paulo')
        // O método .set() do Mongoose entende caminhos com pontos e atualiza apenas a sub-chave.
        Object.keys(updateData).forEach(path => {
            if (updateData[path] !== undefined && updateData[path] !== null) {
                school.set(path, updateData[path]);
            }
        });

        // Atualização da Logotipo (se um novo arquivo foi enviado)
        if (logoFile) {
            school.logo = {
                data: logoFile.buffer,
                contentType: logoFile.mimetype
            };
        }

        // Persistência no Banco de Dados
        await school.save();

        // Retorno do objeto limpo (sem o buffer da imagem por questões de performance)
        const schoolObject = school.toObject();
        if (schoolObject.logo) {
            delete schoolObject.logo.data;
        }
        
        return schoolObject;
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