const Enrollment = require('../models/enrollment.model');
const Student = require('../models/student.model');
const Class = require('../models/class.model');
const {
  ensureClassAccess,
  getAccessibleClassIds,
  isPrivilegedActor,
} = require('./classAccess.service');

const defaultPopulation = [
  {
    path: 'student',
    select: 'fullName birthDate enrollmentNumber gender',
  },
  {
    path: 'class',
    select: 'name schoolYear grade shift',
  },
];

function normalizeFilter(filter = {}) {
  const normalized = { ...filter };

  if (normalized.classId && !normalized.class) {
    normalized.class = normalized.classId;
  }

  delete normalized.classId;

  return normalized;
}

class EnrollmentService {
  async createEnrollment(enrollmentData, schoolId) {
    const { studentId, classId, agreedFee } = enrollmentData;

    const student = await Student.findOne({ _id: studentId, school_id: schoolId });
    if (!student) {
      throw new Error(
        `Aluno ${studentId} nao encontrado ou nao pertence a esta escola.`
      );
    }

    const classDoc = await Class.findOne({ _id: classId, school_id: schoolId });
    if (!classDoc) {
      throw new Error(
        `Turma ${classId} nao encontrada ou nao pertence a esta escola.`
      );
    }

    const existingEnrollment = await Enrollment.findOne({
      student: studentId,
      academicYear: classDoc.schoolYear,
      school_id: schoolId,
    });

    if (existingEnrollment) {
      throw new Error(
        `Aluno ${student.fullName} ja possui matricula (${existingEnrollment.status}) no ano letivo ${classDoc.schoolYear}.`
      );
    }

    if (classDoc.capacity) {
      const currentEnrollments = await Enrollment.countDocuments({
        class: classId,
        status: 'Ativa',
        school_id: schoolId,
      });

      if (currentEnrollments >= classDoc.capacity) {
        throw new Error(
          `Turma ${classDoc.name} (${classDoc.schoolYear}) atingiu a capacidade maxima de ${classDoc.capacity} alunos.`
        );
      }
    }

    const fee =
      agreedFee !== undefined && agreedFee !== null ? agreedFee : classDoc.monthlyFee;
    if (fee < 0) {
      throw new Error('A mensalidade acordada nao pode ser negativa.');
    }

    const newEnrollment = new Enrollment({
      student: studentId,
      class: classId,
      academicYear: classDoc.schoolYear,
      agreedFee: fee,
      school_id: schoolId,
    });

    await newEnrollment.save();
    await newEnrollment.populate(defaultPopulation);

    return newEnrollment;
  }

  async getEnrollments(filter = {}, schoolId, actor = null) {
    const normalizedFilter = normalizeFilter(filter);
    const query = {
      ...normalizedFilter,
      school_id: schoolId,
    };

    if (query.class) {
      await ensureClassAccess(actor, schoolId, query.class);
    } else if (actor && !isPrivilegedActor(actor)) {
      const classIds = await getAccessibleClassIds(actor, schoolId);

      if (!Array.isArray(classIds) || classIds.length === 0) {
        return [];
      }

      query.class = { $in: classIds };
    }

    return Enrollment.find(query).populate(defaultPopulation);
  }

  async getEnrollmentById(id, schoolId, actor = null) {
    const enrollment = await Enrollment.findOne({
      _id: id,
      school_id: schoolId,
    }).populate(defaultPopulation);

    if (!enrollment) {
      throw new Error(
        `Matricula com ID ${id} nao encontrada ou nao pertence a esta escola.`
      );
    }

    if (actor && !isPrivilegedActor(actor)) {
      await ensureClassAccess(actor, schoolId, enrollment.class?._id || enrollment.class);
    }

    return enrollment;
  }

  async updateEnrollment(id, updateData, schoolId) {
    if (updateData.classId) {
      updateData.class = updateData.classId;
      delete updateData.classId;
    }

    const allowedUpdates = ['agreedFee', 'status', 'observations', 'class'];
    const updates = Object.keys(updateData);
    const isValidOperation = updates.every((update) => allowedUpdates.includes(update));

    if (!isValidOperation) {
      throw new Error('Atualizacao invalida! Campos nao permitidos.');
    }
    if (updateData.agreedFee !== undefined && updateData.agreedFee < 0) {
      throw new Error('A mensalidade acordada nao pode ser negativa.');
    }

    delete updateData.school_id;

    if (updateData.class) {
      const newClassDoc = await Class.findOne({
        _id: updateData.class,
        school_id: schoolId,
      });

      if (!newClassDoc) {
        throw new Error(
          `Nova turma ${updateData.class} nao encontrada ou nao pertence a esta escola.`
        );
      }

      updateData.academicYear = newClassDoc.schoolYear;
    }

    const updatedEnrollment = await Enrollment.findOneAndUpdate(
      { _id: id, school_id: schoolId },
      updateData,
      { new: true, runValidators: true }
    ).populate(defaultPopulation);

    if (!updatedEnrollment) {
      throw new Error(
        `Matricula com ID ${id} nao encontrada ou nao pertence a esta escola para atualizacao.`
      );
    }

    return updatedEnrollment;
  }

  async deleteEnrollment(id, schoolId) {
    const deletedEnrollment = await Enrollment.findOneAndDelete({
      _id: id,
      school_id: schoolId,
    });

    if (!deletedEnrollment) {
      throw new Error(
        `Matricula com ID ${id} nao encontrada ou nao pertence a esta escola para delecao.`
      );
    }

    return deletedEnrollment;
  }
}

module.exports = new EnrollmentService();
