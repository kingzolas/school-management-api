// src/api/services/user.service.js
const mongoose = require('mongoose');
const User = require('../models/user.model');
const StaffProfile = require('../models/staffProfile.model');
const appEmitter = require('../../loaders/eventEmitter');

// Define quais campos pertencem ao User model
const userModelFields = [
    'fullName', 'email', 'cpf', 'birthDate', 'gender', 
    'phoneNumber', 'phoneFixed', 'address', 'profilePictureUrl', 
    'username', 'password', 'roles', 'status'
];
// Define quais campos pertencem ao StaffProfile model
const staffProfileModelFields = [
    'admissionDate', 'employmentType', 'mainRole', 'remunerationModel', 
    'salaryAmount', 'hourlyRate', 'weeklyWorkload', 
    'academicFormation', 'enabledLevels', 'enabledSubjects'
];

class UserService {
    
    /**
     * Cria um novo Funcionário (User + StaffProfile).
     * Injeta 'schoolId' nos registros para garantir o vínculo.
     * [CORREÇÃO] Removemos transações ACID para compatibilidade com MongoDB Standalone (Local e Render).
     */
    async createStaff(fullData, schoolId, file) { // Adicionei 'file' caso precise tratar upload aqui
        // Separa os dados
        const userData = {};
        const profileData = {};
        
        Object.keys(fullData).forEach(key => {
            if (userModelFields.includes(key)) {
                userData[key] = fullData[key];
            } else if (staffProfileModelFields.includes(key)) {
                profileData[key] = fullData[key];
            }
        });

        // --- [CRÍTICO] INJETA O ID DA ESCOLA ---
        userData.school_id = schoolId;
        profileData.school_id = schoolId; 
        // --------------------------------------

        // Lógica Unificada (Funciona em Local e Produção sem Replica Set)
        let newUser;

        try {
            // 1. Cria User
            // Nota: Se você tiver lógica de upload de imagem (S3/Firebase), 
            // ela geralmente ocorre antes ou aqui, atualizando userData.profilePictureUrl
            
            newUser = new User(userData);
            await newUser.save();
            
            // 2. Cria Profile
            profileData.user = newUser._id;
            const newProfile = new StaffProfile(profileData);
            await newProfile.save();

            // 3. Linka o Profile no User
            newUser.staffProfiles.push(newProfile._id);
            await newUser.save();

            // 4. Retorna populado
            const populatedUser = await this.getUserById(newUser._id, schoolId);
            appEmitter.emit('user:created', populatedUser);
            return populatedUser;
            
        } catch (error) {
            // ROLLBACK MANUAL
            // Se algo der errado (ex: erro ao criar profile), apagamos o usuário recém-criado
            // para não deixar "lixo" no banco.
            if (newUser && newUser._id) {
                console.warn(`[UserService] Reversão: Falha ao criar StaffProfile. Removendo user ${newUser._id}...`);
                try {
                    await User.findByIdAndDelete(newUser._id);
                } catch (deleteError) {
                    console.error('[UserService] Erro crítico ao tentar reverter usuário:', deleteError);
                }
            }
            throw error;
        }
    }

    /**
     * Cria um usuário simples (sem perfil de staff).
     */
    async createUser(userData, schoolId) {
        // Injeta a escola
        const dataToSave = { ...userData, school_id: schoolId };

        const newUser = new User(dataToSave);
        await newUser.save();
        
        const userObject = newUser.toObject();
        delete userObject.password;
        
        appEmitter.emit('user:created', userObject);
        return userObject;
    }

    /**
     * Busca todos os usuários APENAS da escola informada.
     */
    async getAllUsers(schoolId) {
        return await User.find({ school_id: schoolId })
            .select('-password')
            .populate({
                path: 'staffProfiles',
                populate: { path: 'enabledSubjects', model: 'Subject' } 
            });
    }

    /**
     * Busca um usuário por ID, garantindo que pertença à escola.
     */
    async getUserById(id, schoolId) {
        const user = await User.findOne({ _id: id, school_id: schoolId })
            .select('-password')
            .populate({
                path: 'staffProfiles',
                populate: { path: 'enabledSubjects', model: 'Subject' } 
            });
            
        if (!user) {
            throw new Error('Usuário não encontrado ou não pertence a esta escola.');
        }
        return user;
    }

    /**
     * Atualiza um funcionário.
     */
    async updateStaff(id, updateData, schoolId, file) { // Adicionei 'file' para manter padrão
        if (updateData.password) delete updateData.password;
        
        // 1. Busca e Valida Propriedade
        const user = await User.findOne({ _id: id, school_id: schoolId });
        if (!user) throw new Error('Usuário não encontrado ou não pertence a esta escola.');

        const userData = {};
        const profileData = {};
        Object.keys(updateData).forEach(key => {
            if (userModelFields.includes(key)) userData[key] = updateData[key];
            else if (staffProfileModelFields.includes(key)) profileData[key] = updateData[key];
        });

        // Garante que não muda a escola
        delete userData.school_id;
        delete profileData.school_id;

        // 2. Atualiza User
        if (Object.keys(userData).length > 0) {
            Object.assign(user, userData);
            await user.save();
        }

        // 3. Atualiza StaffProfile (se existir)
        if (Object.keys(profileData).length > 0 && user.staffProfiles.length > 0) {
            const profileId = user.staffProfiles[0];
            await StaffProfile.findByIdAndUpdate(profileId, profileData, { new: true, runValidators: true });
        }

        const fullyPopulatedUser = await this.getUserById(id, schoolId); 
        appEmitter.emit('user:updated', fullyPopulatedUser);
        return fullyPopulatedUser;
    }

    /**
     * Inativa um usuário da escola.
     */
    async inactivateUser(id, schoolId) {
        const user = await User.findOneAndUpdate(
            { _id: id, school_id: schoolId }, // Filtro seguro
            { status: 'Inativo' },
            { new: true }
        ).select('-password').populate('staffProfiles');

        if (!user) {
            throw new Error('Usuário não encontrado ou não pertence a esta escola.');
        }

        appEmitter.emit('user:updated', user); 
        return user;
    }
}

module.exports = new UserService();