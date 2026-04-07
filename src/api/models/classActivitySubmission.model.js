const mongoose = require('mongoose');

const { Schema } = mongoose;

const DELIVERY_STATUSES = [
  'PENDING',
  'DELIVERED',
  'PARTIAL',
  'NOT_DELIVERED',
  'EXCUSED',
];

const classActivitySubmissionSchema = new Schema(
  {
    schoolId: {
      type: Schema.Types.ObjectId,
      ref: 'School',
      required: true,
      index: true,
    },
    classId: {
      type: Schema.Types.ObjectId,
      ref: 'Class',
      required: true,
      index: true,
    },
    activityId: {
      type: Schema.Types.ObjectId,
      ref: 'ClassActivity',
      required: true,
      index: true,
    },
    teacherId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    studentId: {
      type: Schema.Types.ObjectId,
      ref: 'Student',
      required: true,
      index: true,
    },
    enrollmentId: {
      type: Schema.Types.ObjectId,
      ref: 'Enrollment',
      default: null,
      index: true,
    },
    deliveryStatus: {
      type: String,
      enum: DELIVERY_STATUSES,
      default: 'PENDING',
      index: true,
    },
    submittedAt: {
      type: Date,
      default: null,
    },
    isCorrected: {
      type: Boolean,
      default: false,
      index: true,
    },
    correctedAt: {
      type: Date,
      default: null,
    },
    score: {
      type: Number,
      default: null,
      min: 0,
    },
    teacherNote: {
      type: String,
      default: '',
      trim: true,
    },
  },
  { timestamps: true }
);

classActivitySubmissionSchema.index(
  { activityId: 1, studentId: 1 },
  { unique: true }
);
classActivitySubmissionSchema.index({ activityId: 1, enrollmentId: 1 });
classActivitySubmissionSchema.index({ schoolId: 1, classId: 1, studentId: 1 });
classActivitySubmissionSchema.index({ schoolId: 1, classId: 1, deliveryStatus: 1 });

module.exports = mongoose.model(
  'ClassActivitySubmission',
  classActivitySubmissionSchema
);
