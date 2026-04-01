require('dotenv').config();

const mongoose = require('mongoose');
mongoose.set('strictPopulate', false);
const connectDB = require('../src/config/database');

const School = require('../src/api/models/school.model');
const Company = require('../src/api/models/company.model');
const Student = require('../src/api/models/student.model');
require('../src/api/models/subject.model');
require('../src/api/models/staffProfile.model');
require('../src/api/models/user.model');
require('../src/api/models/technicalSpace.model');
require('../src/api/models/class.model');
const TechnicalProgram = require('../src/api/models/technicalProgram.model');
const TechnicalProgramModule = require('../src/api/models/technicalProgramModule.model');
const TechnicalProgramOffering = require('../src/api/models/technicalProgramOffering.model');
const TechnicalProgramOfferingModule = require('../src/api/models/technicalProgramOfferingModule.model');
const TechnicalEnrollment = require('../src/api/models/technicalEnrollment.model');
const TechnicalModuleRecord = require('../src/api/models/technicalModuleRecord.model');
const User = require('../src/api/models/user.model');

const CompanyService = require('../src/api/services/company.service');
const TechnicalEnrollmentService = require('../src/api/services/technicalEnrollment.service');
const TechnicalModuleRecordService = require('../src/api/services/technicalModuleRecord.service');

const SCENARIO = {
    schoolName: 'Instituto Horizonte Técnico',
    coordinatorEmail: 'mariana.ribeiro@academyhub.test',
    programName: 'Técnico em Administração',
    offeringName: 'Turma Noturna',
    companies: [
        {
            name: 'Horizonte Contábil Ltda',
            legalName: 'Horizonte Contábil Ltda',
            cnpjBase: '114223330001',
            contactEmail: 'contato@horizontecontabil.test',
            contactPhone: '(11) 4002-1101',
            contactPerson: {
                fullName: 'Marcos Vinícius Torres',
                jobTitle: 'Gerente Administrativo',
                phone: '(11) 97111-1101',
                email: 'marcos.torres@horizontecontabil.test'
            },
            address: {
                street: 'Avenida Paulista',
                neighborhood: 'Bela Vista',
                number: '820',
                block: '',
                lot: '',
                cep: '01310-100',
                city: 'São Paulo',
                state: 'SP'
            }
        },
        {
            name: 'Vale Gestão Empresarial',
            legalName: 'Vale Gestão Empresarial Ltda',
            cnpjBase: '125334440001',
            contactEmail: 'relacionamento@valegestao.test',
            contactPhone: '(11) 4002-1102',
            contactPerson: {
                fullName: 'Patrícia Nogueira Silva',
                jobTitle: 'Coordenadora de Operações',
                phone: '(11) 97111-1102',
                email: 'patricia.silva@valegestao.test'
            },
            address: {
                street: 'Rua Haddock Lobo',
                neighborhood: 'Cerqueira César',
                number: '455',
                block: '',
                lot: '',
                cep: '01414-001',
                city: 'São Paulo',
                state: 'SP'
            }
        },
        {
            name: 'NorteLog Serviços Administrativos',
            legalName: 'NorteLog Serviços Administrativos Ltda',
            cnpjBase: '136445550001',
            contactEmail: 'contato@nortelog.test',
            contactPhone: '(11) 4002-1103',
            contactPerson: {
                fullName: 'Eduardo Pacheco Lima',
                jobTitle: 'Supervisor Corporativo',
                phone: '(11) 97111-1103',
                email: 'eduardo.lima@nortelog.test'
            },
            address: {
                street: 'Rua da Consolação',
                neighborhood: 'Consolação',
                number: '1220',
                block: '',
                lot: '',
                cep: '01302-001',
                city: 'São Paulo',
                state: 'SP'
            }
        },
        {
            name: 'Prime Office Soluções',
            legalName: 'Prime Office Soluções Administrativas Ltda',
            cnpjBase: '147556660001',
            contactEmail: 'atendimento@primeoffice.test',
            contactPhone: '(11) 4002-1104',
            contactPerson: {
                fullName: 'Juliana Ferreira Prado',
                jobTitle: 'Analista de Desenvolvimento Humano',
                phone: '(11) 97111-1104',
                email: 'juliana.prado@primeoffice.test'
            },
            address: {
                street: 'Rua Oscar Freire',
                neighborhood: 'Pinheiros',
                number: '610',
                block: '',
                lot: '',
                cep: '01426-001',
                city: 'São Paulo',
                state: 'SP'
            }
        },
        {
            name: 'Atlas Apoio Corporativo',
            legalName: 'Atlas Apoio Corporativo Ltda',
            cnpjBase: '158667770001',
            contactEmail: 'contato@atlasapoio.test',
            contactPhone: '(11) 4002-1105',
            contactPerson: {
                fullName: 'Renato Castro Almeida',
                jobTitle: 'Coordenador de Relacionamento',
                phone: '(11) 97111-1105',
                email: 'renato.almeida@atlasapoio.test'
            },
            address: {
                street: 'Avenida Faria Lima',
                neighborhood: 'Itaim Bibi',
                number: '1777',
                block: '',
                lot: '',
                cep: '04538-133',
                city: 'São Paulo',
                state: 'SP'
            }
        }
    ],
    participants: [
        {
            fullName: 'João Pedro Carvalho',
            birthDate: '1999-05-14',
            gender: 'Masculino',
            race: 'Parda',
            nationality: 'Brasileira',
            cpfBase: '214365870',
            rg: '325478901',
            email: 'joao.carvalho@horizontecontabil.test',
            phoneNumber: '(11) 97222-0001',
            companyName: 'Horizonte Contábil Ltda',
            enrollmentDate: '2026-03-02',
            address: {
                street: 'Rua Maestro Cardim',
                neighborhood: 'Bela Vista',
                number: '101',
                block: '',
                lot: '',
                cep: '01323-000',
                city: 'São Paulo',
                state: 'SP'
            },
            records: [
                {
                    moduleName: 'Fundamentos da Administração',
                    status: 'Concluído',
                    completedHours: 300,
                    startedAt: '2026-03-02',
                    finishedAt: '2026-07-12',
                    notes: 'Concluiu o primeiro módulo com bom desempenho.'
                },
                {
                    moduleName: 'Gestão Financeira',
                    status: 'Concluído',
                    completedHours: 300,
                    startedAt: '2026-07-13',
                    finishedAt: '2026-11-22',
                    notes: 'Concluiu o módulo de finanças dentro do período planejado.'
                },
                {
                    moduleName: 'Gestão de Pessoas',
                    status: 'Em andamento',
                    completedHours: 120,
                    startedAt: '2026-11-23',
                    notes: 'Está cursando o terceiro módulo e já completou parte relevante da carga.'
                }
            ]
        },
        {
            fullName: 'Larissa Almeida Costa',
            birthDate: '2000-08-09',
            gender: 'Feminino',
            race: 'Branca',
            nationality: 'Brasileira',
            cpfBase: '225476981',
            rg: '336589012',
            email: 'larissa.costa@horizontecontabil.test',
            phoneNumber: '(11) 97222-0002',
            companyName: 'Horizonte Contábil Ltda',
            enrollmentDate: '2026-04-20',
            address: {
                street: 'Rua Treze de Maio',
                neighborhood: 'Bela Vista',
                number: '205',
                block: '',
                lot: '',
                cep: '01327-000',
                city: 'São Paulo',
                state: 'SP'
            },
            records: [
                {
                    moduleName: 'Fundamentos da Administração',
                    status: 'Concluído',
                    completedHours: 300,
                    startedAt: '2026-04-20',
                    finishedAt: '2026-07-12',
                    notes: 'Ingressou no módulo inicial e concluiu a carga prevista.'
                },
                {
                    moduleName: 'Gestão Financeira',
                    status: 'Em andamento',
                    completedHours: 180,
                    startedAt: '2026-07-13',
                    notes: 'Avançou bem no módulo financeiro.'
                }
            ]
        },
        {
            fullName: 'Mateus Henrique Rocha',
            birthDate: '1998-11-21',
            gender: 'Masculino',
            race: 'Preta',
            nationality: 'Brasileira',
            cpfBase: '236587092',
            rg: '347690123',
            email: 'mateus.rocha@valegestao.test',
            phoneNumber: '(11) 97222-0003',
            companyName: 'Vale Gestão Empresarial',
            enrollmentDate: '2026-07-01',
            address: {
                street: 'Rua Frei Caneca',
                neighborhood: 'Consolação',
                number: '330',
                block: '',
                lot: '',
                cep: '01307-001',
                city: 'São Paulo',
                state: 'SP'
            },
            records: [
                {
                    moduleName: 'Fundamentos da Administração',
                    status: 'Em andamento',
                    completedHours: 60,
                    startedAt: '2026-07-01',
                    notes: 'Ingressou no fim do primeiro módulo e está recuperando a carga.'
                }
            ]
        },
        {
            fullName: 'Priscila Fernandes Lima',
            birthDate: '1997-03-17',
            gender: 'Feminino',
            race: 'Parda',
            nationality: 'Brasileira',
            cpfBase: '247698103',
            rg: '358701234',
            email: 'priscila.lima@valegestao.test',
            phoneNumber: '(11) 97222-0004',
            companyName: 'Vale Gestão Empresarial',
            enrollmentDate: '2026-09-15',
            address: {
                street: 'Alameda Santos',
                neighborhood: 'Cerqueira César',
                number: '890',
                block: '',
                lot: '',
                cep: '01419-001',
                city: 'São Paulo',
                state: 'SP'
            },
            records: [
                {
                    moduleName: 'Gestão Financeira',
                    status: 'Em andamento',
                    completedHours: 80,
                    startedAt: '2026-09-15',
                    notes: 'Entrou durante a etapa financeira e está em fase inicial.'
                }
            ]
        },
        {
            fullName: 'Rafael Gomes Pereira',
            birthDate: '1996-12-03',
            gender: 'Masculino',
            race: 'Branca',
            nationality: 'Brasileira',
            cpfBase: '258709214',
            rg: '369812345',
            email: 'rafael.pereira@nortelog.test',
            phoneNumber: '(11) 97222-0005',
            companyName: 'NorteLog Serviços Administrativos',
            enrollmentDate: '2026-11-20',
            address: {
                street: 'Rua Bela Cintra',
                neighborhood: 'Consolação',
                number: '412',
                block: '',
                lot: '',
                cep: '01415-000',
                city: 'São Paulo',
                state: 'SP'
            },
            records: [
                {
                    moduleName: 'Gestão de Pessoas',
                    status: 'Em andamento',
                    completedHours: 20,
                    startedAt: '2026-11-23',
                    notes: 'Ingressou na transição para o terceiro módulo.'
                }
            ]
        },
        {
            fullName: 'Tainá Oliveira Martins',
            birthDate: '2001-07-25',
            gender: 'Feminino',
            race: 'Parda',
            nationality: 'Brasileira',
            cpfBase: '269810325',
            rg: '370923456',
            email: 'taina.martins@nortelog.test',
            phoneNumber: '(11) 97222-0006',
            companyName: 'NorteLog Serviços Administrativos',
            enrollmentDate: '2027-01-15',
            address: {
                street: 'Rua Augusta',
                neighborhood: 'Consolação',
                number: '1520',
                block: '',
                lot: '',
                cep: '01305-100',
                city: 'São Paulo',
                state: 'SP'
            },
            records: [
                {
                    moduleName: 'Gestão de Pessoas',
                    status: 'Em andamento',
                    completedHours: 100,
                    startedAt: '2027-01-15',
                    notes: 'Já avançou de forma consistente no módulo de pessoas.'
                }
            ]
        },
        {
            fullName: 'Vinícius Souza Andrade',
            birthDate: '2002-01-08',
            gender: 'Masculino',
            race: 'Parda',
            nationality: 'Brasileira',
            cpfBase: '270921436',
            rg: '381034567',
            email: 'vinicius.andrade@primeoffice.test',
            phoneNumber: '(11) 97222-0007',
            companyName: 'Prime Office Soluções',
            enrollmentDate: '2027-03-10',
            address: {
                street: 'Rua Teodoro Sampaio',
                neighborhood: 'Pinheiros',
                number: '710',
                block: '',
                lot: '',
                cep: '05406-000',
                city: 'São Paulo',
                state: 'SP'
            },
            records: [
                {
                    moduleName: 'Gestão de Pessoas',
                    status: 'Em andamento',
                    completedHours: 40,
                    startedAt: '2027-03-10',
                    notes: 'Entrada recente no terceiro módulo, ainda em fase inicial.'
                }
            ]
        },
        {
            fullName: 'Bianca Lopes Ribeiro',
            birthDate: '1999-09-30',
            gender: 'Feminino',
            race: 'Branca',
            nationality: 'Brasileira',
            cpfBase: '281032547',
            rg: '392145678',
            email: 'bianca.ribeiro@primeoffice.test',
            phoneNumber: '(11) 97222-0008',
            companyName: 'Prime Office Soluções',
            enrollmentDate: '2027-05-05',
            address: {
                street: 'Rua Capote Valente',
                neighborhood: 'Pinheiros',
                number: '302',
                block: '',
                lot: '',
                cep: '05409-000',
                city: 'São Paulo',
                state: 'SP'
            },
            records: [
                {
                    moduleName: 'Processos Administrativos',
                    status: 'Em andamento',
                    completedHours: 60,
                    startedAt: '2027-05-05',
                    notes: 'Ingressou diretamente na fase final da oferta e iniciou processos.'
                }
            ]
        },
        {
            fullName: 'Gabriel Costa Melo',
            birthDate: '2000-02-11',
            gender: 'Masculino',
            race: 'Preta',
            nationality: 'Brasileira',
            cpfBase: '292143658',
            rg: '403256789',
            email: 'gabriel.melo@atlasapoio.test',
            phoneNumber: '(11) 97222-0009',
            companyName: 'Atlas Apoio Corporativo',
            enrollmentDate: '2027-06-20',
            address: {
                street: 'Rua Tabapuã',
                neighborhood: 'Itaim Bibi',
                number: '630',
                block: '',
                lot: '',
                cep: '04533-011',
                city: 'São Paulo',
                state: 'SP'
            },
            records: [
                {
                    moduleName: 'Processos Administrativos',
                    status: 'Em andamento',
                    completedHours: 20,
                    startedAt: '2027-06-20',
                    notes: 'Ingresso tardio, com progresso inicial no último módulo.'
                }
            ]
        },
        {
            fullName: 'Yasmin Ferreira Nunes',
            birthDate: '2001-10-19',
            gender: 'Feminino',
            race: 'Parda',
            nationality: 'Brasileira',
            cpfBase: '303254769',
            rg: '414367890',
            email: 'yasmin.nunes@atlasapoio.test',
            phoneNumber: '(11) 97222-0010',
            companyName: 'Atlas Apoio Corporativo',
            enrollmentDate: '2027-08-01',
            address: {
                street: 'Rua Joaquim Floriano',
                neighborhood: 'Itaim Bibi',
                number: '118',
                block: '',
                lot: '',
                cep: '04534-000',
                city: 'São Paulo',
                state: 'SP'
            },
            records: []
        }
    ]
};

function calculateCpf(base) {
    const digits = String(base).replace(/\D/g, '').split('').map(Number);
    if (digits.length !== 9) {
        throw new Error(`Base de CPF inválida: ${base}`);
    }

    const calcDigit = (items, factor) => {
        const total = items.reduce((sum, value) => sum + (value * factor--), 0);
        const rest = 11 - (total % 11);
        return rest >= 10 ? 0 : rest;
    };

    const digit1 = calcDigit([...digits], 10);
    const digit2 = calcDigit([...digits, digit1], 11);
    return [...digits, digit1, digit2].join('');
}

function calculateCnpj(base) {
    const digits = String(base).replace(/\D/g, '').split('').map(Number);
    if (digits.length !== 12) {
        throw new Error(`Base de CNPJ inválida: ${base}`);
    }

    const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

    const calcDigit = (items, weights) => {
        const total = items.reduce((sum, value, index) => sum + (value * weights[index]), 0);
        const rest = total % 11;
        return rest < 2 ? 0 : 11 - rest;
    };

    const digit1 = calcDigit(digits, weights1);
    const digit2 = calcDigit([...digits, digit1], weights2);
    return [...digits, digit1, digit2].join('');
}

async function loadScenarioContext() {
    const school = await School.findOne({
        name: SCENARIO.schoolName,
        educationModel: 'technical_apprenticeship'
    });

    if (!school) {
        throw new Error('A escola técnica base não foi encontrada. Execute primeiro o cenário do curso técnico.');
    }

    const coordinator = await User.findOne({
        school_id: school._id,
        email: SCENARIO.coordinatorEmail
    });

    if (!coordinator) {
        throw new Error('A coordenadora técnica de teste não foi encontrada.');
    }

    const program = await TechnicalProgram.findOne({
        school_id: school._id,
        name: SCENARIO.programName
    });

    if (!program) {
        throw new Error('O curso técnico base não foi encontrado.');
    }

    const offering = await TechnicalProgramOffering.findOne({
        school_id: school._id,
        technicalProgramId: program._id,
        name: SCENARIO.offeringName
    });

    if (!offering) {
        throw new Error('A oferta técnica base não foi encontrada.');
    }

    const modules = await TechnicalProgramModule.find({
        school_id: school._id,
        technicalProgramId: program._id
    }).sort({ moduleOrder: 1 });

    const offeringModules = await TechnicalProgramOfferingModule.find({
        school_id: school._id,
        technicalProgramOfferingId: offering._id
    });

    return {
        school,
        coordinator,
        program,
        offering,
        modulesByName: Object.fromEntries(modules.map((item) => [item.name, item])),
        offeringModulesByModuleId: Object.fromEntries(
            offeringModules.map((item) => [String(item.technicalProgramModuleId), item])
        )
    };
}

async function ensureCompany(schoolId, companyConfig) {
    const desiredPayload = {
        name: companyConfig.name,
        legalName: companyConfig.legalName,
        cnpj: calculateCnpj(companyConfig.cnpjBase),
        contactEmail: companyConfig.contactEmail,
        contactPhone: companyConfig.contactPhone,
        contactPerson: companyConfig.contactPerson,
        address: companyConfig.address,
        status: 'Ativa'
    };

    let company = await Company.findOne({
        school_id: schoolId,
        cnpj: desiredPayload.cnpj
    });

    if (!company) {
        return CompanyService.createCompany(desiredPayload, schoolId);
    }

    Object.assign(company, {
        ...desiredPayload,
        school_id: schoolId
    });
    await company.save();
    return company.toObject();
}

async function ensureStudent(schoolId, participantConfig, enrollmentNumber) {
    const cpf = calculateCpf(participantConfig.cpfBase);
    const desiredPayload = {
        fullName: participantConfig.fullName,
        birthDate: participantConfig.birthDate,
        gender: participantConfig.gender,
        race: participantConfig.race,
        nationality: participantConfig.nationality,
        email: participantConfig.email,
        phoneNumber: participantConfig.phoneNumber,
        rg: participantConfig.rg,
        cpf,
        address: participantConfig.address,
        tutors: [],
        financialResp: 'STUDENT',
        intendedGrade: 'Formação Técnica',
        isActive: true,
        school_id: schoolId
    };

    let student = await Student.findOne({
        school_id: schoolId,
        cpf
    });

    if (!student) {
        student = new Student({
            ...desiredPayload,
            enrollmentNumber
        });
        await student.save();
        return Student.findById(student._id).select('-profilePicture.data');
    }

    Object.assign(student, {
        ...desiredPayload,
        school_id: schoolId,
        enrollmentNumber
    });
    await student.save();
    return Student.findById(student._id).select('-profilePicture.data');
}

async function ensureTechnicalEnrollment({
    schoolId,
    studentId,
    companyId,
    programId,
    offeringId,
    enrollmentDate
}) {
    let enrollment = await TechnicalEnrollment.findOne({
        school_id: schoolId,
        studentId,
        technicalProgramId: programId
    });

    if (!enrollment) {
        return TechnicalEnrollmentService.createTechnicalEnrollment({
            studentId,
            companyId,
            technicalProgramId: programId,
            currentTechnicalProgramOfferingId: offeringId,
            enrollmentDate,
            status: 'Ativa',
            notes: 'Matrícula técnica criada para cenário de teste de empresas e progressão individual.'
        }, schoolId);
    }

    enrollment.companyId = companyId;
    enrollment.technicalProgramId = programId;
    enrollment.currentTechnicalProgramOfferingId = offeringId;
    enrollment.currentClassId = null;
    enrollment.enrollmentDate = new Date(enrollmentDate);
    enrollment.status = 'Ativa';
    enrollment.notes = 'Matrícula técnica criada para cenário de teste de empresas e progressão individual.';
    await enrollment.save();
    return TechnicalEnrollment.findById(enrollment._id);
}

async function resetAndCreateModuleRecords({
    schoolId,
    enrollment,
    participantConfig,
    modulesByName,
    offeringId,
    offeringModulesByModuleId
}) {
    await TechnicalModuleRecord.deleteMany({
        school_id: schoolId,
        technicalEnrollmentId: enrollment._id
    });

    const createdRecords = [];
    for (const recordConfig of participantConfig.records) {
        const moduleDoc = modulesByName[recordConfig.moduleName];
        const offeringModule = offeringModulesByModuleId[String(moduleDoc._id)];

        const record = await TechnicalModuleRecordService.createTechnicalModuleRecord({
            technicalEnrollmentId: enrollment._id,
            technicalProgramModuleId: moduleDoc._id,
            technicalProgramOfferingId: offeringId,
            technicalProgramOfferingModuleId: offeringModule?._id || null,
            completedHours: recordConfig.completedHours,
            status: recordConfig.status,
            startedAt: recordConfig.startedAt,
            finishedAt: recordConfig.finishedAt || null,
            notes: recordConfig.notes
        }, schoolId);

        createdRecords.push(record);
    }

    return createdRecords;
}

async function main() {
    await connectDB();

    const context = await loadScenarioContext();
    const companiesByName = {};

    for (const companyConfig of SCENARIO.companies) {
        const company = await ensureCompany(context.school._id, companyConfig);
        companiesByName[company.name] = company;
    }

    const enrollments = [];
    const studentsByName = {};

    for (const [index, participantConfig] of SCENARIO.participants.entries()) {
        const enrollmentNumber = `HTA-${String(index + 1).padStart(3, '0')}`;
        const student = await ensureStudent(context.school._id, participantConfig, enrollmentNumber);
        studentsByName[student.fullName] = student;

        const company = companiesByName[participantConfig.companyName];
        const enrollment = await ensureTechnicalEnrollment({
            schoolId: context.school._id,
            studentId: student._id,
            companyId: company._id,
            programId: context.program._id,
            offeringId: context.offering._id,
            enrollmentDate: participantConfig.enrollmentDate
        });

        await resetAndCreateModuleRecords({
            schoolId: context.school._id,
            enrollment,
            participantConfig,
            modulesByName: context.modulesByName,
            offeringId: context.offering._id,
            offeringModulesByModuleId: context.offeringModulesByModuleId
        });

        enrollments.push(await TechnicalEnrollmentService.getTechnicalEnrollmentProgress(enrollment._id, context.school._id));
    }

    const summary = {
        school: {
            id: String(context.school._id),
            name: context.school.name
        },
        program: {
            id: String(context.program._id),
            name: context.program.name
        },
        offering: {
            id: String(context.offering._id),
            name: context.offering.name
        },
        companies: Object.values(companiesByName).map((company) => ({
            id: String(company._id),
            name: company.name,
            legalName: company.legalName,
            cnpj: company.cnpj,
            contactPerson: company.contactPerson?.fullName || null
        })),
        participants: SCENARIO.participants.map((participant) => {
            const student = studentsByName[participant.fullName];
            const progress = enrollments.find((entry) => String(entry.enrollment.studentId._id || entry.enrollment.studentId) === String(student._id));
            return {
                studentId: String(student._id),
                enrollmentNumber: student.enrollmentNumber,
                fullName: participant.fullName,
                companyName: participant.companyName,
                enrollmentDate: participant.enrollmentDate,
                overallStatus: progress.summary.overallStatus,
                completionPercentage: progress.summary.completionPercentage,
                totalCompletedHours: progress.summary.totalCompletedHours,
                totalRemainingHours: progress.summary.totalRemainingHours,
                moduleStatuses: progress.modules.map((moduleItem) => ({
                    moduleName: moduleItem.technicalProgramModule.name,
                    status: moduleItem.status,
                    completedHours: moduleItem.completedHours,
                    remainingHours: moduleItem.remainingHours
                }))
            };
        }),
        counts: {
            companies: Object.keys(companiesByName).length,
            participants: Object.keys(studentsByName).length,
            enrollments: enrollments.length
        }
    };

    console.log(JSON.stringify(summary, null, 2));
}

main()
    .catch((error) => {
        console.error('Falha ao criar o cenário de empresas e participantes técnicos:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await mongoose.disconnect();
    });
