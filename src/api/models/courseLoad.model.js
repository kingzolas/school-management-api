const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// [CORREÇÃO 1]
// Garante que o Mongoose registrou o modelo 'Subject' antes de tentarmos
// criar uma referência (ref) a ele.
// (Ajuste o caminho se o seu arquivo for 'disciplina.model.js')
require('./subject.model.js'); 

const courseLoadSchema = new Schema({
  periodoId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Periodo', 
    required: true 
  },
  classId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Class', 
    required: true 
  },
  subjectId: { 
    type: Schema.Types.ObjectId, 
        // [CORREÇÃO 2]
        // O nome aqui ('Subject') DEVE ser idêntico ao nome
        // usado em mongoose.model('Subject', ...) no seu arquivo de disciplina.
    ref: 'Subject', 
    required: true 
  },
  targetHours: { 
    type: Number, 
    required: true,
    min: 0
  }
}, { timestamps: true });

courseLoadSchema.index({ periodoId: 1, classId: 1, subjectId: 1 }, { unique: true });

const CourseLoad = mongoose.model('CourseLoad', courseLoadSchema);
module.exports = CourseLoad;