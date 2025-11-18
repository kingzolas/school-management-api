// src/api/controllers/user.controller.js
const UserService = require('../services/user.service');
const User = require('../models/user.model'); // Necessário para o createFirstAdmin

class UserController {

    /**
     * [ROTA PÚBLICA] Cria o primeiro admin de uma escola (Setup).
     * POST /api/users/setup-admin
     */
    async createFirstAdmin(req, res, next) {
        try {
            const { school_id, ...userData } = req.body;

            if (!school_id) {
                return res.status(400).json({ message: 'O ID da escola (school_id) é obrigatório.' });
            }

            // Verifica se já existem usuários nesta escola
            const existingUsers = await User.countDocuments({ school_id: school_id });
            
            if (existingUsers > 0) {
                return res.status(403).json({ 
                    message: 'Esta escola já possui usuários. Faça login para criar novos.' 
                });
            }

            // Cria o usuário ADMIN
            const adminPayload = {
                ...userData,
                school_id,
                roles: ['Admin', 'Coordenador'],
                status: 'Ativo'
            };

            const newUser = new User(adminPayload);
            await newUser.save();

            res.status(201).json({
                message: 'Administrador inicial criado com sucesso!',
                user: newUser
            });

        } catch (error) {
            console.error('Erro ao criar admin inicial:', error);
            res.status(500).json({ message: error.message });
        }
    }
    
    /**
     * [MODIFICADO] Cria um novo Funcionário (User + StaffProfile)
     * POST /api/users/staff
     */
    async createStaff(req, res, next) {
        try {
            const schoolId = req.user.school_id;
            if (!schoolId) {
                return res.status(403).json({ message: 'Usuário não está associado a uma escola.' });
            }

            // Passa o schoolId para o service
            const newUser = await UserService.createStaff(req.body, schoolId);
            res.status(201).json(newUser);

        } catch (error) {
            console.error('❌ ERRO [UserController.createStaff]:', error.message);
            
            if (error.code === 11000 || error.message.includes('unique') || error.message.includes('duplicata')) {
                 return res.status(409).json({ message: 'Erro de duplicata: CPF, E-mail ou Usuário já cadastrado.', error: error.message });
            }
            if (error.name === 'ValidationError') {
                 return res.status(400).json({ message: 'Erro de validação.', error: error.message });
            }
            next(error); 
        }
    }

    /**
     * [MODIFICADO] Cria um usuário simples
     * POST /api/users
     */
    async create(req, res, next) {
        try {
            const schoolId = req.user.school_id;
            if (!schoolId) {
                return res.status(403).json({ message: 'Usuário não está associado a uma escola.' });
            }

            const user = await UserService.createUser(req.body, schoolId);
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
     * [MODIFICADO] Busca todos os usuários da escola logada
     * GET /api/users
     */
    async getAll(req, res, next) {
        try {
            const schoolId = req.user.school_id;
            if (!schoolId) {
                return res.status(403).json({ message: 'Usuário não está associado a uma escola.' });
            }

            const users = await UserService.getAllUsers(schoolId);
            res.status(200).json(users);
        } catch (error) {
            console.error('❌ ERRO [UserController.getAll]:', error.message);
            next(error);
        }
    }

    /**
     * [MODIFICADO] Busca um usuário por ID (validando a escola)
     * GET /api/users/:id
     */
    async getById(req, res, next) {
        try {
            const schoolId = req.user.school_id;
            const userId = req.params.id;
            
            if (!schoolId) {
                return res.status(403).json({ message: 'Usuário não está associado a uma escola.' });
            }

            const user = await UserService.getUserById(userId, schoolId);
            res.status(200).json(user);

        } catch (error) {
            console.error('❌ ERRO [UserController.getById]:', error.message);
            if (error.message.includes('não encontrado') || error.message.includes('não pertence')) {
                 return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    /**
     * [MODIFICADO] Atualiza um usuário (validando a escola)
     * PATCH /api/users/:id
     */
    async update(req, res, next) { 
        try {
            const schoolId = req.user.school_id;
            const userId = req.params.id;

            if (!schoolId) {
                return res.status(403).json({ message: 'Usuário não está associado a uma escola.' });
            }

            const user = await UserService.updateStaff(userId, req.body, schoolId);
            res.status(200).json(user);

        } catch (error) {
            console.error('❌ ERRO [UserController.update]:', error.message);
            if (error.message.includes('não encontrado') || error.message.includes('não pertence')) {
                 return res.status(404).json({ message: error.message });
            }
            res.status(400).json({ message: 'Erro ao atualizar usuário', error: error.message });
        }
    }

    /**
     * [MODIFICADO] Inativa um usuário
     * PATCH /api/users/:id/inactivate
     */
    async inactivate(req, res, next) { 
        try {
            const schoolId = req.user.school_id;
            const userId = req.params.id;

            if (!schoolId) {
                return res.status(403).json({ message: 'Usuário não está associado a uma escola.' });
            }

            const user = await UserService.inactivateUser(userId, schoolId);
            res.status(200).json({ message: 'Usuário inativado com sucesso', user });

        } catch (error) {
            console.error('❌ ERRO [UserController.inactivate]:', error.message);
             if (error.message.includes('não encontrado') || error.message.includes('não pertence')) {
                 return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }
}

module.exports = new UserController();