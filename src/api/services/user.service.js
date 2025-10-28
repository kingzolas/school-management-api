const mongoose = require('mongoose'); // <<< NOVO
const User = require('../models/user.model');
const StaffProfile = require('../models/staffProfile.model'); // <<< NOVO
const appEmitter = require('../../loaders/eventEmitter');

// Define quais campos pertencem ao User model (baseado no user.model.js)
const userModelFields = [
    'fullName', 'email', 'cpf', 'birthDate', 'gender', 
    'phoneNumber', 'phoneFixed', 'address', 'profilePictureUrl', 
    'username', 'password', 'roles', 'status'
];
const staffProfileModelFields = [
    'admissionDate', 'employmentType', 'mainRole', 'remunerationModel', 
    'salaryAmount', 'hourlyRate', 'weeklyWorkload', 
    'academicFormation', 'enabledLevels', 'enabledSubjects'
];

class UserService {
    
    /**
     * [NOVO] Cria um novo Funcionário (User + StaffProfile) usando transação.
     * Recebe o req.body completo e a sessão mongoose.
     */
    async createStaff(fullData, session) {
        // 1. Separa os dados do req.body
        const userData = {};
        const profileData = {};

        Object.keys(fullData).forEach(key => {
            if (userModelFields.includes(key)) {
                userData[key] = fullData[key];
            } else if (staffProfileModelFields.includes(key)) {
                profileData[key] = fullData[key];
            }
        });

        // 2. Cria o Usuário (senha será hasheada pelo pre-save hook)
        const newUser = (await User.create([userData], { session }))[0];

        // 3. Cria o StaffProfile, ligando ao novo User
        profileData.user = newUser._id;
        const newProfile = (await StaffProfile.create([profileData], { session }))[0];

        // 4. Liga o Perfil de volta ao Usuário
        newUser.staffProfiles.push(newProfile._id);
        await newUser.save({ session });

        // 5. O Controller fará o commit. Nós populamos e retornamos.
        // (População não funciona dentro da transação, buscamos de novo fora dela se necessário)
        
        // Emite o evento (a transação ainda não foi commitada, mas o objeto existe)
        // É melhor emitir no controller *após* o commit
        
        // Retorna o objeto de usuário criado (sem senha)
        const userObject = newUser.toObject();
        delete userObject.password;
        userObject.staffProfiles = [newProfile.toObject()]; // Anexa o perfil criado

        // Emite o evento com o usuário populado
        appEmitter.emit('user:created', userObject);

        return userObject;
    }

    /**
     * [Mantido] Cria um novo usuário simples (sem perfil).
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
            .populate('staffProfiles'); // <<< Popula os perfis de trabalho
    }

    /**
     * [ATUALIZADO] Busca um usuário por ID, populando seu perfil.
     */
    async getUserById(id) {
        return await User.findById(id)
            .select('-password')
            .populate('staffProfiles'); // <<< Popula o perfil de trabalho
    }

    /**
     * [ATUALIZADO] Atualiza um funcionário (User e StaffProfile).
     */
    async updateStaff(id, updateData) {
        // Impede que esta rota atualize a senha
        if (updateData.password) delete updateData.password;

        // 1. Separa os dados para User e StaffProfile
        const userData = {};
        const profileData = {};
        Object.keys(updateData).forEach(key => {
            if (userModelFields.includes(key)) {
                userData[key] = updateData[key];
            } else if (staffProfileModelFields.includes(key)) {
                profileData[key] = updateData[key];
            }
        });

        // 2. Atualiza o User (se houver dados para ele)
        let updatedUser = await User.findById(id);
        if (!updatedUser) {
            throw new Error('Usuário não encontrado.');
        }
        if (Object.keys(userData).length > 0) {
            updatedUser = await User.findByIdAndUpdate(id, userData, { new: true });
        }

        // 3. Atualiza o StaffProfile (se houver dados para ele)
        if (Object.keys(profileData).length > 0 && updatedUser.staffProfiles.length > 0) {
            // Assume que estamos atualizando o *primeiro* perfil de staff
            // (Para suportar múltiplos, a rota precisaria ser /api/staff-profiles/:profileId)
            const profileId = updatedUser.staffProfiles[0];
            await StaffProfile.findByIdAndUpdate(profileId, profileData, { new: true, runValidators: true });
        }

        // 4. Busca o usuário completo e populado para retornar e emitir
        const fullyPopulatedUser = await this.getUserById(id); // Re-busca para garantir dados populados

        appEmitter.emit('user:updated', fullyPopulatedUser);
        return fullyPopulatedUser;
    }

    /**
     * [ATUALIZADO] Inativa um usuário em vez de deletar.
     */
    async inactivateUser(id) {
        const user = await User.findById(id);
        if (!user) {
            throw new Error('Usuário não encontrado.');
        }

        user.status = 'Inativo';
        await user.save();
        
        // Popula o usuário inativado para enviar no evento
        await user.populate('staffProfiles');

        // Emite 'user:updated' pois o status mudou
        appEmitter.emit('user:updated', user); 
        
        const userObject = user.toObject();
        delete userObject.password;
        return userObject;
    }
}

module.exports = new UserService();