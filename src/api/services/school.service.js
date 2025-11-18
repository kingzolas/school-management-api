// src/api/services/school.service.js
const School = require('../models/school.model');

class SchoolService {

    /**
     * Cria uma nova escola.
     * @param {object} schoolData - Dados do req.body (name, cnpj, etc.)
     * @param {object} logoFile - O arquivo da logo (ex: req.file do multer)
     */
    async createSchool(schoolData, logoFile) {
        // Copia os dados do body
        const data = { ...schoolData };

        // Se um arquivo de logo foi enviado, processa e anexa
        if (logoFile) {
            data.logo = {
                data: logoFile.buffer,          // Os dados binários da imagem
                contentType: logoFile.mimetype  // O tipo (ex: 'image/png')
            };
        }

        const newSchool = new School(data);
        await newSchool.save();
        
        // Converte para objeto para poder remover a logo antes de retornar
        const schoolObject = newSchool.toObject();
        // Não retorna o buffer de dados no JSON de criação
        if (schoolObject.logo) {
            delete schoolObject.logo.data;
        }
        
        return schoolObject;
    }

    /**
     * Atualiza uma escola existente.
     * @param {string} id - O ID da escola
     * @param {object} updateData - Dados do req.body
     * @param {object} logoFile - O novo arquivo de logo (opcional)
     */
    async updateSchool(id, updateData, logoFile) {
        const school = await School.findById(id);
        if (!school) {
            throw new Error('Escola não encontrada.');
        }

        // Atualiza os campos de texto/dados
        Object.assign(school, updateData);

        // Se uma nova logo foi enviada, substitui a antiga
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

    /**
     * Busca todas as escolas (sem o buffer da logo, para performance).
     */
    async getAllSchools() {
        // Retorna todas as escolas, mas exclui o campo 'logo.data' 
        // que é pesado e desnecessário para uma listagem.
        return await School.find().select('-logo.data');
    }

    /**
     * Busca uma escola por ID (sem o buffer da logo).
     * @param {string} id - O ID da escola
     */
    async getSchoolById(id) {
        const school = await School.findById(id).select('-logo.data');
        if (!school) {
            throw new Error('Escola não encontrada.');
        }
        return school;
    }

    /**
     * Busca APENAS a logo de uma escola por ID.
     * @param {string} id - O ID da escola
     */
    async getSchoolLogo(id) {
        // Busca apenas o documento e o campo 'logo'
        const school = await School.findById(id).select('logo');
        if (!school || !school.logo || !school.logo.data) {
            throw new Error('Logo não encontrada.');
        }
        return school.logo; // Retorna o objeto { data, contentType }
    }

    /**
     * Inativa uma escola (Soft delete).
     * @param {string} id - O ID da escola
     */
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