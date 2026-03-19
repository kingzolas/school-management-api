const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const reportCardSubjectSchema = new Schema(
  {
    subjectId: {
      type: Schema.Types.ObjectId,
      ref: 'Subject',
      required: true,
    },
    subjectNameSnapshot: {
      type: String,
      required: true,
      trim: true,
    },

    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    teacherNameSnapshot: {
      type: String,
      trim: true,
      default: null,
    },

    // --- NOVOS CAMPOS DE COMPOSIÇÃO DE NOTA ---
    testScore: {
      type: Number,
      min: 0,
      max: 10,
      default: null,
    },
    activityScore: {
      type: Number,
      min: 0,
      max: 10,
      default: null,
    },
    participationScore: {
      type: Number,
      min: 0,
      max: 10,
      default: null,
    },
    // -----------------------------------------

    score: {
      type: Number,
      min: 0,
      max: 10,
      default: null,
    },

    status: {
      type: String,
      enum: [
        'Pendente',
        'Preenchido',
        'Abaixo da Média',
        'Acima da Média',
        'Em Revisão',
      ],
      default: 'Pendente',
    },

    observation: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: '',
    },

    filledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    filledAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const reportCardSchema = new Schema(
  {
    school_id: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: [true, 'A referência da escola (school_id) é obrigatória.'],
      index: true,
    },

    schoolYear: {
      type: Number,
      required: [true, 'O ano letivo é obrigatório.'],
      index: true,
    },

    termId: {
      type: Schema.Types.ObjectId,
      ref: 'Periodo',
      required: [true, 'O período/bimestre (termId) é obrigatório.'],
      index: true,
    },

    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      required: [true, 'A turma (classId) é obrigatória.'],
      index: true,
    },

    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: [true, 'O aluno (studentId) é obrigatório.'],
      index: true,
    },

    enrollmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Enrollment',
      required: [true, 'A matrícula (enrollmentId) é obrigatória.'],
      index: true,
    },

    gradingType: {
      type: String,
      enum: ['numeric'],
      default: 'numeric',
      required: true,
    },

    minimumAverage: {
      type: Number,
      required: true,
      default: 7.0,
      min: 0,
      max: 10,
    },

    status: {
      type: String,
      enum: [
        'Rascunho',
        'Em Preenchimento',
        'Parcial',
        'Completo',
        'Aguardando Conferência',
        'Liberado',
        'Impresso',
      ],
      default: 'Rascunho',
      index: true,
    },

    responsibleNameSnapshot: {
      type: String,
      trim: true,
      default: '',
    },

    generalObservation: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },

    subjects: {
      type: [reportCardSubjectSchema],
      default: [],
    },

    releasedForPrint: {
      type: Boolean,
      default: false,
      index: true,
    },

    releasedAt: {
      type: Date,
      default: null,
    },

    releasedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

// Garante 1 boletim por aluno por turma por período por ano letivo dentro da escola
reportCardSchema.index(
  {
    school_id: 1,
    schoolYear: 1,
    termId: 1,
    classId: 1,
    studentId: 1,
  },
  { unique: true }
);

const ReportCard = mongoose.model('ReportCard', reportCardSchema);

module.exports = ReportCard;