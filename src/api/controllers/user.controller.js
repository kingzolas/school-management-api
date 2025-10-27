const UserService = require('../services/user.service');
const mongoose = require('mongoose'); // Necessário para a transação

class UserController {
    
    /**
     * [NOVO] Cria um novo Funcionário (User + StaffProfile)
     */
    async createStaff(req, res, next) {
        // Inicia a sessão do Mongoose para a transação
        const session = await mongoose.startSession();
        session.startTransaction();
        try {
            // Os dados do User e do StaffProfile vêm no req.body
            // O Service separará os dados e criará os dois documentos
            const newUser = await UserService.createStaff(req.body, session);
            
            // Se tudo deu certo, commita a transação
            await session.commitTransaction();
            
            // O service já emite o evento WebSocket
            res.status(201).json(newUser);

        } catch (error) {
            // Se algo deu errado, desfaz a transação
            await session.abortTransaction();
            console.error('❌ ERRO [UserController.createStaff]:', error.message);
            
            if (error.code === 11000) { // Erro de duplicata (Email, CPF, Username)
                 return res.status(409).json({ message: 'Erro de duplicata.', error: error.message });
            }
            res.status(400).json({ message: 'Erro ao criar funcionário.', error: error.message });
            // next(error); // Alternativa
        } finally {
            // Fecha a sessão
            session.endSession();
        }
    }

    /**
     * [Mantido] Cria um usuário simples (sem perfil de staff)
     */
    async create(req, res, next) {
        try {
            const user = await UserService.createUser(req.body);
            res.status(201).json(user);
        } catch (error) {
            console.error('❌ ERRO [UserController.create]:', error.message);
            if (error.code === 11000) {
                 return res.status(409).json({ message: 'Erro de duplicata.', error: error.message });
            }
            res.status(400).json({ message: 'Erro ao criar usuário', error: error.message });
            // next(error);
        }
    }

    /**
     * [Atualizado] Busca todos os usuários (agora com perfis)
     */
    async getAll(req, res, next) {
        try {
            const users = await UserService.getAllUsers();
            res.status(200).json(users);
        } catch (error) {
            console.error('❌ ERRO [UserController.getAll]:', error.message);
            res.status(500).json({ message: 'Erro ao buscar usuários', error: error.message });
            // next(error);
        }
    }

    /**
     * [Atualizado] Busca um usuário por ID (agora com perfil)
     */
    async getById(req, res, next) {
        try {
            const user = await UserService.getUserById(req.params.id);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado' });
            }
            res.status(200).json(user);
        } catch (error) {
            console.error('❌ ERRO [UserController.getById]:', error.message);
            res.status(500).json({ message: 'Erro ao buscar usuário', error: error.message });
            // next(error);
        }
    }

    /**
     * [NOVO] Atualiza dados do User e/ou StaffProfile
     */
    async updateStaff(req, res, next) {
        try {
            // O service agora lida com a separação dos dados
            const user = await UserService.updateStaff(req.params.id, req.body);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado' });
            }
            res.status(200).json(user);
        } catch (error) {
            console.error('❌ ERRO [UserController.updateStaff]:', error.message);
            res.status(400).json({ message: 'Erro ao atualizar usuário', error: error.message });
            // next(error);
        }
    }

    /**
     * [NOVO] Inativa um usuário
     */
    async inactivate(req, res, next) {
        try {
            const user = await UserService.inactivateUser(req.params.id);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado' });
            }
            res.status(200).json({ message: 'Usuário inativado com sucesso', user });
        } catch (error) {
            console.error('❌ ERRO [UserController.inactivate]:', error.message);
            res.status(500).json({ message: 'Erro ao inativar usuário', error: error.message });
            // next(error);
        }
    }
}

module.exports = new UserController();