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
async updateTutorRelationship(studentId, tutorId, newRelationship) {
        try {
            console.log(`[SERVICE] Atualizando relacionamento: Aluno ${studentId}, Tutor ${tutorId}`);
            
            // Encontra o aluno pelo ID
            const student = await Student.findById(studentId);
            if (!student) {
                throw new Error('Aluno não encontrado.');
            }

            // Encontra o vínculo do tutor dentro do array 'tutors' do aluno
            // Usamos .find() para obter a referência direta ao subdocumento
            const tutorLink = student.tutors.find(
                (t) => t.tutorInfo.toString() === tutorId
            );

            if (!tutorLink) {
                throw new Error('Vínculo com tutor não encontrado no aluno.');
            }

            // Atualiza o campo relationship
            tutorLink.relationship = newRelationship;

            // Salva o documento PAI (o aluno) para persistir a mudança no subdocumento
            await student.save();

            // Popula o 'tutorInfo' do vínculo específico que acabamos de salvar
            // para retornar os dados completos para o Flutter
            await student.populate({
                path: 'tutors.tutorInfo',
                model: 'Tutor' // Certifique-se que 'Tutor' é o nome do seu model
            });
            
            // Encontra o vínculo recém-populado para retornar
            const updatedPopulatedLink = student.tutors.find(
                 (t) => t.tutorInfo._id.toString() === tutorId
            );

            return updatedPopulatedLink; // Retorna o TutorInStudent atualizado e populado

        } catch (error) {
            console.error(`Erro no service ao ATUALIZAR relacionamento:`, error.message);
            throw new Error(`Erro ao atualizar relacionamento: ${error.message}`);
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
async updateTutor(id, tutorData) {
        try {
            // Encontra o tutor pelo ID e atualiza com os novos dados (tutorData)
            // { new: true } garante que o método retorne o documento ATUALIZADO
            const updatedTutor = await Tutor.findByIdAndUpdate(id, tutorData, { new: true });
            
            if (!updatedTutor) {
                console.warn(`[SERVICE] Tentativa de atualizar tutor não encontrado: ${id}`);
            }

            return updatedTutor; // Retorna o tutor atualizado
        } catch (error) {
            console.error(`Erro no service ao ATUALIZAR tutor por ID (${id}):`, error.message);
            throw new Error(`Erro ao atualizar tutor: ${error.message}`);
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