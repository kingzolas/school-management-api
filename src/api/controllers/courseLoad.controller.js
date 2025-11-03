const courseLoadService = require('../services/courseLoad.service.js');

class CourseLoadController {

 /**
 * Rota: GET /api/course-loads
 * Busca cargas horárias baseado em query filters (req.query)
 * Ex: ?periodoId=...&classId=...
 */
 async find(req, res) {
  try {
   const loads = await courseLoadService.find(req.query);
   res.status(200).json(loads);
  } catch (error) {
   res.status(500).json({ message: error.message });
  }
 }

 /**
 * Rota: POST /api/course-loads/batch
 * Salva (cria/atualiza) múltiplas cargas horárias.
 * Espera um body: { periodoId: '...', classId: '...', loads: [...] }
 */
 async batchSave(req, res) {
  try {
   const { periodoId, classId, loads } = req.body;
   const result = await courseLoadService.batchSave(periodoId, classId, loads);
   res.status(200).json({ message: 'Matriz salva com sucesso.', result });
  } catch (error) {
   res.status(500).json({ message: error.message });
  }
 }

 // --- Rotas CRUD Padrão (Opcionais) ---

 async create(req, res) {
  try {
   const newLoad = await courseLoadService.create(req.body);
   res.status(201).json(newLoad);
  } catch (error) {
   res.status(400).json({ message: error.message });
  }
 }

 async update(req, res) {
  try {
   const updatedLoad = await courseLoadService.update(req.params.id, req.body);
   res.status(200).json(updatedLoad);
  } catch (error) {
   res.status(404).json({ message: error.message });
  }
 }
}

module.exports = new CourseLoadController();