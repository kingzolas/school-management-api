require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../src/config/database');

const School = require('../src/api/models/school.model');
const User = require('../src/api/models/user.model');
const StaffProfile = require('../src/api/models/staffProfile.model');
const Subject = require('../src/api/models/subject.model');
const TechnicalProgram = require('../src/api/models/technicalProgram.model');
const TechnicalProgramModule = require('../src/api/models/technicalProgramModule.model');
const TechnicalProgramOffering = require('../src/api/models/technicalProgramOffering.model');
const TechnicalProgramOfferingModule = require('../src/api/models/technicalProgramOfferingModule.model');
const TechnicalSpace = require('../src/api/models/technicalSpace.model');

const SubjectService = require('../src/api/services/subject.service');
const UserService = require('../src/api/services/user.service');
const TechnicalProgramService = require('../src/api/services/technicalProgram.service');
const TechnicalProgramModuleService = require('../src/api/services/technicalProgramModule.service');
const TechnicalProgramOfferingService = require('../src/api/services/technicalProgramOffering.service');
const TechnicalProgramOfferingModuleService = require('../src/api/services/technicalProgramOfferingModule.service');
const TechnicalSpaceService = require('../src/api/services/technicalSpace.service');
const TechnicalTeacherEligibilityService = require('../src/api/services/technicalTeacherEligibility.service');
const ResourceOccupancyService = require('../src/api/services/resourceOccupancy.service');

const SCENARIO = {
    school: {
        name: 'Instituto Horizonte Técnico',
        legalName: 'Instituto Horizonte Técnico Ltda',
        educationModel: 'technical_apprenticeship',
        authorizationProtocol: 'Portaria Interna 014/2026',
        contactPhone: '(11) 4002-7070',
        contactEmail: 'contato@institutohorizonte.test',
        address: {
            street: 'Rua das Palmeiras',
            number: '120',
            neighborhood: 'Centro',
            city: 'São Paulo',
            state: 'SP',
            zipCode: '01010-100'
        }
    },
    coordinator: {
        fullName: 'Mariana Costa Ribeiro',
        email: 'mariana.ribeiro@academyhub.test',
        username: 'mariana.ribeiro',
        password: 'AcademyHub123',
        cpf: '52478136010',
        phoneNumber: '(11) 97111-0001',
        roles: ['Admin', 'Coordenador'],
        profile: {
            admissionDate: '2026-01-15',
            employmentType: 'Efetivo (CLT)',
            mainRole: 'Coordenadora Técnica',
            remunerationModel: 'Salário Fixo Mensal',
            salaryAmount: 6800,
            weeklyWorkload: 40,
            academicFormation: 'Especialização em Gestão Educacional',
            enabledLevels: [],
            enabledSubjects: []
        }
    },
    subjects: [
        { name: 'Fundamentos da Administração', level: 'Geral' },
        { name: 'Gestão Financeira', level: 'Geral' },
        { name: 'Gestão de Pessoas', level: 'Geral' },
        { name: 'Processos Administrativos', level: 'Geral' }
    ],
    teachers: [
        {
            fullName: 'Ana Paula Martins',
            email: 'ana.martins@academyhub.test',
            username: 'ana.martins',
            password: 'AcademyHub123',
            cpf: '27463598041',
            phoneNumber: '(11) 97111-0002',
            roles: ['Professor'],
            subjectName: 'Fundamentos da Administração'
        },
        {
            fullName: 'Bruno Henrique Lima',
            email: 'bruno.lima@academyhub.test',
            username: 'bruno.lima',
            password: 'AcademyHub123',
            cpf: '38164025072',
            phoneNumber: '(11) 97111-0003',
            roles: ['Professor'],
            subjectName: 'Gestão Financeira'
        },
        {
            fullName: 'Carla Mendes Rocha',
            email: 'carla.rocha@academyhub.test',
            username: 'carla.rocha',
            password: 'AcademyHub123',
            cpf: '49620817093',
            phoneNumber: '(11) 97111-0004',
            roles: ['Professor'],
            subjectName: 'Gestão de Pessoas'
        },
        {
            fullName: 'Diego Alves Souza',
            email: 'diego.souza@academyhub.test',
            username: 'diego.souza',
            password: 'AcademyHub123',
            cpf: '60731948025',
            phoneNumber: '(11) 97111-0005',
            roles: ['Professor'],
            subjectName: 'Processos Administrativos'
        }
    ],
    program: {
        name: 'Técnico em Administração',
        description: 'Curso técnico noturno voltado para formação em gestão, finanças, pessoas e processos administrativos.',
        totalWorkloadHours: 1200,
        status: 'Ativo'
    },
    spaces: [
        { name: 'Sala 01', type: 'Sala', capacity: 35, status: 'Ativo' },
        { name: 'Sala 02', type: 'Sala', capacity: 35, status: 'Ativo' },
        { name: 'Sala 03', type: 'Sala', capacity: 35, status: 'Ativo' },
        { name: 'Sala 04', type: 'Sala', capacity: 35, status: 'Ativo' }
    ],
    offering: {
        name: 'Turma Noturna',
        code: 'ADM-NOT-2026',
        status: 'Ativa',
        shift: 'Noite',
        capacity: 35,
        plannedStartDate: '2026-03-02',
        plannedEndDate: '2027-08-15',
        actualStartDate: '2026-03-02',
        notes: 'Oferta técnica de teste para validação completa do fluxo operacional.'
    },
    moduleExecutions: [
        {
            moduleName: 'Fundamentos da Administração',
            executionOrder: 1,
            estimatedStartDate: '2026-03-02',
            status: 'Em andamento',
            spaceName: 'Sala 01',
            teacherEmail: 'ana.martins@academyhub.test',
            prerequisiteModuleNames: [],
            scheduleSlots: [
                { weekday: 1, startTime: '18:30', endTime: '22:30' },
                { weekday: 2, startTime: '18:30', endTime: '22:30' },
                { weekday: 3, startTime: '18:30', endTime: '22:30' },
                { weekday: 4, startTime: '18:30', endTime: '22:30' }
            ],
            publishFingerprints: [
                '1|18:30|22:30',
                '2|18:30|22:30',
                '3|18:30|22:30',
                '4|18:30|22:30'
            ]
        },
        {
            moduleName: 'Gestão Financeira',
            executionOrder: 2,
            estimatedStartDate: '2026-07-13',
            status: 'Planejado',
            spaceName: 'Sala 02',
            teacherEmail: 'bruno.lima@academyhub.test',
            prerequisiteModuleNames: ['Fundamentos da Administração'],
            scheduleSlots: [
                { weekday: 1, startTime: '18:30', endTime: '20:30' },
                { weekday: 1, startTime: '20:30', endTime: '22:30' },
                { weekday: 2, startTime: '18:30', endTime: '22:30' },
                { weekday: 3, startTime: '18:30', endTime: '22:30' },
                { weekday: 4, startTime: '18:30', endTime: '22:30' }
            ],
            publishFingerprints: [
                '1|18:30|20:30',
                '2|18:30|22:30',
                '3|18:30|22:30',
                '4|18:30|22:30'
            ]
        },
        {
            moduleName: 'Gestão de Pessoas',
            executionOrder: 3,
            estimatedStartDate: '2026-11-23',
            status: 'Planejado',
            spaceName: 'Sala 03',
            teacherEmail: 'carla.rocha@academyhub.test',
            prerequisiteModuleNames: ['Gestão Financeira'],
            scheduleSlots: [
                { weekday: 1, startTime: '18:30', endTime: '22:30' },
                { weekday: 2, startTime: '18:30', endTime: '22:30' },
                { weekday: 3, startTime: '18:30', endTime: '22:30' },
                { weekday: 4, startTime: '18:30', endTime: '22:30' }
            ],
            publishFingerprints: []
        },
        {
            moduleName: 'Processos Administrativos',
            executionOrder: 4,
            estimatedStartDate: '2027-04-05',
            status: 'Planejado',
            spaceName: 'Sala 04',
            teacherEmail: 'diego.souza@academyhub.test',
            prerequisiteModuleNames: ['Gestão de Pessoas'],
            scheduleSlots: [
                { weekday: 1, startTime: '18:30', endTime: '22:30' },
                { weekday: 2, startTime: '18:30', endTime: '22:30' },
                { weekday: 3, startTime: '18:30', endTime: '22:30' },
                { weekday: 4, startTime: '18:30', endTime: '22:30' }
            ],
            publishFingerprints: [
                '1|18:30|22:30',
                '2|18:30|22:30',
                '3|18:30|22:30',
                '4|18:30|22:30'
            ]
        }
    ]
};

function slotFingerprint(slot) {
    return `${Number(slot.weekday)}|${slot.startTime}|${slot.endTime}`;
}

async function ensureSchool() {
    let school = await School.findOne({
        name: SCENARIO.school.name,
        educationModel: SCENARIO.school.educationModel
    });

    if (!school) {
        school = new School(SCENARIO.school);
    } else {
        Object.assign(school, SCENARIO.school);
    }

    await school.save();
    return school;
}

async function ensureStaffUser({ schoolId, account, enabledSubjects }) {
    let user = await User.findOne({ email: account.email });
    if (user && String(user.school_id) !== String(schoolId)) {
        throw new Error(`O e-mail ${account.email} já está vinculado a outra escola.`);
    }

    const payload = {
        fullName: account.fullName,
        email: account.email,
        username: account.username,
        password: account.password,
        cpf: account.cpf,
        phoneNumber: account.phoneNumber,
        roles: account.roles,
        status: 'Ativo',
        school_id: schoolId
    };

    if (!user) {
        user = await UserService.createStaff({
            ...payload,
            ...account.profile,
            enabledSubjects
        }, schoolId);

        return user;
    }

    user.fullName = payload.fullName;
    user.email = payload.email;
    user.username = payload.username;
    user.password = payload.password;
    user.cpf = payload.cpf;
    user.phoneNumber = payload.phoneNumber;
    user.roles = payload.roles;
    user.status = payload.status;
    user.school_id = schoolId;
    await user.save();

    let profile = await StaffProfile.findOne({
        user: user._id,
        mainRole: account.profile.mainRole
    });

    if (!profile) {
        profile = new StaffProfile({
            ...account.profile,
            enabledSubjects,
            school_id: schoolId,
            user: user._id
        });
        await profile.save();
        await User.findByIdAndUpdate(user._id, { $addToSet: { staffProfiles: profile._id } });
    } else {
        Object.assign(profile, {
            ...account.profile,
            enabledSubjects,
            school_id: schoolId,
            user: user._id
        });
        await profile.save();
    }

    return UserService.getUserById(user._id, schoolId);
}

async function ensureSubject({ schoolId, subjectData }) {
    let subject = await Subject.findOne({
        school_id: schoolId,
        name: subjectData.name
    });

    if (!subject) {
        subject = await SubjectService.createSubject(subjectData, schoolId);
    } else {
        subject.name = subjectData.name;
        subject.level = subjectData.level;
        subject.school_id = schoolId;
        await subject.save();
    }

    return subject;
}

async function ensureProgram({ schoolId, programData }) {
    let program = await TechnicalProgram.findOne({
        school_id: schoolId,
        name: programData.name
    });

    if (!program) {
        program = await TechnicalProgramService.createTechnicalProgram(programData, schoolId);
    } else {
        Object.assign(program, {
            ...programData,
            school_id: schoolId
        });
        await program.save();
    }

    return program;
}

async function ensureProgramModule({ schoolId, programId, moduleData }) {
    let module = await TechnicalProgramModule.findOne({
        school_id: schoolId,
        technicalProgramId: programId,
        moduleOrder: moduleData.moduleOrder
    });

    if (!module) {
        module = await TechnicalProgramModuleService.createTechnicalProgramModule({
            ...moduleData,
            technicalProgramId: programId
        }, schoolId);
    } else {
        module.name = moduleData.name;
        module.description = moduleData.description;
        module.subjectId = moduleData.subjectId;
        module.status = moduleData.status || 'Ativo';
        await module.save();
    }

    return module;
}

async function ensureSpace({ schoolId, spaceData }) {
    let space = await TechnicalSpace.findOne({
        school_id: schoolId,
        name: spaceData.name
    });

    if (!space) {
        space = await TechnicalSpaceService.createTechnicalSpace(spaceData, schoolId);
    } else {
        Object.assign(space, {
            ...spaceData,
            school_id: schoolId
        });
        await space.save();
    }

    return space;
}

async function ensureOffering({ schoolId, programId, defaultSpaceId }) {
    let offering = await TechnicalProgramOffering.findOne({
        school_id: schoolId,
        technicalProgramId: programId,
        name: SCENARIO.offering.name
    });

    const payload = {
        ...SCENARIO.offering,
        technicalProgramId: programId,
        defaultSpaceId
    };

    if (!offering) {
        offering = await TechnicalProgramOfferingService.createTechnicalProgramOffering(payload, schoolId);
    } else {
        offering = await TechnicalProgramOfferingService.updateTechnicalProgramOffering(
            offering._id,
            payload,
            schoolId
        );
    }

    return offering;
}

async function ensureOfferingModule({
    schoolId,
    performedByUserId,
    offeringId,
    moduleDoc,
    executionConfig,
    teacherId,
    spaceId,
    prerequisiteModuleIds
}) {
    const desiredSlots = executionConfig.scheduleSlots.map((slot) => ({
        weekday: slot.weekday,
        startTime: slot.startTime,
        endTime: slot.endTime,
        teacherIds: [teacherId],
        spaceId,
        status: 'Ativo',
        notes: `Aula de ${moduleDoc.name}`
    }));

    let offeringModule = await TechnicalProgramOfferingModule.findOne({
        school_id: schoolId,
        technicalProgramOfferingId: offeringId,
        technicalProgramModuleId: moduleDoc._id
    }).lean();

    if (!offeringModule) {
        offeringModule = await TechnicalProgramOfferingModuleService.createTechnicalProgramOfferingModule({
            technicalProgramOfferingId: offeringId,
            technicalProgramModuleId: moduleDoc._id,
            executionOrder: executionConfig.executionOrder,
            moduleOrderSnapshot: moduleDoc.moduleOrder,
            plannedWorkloadHours: moduleDoc.workloadHours,
            estimatedStartDate: executionConfig.estimatedStartDate,
            prerequisiteModuleIds,
            scheduleSlots: desiredSlots,
            status: executionConfig.status,
            notes: `Execução de ${moduleDoc.name} na ${SCENARIO.offering.name}.`
        }, schoolId);
    } else {
        const currentSlots = Array.isArray(offeringModule.scheduleSlots) ? offeringModule.scheduleSlots : [];
        const mergedSlots = desiredSlots.map((slot) => {
            const currentSlot = currentSlots.find((candidate) => (
                Number(candidate.weekday) === Number(slot.weekday)
                && String(candidate.startTime) === String(slot.startTime)
                && String(candidate.endTime) === String(slot.endTime)
            ));

            return currentSlot ? { _id: currentSlot._id, ...slot } : slot;
        });

        offeringModule = await TechnicalProgramOfferingModuleService.updateTechnicalProgramOfferingModule(
            offeringModule._id,
            {
                executionOrder: executionConfig.executionOrder,
                plannedWorkloadHours: moduleDoc.workloadHours,
                estimatedStartDate: executionConfig.estimatedStartDate,
                prerequisiteModuleIds,
                scheduleSlots: mergedSlots,
                status: executionConfig.status,
                notes: `Execução de ${moduleDoc.name} na ${SCENARIO.offering.name}.`
            },
            schoolId,
            performedByUserId
        );
    }

    const publishFingerprints = new Set(executionConfig.publishFingerprints);
    for (const slot of offeringModule.scheduleSlots || []) {
        if (!publishFingerprints.has(slotFingerprint(slot))) {
            continue;
        }

        await ResourceOccupancyService.publishScheduleSlot(
            offeringModule._id,
            slot._id,
            schoolId,
            performedByUserId
        );
    }

    return TechnicalProgramOfferingModuleService.getTechnicalProgramOfferingModuleById(
        offeringModule._id,
        schoolId
    );
}

async function main() {
    await connectDB();

    const school = await ensureSchool();

    const coordinator = await ensureStaffUser({
        schoolId: school._id,
        account: SCENARIO.coordinator,
        enabledSubjects: []
    });

    const subjectsByName = {};
    for (const subjectData of SCENARIO.subjects) {
        const subject = await ensureSubject({
            schoolId: school._id,
            subjectData
        });
        subjectsByName[subject.name] = subject;
    }

    const teachersByEmail = {};
    for (const teacherConfig of SCENARIO.teachers) {
        const subject = subjectsByName[teacherConfig.subjectName];
        const teacher = await ensureStaffUser({
            schoolId: school._id,
            account: {
                ...teacherConfig,
                profile: {
                    admissionDate: '2026-02-02',
                    employmentType: 'Efetivo (CLT)',
                    mainRole: 'Professor',
                    remunerationModel: 'Pagamento por Hora/Aula',
                    hourlyRate: 85,
                    weeklyWorkload: 20,
                    academicFormation: 'Especialização em Educação Profissional',
                    enabledLevels: []
                }
            },
            enabledSubjects: [subject._id]
        });

        teachersByEmail[teacherConfig.email] = teacher;
    }

    const program = await ensureProgram({
        schoolId: school._id,
        programData: SCENARIO.program
    });

    const moduleBlueprints = [
        {
            name: 'Fundamentos da Administração',
            description: 'Introdução aos conceitos centrais de organização, planejamento e estrutura administrativa.',
            moduleOrder: 1,
            workloadHours: 300,
            subjectName: 'Fundamentos da Administração',
            status: 'Ativo'
        },
        {
            name: 'Gestão Financeira',
            description: 'Estudo de fluxo de caixa, orçamento, análise financeira e controles gerenciais.',
            moduleOrder: 2,
            workloadHours: 300,
            subjectName: 'Gestão Financeira',
            status: 'Ativo'
        },
        {
            name: 'Gestão de Pessoas',
            description: 'Desenvolvimento de competências ligadas a liderança, recrutamento e rotinas de RH.',
            moduleOrder: 3,
            workloadHours: 300,
            subjectName: 'Gestão de Pessoas',
            status: 'Ativo'
        },
        {
            name: 'Processos Administrativos',
            description: 'Aplicação prática de processos, documentação, indicadores e rotinas administrativas.',
            moduleOrder: 4,
            workloadHours: 300,
            subjectName: 'Processos Administrativos',
            status: 'Ativo'
        }
    ];

    const modulesByName = {};
    for (const blueprint of moduleBlueprints) {
        const module = await ensureProgramModule({
            schoolId: school._id,
            programId: program._id,
            moduleData: {
                ...blueprint,
                subjectId: subjectsByName[blueprint.subjectName]._id
            }
        });

        modulesByName[module.name] = module;
    }

    const spacesByName = {};
    for (const spaceData of SCENARIO.spaces) {
        const space = await ensureSpace({
            schoolId: school._id,
            spaceData
        });
        spacesByName[space.name] = space;
    }

    const offering = await ensureOffering({
        schoolId: school._id,
        programId: program._id,
        defaultSpaceId: spacesByName['Sala 01']._id
    });

    const offeringModules = [];
    for (const executionConfig of SCENARIO.moduleExecutions) {
        const moduleDoc = modulesByName[executionConfig.moduleName];
        const teacher = teachersByEmail[executionConfig.teacherEmail];
        const space = spacesByName[executionConfig.spaceName];
        const prerequisiteModuleIds = executionConfig.prerequisiteModuleNames.map(
            (moduleName) => modulesByName[moduleName]._id
        );

        const offeringModule = await ensureOfferingModule({
            schoolId: school._id,
            performedByUserId: coordinator._id,
            offeringId: offering._id,
            moduleDoc,
            executionConfig,
            teacherId: teacher._id,
            spaceId: space._id,
            prerequisiteModuleIds
        });

        offeringModules.push(offeringModule);
    }

    const schedulingContexts = {};
    for (const moduleDoc of Object.values(modulesByName)) {
        schedulingContexts[moduleDoc.name] = await TechnicalTeacherEligibilityService.getTechnicalProgramModuleSchedulingContext(
            moduleDoc._id,
            school._id
        );
    }

    const occupancy = await ResourceOccupancyService.getResourceOccupancy(school._id);

    const summary = {
        school: {
            id: String(school._id),
            name: school.name,
            educationModel: school.educationModel
        },
        access: {
            email: SCENARIO.coordinator.email,
            username: SCENARIO.coordinator.username,
            password: SCENARIO.coordinator.password
        },
        subjects: Object.values(subjectsByName).map((subject) => ({
            id: String(subject._id),
            name: subject.name,
            level: subject.level
        })),
        teachers: Object.values(teachersByEmail).map((teacher) => ({
            id: String(teacher._id),
            fullName: teacher.fullName,
            email: teacher.email,
            enabledSubjects: (teacher.staffProfiles || [])
                .flatMap((profile) => profile.enabledSubjects || [])
                .map((subject) => subject.name || String(subject))
        })),
        program: {
            id: String(program._id),
            name: program.name,
            totalWorkloadHours: program.totalWorkloadHours
        },
        modules: Object.values(modulesByName).map((moduleDoc) => ({
            id: String(moduleDoc._id),
            name: moduleDoc.name,
            moduleOrder: moduleDoc.moduleOrder,
            workloadHours: moduleDoc.workloadHours,
            subjectId: String(moduleDoc.subjectId)
        })),
        spaces: Object.values(spacesByName).map((space) => ({
            id: String(space._id),
            name: space.name,
            type: space.type,
            capacity: space.capacity
        })),
        offering: {
            id: String(offering._id),
            name: offering.name,
            code: offering.code,
            shift: offering.shift,
            plannedStartDate: offering.plannedStartDate,
            plannedEndDate: offering.plannedEndDate
        },
        offeringModules: offeringModules.map((moduleExecution) => ({
            id: String(moduleExecution._id),
            moduleName: moduleExecution.technicalProgramModuleId?.name || moduleExecution.technicalProgramModuleId,
            executionOrder: moduleExecution.executionOrder,
            estimatedStartDate: moduleExecution.estimatedStartDate,
            estimatedEndDate: moduleExecution.estimatedEndDate,
            plannedWeeklyMinutes: moduleExecution.plannedWeeklyMinutes,
            estimatedWeeks: moduleExecution.estimatedWeeks,
            status: moduleExecution.status,
            scheduleSlots: (moduleExecution.scheduleSlots || []).map((slot) => ({
                id: String(slot._id),
                weekday: slot.weekday,
                startTime: slot.startTime,
                endTime: slot.endTime,
                teacher: slot.teacherIds?.[0]?.fullName || null,
                space: slot.spaceId?.name || null,
                publicationStatus: slot.publicationStatus
            }))
        })),
        schedulingContexts: Object.fromEntries(
            Object.entries(schedulingContexts).map(([moduleName, context]) => ([
                moduleName,
                {
                    canEnterGrade: context.canEnterGrade,
                    eligibleTeachers: context.eligibleTeachers.map((teacher) => teacher.fullName),
                    blockingReasons: context.blockingReasons
                }
            ]))
        ),
        occupancySummary: occupancy.summary
    };

    console.log(JSON.stringify(summary, null, 2));
}

main()
    .catch((error) => {
        console.error('Falha ao criar o cenário técnico:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
