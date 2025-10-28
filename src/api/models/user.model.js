// src/api/models/user.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const bcrypt = require('bcryptjs');
const addressSchema = require('./address.model');

const userSchema = new Schema({
    // --- Seção 1 e 2: Info Pessoal e Contato ---
    fullName: {
        type: String,
        required: [true, 'O nome completo é obrigatório.'],
        trim: true
    },
    profilePictureUrl: { type: String, default: null }, // (Seção 1 - Foto)
    cpf: { // (Seção 1)
        type: String,
        required: [true, 'O CPF é obrigatório.'],
        unique: true,
        sparse: true, // Garante CPF único, mas permite múltiplos nulos se não preenchido
        trim: true
    },
    birthDate: { type: Date }, // (Seção 1 - Data de Nascimento)
    gender: { // (Seção 1 - Gênero)
        type: String, 
        enum: ['Masculino', 'Feminino', 'Outro', 'Prefiro não dizer'] 
    }, 
    
    phoneNumber: { type: String, required: [true, 'O telefone celular é obrigatório.'], trim: true }, // (Seção 2)
    phoneFixed: { type: String, trim: true, default: '' }, // (Seção 2 - Opcional)
    address: { type: addressSchema }, // (Seção 2 - Endereço Completo)

    // --- Seção 5: Acesso ao Sistema ---
    email: { // (Seção 2 e 5 - Email Principal)
        type: String,
        required: [true, 'O e-mail é obrigatório.'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/\S+@\S+\.\S+/, 'Por favor, insira um e-mail válido.']
    },
    username: { // (Campo existente)
        type: String,
        required: [true, 'O nome de usuário é obrigatório.'],
        unique: true,
        lowercase: true,
        trim: true,
        minlength: [3, 'O nome de usuário deve ter no mínimo 3 caracteres.'],
        match: [/^[a-zA-Z0-9_.-]+$/, 'O nome de usuário pode conter apenas letras, números, _, . ou -']
    },
    password: {
        type: String,
        required: [true, 'A senha é obrigatória.'],
        minlength: [6, 'A senha deve ter no mínimo 6 caracteres.'],
        select: false // Não retorna a senha em buscas
    },
    roles: [{ // (Seção 5 - Perfil de Permissão)
        type: String,
        required: true,
        enum: ['Professor', 'Coordenador', 'Admin', 'Staff'], // Alinhado com sua proposta
    }],
    status: { // (Seção 3 - Status)
        type: String,
        enum: ['Ativo', 'Inativo'],
        default: 'Ativo',
        required: true
    },

    // --- Ligação com os Contratos/Perfis de Trabalho ---
    staffProfiles: [{ 
        type: Schema.Types.ObjectId, 
        ref: 'StaffProfile' 
    }]

}, {
    timestamps: true
});

// Hook para hashear a senha (inalterado)
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) {
        return next();
    }
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Método para comparar a senha (inalterado)
userSchema.methods.comparePassword = function(candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.model('User', userSchema);
module.exports = User;