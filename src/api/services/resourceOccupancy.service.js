const TechnicalProgramOfferingModule = require('../models/technicalProgramOfferingModule.model');
const TechnicalSpace = require('../models/technicalSpace.model');
const TechnicalProgramOfferingModuleService = require('./technicalProgramOfferingModule.service');
const TechnicalTeacherEligibilityService = require('./technicalTeacherEligibility.service');
const Horario = require('../models/horario.model');
const Class = require('../models/class.model');
const { ApiError } = require('../utils/apiError');
const {
    normalizeReferenceId,
    normalizeTeacherIds,
    SLOT_PUBLICATION_STATUS
} = require('../utils/technicalScheduleSlot');
const {
    normalizeWeekday,
    normalizeResourceKey,
    normalizeTimeWindow,
    slotTimesOverlap
} = require('../utils/technicalResourceOccupancy.helper');

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const technicalModulePopulation = [
    {
        path: 'technicalProgramOfferingId',
        select: 'technicalProgramId name code status plannedStartDate plannedEndDate actualStartDate actualEndDate shift capacity defaultSpaceId',
        populate: [
            { path: 'technicalProgramId', select: 'name totalWorkloadHours status' },
            { path: 'defaultSpaceId', select: 'name type capacity status' }
        ]
    },
    {
        path: 'technicalProgramModuleId',
        select: 'technicalProgramId subjectId name description moduleOrder workloadHours status',
        populate: [
            { path: 'technicalProgramId', select: 'name totalWorkloadHours status' },
            { path: 'subjectId', select: 'name level' }
        ]
    },
    {
        path: 'scheduleSlots.teacherIds',
        select: 'fullName email roles status'
    },
    {
        path: 'scheduleSlots.publishedByUserId',
        select: 'fullName email roles status'
    },
    {
        path: 'scheduleSlots.publicationRevertedByUserId',
        select: 'fullName email roles status'
    },
    {
        path: 'scheduleSlots.spaceId',
        select: 'name type capacity status'
    }
];

const regularHorarioPopulation = [
    { path: 'teacherId', select: 'fullName email roles status' },
    { path: 'classId', select: 'name room schoolYear grade shift status' },
    { path: 'subjectId', select: 'name level' }
];

function buildTeacherResourceItem({
    sourceDomain,
    sourceId,
    sourceLabel,
    weekday,
    startTime,
    endTime,
    teacher,
    extra = {}
}) {
    const teacherId = normalizeReferenceId(teacher);
    const resourceKey = normalizeResourceKey('teacher', teacherId);

    return {
        sourceDomain,
        resourceType: 'teacher',
        resourceKey,
        resourceLabel: teacher?.fullName || teacher?.email || teacherId,
        weekday,
        startTime,
        endTime,
        startMinutes: normalizeTimeWindow({ weekday, startTime, endTime }).startMinutes,
        endMinutes: normalizeTimeWindow({ weekday, startTime, endTime }).endMinutes,
        sourceId,
        sourceLabel,
        source: extra.source || {},
        isOperational: true,
        blockingReasons: [],
        teacherId,
        spaceId: null
    };
}

function buildSpaceResourceItem({
    sourceDomain,
    sourceId,
    sourceLabel,
    weekday,
    startTime,
    endTime,
    space,
    extra = {}
}) {
    const spaceName = space?.name || space?.room || space || null;
    const resourceKey = normalizeResourceKey('space', spaceName);

    return {
        sourceDomain,
        resourceType: 'space',
        resourceKey,
        resourceLabel: spaceName,
        weekday,
        startTime,
        endTime,
        startMinutes: normalizeTimeWindow({ weekday, startTime, endTime }).startMinutes,
        endMinutes: normalizeTimeWindow({ weekday, startTime, endTime }).endMinutes,
        sourceId,
        sourceLabel,
        source: extra.source || {},
        isOperational: true,
        blockingReasons: [],
        teacherId: null,
        spaceId: extra.spaceId || normalizeReferenceId(space)
    };
}

function buildConflictReasons(conflicts = []) {
    return conflicts.map((conflict) => ({
        code: conflict.code,
        message: conflict.message,
        resourceType: conflict.resourceType,
        resourceKey: conflict.resourceKey,
        sourceDomain: conflict.sourceDomain,
        sourceId: conflict.sourceId,
        sourceLabel: conflict.sourceLabel
    }));
}

class ResourceOccupancyService {
    async _loadTechnicalOccupancyItems(schoolId, { exclude = null } = {}) {
        const modules = await TechnicalProgramOfferingModule.find({
            school_id: schoolId,
            'scheduleSlots.publicationStatus': SLOT_PUBLICATION_STATUS.PUBLISHED,
            status: { $ne: 'Cancelado' }
        })
            .select('technicalProgramOfferingId technicalProgramModuleId scheduleSlots status')
            .populate(technicalModulePopulation);

        const items = [];

        for (const module of modules) {
            const offering = module.technicalProgramOfferingId;
            const programModule = module.technicalProgramModuleId;

            if (!programModule || !offering) {
                continue;
            }

            if (module.status === 'Cancelado') {
                continue;
            }

            for (const slot of module.scheduleSlots || []) {
                if (slot.publicationStatus !== SLOT_PUBLICATION_STATUS.PUBLISHED) {
                    continue;
                }

                if (slot.status !== 'Ativo' || !slot.isOperational) {
                    continue;
                }

                const slotId = normalizeReferenceId(slot._id);
                if (
                    exclude
                    && normalizeReferenceId(exclude.technicalProgramOfferingModuleId) === normalizeReferenceId(module._id)
                    && normalizeReferenceId(exclude.slotId) === slotId
                ) {
                    continue;
                }

                const effectiveSpace = slot.spaceId || offering.defaultSpaceId || null;
                const slotLabel = `${offering.name || 'Oferta tecnica'} / ${programModule.name || 'Modulo tecnico'}`;
                const normalizedTime = normalizeTimeWindow(slot);
                const teacherIds = normalizeTeacherIds(slot);

                for (const teacherId of teacherIds) {
                    const teacher = Array.isArray(slot.teacherIds)
                        ? slot.teacherIds.find((candidate) => normalizeReferenceId(candidate) === normalizeReferenceId(teacherId))
                        : null;

                    items.push(buildTeacherResourceItem({
                        sourceDomain: 'technical',
                        sourceId: {
                            technicalProgramOfferingModuleId: normalizeReferenceId(module._id),
                            scheduleSlotId: slotId,
                            technicalProgramOfferingId: normalizeReferenceId(offering._id),
                            technicalProgramModuleId: normalizeReferenceId(programModule._id)
                        },
                        sourceLabel: slotLabel,
                        weekday: normalizedTime.weekday,
                        startTime: normalizedTime.startTime,
                        endTime: normalizedTime.endTime,
                        teacher: teacher || { _id: teacherId },
                        extra: {
                            source: {
                                technicalProgramOfferingModuleId: normalizeReferenceId(module._id),
                                technicalProgramOfferingId: normalizeReferenceId(offering._id),
                                technicalProgramModuleId: normalizeReferenceId(programModule._id),
                                scheduleSlotId: slotId,
                                publicationStatus: slot.publicationStatus,
                                slotStatus: slot.status,
                                subjectId: normalizeReferenceId(programModule.subjectId),
                                subjectName: programModule.subjectId?.name || null,
                                programName: offering.technicalProgramId?.name || null,
                                moduleName: programModule.name || null
                            }
                        }
                    }));
                }

                items.push(buildSpaceResourceItem({
                    sourceDomain: 'technical',
                    sourceId: {
                        technicalProgramOfferingModuleId: normalizeReferenceId(module._id),
                        scheduleSlotId: slotId,
                        technicalProgramOfferingId: normalizeReferenceId(offering._id),
                        technicalProgramModuleId: normalizeReferenceId(programModule._id)
                    },
                    sourceLabel: slotLabel,
                    weekday: normalizedTime.weekday,
                    startTime: normalizedTime.startTime,
                    endTime: normalizedTime.endTime,
                    space: effectiveSpace,
                    extra: {
                        spaceId: normalizeReferenceId(effectiveSpace),
                        source: {
                            technicalProgramOfferingModuleId: normalizeReferenceId(module._id),
                            technicalProgramOfferingId: normalizeReferenceId(offering._id),
                            technicalProgramModuleId: normalizeReferenceId(programModule._id),
                            scheduleSlotId: slotId,
                            publicationStatus: slot.publicationStatus,
                            slotStatus: slot.status,
                            subjectId: normalizeReferenceId(programModule.subjectId),
                            subjectName: programModule.subjectId?.name || null,
                            programName: offering.technicalProgramId?.name || null,
                            moduleName: programModule.name || null,
                            spaceId: normalizeReferenceId(effectiveSpace)
                        }
                    }
                }));
            }
        }

        return items;
    }

    async _loadRegularOccupancyItems(schoolId) {
        const classes = await Class.find({
            school_id: schoolId,
            status: { $nin: ['Cancelada', 'Encerrada'] }
        }).select('_id name room schoolYear grade shift status');

        const activeClassIds = classes.map((classDoc) => classDoc._id);

        if (activeClassIds.length === 0) {
            return [];
        }

        const horarios = await Horario.find({
            school_id: schoolId,
            classId: { $in: activeClassIds }
        })
            .populate(regularHorarioPopulation)
            .sort({ dayOfWeek: 1, startTime: 1 });

        const classesById = new Map(classes.map((classDoc) => [normalizeReferenceId(classDoc._id), classDoc]));
        const items = [];

        for (const horario of horarios) {
            const normalizedTime = normalizeTimeWindow(horario);
            if (normalizedTime.weekday === null || normalizedTime.startMinutes === null || normalizedTime.endMinutes === null) {
                continue;
            }

            const classDoc = classesById.get(normalizeReferenceId(horario.classId?._id || horario.classId)) || horario.classId || null;
            const sourceLabel = `${classDoc?.name || 'Turma'} / ${horario.subjectId?.name || 'Disciplina'}`;
            const roomLabel = horario.room || classDoc?.room || null;

            if (hasValue(horario.teacherId)) {
                items.push(buildTeacherResourceItem({
                    sourceDomain: 'regular',
                    sourceId: {
                        horarioId: normalizeReferenceId(horario._id),
                        classId: normalizeReferenceId(classDoc?._id || horario.classId),
                        termId: normalizeReferenceId(horario.termId)
                    },
                    sourceLabel,
                    weekday: normalizedTime.weekday,
                    startTime: normalizedTime.startTime,
                    endTime: normalizedTime.endTime,
                    teacher: horario.teacherId,
                    extra: {
                        source: {
                            horarioId: normalizeReferenceId(horario._id),
                            classId: normalizeReferenceId(classDoc?._id || horario.classId),
                            className: classDoc?.name || null,
                            termId: normalizeReferenceId(horario.termId),
                            subjectId: normalizeReferenceId(horario.subjectId),
                            subjectName: horario.subjectId?.name || null,
                            room: roomLabel,
                            schoolYear: classDoc?.schoolYear || null,
                            grade: classDoc?.grade || null,
                            shift: classDoc?.shift || null
                        }
                    }
                }));
            }

            if (hasValue(roomLabel)) {
                items.push(buildSpaceResourceItem({
                    sourceDomain: 'regular',
                    sourceId: {
                        horarioId: normalizeReferenceId(horario._id),
                        classId: normalizeReferenceId(classDoc?._id || horario.classId),
                        termId: normalizeReferenceId(horario.termId)
                    },
                    sourceLabel,
                    weekday: normalizedTime.weekday,
                    startTime: normalizedTime.startTime,
                    endTime: normalizedTime.endTime,
                    space: roomLabel,
                    extra: {
                        source: {
                            horarioId: normalizeReferenceId(horario._id),
                            classId: normalizeReferenceId(classDoc?._id || horario.classId),
                            className: classDoc?.name || null,
                            termId: normalizeReferenceId(horario.termId),
                            subjectId: normalizeReferenceId(horario.subjectId),
                            subjectName: horario.subjectId?.name || null,
                            room: roomLabel,
                            schoolYear: classDoc?.schoolYear || null,
                            grade: classDoc?.grade || null,
                            shift: classDoc?.shift || null
                        }
                    }
                }));
            }
        }

        return items;
    }

    async getResourceOccupancy(schoolId, options = {}) {
        const { exclude = null } = options;
        const [technicalItems, regularItems] = await Promise.all([
            this._loadTechnicalOccupancyItems(schoolId, { exclude }),
            this._loadRegularOccupancyItems(schoolId)
        ]);

        const items = [...technicalItems, ...regularItems].sort((left, right) => {
            const leftTime = `${String(left.weekday || '')}:${String(left.startTime || '')}`;
            const rightTime = `${String(right.weekday || '')}:${String(right.startTime || '')}`;

            if (leftTime !== rightTime) {
                return leftTime.localeCompare(rightTime);
            }

            if (left.resourceType !== right.resourceType) {
                return left.resourceType.localeCompare(right.resourceType);
            }

            return String(left.resourceLabel || '').localeCompare(String(right.resourceLabel || ''));
        });

        const summary = items.reduce((accumulator, item) => {
            accumulator.totalItems += 1;
            accumulator.byDomain[item.sourceDomain] = (accumulator.byDomain[item.sourceDomain] || 0) + 1;
            accumulator.byResourceType[item.resourceType] = (accumulator.byResourceType[item.resourceType] || 0) + 1;
            accumulator.byWeekday[item.weekday] = (accumulator.byWeekday[item.weekday] || 0) + 1;
            return accumulator;
        }, {
            totalItems: 0,
            byDomain: {
                technical: 0,
                regular: 0
            },
            byResourceType: {
                teacher: 0,
                space: 0
            },
            byWeekday: {}
        });

        return {
            range: {
                scope: 'weekly',
                from: null,
                to: null
            },
            items,
            summary
        };
    }

    _buildCandidateResourceItems({ candidateSlot, sourceMeta }) {
        const normalizedTime = normalizeTimeWindow(candidateSlot);
        const teacherIds = normalizeTeacherIds(candidateSlot);
        const items = [];

        for (const teacherId of teacherIds) {
            items.push(buildTeacherResourceItem({
                sourceDomain: 'technical',
                sourceId: sourceMeta,
                sourceLabel: sourceMeta.sourceLabel,
                weekday: normalizedTime.weekday,
                startTime: normalizedTime.startTime,
                endTime: normalizedTime.endTime,
                teacher: { _id: teacherId },
                extra: {
                    source: sourceMeta
                }
            }));
        }

        if (hasValue(candidateSlot.effectiveSpaceId)) {
            items.push(buildSpaceResourceItem({
                sourceDomain: 'technical',
                sourceId: sourceMeta,
                sourceLabel: sourceMeta.sourceLabel,
                weekday: normalizedTime.weekday,
                startTime: normalizedTime.startTime,
                endTime: normalizedTime.endTime,
                space: candidateSlot.effectiveSpaceName || candidateSlot.effectiveSpaceId,
                extra: {
                    spaceId: candidateSlot.effectiveSpaceId,
                    source: sourceMeta
                }
            }));
        }

        return items;
    }

    _findConflicts(candidateItems, occupancyItems) {
        const conflicts = [];

        for (const candidate of candidateItems) {
            for (const occupied of occupancyItems) {
                if (candidate.resourceType !== occupied.resourceType) {
                    continue;
                }

                if (candidate.resourceKey !== occupied.resourceKey) {
                    continue;
                }

                if (!slotTimesOverlap(candidate, occupied)) {
                    continue;
                }

                conflicts.push({
                    code: candidate.resourceType === 'teacher' ? 'TEACHER_CONFLICT' : 'SPACE_CONFLICT',
                    message: candidate.resourceType === 'teacher'
                        ? 'Professor ja esta ocupado neste horario.'
                        : 'Sala ja esta ocupada neste horario.',
                    resourceType: candidate.resourceType,
                    resourceKey: candidate.resourceKey,
                    resourceLabel: candidate.resourceLabel,
                    sourceDomain: occupied.sourceDomain,
                    sourceId: occupied.sourceId,
                    sourceLabel: occupied.sourceLabel,
                    weekday: candidate.weekday,
                    startTime: candidate.startTime,
                    endTime: candidate.endTime
                });
            }
        }

        return conflicts;
    }

    async _loadSlotEvaluationContext(technicalProgramOfferingModuleId, slotId, schoolId, candidateOverrides = null) {
        const offeringModule = await TechnicalProgramOfferingModule.findOne({
            _id: technicalProgramOfferingModuleId,
            school_id: schoolId
        }).populate(technicalModulePopulation);

        if (!offeringModule) {
            throw new ApiError({
                message: 'Execucao do modulo da oferta nao encontrada ou nao pertence a esta escola.',
                code: 'NOT_FOUND',
                status: 404
            });
        }

        const currentSlot = offeringModule.scheduleSlots.id(slotId);
        if (!currentSlot) {
            throw new ApiError({
                message: 'Slot nao encontrado na execucao informada.',
                code: 'NOT_FOUND',
                status: 404
            });
        }

        const module = offeringModule.technicalProgramModuleId;
        const offering = offeringModule.technicalProgramOfferingId;
        const moduleSubjectId = module?.subjectId ? normalizeReferenceId(module.subjectId) : null;
        const selectedSlot = candidateOverrides ? { ...currentSlot.toObject({ virtuals: true }), ...candidateOverrides } : currentSlot.toObject({ virtuals: true });
        const normalizedTime = normalizeTimeWindow(selectedSlot);
        const effectiveSpace = hasValue(selectedSlot.spaceId)
            ? selectedSlot.spaceId
            : (offering?.defaultSpaceId || null);
        const effectiveSpaceId = normalizeReferenceId(effectiveSpace);
        let effectiveSpaceName = effectiveSpace?.name || effectiveSpace?.label || effectiveSpace?.room || null;
        const teacherIds = normalizeTeacherIds(selectedSlot);
        const eligibleTeachers = moduleSubjectId
            ? await TechnicalTeacherEligibilityService.getEligibleTeachersBySubjectId(moduleSubjectId, schoolId)
            : [];
        const eligibleTeacherIds = new Set(eligibleTeachers.map((teacher) => normalizeReferenceId(teacher.teacherId)));
        const validationReasons = [];

        if (!module) {
            validationReasons.push({
                code: 'MODULE_NOT_FOUND',
                message: 'Modulo tecnico nao encontrado na execucao informada.'
            });
        }

        if (module && module.status === 'Inativo') {
            validationReasons.push({
                code: 'MODULE_INACTIVE',
                message: 'Modulo tecnico inativo.'
            });
        }

        if (!offering) {
            validationReasons.push({
                code: 'OFFERING_NOT_FOUND',
                message: 'Oferta tecnica nao encontrada para validar o slot.'
            });
        } else if (offering.status === 'Cancelado') {
            validationReasons.push({
                code: 'OFFERING_INACTIVE',
                message: 'Oferta tecnica cancelada nao pode receber publicacao operacional.'
            });
        }

        if (!moduleSubjectId) {
            validationReasons.push({
                code: 'MISSING_SUBJECT',
                message: 'O modulo precisa de subjectId para entrar em grade.'
            });
        }

        if (!Number.isInteger(normalizedTime.weekday) || normalizedTime.weekday < 1 || normalizedTime.weekday > 7) {
            validationReasons.push({
                code: 'INVALID_WEEKDAY',
                message: 'Dia da semana invalido.'
            });
        }

        if (!normalizedTime.startTime || !normalizedTime.endTime || normalizedTime.endMinutes === null || normalizedTime.startMinutes === null || normalizedTime.endMinutes <= normalizedTime.startMinutes) {
            validationReasons.push({
                code: 'INVALID_TIME_RANGE',
                message: 'Horario inicial/final invalido.'
            });
        }

        if (teacherIds.length === 0) {
            validationReasons.push({
                code: 'MISSING_TEACHER',
                message: 'Slot precisa ter um professor definido.'
            });
        } else if (teacherIds.length > 1) {
            validationReasons.push({
                code: 'MULTIPLE_TEACHERS',
                message: 'Slot precisa ter apenas um professor.'
            });
        }

        const selectedTeacherId = teacherIds[0] || null;
        if (moduleSubjectId && selectedTeacherId && !eligibleTeacherIds.has(normalizeReferenceId(selectedTeacherId))) {
            validationReasons.push({
                code: 'TEACHER_NOT_ELIGIBLE',
                message: 'Professor nao esta habilitado para este modulo.'
            });
        }

        if (!effectiveSpaceId) {
            validationReasons.push({
                code: 'MISSING_SPACE',
                message: 'Slot precisa ter uma sala valida.'
            });
        } else {
            const space = await TechnicalSpace.findOne({
                _id: effectiveSpaceId,
                school_id: schoolId,
                status: 'Ativo'
            }).select('_id name type capacity status');

            if (!space) {
                validationReasons.push({
                    code: 'INVALID_SPACE',
                    message: 'Sala tecnica invalida, inativa ou nao pertence a esta escola.'
                });
            } else {
                effectiveSpaceName = space.name;
            }
        }

        if (String(selectedSlot.status || 'Ativo') !== 'Ativo') {
            validationReasons.push({
                code: 'SLOT_INACTIVE',
                message: 'Slot inativo.'
            });
        }

        const candidateItems = this._buildCandidateResourceItems({
            candidateSlot: {
                ...selectedSlot,
                effectiveSpaceId,
                effectiveSpaceName
            },
            sourceMeta: {
                sourceDomain: 'technical',
                technicalProgramOfferingModuleId: normalizeReferenceId(offeringModule._id),
                technicalProgramOfferingId: normalizeReferenceId(offering?._id),
                technicalProgramModuleId: normalizeReferenceId(module?._id),
                scheduleSlotId: normalizeReferenceId(currentSlot._id),
                publicationStatus: selectedSlot.publicationStatus || SLOT_PUBLICATION_STATUS.DRAFT,
                slotStatus: selectedSlot.status || 'Ativo',
                subjectId: normalizeReferenceId(module?.subjectId),
                subjectName: module?.subjectId?.name || null,
                programName: offering?.technicalProgramId?.name || null,
                moduleName: module?.name || null,
                sourceLabel: `${offering?.name || 'Oferta tecnica'} / ${module?.name || 'Modulo tecnico'}`
            }
        });

        const occupancySnapshot = await this.getResourceOccupancy(schoolId, {
            exclude: {
                technicalProgramOfferingModuleId: normalizeReferenceId(offeringModule._id),
                slotId: normalizeReferenceId(currentSlot._id)
            }
        });
        const conflicts = this._findConflicts(candidateItems, occupancySnapshot.items);

        const blockingReasons = [
            ...validationReasons,
            ...buildConflictReasons(conflicts)
        ];

        const normalizedItem = {
            technicalProgramOfferingModuleId: normalizeReferenceId(offeringModule._id),
            technicalProgramOfferingId: normalizeReferenceId(offering?._id),
            technicalProgramModuleId: normalizeReferenceId(module?._id),
            slotId: normalizeReferenceId(currentSlot._id),
            publicationStatus: selectedSlot.publicationStatus || SLOT_PUBLICATION_STATUS.DRAFT,
            isOperational: blockingReasons.length === 0,
            weekday: normalizedTime.weekday,
            startTime: normalizedTime.startTime,
            endTime: normalizedTime.endTime,
            durationMinutes: normalizedTime.startMinutes !== null && normalizedTime.endMinutes !== null
                ? (normalizedTime.endMinutes - normalizedTime.startMinutes)
                : null,
            teacherId: selectedTeacherId ? normalizeReferenceId(selectedTeacherId) : null,
            teacherIds,
            spaceId: effectiveSpaceId,
            effectiveSpaceId,
            effectiveSpaceName,
            subjectId: normalizeReferenceId(module?.subjectId),
            subjectName: module?.subjectId?.name || null,
            programName: offering?.technicalProgramId?.name || null,
            moduleName: module?.name || null
        };

        return {
            offeringModule,
            currentSlot,
            candidateItems,
            occupancySnapshot,
            conflicts,
            blockingReasons,
            canPublish: blockingReasons.length === 0,
            normalizedItem
        };
    }

    async previewScheduleSlotPublication(payload, schoolId) {
        const {
            technicalProgramOfferingModuleId,
            slotId,
            scheduleSlot = null
        } = payload || {};

        const evaluation = await this._loadSlotEvaluationContext(
            technicalProgramOfferingModuleId,
            slotId,
            schoolId,
            scheduleSlot
        );

        return {
            canPublish: evaluation.canPublish,
            blockingReasons: evaluation.blockingReasons,
            conflicts: evaluation.conflicts,
            normalizedItem: evaluation.normalizedItem
        };
    }

    async publishScheduleSlot(technicalProgramOfferingModuleId, slotId, schoolId, performedByUserId = null) {
        const evaluation = await this._loadSlotEvaluationContext(
            technicalProgramOfferingModuleId,
            slotId,
            schoolId
        );

        if (!evaluation.canPublish) {
            throw new ApiError({
                message: 'Slot nao pode ser publicado.',
                code: evaluation.conflicts.length > 0 ? 'SLOT_CONFLICT' : 'SLOT_NOT_PUBLISHABLE',
                status: evaluation.conflicts.length > 0 ? 409 : 422,
                blockingReasons: evaluation.blockingReasons,
                meta: {
                    technicalProgramOfferingModuleId: normalizeReferenceId(technicalProgramOfferingModuleId),
                    slotId: normalizeReferenceId(slotId),
                    normalizedItem: evaluation.normalizedItem,
                    conflicts: evaluation.conflicts
                }
            });
        }

        const module = evaluation.offeringModule;
        const slot = module.scheduleSlots.id(slotId);

        if (!slot) {
            throw new ApiError({
                message: 'Slot nao encontrado na execucao informada.',
                code: 'NOT_FOUND',
                status: 404
            });
        }

        if (slot.publicationStatus === SLOT_PUBLICATION_STATUS.PUBLISHED) {
            return TechnicalProgramOfferingModuleService.getTechnicalProgramOfferingModuleById(
                technicalProgramOfferingModuleId,
                schoolId
            );
        }

        slot.publicationStatus = SLOT_PUBLICATION_STATUS.PUBLISHED;
        slot.publishedAt = new Date();
        slot.publishedByUserId = performedByUserId || null;
        slot.publicationRevertedAt = null;
        slot.publicationRevertedByUserId = null;
        slot.publicationRevertedReason = null;

        await module.save();

        return TechnicalProgramOfferingModuleService.getTechnicalProgramOfferingModuleById(
            technicalProgramOfferingModuleId,
            schoolId
        );
    }
}

module.exports = new ResourceOccupancyService();
