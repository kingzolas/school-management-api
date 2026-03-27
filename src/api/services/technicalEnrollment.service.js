const TechnicalEnrollment = require('../models/technicalEnrollment.model');
const Student = require('../models/student.model');
const Company = require('../models/company.model');
const TechnicalProgram = require('../models/technicalProgram.model');
const TechnicalProgramModule = require('../models/technicalProgramModule.model');
const TechnicalProgramOffering = require('../models/technicalProgramOffering.model');
const TechnicalProgramOfferingModule = require('../models/technicalProgramOfferingModule.model');
const TechnicalModuleRecord = require('../models/technicalModuleRecord.model');
const TechnicalEnrollmentOfferingMovement = require('../models/technicalEnrollmentOfferingMovement.model');
const TechnicalClassMovement = require('../models/technicalClassMovement.model');
const Class = require('../models/class.model');

const defaultPopulation = [
    { path: 'studentId', select: 'fullName birthDate cpf' },
    { path: 'companyId', select: 'name legalName cnpj' },
    { path: 'technicalProgramId', select: 'name totalWorkloadHours' },
    {
        path: 'currentTechnicalProgramOfferingId',
        select: 'name code status plannedStartDate plannedEndDate actualStartDate actualEndDate shift capacity defaultSpaceId',
        populate: [
            { path: 'defaultSpaceId', select: 'name type capacity status' },
            {
                path: 'modules',
                options: { sort: { executionOrder: 1 } },
                populate: [
                    { path: 'technicalProgramModuleId', select: 'name moduleOrder workloadHours subjectId status', populate: { path: 'subjectId', select: 'name level' } },
                    { path: 'prerequisiteModuleIds', select: 'name moduleOrder workloadHours status' },
                    { path: 'scheduleSlots.teacherIds', select: 'fullName email roles status' },
                    { path: 'scheduleSlots.spaceId', select: 'name type capacity status' }
                ]
            }
        ]
    },
    { path: 'currentClassId', select: 'name schoolYear grade shift' }
];

const hasValue = (value) => value !== undefined && value !== null && value !== '';
const getDocumentId = (value) => {
    if (!value) {
        return null;
    }

    if (typeof value === 'object' && value._id) {
        return String(value._id);
    }

    return String(value);
};

const getRecordStatusBucket = (status, hasRecord) => {
    if (!hasRecord) {
        return 'Pendente';
    }

    return status || 'Pendente';
};

const resolveOverallStatus = (moduleSummaries) => {
    if (moduleSummaries.length === 0) {
        return 'Pendente';
    }

    const allCompleted = moduleSummaries.every((module) => module.status === 'Concluído');
    if (allCompleted) {
        return 'Concluída';
    }

    const hasAnyProgress = moduleSummaries.some((module) => (
        module.status === 'Concluído'
        || module.status === 'Em andamento'
        || module.status === 'Repetindo'
        || module.status === 'Reprovado'
    ));

    return hasAnyProgress ? 'Em andamento' : 'Pendente';
};

class TechnicalEnrollmentService {
    async createTechnicalEnrollment(enrollmentData, schoolId) {
        const {
            studentId,
            companyId,
            technicalProgramId,
            currentTechnicalProgramOfferingId,
            currentClassId
        } = enrollmentData;

        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) {
            throw new Error(`Participante ${studentId} nao encontrado ou nao pertence a esta escola.`);
        }

        const company = await Company.findOne({ _id: companyId, school_id: schoolId });
        if (!company) {
            throw new Error(`Empresa ${companyId} nao encontrada ou nao pertence a esta escola.`);
        }

        const technicalProgram = await TechnicalProgram.findOne({
            _id: technicalProgramId,
            school_id: schoolId
        });
        if (!technicalProgram) {
            throw new Error(`Programa tecnico ${technicalProgramId} nao encontrado ou nao pertence a esta escola.`);
        }

        if (hasValue(currentTechnicalProgramOfferingId)) {
            const technicalProgramOffering = await TechnicalProgramOffering.findOne({
                _id: currentTechnicalProgramOfferingId,
                school_id: schoolId
            });

            if (!technicalProgramOffering) {
                throw new Error(`Oferta tecnica ${currentTechnicalProgramOfferingId} nao encontrada ou nao pertence a esta escola.`);
            }

            if (String(technicalProgramOffering.technicalProgramId) !== String(technicalProgramId)) {
                throw new Error('A oferta tecnica informada nao pertence ao programa tecnico da matricula.');
            }
        }

        if (hasValue(currentClassId)) {
            const currentClass = await Class.findOne({ _id: currentClassId, school_id: schoolId });
            if (!currentClass) {
                throw new Error(`Turma ${currentClassId} nao encontrada ou nao pertence a esta escola.`);
            }
        }

        const existingEnrollment = await TechnicalEnrollment.findOne({
            studentId,
            technicalProgramId,
            school_id: schoolId
        });
        if (existingEnrollment) {
            throw new Error(`O participante ${student.fullName} ja possui matricula tecnica neste programa.`);
        }

        try {
            const newEnrollment = new TechnicalEnrollment({
                ...enrollmentData,
                currentTechnicalProgramOfferingId: hasValue(currentTechnicalProgramOfferingId) ? currentTechnicalProgramOfferingId : null,
                currentClassId: hasValue(currentClassId) ? currentClassId : null,
                status: enrollmentData.status || ((hasValue(currentClassId) || hasValue(currentTechnicalProgramOfferingId)) ? 'Ativa' : 'Pendente'),
                school_id: schoolId
            });

            await newEnrollment.save();
            await newEnrollment.populate(defaultPopulation);

            return newEnrollment;
        } catch (error) {
            if (error.code === 11000) {
                throw new Error('Ja existe uma matricula tecnica para este participante neste programa.');
            }
            throw error;
        }
    }

    async getAllTechnicalEnrollments(filter = {}, schoolId) {
        const query = { ...filter };
        delete query.school_id;

        return await TechnicalEnrollment.find({
            ...query,
            school_id: schoolId
        })
            .populate(defaultPopulation)
            .sort({ createdAt: -1 });
    }

    async getTechnicalEnrollmentById(id, schoolId) {
        const enrollment = await TechnicalEnrollment.findOne({
            _id: id,
            school_id: schoolId
        }).populate(defaultPopulation);

        if (!enrollment) {
            throw new Error('Matricula tecnica nao encontrada ou nao pertence a esta escola.');
        }

        return enrollment;
    }

    async updateTechnicalEnrollment(id, updateData, schoolId) {
        delete updateData.school_id;

        const currentEnrollment = await TechnicalEnrollment.findOne({
            _id: id,
            school_id: schoolId
        });

        if (!currentEnrollment) {
            throw new Error('Matricula tecnica nao encontrada para atualizar.');
        }

        const hasOperationalHistory = async () => Promise.all([
            TechnicalModuleRecord.exists({
                technicalEnrollmentId: id,
                school_id: schoolId
            }),
            TechnicalEnrollmentOfferingMovement.exists({
                technicalEnrollmentId: id,
                school_id: schoolId
            }),
            TechnicalClassMovement.exists({
                technicalEnrollmentId: id,
                school_id: schoolId
            })
        ]).then((results) => results.some(Boolean));

        if (updateData.studentId) {
            if (String(updateData.studentId) !== String(currentEnrollment.studentId) && (currentEnrollment.currentClassId || currentEnrollment.currentTechnicalProgramOfferingId || await hasOperationalHistory())) {
                throw new Error('Nao e permitido alterar o participante de uma matricula que ja possui historico ou vinculo operacional.');
            }

            const student = await Student.findOne({
                _id: updateData.studentId,
                school_id: schoolId
            });

            if (!student) {
                throw new Error(`Participante ${updateData.studentId} nao encontrado ou nao pertence a esta escola.`);
            }
        }

        if (updateData.companyId) {
            if (String(updateData.companyId) !== String(currentEnrollment.companyId) && (currentEnrollment.currentClassId || currentEnrollment.currentTechnicalProgramOfferingId || await hasOperationalHistory())) {
                throw new Error('Nao e permitido alterar a empresa de uma matricula que ja possui historico ou vinculo operacional.');
            }

            const company = await Company.findOne({
                _id: updateData.companyId,
                school_id: schoolId
            });

            if (!company) {
                throw new Error(`Empresa ${updateData.companyId} nao encontrada ou nao pertence a esta escola.`);
            }
        }

        if (updateData.technicalProgramId) {
            const technicalProgram = await TechnicalProgram.findOne({
                _id: updateData.technicalProgramId,
                school_id: schoolId
            });

            if (!technicalProgram) {
                throw new Error(`Programa tecnico ${updateData.technicalProgramId} nao encontrado ou nao pertence a esta escola.`);
            }
        }

        const nextTechnicalProgramId = updateData.technicalProgramId || currentEnrollment.technicalProgramId;
        if (updateData.technicalProgramId && String(updateData.technicalProgramId) !== String(currentEnrollment.technicalProgramId)) {
            const [hasModuleRecords, hasOfferingMovementHistory] = await Promise.all([
                TechnicalModuleRecord.exists({
                    technicalEnrollmentId: id,
                    school_id: schoolId
                }),
                TechnicalEnrollmentOfferingMovement.exists({
                    technicalEnrollmentId: id,
                    school_id: schoolId
                })
            ]);

            if (currentEnrollment.currentTechnicalProgramOfferingId || hasModuleRecords || hasOfferingMovementHistory) {
                throw new Error('Nao e permitido alterar o programa tecnico de uma matricula que ja possui historico, oferta ou movimentacao vinculada.');
            }
        }

        const currentOfferingId = hasValue(currentEnrollment.currentTechnicalProgramOfferingId)
            ? String(currentEnrollment.currentTechnicalProgramOfferingId)
            : null;

        if (Object.prototype.hasOwnProperty.call(updateData, 'currentTechnicalProgramOfferingId')) {
            const nextOfferingId = hasValue(updateData.currentTechnicalProgramOfferingId)
                ? String(updateData.currentTechnicalProgramOfferingId)
                : null;

            if (currentOfferingId && currentOfferingId !== nextOfferingId) {
                throw new Error('A troca de oferta tecnica deve ser registrada pelo fluxo de movimentacao de oferta.');
            }

            if (hasValue(nextOfferingId)) {
                const technicalProgramOffering = await TechnicalProgramOffering.findOne({
                    _id: nextOfferingId,
                    school_id: schoolId
                });

                if (!technicalProgramOffering) {
                    throw new Error(`Oferta tecnica ${nextOfferingId} nao encontrada ou nao pertence a esta escola.`);
                }

                if (String(technicalProgramOffering.technicalProgramId) !== String(nextTechnicalProgramId)) {
                    throw new Error('A oferta tecnica informada nao pertence ao programa tecnico da matricula.');
                }
            }
        }

        if (Object.prototype.hasOwnProperty.call(updateData, 'currentClassId')) {
            const currentClassId = hasValue(currentEnrollment.currentClassId)
                ? String(currentEnrollment.currentClassId)
                : null;
            const nextClassId = hasValue(updateData.currentClassId)
                ? String(updateData.currentClassId)
                : null;

            if (currentClassId && currentClassId !== nextClassId) {
                throw new Error('A troca de turma tecnica deve ser registrada pelo fluxo de movimentacao de turma.');
            }

            if (hasValue(nextClassId)) {
                const currentClass = await Class.findOne({
                    _id: nextClassId,
                    school_id: schoolId
                });

                if (!currentClass) {
                    throw new Error(`Turma ${nextClassId} nao encontrada ou nao pertence a esta escola.`);
                }
            }
        }

        if (
            (Object.prototype.hasOwnProperty.call(updateData, 'currentClassId') ||
            Object.prototype.hasOwnProperty.call(updateData, 'currentTechnicalProgramOfferingId')) &&
            !Object.prototype.hasOwnProperty.call(updateData, 'status')
        ) {
            const nextCurrentClassId = Object.prototype.hasOwnProperty.call(updateData, 'currentClassId')
                ? updateData.currentClassId
                : currentEnrollment.currentClassId;
            const nextCurrentTechnicalProgramOfferingId = Object.prototype.hasOwnProperty.call(updateData, 'currentTechnicalProgramOfferingId')
                ? updateData.currentTechnicalProgramOfferingId
                : currentEnrollment.currentTechnicalProgramOfferingId;

            updateData.status = (hasValue(nextCurrentClassId) || hasValue(nextCurrentTechnicalProgramOfferingId))
                ? 'Ativa'
                : 'Pendente';
        }

        const nextStudentId = updateData.studentId || currentEnrollment.studentId;

        const existingEnrollment = await TechnicalEnrollment.findOne({
            _id: { $ne: id },
            studentId: nextStudentId,
            technicalProgramId: nextTechnicalProgramId,
            school_id: schoolId
        });

        if (existingEnrollment) {
            throw new Error('Ja existe outra matricula tecnica para este participante neste programa.');
        }

        const updatedEnrollment = await TechnicalEnrollment.findOneAndUpdate(
            { _id: id, school_id: schoolId },
            { $set: updateData },
            { new: true, runValidators: true }
        ).populate(defaultPopulation);

        if (!updatedEnrollment) {
            throw new Error('Matricula tecnica nao encontrada para atualizar.');
        }

        return updatedEnrollment;
    }

    async getTechnicalEnrollmentProgress(id, schoolId) {
        const enrollment = await TechnicalEnrollment.findOne({
            _id: id,
            school_id: schoolId
        }).populate(defaultPopulation);

        if (!enrollment) {
            throw new Error('Matricula tecnica nao encontrada ou nao pertence a esta escola.');
        }

        const curriculumModules = await TechnicalProgramModule.find({
            technicalProgramId: enrollment.technicalProgramId,
            school_id: schoolId
        })
            .select('technicalProgramId subjectId name description moduleOrder workloadHours status')
            .populate([{ path: 'subjectId', select: 'name level' }])
            .sort({ moduleOrder: 1, createdAt: 1 });

        const records = await TechnicalModuleRecord.find({
            technicalEnrollmentId: id,
            school_id: schoolId
        })
            .populate([
                {
                    path: 'technicalProgramModuleId',
                    select: 'technicalProgramId subjectId name description moduleOrder workloadHours status',
                    populate: [{ path: 'subjectId', select: 'name level' }]
                },
                {
                    path: 'technicalProgramOfferingId',
                    select: 'technicalProgramId name code status plannedStartDate plannedEndDate actualStartDate actualEndDate shift capacity defaultSpaceId',
                    populate: [
                        { path: 'technicalProgramId', select: 'name totalWorkloadHours status' },
                        { path: 'defaultSpaceId', select: 'name type capacity status' }
                    ]
                },
                {
                    path: 'technicalProgramOfferingModuleId',
                    select: 'technicalProgramOfferingId technicalProgramModuleId executionOrder moduleOrderSnapshot plannedWorkloadHours plannedWeeklyMinutes estimatedWeeks estimatedStartDate estimatedEndDate status scheduleSlots',
                    populate: [
                        {
                            path: 'technicalProgramOfferingId',
                            select: 'technicalProgramId name code status plannedStartDate plannedEndDate actualStartDate actualEndDate shift capacity defaultSpaceId',
                            populate: [
                                { path: 'technicalProgramId', select: 'name totalWorkloadHours status' },
                                { path: 'defaultSpaceId', select: 'name type capacity status' }
                            ]
                        },
                        { path: 'technicalProgramModuleId', select: 'technicalProgramId subjectId name moduleOrder workloadHours status', populate: { path: 'subjectId', select: 'name level' } }
                    ]
                }
            ])
            .sort({ technicalProgramModuleId: 1, attemptNumber: -1, createdAt: -1 });

        const latestRecordsByModuleId = new Map();
        const attemptsByModuleId = new Map();

        for (const record of records) {
            const moduleId = getDocumentId(record.technicalProgramModuleId);
            if (!moduleId) {
                continue;
            }

            attemptsByModuleId.set(moduleId, (attemptsByModuleId.get(moduleId) || 0) + 1);

            if (!latestRecordsByModuleId.has(moduleId)) {
                latestRecordsByModuleId.set(moduleId, record);
            }
        }

        const offeringModulesByModuleId = new Map();
        const currentOffering = enrollment.currentTechnicalProgramOfferingId;
        const currentOfferingModules = currentOffering
            ? (Array.isArray(currentOffering.modules) && currentOffering.modules.length > 0
                ? currentOffering.modules
                : await TechnicalProgramOfferingModule.find({
                    technicalProgramOfferingId: currentOffering._id,
                    school_id: schoolId
                })
                    .populate([
                        { path: 'technicalProgramModuleId', select: 'technicalProgramId subjectId name description moduleOrder workloadHours status', populate: [{ path: 'subjectId', select: 'name level' }] },
                        { path: 'prerequisiteModuleIds', select: 'name moduleOrder workloadHours status' },
                        { path: 'scheduleSlots.teacherIds', select: 'fullName email roles status' },
                        { path: 'scheduleSlots.spaceId', select: 'name type capacity status' }
                    ])
                    .sort({ executionOrder: 1, createdAt: 1 }))
            : [];

        for (const offeringModule of currentOfferingModules) {
            const moduleId = getDocumentId(offeringModule.technicalProgramModuleId);
            if (moduleId) {
                offeringModulesByModuleId.set(moduleId, offeringModule);
            }
        }

        const modules = curriculumModules.map((module) => {
            const moduleId = getDocumentId(module._id);
            const latestRecord = latestRecordsByModuleId.get(moduleId) || null;
            const offeringModule = offeringModulesByModuleId.get(moduleId)
                || (latestRecord ? latestRecord.technicalProgramOfferingModuleId : null);
            const plannedHours = Number(
                offeringModule?.plannedWorkloadHours
                ?? latestRecord?.moduleWorkloadHours
                ?? module.workloadHours
                ?? 0
            );
            const completedHours = Number(latestRecord?.completedHours ?? 0);
            const status = getRecordStatusBucket(latestRecord?.status, Boolean(latestRecord));
            const progressPercentage = plannedHours > 0
                ? Number(Math.min(100, ((completedHours / plannedHours) * 100)).toFixed(2))
                : 0;

            return {
                technicalProgramModule: module,
                latestRecord,
                attempts: attemptsByModuleId.get(moduleId) || 0,
                offeringExecution: offeringModule ? {
                    technicalProgramOfferingModuleId: offeringModule._id,
                    technicalProgramOfferingId: offeringModule.technicalProgramOfferingId,
                    executionOrder: offeringModule.executionOrder,
                    moduleOrderSnapshot: offeringModule.moduleOrderSnapshot,
                    plannedWorkloadHours: offeringModule.plannedWorkloadHours,
                    plannedWeeklyMinutes: offeringModule.plannedWeeklyMinutes,
                    estimatedWeeks: offeringModule.estimatedWeeks,
                    estimatedStartDate: offeringModule.estimatedStartDate,
                    estimatedEndDate: offeringModule.estimatedEndDate,
                    scheduleSlots: offeringModule.scheduleSlots,
                    status: offeringModule.status
                } : null,
                plannedHours,
                completedHours,
                remainingHours: Math.max(plannedHours - completedHours, 0),
                progressPercentage,
                status
            };
        });

        const summary = modules.reduce((accumulator, moduleSummary) => {
            accumulator.totalModules += 1;
            accumulator.totalPlannedHours += moduleSummary.plannedHours;
            accumulator.totalCompletedHours += moduleSummary.completedHours;

            if (moduleSummary.status === 'Concluído') {
                accumulator.completedModules += 1;
            } else if (moduleSummary.status === 'Em andamento') {
                accumulator.inProgressModules += 1;
            } else if (moduleSummary.status === 'Repetindo' || moduleSummary.status === 'Reprovado') {
                accumulator.repeatedModules += 1;
            } else {
                accumulator.pendingModules += 1;
            }

            return accumulator;
        }, {
            totalModules: 0,
            completedModules: 0,
            inProgressModules: 0,
            repeatedModules: 0,
            pendingModules: 0,
            totalPlannedHours: 0,
            totalCompletedHours: 0
        });

        summary.totalRemainingHours = Math.max(summary.totalPlannedHours - summary.totalCompletedHours, 0);
        summary.completionPercentage = summary.totalPlannedHours > 0
            ? Number(Math.min(100, ((summary.totalCompletedHours / summary.totalPlannedHours) * 100)).toFixed(2))
            : 0;
        summary.overallStatus = resolveOverallStatus(modules);

        const currentProgressEnrollment = enrollment.toObject ? enrollment.toObject({ virtuals: true }) : enrollment;

        return {
            enrollment: currentProgressEnrollment,
            summary,
            modules
        };
    }
}

module.exports = new TechnicalEnrollmentService();
