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
     * [MODULAR] Cria um novo Funcionário (User + StaffProfile).
     * Usa Transações em Produção (NODE_ENV=production) e Reversão Manual em Desenvolvimento.
     */
    async createStaff(fullData) {
        // Separa os dados do req.body
        const userData = {};
        const profileData = {};
        Object.keys(fullData).forEach(key => {
            if (userModelFields.includes(key)) {
                userData[key] = fullData[key];
            } else if (staffProfileModelFields.includes(key)) {
                profileData[key] = fullData[key];
            }
        });

        // Verifica o ambiente
        if (process.env.NODE_ENV === 'production') {
            // --- LÓGICA DE PRODUÇÃO (COM TRANSAÇÃO) ---
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const newUserArr = await User.create([userData], { session });
                const newUser = newUserArr[0];

                profileData.user = newUser._id;
                const newProfileArr = await StaffProfile.create([profileData], { session });
                const newProfile = newProfileArr[0];

                newUser.staffProfiles.push(newProfile._id);
                await newUser.save({ session });

                await session.commitTransaction(); // Confirma tudo

                // Busca o usuário populado para retornar e emitir
                const populatedUser = await this.getUserById(newUser._id);
                appEmitter.emit('user:created', populatedUser);
                return populatedUser;

            } catch (error) {
                await session.abortTransaction(); // Desfaz tudo
                throw error; // Lança o erro para o controller
            } finally {
                session.endSession();
            }

        } else {
            // --- LÓGICA DE DESENVOLVIMENTO LOCAL (SEM TRANSAÇÃO) ---
            // (Usa reversão manual)
            let newUser;
            try {
                // 1. Cria o Usuário
                newUser = new User(userData);
                await newUser.save();
                
                // 2. Tenta criar o Perfil
                profileData.user = newUser._id;
                const newProfile = new StaffProfile(profileData);
                await newProfile.save();

                // 3. Liga o Perfil de volta ao Usuário
                newUser.staffProfiles.push(newProfile._id);
                await newUser.save();

                // 4. Busca o usuário populado para retornar e emitir
                const populatedUser = await this.getUserById(newUser._id);
                appEmitter.emit('user:created', populatedUser);
                return populatedUser;
                
            } catch (error) {
                // Se o usuário foi criado (newUser._id existe) mas o perfil falhou,
                // precisamos deletar o usuário "órfão".
                if (newUser && newUser._id) {
                    console.warn(`REVERSÃO: Falha ao criar StaffProfile. Deletando usuário ${newUser._id}...`);
                    await User.findByIdAndDelete(newUser._id);
                }
                // Lança o erro original (ex: falha de validação do StaffProfile)
                throw error;
            }
        }
    }

    /**
     * [Mantido] Cria um usuário simples (sem perfil).
     */
    async createUser(userData) {
        const newUser = new User(userData);
        await newUser.save();
        const userObject = newUser.toObject();
        delete userObject.password;
        appEmitter.emit('user:created', userObject);
        return userObject;
    }

    /**
     * [ATUALIZADO] Busca todos os usuários, populando seus perfis.
     */
    async getAllUsers() {
        return await User.find()
            .select('-password')
            .populate({
                path: 'staffProfiles',
                populate: { path: 'enabledSubjects', model: 'Subject' } // Popula as disciplinas dentro do perfil
            });
    }

    /**
     * [ATUALIZADO] Busca um usuário por ID, populando seu perfil.
     */
    async getUserById(id) {
        const user = await User.findById(id)
            .select('-password')
            .populate({
                path: 'staffProfiles',
                populate: { path: 'enabledSubjects', model: 'Subject' } // Popula as disciplinas
            });
        if (!user) throw new Error('Usuário não encontrado.');
        return user;
    }

    /**
     * [ATUALIZADO] Atualiza um funcionário (User e StaffProfile).
     */
    async updateStaff(id, updateData) {
        if (updateData.password) delete updateData.password;
        
        const userData = {};
        const profileData = {};
        Object.keys(updateData).forEach(key => {
            if (userModelFields.includes(key)) userData[key] = updateData[key];
            else if (staffProfileModelFields.includes(key)) profileData[key] = updateData[key];
        });

        const user = await User.findById(id);
        if (!user) throw new Error('Usuário não encontrado.');

        if (Object.keys(userData).length > 0) {
            Object.assign(user, userData);
            await user.save();
        }

        if (Object.keys(profileData).length > 0 && user.staffProfiles.length > 0) {
            const profileId = user.staffProfiles[0];
            await StaffProfile.findByIdAndUpdate(profileId, profileData, { new: true, runValidators: true });
        }

        const fullyPopulatedUser = await this.getUserById(id); 
        appEmitter.emit('user:updated', fullyPopulatedUser);
        return fullyPopulatedUser;
    }

    /**
     * [ATUALIZADO] Inativa um usuário (Status: 'Inativo')
     */
    async inactivateUser(id) {
        const user = await User.findByIdAndUpdate(
            id, { status: 'Inativo' }, { new: true }
        ).select('-password').populate('staffProfiles');

        if (!user) {
            throw new Error('Usuário não encontrado.');
        }

        appEmitter.emit('user:updated', user); 
        return user;
    }
}

module.exports = new UserService();