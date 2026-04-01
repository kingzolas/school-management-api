const BootstrapRun = require('../api/models/bootstrapRun.model');
const School = require('../api/models/school.model');
const User = require('../api/models/user.model');
const Student = require('../api/models/student.model');

const UserService = require('../api/services/user.service');
const SubjectService = require('../api/services/subject.service');
const TechnicalProgramService = require('../api/services/technicalProgram.service');
const TechnicalProgramModuleService = require('../api/services/technicalProgramModule.service');
const TechnicalProgramOfferingService = require('../api/services/technicalProgramOffering.service');
const TechnicalProgramOfferingModuleService = require('../api/services/technicalProgramOfferingModule.service');
const TechnicalSpaceService = require('../api/services/technicalSpace.service');
const TechnicalEnrollmentService = require('../api/services/technicalEnrollment.service');
const TechnicalModuleRecordService = require('../api/services/technicalModuleRecord.service');
const CompanyService = require('../api/services/company.service');
const ResourceOccupancyService = require('../api/services/resourceOccupancy.service');
const TechnicalTeacherEligibilityService = require('../api/services/technicalTeacherEligibility.service');

const BOOTSTRAP_KEY = 'technical_school_production_bootstrap_v1';
const BOOTSTRAP_DESCRIPTION = 'Bootstrap automatico de producao para escola tecnica isolada.';
const STALE_RUNNING_THRESHOLD_MS = 1000 * 60 * 30;

const SCHOOL_NAME_CANDIDATES = [
    'Instituto Horizonte Técnico',
    'Instituto Horizonte Profissional'
];

const slotFingerprint = (slot) => `${Number(slot.weekday)}|${slot.startTime}|${slot.endTime}`;
const toObjectIdString = (value) => (value ? String(value._id || value) : null);

function onlyDigits(value) {
    return String(value || '').replace(/\D/g, '');
}

function calculateCpf(base) {
    const digits = onlyDigits(base).split('').map(Number);
    if (digits.length !== 9) {
        throw new Error(`Base de CPF invalida: ${base}`);
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
    const digits = onlyDigits(base).split('').map(Number);
    if (digits.length !== 12) {
        throw new Error(`Base de CNPJ invalida: ${base}`);
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

function buildEnrollmentNumber(prefix, index) {
    return `${prefix}-ADM-${String(index + 1).padStart(3, '0')}`;
}

function createAuditState() {
    return {
        schoolName: null,
        schoolId: null,
        adminUserId: null,
        createdIds: {
            subjectIds: [],
            teacherIds: [],
            technicalProgramId: null,
            technicalProgramModuleIds: [],
            technicalProgramOfferingId: null,
            technicalProgramOfferingModuleIds: [],
            technicalSpaceIds: [],
            companyIds: [],
            studentIds: [],
            technicalEnrollmentIds: [],
            technicalModuleRecordIds: []
        }
    };
}

function pushCreatedId(target, key, value) {
    if (!value) {
        return;
    }

    const normalized = String(value);
    if (!Array.isArray(target[key])) {
        target[key] = [];
    }

    if (!target[key].includes(normalized)) {
        target[key].push(normalized);
    }
}

function buildScenario(schoolName) {
    const schoolPrefix = schoolName === SCHOOL_NAME_CANDIDATES[0] ? 'IHT' : 'IHP';
    const identitySuffix = schoolPrefix.toLowerCase();

    return {
        schoolPrefix,
        school: {
            name: schoolName,
            legalName: `${schoolName} Ltda`,
            cnpj: calculateCnpj('118223340001'),
            educationModel: 'technical_apprenticeship',
            authorizationProtocol: 'Portaria Técnica Interna 014/2026',
            contactPhone: '(11) 4002-7070',
            contactEmail: `contato@${identitySuffix}.academyhub.test`,
            address: {
                street: 'Rua das Palmeiras',
                number: '120',
                neighborhood: 'Centro',
                city: 'São Paulo',
                state: 'SP',
                zipCode: '01010-100'
            }
        },
        admin: {
            fullName: 'Rian Oliveira Santos',
            email: `rian.test@${identitySuffix}.academyhub.test`,
            username: 'rian.test',
            password: '123456',
            cpf: calculateCpf('415628370'),
            phoneNumber: '(11) 97111-0099',
            roles: ['Admin', 'Coordenador'],
            profile: {
                admissionDate: '2026-01-15',
                employmentType: 'Efetivo (CLT)',
                mainRole: 'Administrador Técnico',
                remunerationModel: 'Salário Fixo Mensal',
                salaryAmount: 7200,
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
                email: `ana.martins@${identitySuffix}.academyhub.test`,
                username: `ana.martins.${identitySuffix}`,
                password: 'AcademyHub123',
                cpf: calculateCpf('274635980'),
                phoneNumber: '(11) 97111-0002',
                roles: ['Professor'],
                subjectName: 'Fundamentos da Administração'
            },
            {
                fullName: 'Bruno Henrique Lima',
                email: `bruno.lima@${identitySuffix}.academyhub.test`,
                username: `bruno.lima.${identitySuffix}`,
                password: 'AcademyHub123',
                cpf: calculateCpf('381640250'),
                phoneNumber: '(11) 97111-0003',
                roles: ['Professor'],
                subjectName: 'Gestão Financeira'
            },
            {
                fullName: 'Carla Mendes Rocha',
                email: `carla.rocha@${identitySuffix}.academyhub.test`,
                username: `carla.rocha.${identitySuffix}`,
                password: 'AcademyHub123',
                cpf: calculateCpf('496208170'),
                phoneNumber: '(11) 97111-0004',
                roles: ['Professor'],
                subjectName: 'Gestão de Pessoas'
            },
            {
                fullName: 'Diego Alves Souza',
                email: `diego.souza@${identitySuffix}.academyhub.test`,
                username: `diego.souza.${identitySuffix}`,
                password: 'AcademyHub123',
                cpf: calculateCpf('607319480'),
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
        moduleBlueprints: [
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
                description: 'Desenvolvimento de competências ligadas à liderança, recrutamento e rotinas de RH.',
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
            notes: 'Oferta técnica criada automaticamente pelo bootstrap produtivo do cenário técnico.'
        },
        spaces: [
            { name: 'Sala 01', type: 'Sala', capacity: 35, status: 'Ativo' },
            { name: 'Sala 02', type: 'Sala', capacity: 35, status: 'Ativo' },
            { name: 'Sala 03', type: 'Sala', capacity: 35, status: 'Ativo' },
            { name: 'Sala 04', type: 'Sala', capacity: 35, status: 'Ativo' }
        ],
        moduleExecutions: [
            {
                moduleName: 'Fundamentos da Administração',
                executionOrder: 1,
                estimatedStartDate: '2026-03-02',
                status: 'Em andamento',
                spaceName: 'Sala 01',
                teacherEmail: `ana.martins@${identitySuffix}.academyhub.test`,
                prerequisiteModuleNames: [],
                scheduleSlots: [
                    { weekday: 1, startTime: '18:30', endTime: '22:30' },
                    { weekday: 2, startTime: '18:30', endTime: '22:30' },
                    { weekday: 3, startTime: '18:30', endTime: '22:30' },
                    { weekday: 4, startTime: '18:30', endTime: '22:30' }
                ],
                publishFingerprints: ['1|18:30|22:30', '2|18:30|22:30', '3|18:30|22:30', '4|18:30|22:30']
            },
            {
                moduleName: 'Gestão Financeira',
                executionOrder: 2,
                estimatedStartDate: '2026-07-13',
                status: 'Planejado',
                spaceName: 'Sala 02',
                teacherEmail: `bruno.lima@${identitySuffix}.academyhub.test`,
                prerequisiteModuleNames: ['Fundamentos da Administração'],
                scheduleSlots: [
                    { weekday: 1, startTime: '18:30', endTime: '20:30' },
                    { weekday: 1, startTime: '20:30', endTime: '22:30' },
                    { weekday: 2, startTime: '18:30', endTime: '22:30' },
                    { weekday: 3, startTime: '18:30', endTime: '22:30' },
                    { weekday: 4, startTime: '18:30', endTime: '22:30' }
                ],
                publishFingerprints: ['1|18:30|20:30', '2|18:30|22:30', '3|18:30|22:30', '4|18:30|22:30']
            },
            {
                moduleName: 'Gestão de Pessoas',
                executionOrder: 3,
                estimatedStartDate: '2026-11-23',
                status: 'Planejado',
                spaceName: 'Sala 03',
                teacherEmail: `carla.rocha@${identitySuffix}.academyhub.test`,
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
                teacherEmail: `diego.souza@${identitySuffix}.academyhub.test`,
                prerequisiteModuleNames: ['Gestão de Pessoas'],
                scheduleSlots: [
                    { weekday: 1, startTime: '18:30', endTime: '22:30' },
                    { weekday: 2, startTime: '18:30', endTime: '22:30' },
                    { weekday: 3, startTime: '18:30', endTime: '22:30' },
                    { weekday: 4, startTime: '18:30', endTime: '22:30' }
                ],
                publishFingerprints: ['1|18:30|22:30', '2|18:30|22:30', '3|18:30|22:30', '4|18:30|22:30']
            }
        ],
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
                    { moduleName: 'Fundamentos da Administração', status: 'Concluído', completedHours: 300, startedAt: '2026-03-02', finishedAt: '2026-07-12', notes: 'Concluiu o primeiro módulo com bom desempenho.' },
                    { moduleName: 'Gestão Financeira', status: 'Concluído', completedHours: 300, startedAt: '2026-07-13', finishedAt: '2026-11-22', notes: 'Concluiu o módulo de finanças dentro do período planejado.' },
                    { moduleName: 'Gestão de Pessoas', status: 'Em andamento', completedHours: 120, startedAt: '2026-11-23', notes: 'Está cursando o terceiro módulo e já completou parte relevante da carga.' }
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
                    { moduleName: 'Fundamentos da Administração', status: 'Concluído', completedHours: 300, startedAt: '2026-04-20', finishedAt: '2026-07-12', notes: 'Ingressou no módulo inicial e concluiu a carga prevista.' },
                    { moduleName: 'Gestão Financeira', status: 'Em andamento', completedHours: 180, startedAt: '2026-07-13', notes: 'Avançou bem no módulo financeiro.' }
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
                    { moduleName: 'Fundamentos da Administração', status: 'Em andamento', completedHours: 60, startedAt: '2026-07-01', notes: 'Ingressou no fim do primeiro módulo e está recuperando a carga.' }
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
                    { moduleName: 'Gestão Financeira', status: 'Em andamento', completedHours: 80, startedAt: '2026-09-15', notes: 'Entrou durante a etapa financeira e está em fase inicial.' }
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
                    { moduleName: 'Gestão de Pessoas', status: 'Em andamento', completedHours: 20, startedAt: '2026-11-23', notes: 'Ingressou na transição para o terceiro módulo.' }
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
                    { moduleName: 'Gestão de Pessoas', status: 'Em andamento', completedHours: 100, startedAt: '2027-01-15', notes: 'Já avançou de forma consistente no módulo de pessoas.' }
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
                    { moduleName: 'Gestão de Pessoas', status: 'Em andamento', completedHours: 40, startedAt: '2027-03-10', notes: 'Entrada recente no terceiro módulo, ainda em fase inicial.' }
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
                    { moduleName: 'Processos Administrativos', status: 'Em andamento', completedHours: 60, startedAt: '2027-05-05', notes: 'Ingressou diretamente na fase final da oferta e iniciou processos.' }
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
                    { moduleName: 'Processos Administrativos', status: 'Em andamento', completedHours: 20, startedAt: '2027-06-20', notes: 'Ingresso tardio, com progresso inicial no último módulo.' }
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
}

async function markBootstrapFailed(runId, auditState, error) {
    const message = error instanceof Error ? error.message : String(error);
    await BootstrapRun.findByIdAndUpdate(runId, {
        $set: {
            status: 'failed',
            failedAt: new Date(),
            completedAt: null,
            schoolName: auditState.schoolName || null,
            schoolId: auditState.schoolId || null,
            adminUserId: auditState.adminUserId || null,
            createdIds: auditState.createdIds,
            lastError: message
        }
    });
}

async function resolveTargetSchoolName() {
    const [preferredExists, alternateExists] = await Promise.all(
        SCHOOL_NAME_CANDIDATES.map((name) => School.exists({ name }))
    );

    if (!preferredExists) {
        return SCHOOL_NAME_CANDIDATES[0];
    }

    if (!alternateExists) {
        return SCHOOL_NAME_CANDIDATES[1];
    }

    throw new Error('Os nomes reservados para o bootstrap tecnico ja existem em producao. O bootstrap foi interrompido por seguranca.');
}

async function assertNoConflictingUsers(scenario) {
    const usernames = [scenario.admin.username, ...scenario.teachers.map((teacher) => teacher.username)];
    const emails = [scenario.admin.email, ...scenario.teachers.map((teacher) => teacher.email)];
    const cpfs = [scenario.admin.cpf, ...scenario.teachers.map((teacher) => teacher.cpf)];

    const conflicts = await User.find({
        $or: [
            { username: { $in: usernames } },
            { email: { $in: emails } },
            { cpf: { $in: cpfs } }
        ]
    }).select('_id fullName username email cpf school_id');

    if (conflicts.length > 0) {
        const labels = conflicts.map((item) => item.username || item.email || item.cpf).join(', ');
        throw new Error(`Ja existem usuarios conflitantes para o bootstrap tecnico: ${labels}. Nada foi recriado.`);
    }
}

async function assertNoConflictingEnrollmentNumbers(scenario) {
    const enrollmentNumbers = scenario.participants.map((_, index) => buildEnrollmentNumber(scenario.schoolPrefix, index));
    const conflicts = await Student.find({
        enrollmentNumber: { $in: enrollmentNumbers }
    }).select('_id enrollmentNumber');

    if (conflicts.length > 0) {
        const labels = conflicts.map((item) => item.enrollmentNumber).join(', ');
        throw new Error(`Ja existem matriculas com os codigos reservados para o bootstrap tecnico: ${labels}.`);
    }
}

async function createSchool(scenario) {
    const school = new School(scenario.school);
    await school.save();
    return school;
}

async function createAdminUser(schoolId, scenario) {
    return UserService.createStaff({
        fullName: scenario.admin.fullName,
        email: scenario.admin.email,
        username: scenario.admin.username,
        password: scenario.admin.password,
        cpf: scenario.admin.cpf,
        phoneNumber: scenario.admin.phoneNumber,
        roles: scenario.admin.roles,
        status: 'Ativo',
        ...scenario.admin.profile,
        enabledSubjects: []
    }, schoolId);
}

async function createTeacherUser(schoolId, teacherConfig, enabledSubjectId) {
    return UserService.createStaff({
        fullName: teacherConfig.fullName,
        email: teacherConfig.email,
        username: teacherConfig.username,
        password: teacherConfig.password,
        cpf: teacherConfig.cpf,
        phoneNumber: teacherConfig.phoneNumber,
        roles: teacherConfig.roles,
        status: 'Ativo',
        admissionDate: '2026-02-02',
        employmentType: 'Efetivo (CLT)',
        mainRole: 'Professor',
        remunerationModel: 'Pagamento por Hora/Aula',
        hourlyRate: 85,
        weeklyWorkload: 20,
        academicFormation: 'Especialização em Educação Profissional',
        enabledLevels: [],
        enabledSubjects: [enabledSubjectId]
    }, schoolId);
}

async function createStudentRecord(schoolId, participantConfig, enrollmentNumber) {
    const student = new Student({
        enrollmentNumber,
        intendedGrade: 'Formação Técnica',
        fullName: participantConfig.fullName,
        birthDate: participantConfig.birthDate,
        gender: participantConfig.gender,
        race: participantConfig.race,
        nationality: participantConfig.nationality,
        email: participantConfig.email,
        phoneNumber: participantConfig.phoneNumber,
        rg: participantConfig.rg,
        cpf: calculateCpf(participantConfig.cpfBase),
        address: participantConfig.address,
        tutors: [],
        financialResp: 'STUDENT',
        isActive: true,
        school_id: schoolId
    });

    await student.save();
    return student;
}

async function createScenario(auditState) {
    const schoolName = await resolveTargetSchoolName();
    const scenario = buildScenario(schoolName);
    auditState.schoolName = schoolName;

    await assertNoConflictingUsers(scenario);
    await assertNoConflictingEnrollmentNumbers(scenario);

    const school = await createSchool(scenario);
    auditState.schoolId = toObjectIdString(school);

    const adminUser = await createAdminUser(school._id, scenario);
    auditState.adminUserId = toObjectIdString(adminUser);

    const subjectsByName = {};
    for (const subjectConfig of scenario.subjects) {
        const subject = await SubjectService.createSubject(subjectConfig, school._id);
        subjectsByName[subject.name] = subject;
        pushCreatedId(auditState.createdIds, 'subjectIds', subject._id);
    }

    const teachersByEmail = {};
    for (const teacherConfig of scenario.teachers) {
        const subject = subjectsByName[teacherConfig.subjectName];
        const teacher = await createTeacherUser(school._id, teacherConfig, subject._id);
        teachersByEmail[teacherConfig.email] = teacher;
        pushCreatedId(auditState.createdIds, 'teacherIds', teacher._id);
    }

    const technicalProgram = await TechnicalProgramService.createTechnicalProgram(scenario.program, school._id);
    auditState.createdIds.technicalProgramId = toObjectIdString(technicalProgram);

    const modulesByName = {};
    for (const moduleConfig of scenario.moduleBlueprints) {
        const subject = subjectsByName[moduleConfig.subjectName];
        const moduleDoc = await TechnicalProgramModuleService.createTechnicalProgramModule({
            technicalProgramId: technicalProgram._id,
            subjectId: subject._id,
            name: moduleConfig.name,
            description: moduleConfig.description,
            moduleOrder: moduleConfig.moduleOrder,
            workloadHours: moduleConfig.workloadHours,
            status: moduleConfig.status
        }, school._id);

        const schedulingContext = await TechnicalTeacherEligibilityService.getTechnicalProgramModuleSchedulingContext(
            moduleDoc._id,
            school._id
        );
        if (!schedulingContext.canEnterGrade) {
            throw new Error(`O modulo '${moduleDoc.name}' nao ficou elegivel para grade durante o bootstrap.`);
        }

        modulesByName[moduleDoc.name] = moduleDoc;
        pushCreatedId(auditState.createdIds, 'technicalProgramModuleIds', moduleDoc._id);
    }

    const spacesByName = {};
    for (const spaceConfig of scenario.spaces) {
        const space = await TechnicalSpaceService.createTechnicalSpace(spaceConfig, school._id);
        spacesByName[space.name] = space;
        pushCreatedId(auditState.createdIds, 'technicalSpaceIds', space._id);
    }

    const offering = await TechnicalProgramOfferingService.createTechnicalProgramOffering({
        ...scenario.offering,
        technicalProgramId: technicalProgram._id,
        defaultSpaceId: spacesByName['Sala 01']._id
    }, school._id);
    auditState.createdIds.technicalProgramOfferingId = toObjectIdString(offering);

    const offeringModulesByName = {};
    for (const executionConfig of scenario.moduleExecutions) {
        const moduleDoc = modulesByName[executionConfig.moduleName];
        const teacher = teachersByEmail[executionConfig.teacherEmail];
        const space = spacesByName[executionConfig.spaceName];
        const prerequisiteModuleIds = executionConfig.prerequisiteModuleNames.map((name) => modulesByName[name]._id);

        let offeringModule = await TechnicalProgramOfferingModuleService.createTechnicalProgramOfferingModule({
            technicalProgramOfferingId: offering._id,
            technicalProgramModuleId: moduleDoc._id,
            executionOrder: executionConfig.executionOrder,
            moduleOrderSnapshot: moduleDoc.moduleOrder,
            plannedWorkloadHours: moduleDoc.workloadHours,
            estimatedStartDate: executionConfig.estimatedStartDate,
            prerequisiteModuleIds,
            scheduleSlots: executionConfig.scheduleSlots.map((slot) => ({
                weekday: slot.weekday,
                startTime: slot.startTime,
                endTime: slot.endTime,
                teacherIds: [teacher._id],
                spaceId: space._id,
                status: 'Ativo',
                notes: `Aula de ${moduleDoc.name}`
            })),
            status: executionConfig.status,
            notes: `Execução de ${moduleDoc.name} na ${scenario.offering.name}.`
        }, school._id);

        const publishFingerprints = new Set(executionConfig.publishFingerprints);
        for (const slot of offeringModule.scheduleSlots || []) {
            if (!publishFingerprints.has(slotFingerprint(slot))) {
                continue;
            }

            offeringModule = await ResourceOccupancyService.publishScheduleSlot(
                offeringModule._id,
                slot._id,
                school._id,
                adminUser._id
            );
        }

        offeringModulesByName[moduleDoc.name] = offeringModule;
        pushCreatedId(auditState.createdIds, 'technicalProgramOfferingModuleIds', offeringModule._id);
    }

    const companiesByName = {};
    for (const companyConfig of scenario.companies) {
        const company = await CompanyService.createCompany({
            name: companyConfig.name,
            legalName: companyConfig.legalName,
            cnpj: calculateCnpj(companyConfig.cnpjBase),
            contactEmail: companyConfig.contactEmail,
            contactPhone: companyConfig.contactPhone,
            contactPerson: companyConfig.contactPerson,
            address: companyConfig.address,
            status: 'Ativa'
        }, school._id);

        companiesByName[company.name] = company;
        pushCreatedId(auditState.createdIds, 'companyIds', company._id);
    }

    for (const [index, participantConfig] of scenario.participants.entries()) {
        const student = await createStudentRecord(
            school._id,
            participantConfig,
            buildEnrollmentNumber(scenario.schoolPrefix, index)
        );
        pushCreatedId(auditState.createdIds, 'studentIds', student._id);

        const enrollment = await TechnicalEnrollmentService.createTechnicalEnrollment({
            studentId: student._id,
            companyId: companiesByName[participantConfig.companyName]._id,
            technicalProgramId: technicalProgram._id,
            currentTechnicalProgramOfferingId: offering._id,
            enrollmentDate: participantConfig.enrollmentDate,
            status: 'Ativa',
            notes: 'Matrícula técnica criada automaticamente pelo bootstrap produtivo.'
        }, school._id);
        pushCreatedId(auditState.createdIds, 'technicalEnrollmentIds', enrollment._id);

        for (const recordConfig of participantConfig.records) {
            const moduleDoc = modulesByName[recordConfig.moduleName];
            const offeringModule = offeringModulesByName[recordConfig.moduleName];
            const moduleRecord = await TechnicalModuleRecordService.createTechnicalModuleRecord({
                technicalEnrollmentId: enrollment._id,
                technicalProgramModuleId: moduleDoc._id,
                technicalProgramOfferingId: offering._id,
                technicalProgramOfferingModuleId: offeringModule?._id || null,
                completedHours: recordConfig.completedHours,
                status: recordConfig.status,
                startedAt: recordConfig.startedAt,
                finishedAt: recordConfig.finishedAt || null,
                notes: recordConfig.notes
            }, school._id);

            pushCreatedId(auditState.createdIds, 'technicalModuleRecordIds', moduleRecord._id);
        }
    }

    return {
        schoolName: school.name,
        adminUsername: scenario.admin.username,
        counts: {
            subjects: auditState.createdIds.subjectIds.length,
            teachers: auditState.createdIds.teacherIds.length,
            modules: auditState.createdIds.technicalProgramModuleIds.length,
            offeringModules: auditState.createdIds.technicalProgramOfferingModuleIds.length,
            spaces: auditState.createdIds.technicalSpaceIds.length,
            companies: auditState.createdIds.companyIds.length,
            participants: auditState.createdIds.studentIds.length,
            technicalEnrollments: auditState.createdIds.technicalEnrollmentIds.length,
            technicalModuleRecords: auditState.createdIds.technicalModuleRecordIds.length
        },
        courseName: technicalProgram.name,
        offeringName: offering.name
    };
}

async function createOrLoadBootstrapRun() {
    try {
        const run = await BootstrapRun.create({
            key: BOOTSTRAP_KEY,
            description: BOOTSTRAP_DESCRIPTION,
            status: 'running',
            startedAt: new Date(),
            createdIds: {},
            resultSummary: {}
        });
        return { run, created: true };
    } catch (error) {
        if (error?.code !== 11000) {
            throw error;
        }

        const run = await BootstrapRun.findOne({ key: BOOTSTRAP_KEY });
        return { run, created: false };
    }
}

async function handleExistingBootstrapRun(existingRun) {
    if (!existingRun) {
        return false;
    }

    if (existingRun.status === 'completed') {
        console.log(`[Bootstrap][${BOOTSTRAP_KEY}] ja concluido anteriormente. Nenhuma acao sera executada.`);
        return true;
    }

    if (existingRun.status === 'failed') {
        console.warn(`[Bootstrap][${BOOTSTRAP_KEY}] possui falha registrada em banco. O bootstrap nao sera reexecutado automaticamente.`);
        return true;
    }

    if (existingRun.status === 'running') {
        const startedAt = existingRun.startedAt ? new Date(existingRun.startedAt).getTime() : Date.now();
        const isStale = Date.now() - startedAt > STALE_RUNNING_THRESHOLD_MS;

        if (isStale) {
            await BootstrapRun.findByIdAndUpdate(existingRun._id, {
                $set: {
                    status: 'failed',
                    failedAt: new Date(),
                    lastError: 'Bootstrap encontrado em estado running sem conclusao. Marcado como failed por seguranca no startup seguinte.'
                }
            });
            console.warn(`[Bootstrap][${BOOTSTRAP_KEY}] execucao antiga encontrada em estado running e foi marcada como failed por seguranca.`);
        } else {
            console.log(`[Bootstrap][${BOOTSTRAP_KEY}] ja esta em execucao por outra instancia. Nenhuma acao sera executada.`);
        }

        return true;
    }

    return false;
}

async function runTechnicalSchoolProductionBootstrap() {
    console.log(`[Bootstrap][${BOOTSTRAP_KEY}] verificando necessidade de bootstrap tecnico de producao...`);

    const bootstrapState = await createOrLoadBootstrapRun();
    if (!bootstrapState?.run) {
        return;
    }

    const { run: bootstrapRun, created } = bootstrapState;
    const shouldSkip = created ? false : await handleExistingBootstrapRun(bootstrapRun);

    if (shouldSkip) {
        return;
    }

    const auditState = createAuditState();

    try {
        const resultSummary = await createScenario(auditState);

        await BootstrapRun.findByIdAndUpdate(bootstrapRun._id, {
            $set: {
                status: 'completed',
                completedAt: new Date(),
                failedAt: null,
                schoolName: auditState.schoolName || resultSummary.schoolName,
                schoolId: auditState.schoolId || null,
                adminUserId: auditState.adminUserId || null,
                createdIds: auditState.createdIds,
                resultSummary,
                lastError: null
            }
        });

        console.log(`[Bootstrap][${BOOTSTRAP_KEY}] concluido com sucesso para a escola '${resultSummary.schoolName}'.`);
    } catch (error) {
        await markBootstrapFailed(bootstrapRun._id, auditState, error);
        console.error(`[Bootstrap][${BOOTSTRAP_KEY}] falhou:`, error.message);
    }
}

module.exports = {
    BOOTSTRAP_KEY,
    runTechnicalSchoolProductionBootstrap
};
