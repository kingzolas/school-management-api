const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const OFFER_TYPES = [
  'full_time',
  'extended_stay',
  'complementary_activity',
  'reinforcement',
  'other',
];

const OFFER_STATUSES = ['active', 'inactive'];
const PRICING_MODES = ['total', 'additional'];
const PERMANENCE_CLASS_MODES = ['none', 'optional', 'required'];
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeOfferName(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseTimeToMinutes(value) {
  if (!TIME_REGEX.test(String(value || ''))) return null;
  const [hours, minutes] = String(value).split(':').map(Number);
  return hours * 60 + minutes;
}

const enrollmentOfferSchema = new Schema(
  {
    school_id: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: [true, 'A referencia da escola (school_id) e obrigatoria.'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'O nome da oferta e obrigatorio.'],
      trim: true,
    },
    nameNormalized: {
      type: String,
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: OFFER_TYPES,
      required: [true, 'O tipo da oferta e obrigatorio.'],
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: OFFER_STATUSES,
      default: 'active',
      index: true,
    },
    startTime: {
      type: String,
      trim: true,
      default: null,
    },
    endTime: {
      type: String,
      trim: true,
      default: null,
    },
    monthlyFee: {
      type: Number,
      required: [true, 'O valor mensal da oferta e obrigatorio.'],
      min: [0, 'O valor mensal da oferta nao pode ser negativo.'],
    },
    pricingMode: {
      type: String,
      enum: PRICING_MODES,
      default: 'total',
    },
    appliesToAllClasses: {
      type: Boolean,
      default: true,
    },
    applicableClassIds: [{
      type: Schema.Types.ObjectId,
      ref: 'Class',
    }],
    applicableEducationLevels: [{
      type: String,
      trim: true,
    }],
    publicVisible: {
      type: Boolean,
      default: false,
      index: true,
    },
    permanenceClassMode: {
      type: String,
      enum: PERMANENCE_CLASS_MODES,
      default: 'none',
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
);

enrollmentOfferSchema.pre('validate', function validateEnrollmentOffer(next) {
  this.nameNormalized = normalizeOfferName(this.name);

  if (this.startTime === '') this.startTime = null;
  if (this.endTime === '') this.endTime = null;

  if (this.type === 'full_time' && (!this.startTime || !this.endTime)) {
    this.invalidate('startTime', 'Ofertas de periodo integral precisam de horario de entrada e saida.');
  }

  if (this.startTime && !TIME_REGEX.test(this.startTime)) {
    this.invalidate('startTime', 'Horario de entrada invalido. Use HH:mm.');
  }

  if (this.endTime && !TIME_REGEX.test(this.endTime)) {
    this.invalidate('endTime', 'Horario de saida invalido. Use HH:mm.');
  }

  const startMinutes = parseTimeToMinutes(this.startTime);
  const endMinutes = parseTimeToMinutes(this.endTime);
  if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
    this.invalidate('endTime', 'Horario de saida deve ser posterior ao horario de entrada.');
  }

  if (
    this.appliesToAllClasses === false &&
    (!Array.isArray(this.applicableClassIds) || this.applicableClassIds.length === 0)
  ) {
    this.invalidate('applicableClassIds', 'Informe ao menos uma turma quando a oferta nao se aplica a todas.');
  }

  next();
});

enrollmentOfferSchema.index(
  { school_id: 1, nameNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'unique_active_enrollment_offer_name_by_school',
  }
);

module.exports = mongoose.model('EnrollmentOffer', enrollmentOfferSchema);
module.exports.OFFER_TYPES = OFFER_TYPES;
module.exports.OFFER_STATUSES = OFFER_STATUSES;
module.exports.PRICING_MODES = PRICING_MODES;
module.exports.PERMANENCE_CLASS_MODES = PERMANENCE_CLASS_MODES;
module.exports.normalizeOfferName = normalizeOfferName;
