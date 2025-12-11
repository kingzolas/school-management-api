// src/api/controllers/user.controller.js
const UserService = require('../services/user.service');
const User = require('../models/user.model');

// --- HELPER PARA LIMPEZA E PARSE DE DADOS ---
const parseAndCleanBody = (body) => {
    const cleaned = { ...body };

    // 1. Conversão de Strings vazias para NULL
    // Isso evita o erro de validação (ex: Email inválido) quando o campo vem vazio "" do formulário
    const fieldsToNullify = ['email', 'cpf', 'rg', 'enrollmentNumber', 'birthDate', 'phoneNumber'];
    
    fieldsToNullify.forEach(field => {
        if (cleaned[field] === '' || cleaned[field] === 'null' || cleaned[field] === 'undefined') {
            cleaned[field] = null;
        }
    });

    // 2. Parse de campos JSON (String -> Objeto)
    // Necessário quando usamos multipart/form-data
    const jsonFields = ['address', 'healthInfo', 'roles', 'documents']; 

    jsonFields.forEach(field => {
        if (cleaned[field] && typeof cleaned[field] === 'string') {
            try {
                if (cleaned[field] === 'null' || cleaned[field] === 'undefined') {
                    cleaned[field] = null;
                } else {
                    cleaned[field] = JSON.parse(cleaned[field]);
                }
            } catch (e) {
                console.error(`Erro ao fazer parse do campo ${field}:`, e.message);
                // Se der erro, mantemos o valor original ou removemos, dependendo da estratégia
            }
        }
    });

    // 3. Conversão de Booleanos (String -> Boolean)
    if (cleaned.isActive === 'true') cleaned.isActive = true;
    if (cleaned.isActive === 'false') cleaned.isActive = false;

    return cleaned;
};

class UserController {

    /**
     * [ROTA PÚBLICA] Cria o primeiro admin de uma escola (Setup).
     * POST /api/users/setup-admin
     */
    async createFirstAdmin(req, res, next) {
        try {
            // Limpa os dados antes de processar
            const cleanData = parseAndCleanBody(req.body);
            const { school_id, ...userData } = cleanData;

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

            // [CORREÇÃO] Aplicar a limpeza e parse nos dados
            const userData = parseAndCleanBody(req.body);

            // Passa os dados limpos e o arquivo (req.file) para o service
            // Nota: Se seu UserService.createStaff não aceitar req.file como 3º argumento,
            // você precisará ajustar o Service também, mas geralmente a lógica de foto fica lá.
            const newUser = await UserService.createStaff(userData, schoolId, req.file);
            
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

            // Também limpamos aqui por segurança
            const userData = parseAndCleanBody(req.body);

            const user = await UserService.createUser(userData, schoolId);
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

            // [CORREÇÃO] Parse e limpeza antes do update
            const userData = parseAndCleanBody(req.body);

            // Passamos req.file caso esteja atualizando a foto
            const user = await UserService.updateStaff(userId, userData, schoolId, req.file);
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

    async updateFcmToken(req, res, next) {
        try {
            const { fcmToken } = req.body;
            const userId = req.user.id; // Vem do token JWT decodificado pelo middleware

            if (!fcmToken) {
                return res.status(400).json({ message: 'Token FCM é obrigatório.' });
            }

            // Usamos $addToSet para evitar duplicar o mesmo token no array
            await User.findByIdAndUpdate(userId, {
                $addToSet: { fcmToken: fcmToken }
            });

            return res.status(200).json({ message: 'Token de notificação atualizado com sucesso.' });
        } catch (error) {
            console.error('❌ ERRO [UserController.updateFcmToken]:', error.message);
            return res.status(500).json({ message: 'Erro ao atualizar token de notificação.' });
        }
    }
}

module.exports = new UserController();