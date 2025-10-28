const UserService = require('../services/user.service');
const mongoose = require('mongoose'); // Necessário para a transação
const appEmitter = require('../../loaders/eventEmitter'); // Importa o emitter

class UserController {
    
    /**
     * [NOVO] Cria um novo Funcionário (User + StaffProfile)
     */
    async createStaff(req, res, next) {
        // O Service decide se usa transação (Produção) ou não (Local)
        try {
            const newUser = await UserService.createStaff(req.body);
            // O service já emitiu o evento WebSocket
            res.status(201).json(newUser);

        } catch (error) {
            console.error('❌ ERRO [UserController.createStaff]:', error.message);
            
            if (error.code === 11000 || error.message.includes('unique') || error.message.includes('duplicata')) {
                 return res.status(409).json({ message: 'Erro de duplicata: CPF, E-mail ou Usuário já cadastrado.', error: error.message });
            }
            if (error.name === 'ValidationError') {
                 return res.status(400).json({ message: 'Erro de validação.', error: error.message });
            }
            next(error); // Passa outros erros
        }
    }

    /**
     * [Mantido] Cria um usuário simples (rota POST /)
     */
    async create(req, res, next) {
        try {
            const user = await UserService.createUser(req.body);
            res.status(201).json(user);
        } catch (error) {
            console.error('❌ ERRO [UserController.create]:', error.message);
            if (error.code === 11000) {
                 return res.status(409).json({ message: 'Erro de duplicata: Email ou Usuário já existe.', error: error.message });
            }
            res.status(400).json({ message: 'Erro ao criar usuário', error: error.message });
        }
    }

    /**
     * Busca todos os usuários (agora com perfis)
     */
    async getAll(req, res, next) {
        try {
            const users = await UserService.getAllUsers();
            res.status(200).json(users);
        } catch (error) {
            console.error('❌ ERRO [UserController.getAll]:', error.message);
            next(error);
        }
    }

    /**
     * Busca um usuário por ID (agora com perfil)
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
            next(error);
        }
    }

    /**
     * [CORRIGIDO] Esta função agora existe e chama o service correto.
     */
    async update(req, res, next) { 
        try {
            // Chama a nova função 'updateStaff' do service
            const user = await UserService.updateStaff(req.params.id, req.body);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado' });
            }
            // O service já emite o evento
            res.status(200).json(user);
        } catch (error) {
            console.error('❌ ERRO [UserController.update]:', error.message);
            res.status(400).json({ message: 'Erro ao atualizar usuário', error: error.message });
        }
    }

    /**
     * [CORRIGIDO] Esta função agora existe para a rota 'inactivate'.
     */
    async inactivate(req, res, next) { 
        try {
            const user = await UserService.inactivateUser(req.params.id);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado' });
            }
            // O service já emite o evento
            res.status(200).json({ message: 'Usuário inativado com sucesso', user });
        } catch (error) {
            console.error('❌ ERRO [UserController.inactivate]:', error.message);
            next(error);
        }
    }
}

module.exports = new UserController();