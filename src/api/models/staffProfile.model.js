// src/api/models/staffProfile.model.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const staffProfileSchema = new Schema({
    user: { // Ligação com o User
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    
    // --- Seção 3: Informações Contratuais ---
    admissionDate: { type: Date, default: Date.now }, // Data de Admissão
    employmentType: { // Vínculo
        type: String,
        required: true,
        enum: ['Efetivo (CLT)', 'Prestador de Serviço (PJ)', 'Temporário', 'Estagiário']
    },
    mainRole: { // Cargo/Função
        type: String,
        required: true,
        trim: true
        // Ex: "Professor(a)", "Coordenador(a)", "Secretário(a)", "Auxiliar de Classe"
    },
    remunerationModel: { // Modelo de Remuneração
        type: String,
        required: true,
        enum: ['Salário Fixo Mensal', 'Pagamento por Hora/Aula']
    },
    salaryAmount: { // Valor do Salário (se Fixo)
        type: Number,
        min: 0,
        // Validação: obrigatório SE o modelo for 'Salário Fixo Mensal'
        required: function() { return this.remunerationModel === 'Salário Fixo Mensal'; }
    },
    hourlyRate: { // Valor da Hora/Aula (se Horista)
        type: Number,
        min: 0,
        // Validação: obrigatório SE o modelo for 'Pagamento por Hora/Aula'
        required: function() { return this.remunerationModel === 'Pagamento por Hora/Aula'; }
    },
    weeklyWorkload: { type: Number, min: 0 }, // Carga Horária

    // --- Seção 4: Habilitação Acadêmica ---
    academicFormation: { type: String, trim: true }, // Ex: "Graduado em Letras"
    enabledLevels: [{ // Níveis Habilitados
        type: String,
        enum: ['Educação Infantil', 'Ensino Fundamental I', 'Ensino Fundamental II', 'Ensino Médio']
    }],
    enabledSubjects: [{ // Disciplinas Habilitadas
        type: Schema.Types.ObjectId,
        ref: 'Subject' // Referência ao novo model de Disciplinas
    }],

    // --- Seção Avançada (Opcional) ---
    // availability: { ... } // Pode ser um objeto complexo com dias/horários
    // documents: [ { name: String, url: String } ] // Para upload de docs

}, { timestamps: true });

// Garante que um usuário não tenha dois perfis com o MESMO cargo (Ex: 2x "Professor")
staffProfileSchema.index({ user: 1, mainRole: 1 }, { unique: true });

const StaffProfile = mongoose.model('StaffProfile', staffProfileSchema);
module.exports = StaffProfile;