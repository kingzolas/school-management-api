const School = require('../models/school.model');
const { buildPublicIdentifier } = require('../utils/guardianAccess.util');

class SchoolService {
    async _buildUniquePublicIdentifier(sourceValue, excludeId = null) {
        const baseIdentifier = buildPublicIdentifier(sourceValue);

        if (!baseIdentifier) {
            return null;
        }

        let candidate = baseIdentifier;
        let suffix = 1;

        while (true) {
            const existing = await School.findOne({
                publicIdentifier: candidate,
                ...(excludeId ? { _id: { $ne: excludeId } } : {})
            }).select('_id');

            if (!existing) {
                return candidate;
            }

            suffix += 1;
            candidate = `${baseIdentifier}-${suffix}`;
        }
    }

    async _ensureCreatePublicIdentifier(data = {}) {
        const sourceValue = data.publicIdentifier || data.name;
        data.publicIdentifier = await this._buildUniquePublicIdentifier(sourceValue);
        return data;
    }

    async _ensureUpdatePublicIdentifier(id, currentSchool, updateData = {}) {
        if (Object.prototype.hasOwnProperty.call(updateData, 'publicIdentifier')) {
            updateData.publicIdentifier = await this._buildUniquePublicIdentifier(
                updateData.publicIdentifier,
                id
            );

            return updateData;
        }

        if (!currentSchool?.publicIdentifier) {
            const sourceValue = updateData.name || currentSchool?.name;
            updateData.publicIdentifier = await this._buildUniquePublicIdentifier(
                sourceValue,
                id
            );
        }

        return updateData;
    }

    async createSchool(schoolData, logoFile) {
        const data = { ...schoolData };

        await this._ensureCreatePublicIdentifier(data);

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
        const currentSchool = await School.findById(id).select('name publicIdentifier');

        if (!currentSchool) {
            throw new Error('Escola nao encontrada.');
        }

        const updatePayload = { ...updateData };

        await this._ensureUpdatePublicIdentifier(id, currentSchool, updatePayload);

        if (logoFile) {
            updatePayload['logo.data'] = logoFile.buffer;
            updatePayload['logo.contentType'] = logoFile.mimetype;
        }

        const school = await School.findByIdAndUpdate(
            id,
            { $set: updatePayload },
            {
                new: true,
                runValidators: true
            }
        ).select('-logo.data');

        if (!school) {
            throw new Error('Escola nao encontrada.');
        }

        return school;
    }

    async getAllSchools() {
        return await School.find().select('-logo.data');
    }

    async getSchoolById(id) {
        const school = await School.findById(id).select('-logo.data');
        if (!school) {
            throw new Error('Escola nao encontrada.');
        }
        return school;
    }

    async getSchoolWithCredentials(id) {
        const school = await School.findById(id)
            .select('+mercadoPagoConfig.prodAccessToken +coraConfig.sandbox.clientId +coraConfig.sandbox.certificateContent +coraConfig.sandbox.privateKeyContent +coraConfig.production.clientId +coraConfig.production.certificateContent +coraConfig.production.privateKeyContent');

        if (!school) throw new Error('Escola nao encontrada para credenciais.');
        return school;
    }

    async getSchoolLogo(id) {
        const school = await School.findById(id).select('+logo.data');
        if (!school || !school.logo || !school.logo.data) {
            throw new Error('Logo nao encontrada.');
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
            throw new Error('Escola nao encontrada.');
        }
        return school;
    }
}

module.exports = new SchoolService();
