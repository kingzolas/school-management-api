const Tutor = require('../models/tutor.model');

class TutorService {

    /**
     * Busca todos os tutores cadastrados.
     * Popula os alunos associados a cada tutor.
     */
    async getAllTutors() {
        try {
            // .populate('students') busca os dados dos alunos referenciados
            const tutors = await Tutor.find().populate('students');
            return tutors;
        } catch (error) {
            console.error("Erro no service ao buscar todos os tutores:", error.message);
            throw new Error(`Erro ao buscar tutores: ${error.message}`);
        }
    }

    /**
     * Busca um tutor específico pelo seu ID.
     */
    async getTutorById(id) {
        try {
            const tutor = await Tutor.findById(id).populate('students');
            return tutor;
        } catch (error) {
            console.error(`Erro no service ao buscar tutor por ID (${id}):`, error.message);
            throw new Error(`Erro ao buscar tutor: ${error.message}`);
        }
    }

    /**
     * Busca um tutor específico pelo seu CPF.
     * Esta é a função que o seu frontend vai chamar.
     */
    async findTutorByCpf(cpf) {
        try {
            // Busca na coleção 'tutors' onde o campo 'cpf' bate
            const tutor = await Tutor.findOne({ cpf: cpf });
            return tutor;
        } catch (error) {
            console.error(`Erro no service ao buscar tutor por CPF (${cpf}):`, error.message);
            throw new Error(`Erro ao buscar tutor por CPF: ${error.message}`);
        }
    }

    /* Nota: A lógica de "criar" ou "atualizar" o tutor
    pode ficar aqui, ou pode ficar dentro do 'student.service' 
    (como no exemplo anterior) para garantir que a criação 
    do aluno e do tutor seja feita na mesma operação (transação). 
    Por enquanto, vamos focar na busca.
    */
}

module.exports = new TutorService();