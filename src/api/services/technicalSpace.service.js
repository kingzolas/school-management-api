const TechnicalSpace = require('../models/technicalSpace.model');

class TechnicalSpaceService {
    async createTechnicalSpace(spaceData, schoolId) {
        try {
            const newSpace = new TechnicalSpace({
                ...spaceData,
                status: spaceData.status || 'Ativo',
                school_id: schoolId
            });

            await newSpace.save();
            return newSpace;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error(`O espaco tecnico '${spaceData.name}' ja existe nesta escola.`);
            }
            throw error;
        }
    }

    async getAllTechnicalSpaces(filter = {}, schoolId) {
        const query = { ...filter };
        delete query.school_id;

        return await TechnicalSpace.find({
            ...query,
            school_id: schoolId
        }).sort({ name: 1 });
    }

    async getTechnicalSpaceById(id, schoolId) {
        const space = await TechnicalSpace.findOne({
            _id: id,
            school_id: schoolId
        });

        if (!space) {
            throw new Error('Espaco tecnico nao encontrado ou nao pertence a esta escola.');
        }

        return space;
    }

    async updateTechnicalSpace(id, updateData, schoolId) {
        delete updateData.school_id;

        if (updateData.name) {
            const existing = await TechnicalSpace.findOne({
                _id: { $ne: id },
                name: updateData.name,
                school_id: schoolId
            });

            if (existing) {
                throw new Error(`O espaco tecnico '${updateData.name}' ja existe nesta escola.`);
            }
        }

        const updatedSpace = await TechnicalSpace.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!updatedSpace) {
            throw new Error('Espaco tecnico nao encontrado para atualizar.');
        }

        return updatedSpace;
    }

    async inactivateTechnicalSpace(id, schoolId) {
        const space = await TechnicalSpace.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { status: 'Inativo' },
            { new: true, runValidators: true }
        );

        if (!space) {
            throw new Error('Espaco tecnico nao encontrado para inativar.');
        }

        return space;
    }
}

module.exports = new TechnicalSpaceService();
