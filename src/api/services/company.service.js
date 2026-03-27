const Company = require('../models/company.model');

class CompanyService {
    async createCompany(companyData, schoolId, logoFile = null) {
        try {
            const data = { ...companyData };
            delete data.school_id;

            if (logoFile) {
                data.logo = {
                    data: logoFile.buffer,
                    contentType: logoFile.mimetype
                };
            }

            const newCompany = new Company({
                ...data,
                school_id: schoolId
            });

            await newCompany.save();
            const companyObject = newCompany.toObject();
            if (companyObject.logo) {
                delete companyObject.logo.data;
            }

            return companyObject;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`A empresa com CNPJ '${companyData.cnpj}' já existe nesta escola.`);
            }
            throw error;
        }
    }

    async getAllCompanies(filter = {}, schoolId) {
        const query = { ...filter };
        delete query.school_id;

        return await Company.find({
            ...query,
            school_id: schoolId
        })
            .select('-logo.data')
            .sort({ name: 1 });
    }

    async getCompanyById(id, schoolId) {
        const company = await Company.findOne({ _id: id, school_id: schoolId }).select('-logo.data');

        if (!company) {
            throw new Error('Empresa não encontrada ou não pertence a esta escola.');
        }

        return company;
    }

    async getCompanyLogo(id, schoolId) {
        const company = await Company.findOne({ _id: id, school_id: schoolId }).select('+logo.data');

        if (!company || !company.logo || !company.logo.data) {
            throw new Error('Logo da empresa não encontrada.');
        }

        return company.logo;
    }

    async updateCompany(id, updateData, schoolId, logoFile = null) {
        const payload = { ...updateData };
        delete payload.school_id;
        delete payload.logo;

        if (logoFile) {
            payload.logo = {
                data: logoFile.buffer,
                contentType: logoFile.mimetype
            };
        }

        if (payload.cnpj) {
            const existing = await Company.findOne({
                _id: { $ne: id },
                cnpj: payload.cnpj,
                school_id: schoolId
            });

            if (existing) {
                throw new Error(`O CNPJ '${payload.cnpj}' já está em uso por outra empresa desta escola.`);
            }
        }

        const updatedCompany = await Company.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { $set: payload },
            { new: true, runValidators: true }
        ).select('-logo.data');

        if (!updatedCompany) {
            throw new Error('Empresa não encontrada para atualizar.');
        }

        return updatedCompany;
    }

    async inactivateCompany(id, schoolId) {
        const company = await Company.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { status: 'Inativa' },
            { new: true, runValidators: true }
        ).select('-logo.data');

        if (!company) {
            throw new Error('Empresa não encontrada para inativar.');
        }

        return company;
    }
}

module.exports = new CompanyService();
