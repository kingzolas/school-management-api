const mongoose = require('mongoose');
const { createHash } = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const { ContractTemplate, Contract } = require('../models/contract.model');
const School = require('../models/school.model');
const TechnicalEnrollment = require('../models/technicalEnrollment.model');
const Student = require('../models/student.model');
const Company = require('../models/company.model');
const TechnicalProgram = require('../models/technicalProgram.model');
const TechnicalProgramOffering = require('../models/technicalProgramOffering.model');
const Tutor = require('../models/tutor.model');

const TEMPLATE_STATUSES = ['Rascunho', 'Publicado', 'Substituido', 'Arquivado'];
const CONTRACT_STATUSES = ['Rascunho', 'ProntoParaAssinatura', 'EmAssinatura', 'Assinado', 'Vigente', 'Concluido', 'Cancelado', 'Rescindido'];
const ALLOWED_ENROLLMENT_STATUSES = ['Pendente', 'Ativa'];
const ALLOWED_COMPANY_STATUSES = ['Ativa'];
const ALLOWED_PROGRAM_STATUSES = ['Ativo'];
const ALLOWED_OFFERING_STATUSES = ['Planejada', 'Ativa'];
const NON_TERMINAL_INITIAL_CONTRACT_STATUSES = ['Rascunho', 'ProntoParaAssinatura', 'EmAssinatura', 'Assinado', 'Vigente'];
const LOCKED_AFTER_SIGNATURE_START_FIELDS = [
    'binding',
    'validity',
    'execution',
    'programSnapshot',
    'parties',
    'signatories',
    'renderedDocument',
    'attachments'
];
const ACTIVE_CONTRACT_STATUSES = ['Vigente'];
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);

const hasValue = (value) => value !== undefined && value !== null && value !== '';

const normalizeString = (value) => {
    if (!hasValue(value)) {
        return null;
    }

    const normalized = String(value).trim();
    return normalized ? normalized : null;
};

const slugify = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

const ensureDate = (value, fieldLabel) => {
    if (!hasValue(value)) {
        throw new Error(`${fieldLabel} é obrigatório.`);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`${fieldLabel} é inválido.`);
    }

    return parsed;
};

const ensureOptionalDate = (value, fieldLabel) => {
    if (!hasValue(value)) {
        return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(`${fieldLabel} é inválido.`);
    }

    return parsed;
};

const calculateAge = (birthDate, referenceDate) => {
    if (!birthDate || !referenceDate) {
        return null;
    }

    const birth = new Date(birthDate);
    const reference = new Date(referenceDate);
    let age = reference.getFullYear() - birth.getFullYear();
    const monthDiff = reference.getMonth() - birth.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && reference.getDate() < birth.getDate())) {
        age -= 1;
    }

    return age;
};

const normalizeAddressSnapshot = (address = {}, options = {}) => ({
    street: normalizeString(address.street),
    neighborhood: normalizeString(address.neighborhood || address.district),
    number: normalizeString(address.number),
    block: normalizeString(address.block),
    lot: normalizeString(address.lot),
    city: normalizeString(address.city),
    state: normalizeString(address.state),
    cep: normalizeString(address.cep || options.forceCep),
    zipCode: normalizeString(address.zipCode || options.forceZipCode)
});

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const stableSerialize = (value, seen = new WeakSet()) => {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerialize(item, seen)).join(',')}]`;
    }

    if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
        if (typeof value.toObject === 'function') {
            return stableSerialize(value.toObject(), seen);
        }

        if (seen.has(value)) {
            return JSON.stringify('[Circular]');
        }

        seen.add(value);
        const serialized = `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], seen)}`).join(',')}}`;
        seen.delete(value);
        return serialized;
    }

    if (value instanceof Date) {
        return JSON.stringify(value.toISOString());
    }

    if (Buffer.isBuffer(value)) {
        return JSON.stringify(value.toString('base64'));
    }

    return JSON.stringify(value);
};

const hashBuffer = (buffer) => createHash('sha256').update(buffer).digest('hex');

const hashValue = (value) => createHash('sha256').update(stableSerialize(value)).digest('hex');

const makeAuditEvent = ({ eventType, actorUserId = null, note = null, metadata = null }) => ({
    eventType,
    occurredAt: new Date(),
    actorUserId,
    note,
    metadata
});

const normalizeClauseArray = (clauses = [], { locked = true, sourceType = null } = {}) => {
    if (!Array.isArray(clauses)) {
        throw new Error('As cláusulas precisam ser enviadas como lista.');
    }

    return clauses.map((clause, index) => {
        const key = normalizeString(clause?.key) || `clause_${index + 1}`;
        const title = normalizeString(clause?.title);
        const body = normalizeString(clause?.body);

        if (!title || !body) {
            throw new Error('Cada cláusula precisa informar título e conteúdo.');
        }

        return {
            key,
            title,
            body,
            order: Number(clause?.order) > 0 ? Number(clause.order) : index + 1,
            ...(sourceType ? { sourceType } : {}),
            locked
        };
    }).sort((left, right) => left.order - right.order);
};

const normalizeParameterDefinitions = (definitions = []) => {
    if (!Array.isArray(definitions)) {
        throw new Error('As definições de parâmetros precisam ser enviadas como lista.');
    }

    return definitions.map((definition, index) => {
        const key = normalizeString(definition?.key) || `parameter_${index + 1}`;
        const label = normalizeString(definition?.label);

        if (!label) {
            throw new Error('Cada parâmetro do template precisa ter rótulo.');
        }

        return {
            key,
            label,
            type: definition?.type || 'text',
            required: Boolean(definition?.required),
            placeholder: normalizeString(definition?.placeholder),
            helpText: normalizeString(definition?.helpText),
            defaultValue: hasOwn(definition || {}, 'defaultValue') ? definition.defaultValue : null,
            options: Array.isArray(definition?.options)
                ? definition.options.map((item) => String(item || '').trim()).filter(Boolean)
                : []
        };
    });
};

const normalizeComplementaryDefinitions = (definitions = []) => {
    if (!Array.isArray(definitions)) {
        throw new Error('As definições de cláusulas complementares precisam ser enviadas como lista.');
    }

    return definitions.map((definition, index) => {
        const key = normalizeString(definition?.key) || `complementary_${index + 1}`;
        const title = normalizeString(definition?.title);

        if (!title) {
            throw new Error('Cada cláusula complementar precisa ter título.');
        }

        return {
            key,
            title,
            instructions: normalizeString(definition?.instructions),
            required: Boolean(definition?.required),
            allowMultiple: Boolean(definition?.allowMultiple),
            defaultBody: normalizeString(definition?.defaultBody)
        };
    });
};

const normalizeAttachmentRules = (rules = []) => {
    if (!Array.isArray(rules)) {
        throw new Error('As regras de anexo precisam ser enviadas como lista.');
    }

    return rules.map((rule, index) => {
        const key = normalizeString(rule?.key) || `attachment_${index + 1}`;
        const title = normalizeString(rule?.title);
        const attachmentType = normalizeString(rule?.attachmentType) || key;

        if (!title) {
            throw new Error('Cada anexo obrigatório precisa informar título.');
        }

        return {
            key,
            title,
            description: normalizeString(rule?.description),
            attachmentType,
            required: Boolean(rule?.required)
        };
    });
};

const normalizeSignatureBlueprint = (blueprint = []) => {
    if (!Array.isArray(blueprint)) {
        throw new Error('A estrutura de assinatura do template precisa ser enviada como lista.');
    }

    return blueprint.map((item) => {
        const role = normalizeString(item?.role);
        const partyRole = normalizeString(item?.partyRole);
        const label = normalizeString(item?.label);
        const signingOrder = Number(item?.signingOrder);

        if (!role || !partyRole || !label || !Number.isInteger(signingOrder) || signingOrder < 1) {
            throw new Error('Cada papel de assinatura precisa informar role, partyRole, label e signingOrder válidos.');
        }

        return {
            role,
            partyRole,
            label,
            required: item?.required !== false,
            signingOrder,
            condition: item?.condition || 'always'
        };
    }).sort((left, right) => left.signingOrder - right.signingOrder || left.label.localeCompare(right.label));
};

const normalizeLegalBasis = (items = []) => {
    if (!Array.isArray(items)) {
        throw new Error('A base jurídica precisa ser enviada como lista.');
    }

    return items.map((item, index) => {
        const key = normalizeString(item?.key) || `legal_basis_${index + 1}`;
        const title = normalizeString(item?.title);

        if (!title) {
            throw new Error('Cada item da base jurídica precisa informar título.');
        }

        return {
            key,
            title,
            reference: normalizeString(item?.reference),
            body: normalizeString(item?.body),
            order: Number(item?.order) > 0 ? Number(item.order) : index + 1
        };
    }).sort((left, right) => left.order - right.order);
};

const normalizeExecutionPayload = (execution = {}) => ({
    theoryLocation: normalizeString(execution?.theoryLocation),
    practiceLocation: normalizeString(execution?.practiceLocation),
    journey: normalizeString(execution?.journey),
    weeklyDistribution: normalizeString(execution?.weeklyDistribution),
    remuneration: normalizeString(execution?.remuneration),
    supervisorName: normalizeString(execution?.supervisorName),
    supervisorRole: normalizeString(execution?.supervisorRole)
});

const normalizeComplementaryClausesPayload = (clauses = []) => normalizeClauseArray(clauses, {
    locked: false,
    sourceType: 'complementary'
});

const decodeAttachmentBuffer = (attachment = {}) => {
    if (Buffer.isBuffer(attachment.fileBuffer)) {
        return attachment.fileBuffer;
    }

    if (hasValue(attachment.contentBase64)) {
        try {
            return Buffer.from(String(attachment.contentBase64), 'base64');
        } catch (error) {
            throw new Error(`O anexo '${attachment.title || attachment.key || 'sem título'}' possui conteúdo inválido.`);
        }
    }

    return null;
};

const ensureObject = (value, fieldLabel) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${fieldLabel} precisa ser um objeto válido.`);
    }

    return value;
};

const formatDisplayValue = (value) => {
    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }

    if (typeof value === 'boolean') {
        return value ? 'Sim' : 'Não';
    }

    if (Array.isArray(value)) {
        return value.join(', ');
    }

    if (value === null || value === undefined) {
        return null;
    }

    return String(value);
};

class ContractService {
    async _ensureSchoolSupportsContracts(schoolId) {
        const school = await School.findById(schoolId).select('name legalName cnpj address educationModel');

        if (!school) {
            throw new Error('Escola não encontrada.');
        }

        if (school.educationModel !== 'technical_apprenticeship') {
            throw new Error('O módulo de contratos está disponível apenas para escolas do eixo técnico/aprendizagem.');
        }

        return school;
    }

    _getActorUserId(actor = null) {
        if (!actor) {
            return null;
        }

        return actor._id || actor.id || null;
    }

    async _buildTemplateKey(name, explicitKey, schoolId) {
        const baseKey = normalizeString(explicitKey) || normalizeString(name);
        const normalizedKey = slugify(baseKey);

        if (!normalizedKey) {
            throw new Error('Não foi possível gerar a chave do template.');
        }

        const existing = await ContractTemplate.findOne({
            school_id: schoolId,
            templateKey: normalizedKey
        }).select('_id');

        if (existing) {
            throw new Error(`Já existe um template com a chave '${normalizedKey}' nesta escola. Para continuar, gere uma nova versão.`);
        }

        return normalizedKey;
    }

    _buildTemplateSummary(template) {
        return {
            id: String(template._id),
            name: template.name,
            templateKey: template.templateKey,
            version: template.version,
            status: template.status,
            publishedAt: template.publishedAt || null,
            updatedAt: template.updatedAt || null,
            createdAt: template.createdAt || null
        };
    }

    async createTemplate(payload, schoolId, actor = null) {
        await this._ensureSchoolSupportsContracts(schoolId);

        const name = normalizeString(payload?.name);
        if (!name) {
            throw new Error('O nome do template é obrigatório.');
        }

        const templateKey = await this._buildTemplateKey(name, payload?.templateKey, schoolId);
        const actorUserId = this._getActorUserId(actor);

        const template = new ContractTemplate({
            name,
            templateKey,
            version: 1,
            status: 'Rascunho',
            description: normalizeString(payload?.description),
            baseClauses: normalizeClauseArray(payload?.baseClauses || [], { locked: true }),
            parameterDefinitions: normalizeParameterDefinitions(payload?.parameterDefinitions || []),
            complementaryClauseDefinitions: normalizeComplementaryDefinitions(payload?.complementaryClauseDefinitions || []),
            requiredAttachmentRules: normalizeAttachmentRules(payload?.requiredAttachmentRules || []),
            signatureBlueprint: normalizeSignatureBlueprint(payload?.signatureBlueprint || []),
            legalBasis: normalizeLegalBasis(payload?.legalBasis || []),
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId,
            history: [makeAuditEvent({ eventType: 'template_created', actorUserId })],
            school_id: schoolId
        });

        await template.save();
        return template;
    }

    async listTemplates(filters = {}, schoolId) {
        const query = { school_id: schoolId };

        if (hasValue(filters.status) && TEMPLATE_STATUSES.includes(filters.status)) {
            query.status = filters.status;
        }

        if (hasValue(filters.templateKey)) {
            query.templateKey = String(filters.templateKey).trim();
        }

        const templates = await ContractTemplate.find(query).sort({ templateKey: 1, version: -1, createdAt: -1 });
        return templates.map((template) => this._buildTemplateSummary(template));
    }

    async getTemplateById(id, schoolId) {
        const template = await ContractTemplate.findOne({ _id: id, school_id: schoolId });

        if (!template) {
            throw new Error('Template de contrato não encontrado ou não pertence a esta escola.');
        }

        return template;
    }

    async updateTemplate(id, payload, schoolId, actor = null) {
        const template = await this.getTemplateById(id, schoolId);

        if (template.status !== 'Rascunho') {
            throw new Error('Apenas templates em rascunho podem ser editados. Para alterar um template publicado, gere uma nova versão.');
        }

        if (hasOwn(payload, 'name')) {
            template.name = normalizeString(payload.name) || template.name;
        }

        if (hasOwn(payload, 'description')) {
            template.description = normalizeString(payload.description);
        }

        if (hasOwn(payload, 'baseClauses')) {
            template.baseClauses = normalizeClauseArray(payload.baseClauses || [], { locked: true });
        }

        if (hasOwn(payload, 'parameterDefinitions')) {
            template.parameterDefinitions = normalizeParameterDefinitions(payload.parameterDefinitions || []);
        }

        if (hasOwn(payload, 'complementaryClauseDefinitions')) {
            template.complementaryClauseDefinitions = normalizeComplementaryDefinitions(payload.complementaryClauseDefinitions || []);
        }

        if (hasOwn(payload, 'requiredAttachmentRules')) {
            template.requiredAttachmentRules = normalizeAttachmentRules(payload.requiredAttachmentRules || []);
        }

        if (hasOwn(payload, 'signatureBlueprint')) {
            template.signatureBlueprint = normalizeSignatureBlueprint(payload.signatureBlueprint || []);
        }

        if (hasOwn(payload, 'legalBasis')) {
            template.legalBasis = normalizeLegalBasis(payload.legalBasis || []);
        }

        template.updatedByUserId = this._getActorUserId(actor);
        template.history.push(makeAuditEvent({
            eventType: 'template_updated',
            actorUserId: this._getActorUserId(actor)
        }));

        await template.save();
        return template;
    }

    async publishTemplate(id, schoolId, actor = null) {
        const template = await this.getTemplateById(id, schoolId);

        if (template.status !== 'Rascunho') {
            throw new Error('Somente templates em rascunho podem ser publicados.');
        }

        if (!Array.isArray(template.baseClauses) || template.baseClauses.length === 0) {
            throw new Error('O template precisa ter cláusulas base antes de ser publicado.');
        }

        if (!Array.isArray(template.signatureBlueprint) || template.signatureBlueprint.length === 0) {
            throw new Error('O template precisa definir a estrutura de assinatura antes de ser publicado.');
        }

        const actorUserId = this._getActorUserId(actor);
        const now = new Date();

        await ContractTemplate.updateMany(
            {
                school_id: schoolId,
                templateKey: template.templateKey,
                status: 'Publicado',
                _id: { $ne: template._id }
            },
            {
                $set: {
                    status: 'Substituido',
                    supersededByTemplateId: template._id,
                    updatedByUserId: actorUserId
                },
                $push: {
                    history: makeAuditEvent({
                        eventType: 'template_superseded',
                        actorUserId,
                        metadata: { supersededByTemplateId: template._id }
                    })
                }
            }
        );

        template.status = 'Publicado';
        template.publishedAt = now;
        template.publishedByUserId = actorUserId;
        template.updatedByUserId = actorUserId;
        template.history.push(makeAuditEvent({
            eventType: 'template_published',
            actorUserId
        }));

        await template.save();
        return template;
    }

    async createTemplateVersion(id, payload, schoolId, actor = null) {
        const currentTemplate = await this.getTemplateById(id, schoolId);

        if (currentTemplate.status === 'Rascunho') {
            throw new Error('Para nova versão, use um template já consolidado. O rascunho atual ainda pode ser editado.');
        }

        const latestVersion = await ContractTemplate.findOne({
            school_id: schoolId,
            templateKey: currentTemplate.templateKey
        }).sort({ version: -1 }).select('version');

        const actorUserId = this._getActorUserId(actor);
        const newVersion = new ContractTemplate({
            name: normalizeString(payload?.name) || currentTemplate.name,
            templateKey: currentTemplate.templateKey,
            version: Number(latestVersion?.version || 0) + 1,
            status: 'Rascunho',
            description: hasOwn(payload || {}, 'description')
                ? normalizeString(payload.description)
                : currentTemplate.description,
            baseClauses: hasOwn(payload || {}, 'baseClauses')
                ? normalizeClauseArray(payload.baseClauses || [], { locked: true })
                : cloneJson(currentTemplate.baseClauses || []),
            parameterDefinitions: hasOwn(payload || {}, 'parameterDefinitions')
                ? normalizeParameterDefinitions(payload.parameterDefinitions || [])
                : cloneJson(currentTemplate.parameterDefinitions || []),
            complementaryClauseDefinitions: hasOwn(payload || {}, 'complementaryClauseDefinitions')
                ? normalizeComplementaryDefinitions(payload.complementaryClauseDefinitions || [])
                : cloneJson(currentTemplate.complementaryClauseDefinitions || []),
            requiredAttachmentRules: hasOwn(payload || {}, 'requiredAttachmentRules')
                ? normalizeAttachmentRules(payload.requiredAttachmentRules || [])
                : cloneJson(currentTemplate.requiredAttachmentRules || []),
            signatureBlueprint: hasOwn(payload || {}, 'signatureBlueprint')
                ? normalizeSignatureBlueprint(payload.signatureBlueprint || [])
                : cloneJson(currentTemplate.signatureBlueprint || []),
            legalBasis: hasOwn(payload || {}, 'legalBasis')
                ? normalizeLegalBasis(payload.legalBasis || [])
                : cloneJson(currentTemplate.legalBasis || []),
            previousVersionTemplateId: currentTemplate._id,
            createdByUserId: actorUserId,
            updatedByUserId: actorUserId,
            history: [makeAuditEvent({
                eventType: 'template_version_created',
                actorUserId,
                metadata: {
                    previousVersionTemplateId: currentTemplate._id,
                    previousVersion: currentTemplate.version
                }
            })],
            school_id: schoolId
        });

        await newVersion.save();
        return newVersion;
    }

    async _getPublishedTemplate(templateId, schoolId) {
        const template = await ContractTemplate.findOne({
            _id: templateId,
            school_id: schoolId
        });

        if (!template) {
            throw new Error('Template de contrato não encontrado ou não pertence a esta escola.');
        }

        if (template.status !== 'Publicado') {
            throw new Error('A geração de contratos exige um template publicado.');
        }

        return template;
    }

    async _loadBindingContext({ technicalEnrollmentId, technicalProgramOfferingId }, schoolId) {
        const enrollment = await TechnicalEnrollment.findOne({
            _id: technicalEnrollmentId,
            school_id: schoolId
        });

        if (!enrollment) {
            throw new Error('Matrícula técnica não encontrada ou não pertence a esta escola.');
        }

        const [student, company, technicalProgram, school] = await Promise.all([
            Student.findOne({ _id: enrollment.studentId, school_id: schoolId }).populate({
                path: 'tutors.tutorId',
                model: 'Tutor',
                select: 'fullName cpf rg email phoneNumber address'
            }),
            Company.findOne({ _id: enrollment.companyId, school_id: schoolId }),
            TechnicalProgram.findOne({ _id: enrollment.technicalProgramId, school_id: schoolId }),
            this._ensureSchoolSupportsContracts(schoolId)
        ]);

        if (!student) {
            throw new Error('Aprendiz não encontrado ou não pertence a esta escola.');
        }

        if (!company) {
            throw new Error('Empresa não encontrada ou não pertence a esta escola.');
        }

        if (!technicalProgram) {
            throw new Error('Programa técnico não encontrado ou não pertence a esta escola.');
        }

        if (student.isActive === false) {
            throw new Error('O aprendiz informado estÃ¡ inativo e nÃ£o pode gerar novos contratos.');
        }

        if (!ALLOWED_ENROLLMENT_STATUSES.includes(enrollment.status)) {
            throw new Error('A matrÃ­cula tÃ©cnica precisa estar pendente ou ativa para gerar contratos.');
        }

        if (!ALLOWED_COMPANY_STATUSES.includes(company.status || 'Ativa')) {
            throw new Error('A empresa vinculada estÃ¡ inativa e nÃ£o pode receber novos contratos.');
        }

        if (!ALLOWED_PROGRAM_STATUSES.includes(technicalProgram.status || 'Ativo')) {
            throw new Error('O programa tÃ©cnico vinculado estÃ¡ inativo e nÃ£o pode gerar novos contratos.');
        }

        const resolvedOfferingId = hasValue(technicalProgramOfferingId)
            ? technicalProgramOfferingId
            : enrollment.currentTechnicalProgramOfferingId;

        let offering = null;
        if (hasValue(resolvedOfferingId)) {
            offering = await TechnicalProgramOffering.findOne({
                _id: resolvedOfferingId,
                school_id: schoolId
            });

            if (!offering) {
                throw new Error('Oferta técnica não encontrada ou não pertence a esta escola.');
            }

            if (String(offering.technicalProgramId) !== String(technicalProgram._id)) {
                throw new Error('A oferta informada não pertence ao mesmo programa da matrícula técnica.');
            }
        }

        if (offering && !ALLOWED_OFFERING_STATUSES.includes(offering.status || 'Planejada')) {
            throw new Error('A oferta tÃ©cnica informada nÃ£o estÃ¡ apta para gerar contratos.');
        }

        return {
            school,
            enrollment,
            student,
            company,
            technicalProgram,
            offering
        };
    }

    async _resolveGuardianSnapshot(student, signatoryInputs = {}) {
        const issueDate = ensureDate(signatoryInputs.issueDate || new Date(), 'A data de emissão do contrato');
        const ageAtIssue = calculateAge(student.birthDate, issueDate);

        if (ageAtIssue >= 18) {
            return null;
        }

        if (hasValue(signatoryInputs.legalGuardianTutorId)) {
            const explicitTutor = await Tutor.findOne({
                _id: signatoryInputs.legalGuardianTutorId,
                school_id: student.school_id
            });
            if (!explicitTutor) {
                throw new Error('O responsável legal informado não foi encontrado.');
            }

            return {
                referenceModel: 'Tutor',
                referenceId: explicitTutor._id,
                identitySnapshot: {
                    fullName: explicitTutor.fullName,
                    jobTitle: null,
                    cpf: explicitTutor.cpf || null,
                    email: explicitTutor.email || null,
                    phone: explicitTutor.phoneNumber || null,
                    relationship: normalizeString(signatoryInputs?.legalGuardianRelationship)
                }
            };
        }

        if (student?.tutors?.length) {
            const firstTutorLink = student.tutors.find((link) => link?.tutorId);
            if (firstTutorLink?.tutorId) {
                return {
                    referenceModel: 'Tutor',
                    referenceId: firstTutorLink.tutorId._id,
                    identitySnapshot: {
                        fullName: firstTutorLink.tutorId.fullName,
                        jobTitle: null,
                        cpf: firstTutorLink.tutorId.cpf || null,
                        email: firstTutorLink.tutorId.email || null,
                        phone: firstTutorLink.tutorId.phoneNumber || null,
                        relationship: normalizeString(firstTutorLink.relationship)
                    }
                };
            }
        }

        const manualGuardian = signatoryInputs?.legalGuardian;
        if (manualGuardian) {
            return {
                referenceModel: null,
                referenceId: null,
                identitySnapshot: {
                    fullName: normalizeString(manualGuardian.fullName),
                    jobTitle: normalizeString(manualGuardian.jobTitle),
                    cpf: normalizeString(manualGuardian.cpf),
                    email: normalizeString(manualGuardian.email),
                    phone: normalizeString(manualGuardian.phone),
                    relationship: normalizeString(manualGuardian.relationship)
                }
            };
        }

        throw new Error('Aprendizes menores de idade precisam de responsável legal vinculado ao contrato.');
    }

    _buildParties(context, payload = {}, issueDate = new Date()) {
        const { school, student, company, technicalProgram, offering } = context;
        const ageAtIssue = calculateAge(student.birthDate, issueDate);
        const companyRepresentative = payload?.signatoryInputs?.companyRepresentative || company.contactPerson || null;
        const trainingProviderRepresentative = payload?.signatoryInputs?.trainingProviderRepresentative || null;

        if (!companyRepresentative) {
            throw new Error('É necessário informar o representante da empresa para gerar o contrato.');
        }

        if (!trainingProviderRepresentative) {
            throw new Error('É necessário informar o representante da entidade formadora para gerar o contrato.');
        }

        return {
            company: {
                referenceId: company._id,
                name: company.name,
                legalName: company.legalName || company.name,
                cnpj: company.cnpj,
                address: normalizeAddressSnapshot(company.address),
                representative: {
                    fullName: normalizeString(companyRepresentative.fullName),
                    jobTitle: normalizeString(companyRepresentative.jobTitle),
                    cpf: normalizeString(companyRepresentative.cpf),
                    rg: normalizeString(companyRepresentative.rg),
                    phone: normalizeString(companyRepresentative.phone),
                    email: normalizeString(companyRepresentative.email)
                }
            },
            apprentice: {
                referenceId: student._id,
                fullName: student.fullName,
                birthDate: student.birthDate,
                ageAtIssue,
                rg: normalizeString(student.rg),
                cpf: normalizeString(student.cpf),
                address: normalizeAddressSnapshot(student.address),
                isMinorAtIssue: ageAtIssue < 18
            },
            trainingProvider: {
                referenceId: school._id,
                name: school.name,
                legalName: school.legalName || school.name,
                cnpj: normalizeString(school.cnpj),
                address: normalizeAddressSnapshot(school.address, { forceZipCode: school?.address?.zipCode }),
                representative: {
                    fullName: normalizeString(trainingProviderRepresentative.fullName),
                    jobTitle: normalizeString(trainingProviderRepresentative.jobTitle),
                    cpf: normalizeString(trainingProviderRepresentative.cpf),
                    rg: normalizeString(trainingProviderRepresentative.rg),
                    phone: normalizeString(trainingProviderRepresentative.phone),
                    email: normalizeString(trainingProviderRepresentative.email)
                }
            },
            programSnapshot: {
                referenceId: technicalProgram._id,
                offeringReferenceId: offering?._id || null,
                name: technicalProgram.name,
                code: normalizeString(technicalProgram.code),
                apprenticeshipProgramName: normalizeString(technicalProgram.apprenticeshipProgramName),
                occupationalArc: normalizeString(technicalProgram.occupationalArc),
                cboCodes: Array.isArray(technicalProgram.cboCodes) ? technicalProgram.cboCodes : [],
                theoreticalWorkloadHours: technicalProgram.theoreticalWorkloadHours ?? null,
                practicalWorkloadHours: technicalProgram.practicalWorkloadHours ?? null,
                totalWorkloadHours: technicalProgram.totalWorkloadHours
            }
        };
    }

    async _buildSignatories(template, parties, context, payload = {}, issueDate = new Date()) {
        const signatoryInputs = payload?.signatoryInputs || {};
        const guardianSnapshot = await this._resolveGuardianSnapshot(context.student, {
            ...signatoryInputs,
            issueDate
        });
        const witnesses = Array.isArray(signatoryInputs?.witnesses)
            ? signatoryInputs.witnesses
            : [];

        let witnessIndex = 0;

        return template.signatureBlueprint.map((blueprint) => {
            if (blueprint.condition === 'minor_only' && !parties.apprentice.isMinorAtIssue) {
                return null;
            }

            if (blueprint.role === 'company_representative') {
                return {
                    partyRole: blueprint.partyRole,
                    signatoryRole: blueprint.role,
                    label: blueprint.label,
                    required: blueprint.required,
                    condition: blueprint.condition,
                    signingOrder: blueprint.signingOrder,
                    status: 'Pendente',
                    referenceModel: 'Company',
                    referenceId: parties.company.referenceId,
                    identitySnapshot: {
                        fullName: parties.company.representative.fullName,
                        jobTitle: parties.company.representative.jobTitle,
                        cpf: parties.company.representative.cpf,
                        email: parties.company.representative.email,
                        phone: parties.company.representative.phone,
                        relationship: null
                    }
                };
            }

            if (blueprint.role === 'apprentice') {
                return {
                    partyRole: blueprint.partyRole,
                    signatoryRole: blueprint.role,
                    label: blueprint.label,
                    required: blueprint.required,
                    condition: blueprint.condition,
                    signingOrder: blueprint.signingOrder,
                    status: 'Pendente',
                    referenceModel: 'Student',
                    referenceId: parties.apprentice.referenceId,
                    identitySnapshot: {
                        fullName: parties.apprentice.fullName,
                        jobTitle: null,
                        cpf: parties.apprentice.cpf,
                        email: normalizeString(context.student.email),
                        phone: normalizeString(context.student.phoneNumber),
                        relationship: null
                    }
                };
            }

            if (blueprint.role === 'training_provider_representative') {
                return {
                    partyRole: blueprint.partyRole,
                    signatoryRole: blueprint.role,
                    label: blueprint.label,
                    required: blueprint.required,
                    condition: blueprint.condition,
                    signingOrder: blueprint.signingOrder,
                    status: 'Pendente',
                    referenceModel: 'School',
                    referenceId: parties.trainingProvider.referenceId,
                    identitySnapshot: {
                        fullName: parties.trainingProvider.representative.fullName,
                        jobTitle: parties.trainingProvider.representative.jobTitle,
                        cpf: parties.trainingProvider.representative.cpf,
                        email: parties.trainingProvider.representative.email,
                        phone: parties.trainingProvider.representative.phone,
                        relationship: null
                    }
                };
            }

            if (blueprint.role === 'legal_guardian') {
                if (!guardianSnapshot) {
                    if (blueprint.required) {
                        throw new Error('O template exige responsável legal para este contrato.');
                    }

                    return null;
                }

                return {
                    partyRole: blueprint.partyRole,
                    signatoryRole: blueprint.role,
                    label: blueprint.label,
                    required: blueprint.required,
                    condition: blueprint.condition,
                    signingOrder: blueprint.signingOrder,
                    status: 'Pendente',
                    referenceModel: guardianSnapshot.referenceModel,
                    referenceId: guardianSnapshot.referenceId,
                    identitySnapshot: guardianSnapshot.identitySnapshot
                };
            }

            if (blueprint.role === 'witness') {
                const witness = witnesses[witnessIndex];
                witnessIndex += 1;

                if (!witness) {
                    if (blueprint.required) {
                        throw new Error('O template exige testemunha, mas nenhuma testemunha foi informada.');
                    }

                    return null;
                }

                return {
                    partyRole: blueprint.partyRole,
                    signatoryRole: blueprint.role,
                    label: blueprint.label,
                    required: blueprint.required,
                    condition: blueprint.condition,
                    signingOrder: blueprint.signingOrder,
                    status: 'Pendente',
                    referenceModel: null,
                    referenceId: null,
                    identitySnapshot: {
                        fullName: normalizeString(witness.fullName),
                        jobTitle: normalizeString(witness.jobTitle),
                        cpf: normalizeString(witness.cpf),
                        email: normalizeString(witness.email),
                        phone: normalizeString(witness.phone),
                        relationship: normalizeString(witness.relationship)
                    }
                };
            }

            return null;
        }).filter(Boolean);
    }

    _buildResolvedParameters(template, execution, parameterValues = {}) {
        const definitionMap = new Map((template.parameterDefinitions || []).map((definition) => [definition.key, definition]));
        const normalizedEntries = [];

        for (const definition of template.parameterDefinitions || []) {
            const value = hasOwn(parameterValues, definition.key)
                ? parameterValues[definition.key]
                : hasOwn(execution, definition.key)
                    ? execution[definition.key]
                    : definition.defaultValue;

            if (definition.required && !hasValue(value) && value !== false) {
                throw new Error(`O parâmetro '${definition.label}' é obrigatório para gerar o contrato.`);
            }

            normalizedEntries.push({
                key: definition.key,
                label: definition.label,
                value: value ?? null,
                displayValue: formatDisplayValue(value),
                sourceType: hasOwn(execution, definition.key) ? 'execution' : 'template'
            });
        }

        Object.entries(parameterValues || {}).forEach(([key, value]) => {
            if (definitionMap.has(key)) {
                return;
            }

            normalizedEntries.push({
                key,
                label: key,
                value,
                displayValue: formatDisplayValue(value),
                sourceType: 'override'
            });
        });

        return normalizedEntries;
    }

    _buildRenderedDocument(template, contractNumber, execution, parameterValues, complementaryClauses = []) {
        const baseClausesRendered = normalizeClauseArray(template.baseClauses || [], {
            locked: true,
            sourceType: 'base'
        });

        const complementaryClausesRendered = normalizeComplementaryClausesPayload(complementaryClauses || []);
        const legalBasisRendered = (template.legalBasis || []).map((item) => ({
            key: item.key,
            title: item.title,
            body: normalizeString(item.body) || normalizeString(item.reference) || '',
            order: item.order,
            sourceType: 'legal_basis',
            locked: true
        }));
        const resolvedParameters = this._buildResolvedParameters(template, execution, parameterValues || {});

        return {
            title: 'Contrato de Aprendizagem Profissional',
            subtitle: contractNumber,
            baseClausesRendered,
            complementaryClausesRendered,
            legalBasisRendered,
            resolvedParameters
        };
    }

    _buildAttachments(template, attachmentsPayload = [], actorUserId = null) {
        if (!Array.isArray(attachmentsPayload)) {
            throw new Error('Os anexos do contrato precisam ser enviados como lista.');
        }

        const attachmentPayloadMap = new Map();
        attachmentsPayload.forEach((attachment) => {
            const key = normalizeString(attachment?.key);
            if (key) {
                attachmentPayloadMap.set(key, attachment);
            }
        });

        const attachments = (template.requiredAttachmentRules || []).map((rule) => {
            const payloadAttachment = attachmentPayloadMap.get(rule.key) || {};
            const fileBuffer = decodeAttachmentBuffer(payloadAttachment);
            const contentType = normalizeString(payloadAttachment.contentType) || 'application/octet-stream';

            return {
                key: rule.key,
                title: rule.title,
                attachmentType: rule.attachmentType,
                description: normalizeString(payloadAttachment.description) || rule.description || null,
                required: rule.required,
                status: fileBuffer ? 'attached' : 'pending',
                fileName: fileBuffer ? (normalizeString(payloadAttachment.fileName) || `${rule.key}.bin`) : null,
                contentType: fileBuffer ? contentType : null,
                sizeBytes: fileBuffer ? fileBuffer.length : null,
                hash: fileBuffer ? hashBuffer(fileBuffer) : null,
                fileData: fileBuffer || undefined,
                uploadedAt: fileBuffer ? new Date() : null,
                uploadedByUserId: fileBuffer ? actorUserId : null
            };
        });

        attachmentsPayload.forEach((attachment, index) => {
            const key = normalizeString(attachment?.key);
            if (!key || attachments.some((item) => item.key === key)) {
                return;
            }

            const fileBuffer = decodeAttachmentBuffer(attachment);
            const contentType = normalizeString(attachment.contentType) || 'application/octet-stream';
            attachments.push({
                key,
                title: normalizeString(attachment.title) || `Anexo ${index + 1}`,
                attachmentType: normalizeString(attachment.attachmentType) || key,
                description: normalizeString(attachment.description),
                required: Boolean(attachment.required),
                status: fileBuffer ? 'attached' : 'pending',
                fileName: fileBuffer ? (normalizeString(attachment.fileName) || `${key}.bin`) : null,
                contentType: fileBuffer ? contentType : null,
                sizeBytes: fileBuffer ? fileBuffer.length : null,
                hash: fileBuffer ? hashBuffer(fileBuffer) : null,
                fileData: fileBuffer || undefined,
                uploadedAt: fileBuffer ? new Date() : null,
                uploadedByUserId: fileBuffer ? actorUserId : null
            });
        });

        attachments.forEach((attachment) => {
            if (attachment.sizeBytes && attachment.sizeBytes > MAX_ATTACHMENT_BYTES) {
                throw new Error(`O anexo '${attachment.title}' excede o limite individual de ${MAX_ATTACHMENT_BYTES} bytes.`);
            }
        });

        const totalAttachmentBytes = attachments.reduce((sum, attachment) => sum + (attachment.sizeBytes || 0), 0);
        if (totalAttachmentBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
            throw new Error(`O total de anexos excede o limite de ${MAX_TOTAL_ATTACHMENT_BYTES} bytes para armazenamento seguro do contrato.`);
        }

        return attachments;
    }

    _buildContractHashPayload(contract) {
        const plainContract = contract?.toObject ? contract.toObject() : cloneJson(contract);

        return {
            contractNumber: plainContract.contractNumber,
            documentType: plainContract.documentType,
            issueDate: plainContract.issueDate,
            generatedFromTemplate: plainContract.generatedFromTemplate,
            validity: plainContract.validity,
            execution: plainContract.execution,
            programSnapshot: plainContract.programSnapshot,
            parties: plainContract.parties,
            signatories: (plainContract.signatories || []).map((signatory) => ({
                partyRole: signatory.partyRole,
                signatoryRole: signatory.signatoryRole,
                label: signatory.label,
                required: signatory.required,
                condition: signatory.condition,
                signingOrder: signatory.signingOrder,
                identitySnapshot: signatory.identitySnapshot
            })),
            renderedDocument: plainContract.renderedDocument,
            attachments: (plainContract.attachments || []).map((attachment) => ({
                key: attachment.key,
                title: attachment.title,
                attachmentType: attachment.attachmentType,
                required: attachment.required,
                fileName: attachment.fileName,
                contentType: attachment.contentType,
                hash: attachment.hash
            }))
        };
    }

    async _buildContractPdf(contract) {
        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const titleSize = 15;
        const sectionSize = 11.5;
        const bodySize = 10.2;
        const smallSize = 8.5;
        const lineHeight = 14;
        const margin = 46;
        const width = 595;
        const height = 842;
        const maxWidth = width - (margin * 2);
        const headerHeight = 102;
        const footerHeight = 40;
        const primaryColor = rgb(0.15, 0.19, 0.23);
        const accentColor = rgb(0.54, 0.42, 0.16);
        const mutedColor = rgb(0.43, 0.38, 0.31);
        const lineColor = rgb(0.82, 0.74, 0.56);
        const pages = [];

        const schoolBrand = await School.findById(contract.school_id)
            .select('name legalName cnpj address logo.contentType +logo.data');

        let logoImage = null;
        const logoBuffer = schoolBrand?.logo?.data;
        if (logoBuffer?.length) {
            const contentType = String(schoolBrand.logo.contentType || '').toLowerCase();

            try {
                if (contentType.includes('png')) {
                    logoImage = await pdfDoc.embedPng(logoBuffer);
                } else if (contentType.includes('jpg') || contentType.includes('jpeg')) {
                    logoImage = await pdfDoc.embedJpg(logoBuffer);
                } else {
                    try {
                        logoImage = await pdfDoc.embedPng(logoBuffer);
                    } catch (pngError) {
                        logoImage = await pdfDoc.embedJpg(logoBuffer);
                    }
                }
            } catch (logoError) {
                logoImage = null;
            }
        }

        let page = null;
        let cursorY = 0;

        const normalizePdfText = (value, fallback = '') => {
            const baseValue = hasValue(value) ? String(value) : fallback;
            if (!baseValue) {
                return fallback;
            }

            const replacements = [
                ['Ã¡', 'á'],
                ['Ã ', 'à'],
                ['Ã¢', 'â'],
                ['Ã£', 'ã'],
                ['Ã¤', 'ä'],
                ['Ã©', 'é'],
                ['Ã¨', 'è'],
                ['Ãª', 'ê'],
                ['Ã­', 'í'],
                ['Ã³', 'ó'],
                ['Ã´', 'ô'],
                ['Ãµ', 'õ'],
                ['Ãº', 'ú'],
                ['Ã§', 'ç'],
                ['Ã‰', 'É'],
                ['Ã‡', 'Ç'],
                ['â€¢', '-'],
                ['â€“', '-'],
                ['â€”', '-'],
                ['â€œ', '"'],
                ['â€', '"'],
                ['â€˜', "'"],
                ['â€™', "'"],
                ['Distribui??o', 'Distribuição'],
                ['distribui??o', 'distribuição'],
                ['Remunera??o', 'Remuneração'],
                ['remunera??o', 'remuneração'],
                ['Obriga??es', 'Obrigações'],
                ['obriga??es', 'obrigações'],
                ['legisla??o', 'legislação'],
                ['aplic?vel', 'aplicável'],
                ['pedag?gico', 'pedagógico'],
                ['Clausula', 'Cláusula'],
                ['Rescisao', 'Rescisão'],
                ['Visao', 'Visão']
            ];

            let normalized = String(baseValue);
            replacements.forEach(([broken, fixed]) => {
                normalized = normalized.split(broken).join(fixed);
            });

            return normalized.replace(/\s+/g, ' ').trim();
        };

        const formatDate = (value, fallback = 'Não informado') => {
            if (!value) {
                return fallback;
            }

            const date = new Date(value);
            if (Number.isNaN(date.getTime())) {
                return fallback;
            }

            return date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        };

        const joinParts = (parts = [], fallback = 'Não informado') => {
            const filtered = parts
                .map((item) => normalizePdfText(item))
                .filter(Boolean);

            return filtered.length ? filtered.join(' - ') : fallback;
        };

        const textWidth = (text, currentFont, size) => currentFont.widthOfTextAtSize(String(text || ''), size);

        const wrapText = (text, currentFont = font, size = bodySize, widthLimit = maxWidth) => {
            const words = normalizePdfText(text).split(/\s+/).filter(Boolean);
            const lines = [];
            let currentLine = '';

            words.forEach((word) => {
                const candidate = currentLine ? `${currentLine} ${word}` : word;
                const candidateWidth = textWidth(candidate, currentFont, size);

                if (candidateWidth <= widthLimit) {
                    currentLine = candidate;
                    return;
                }

                if (currentLine) {
                    lines.push(currentLine);
                }

                currentLine = word;
            });

            if (currentLine) {
                lines.push(currentLine);
            }

            return lines.length ? lines : [''];
        };

        const drawPageChrome = (targetPage) => {
            targetPage.drawRectangle({
                x: 0,
                y: height - 16,
                width,
                height: 16,
                color: accentColor,
                opacity: 0.16
            });

            targetPage.drawRectangle({
                x: 0,
                y: 0,
                width,
                height: 12,
                color: accentColor,
                opacity: 0.10
            });

            if (logoImage) {
                const logoWidth = 76;
                const logoHeight = 76;
                targetPage.drawImage(logoImage, {
                    x: margin,
                    y: height - margin - 28,
                    width: logoWidth,
                    height: logoHeight,
                    opacity: 0.98
                });

                targetPage.drawImage(logoImage, {
                    x: (width / 2) - 120,
                    y: (height / 2) - 120,
                    width: 240,
                    height: 240,
                    opacity: 0.05
                });
            }

            const headerTitle = normalizePdfText(
                schoolBrand?.legalName || schoolBrand?.name || 'Academy Hub'
            );
            const headerMeta = joinParts([
                schoolBrand?.cnpj ? `CNPJ ${schoolBrand.cnpj}` : null,
                schoolBrand?.address?.city,
                schoolBrand?.address?.state,
                'Programa Técnico / Jovem Aprendiz'
            ], 'Programa Técnico / Jovem Aprendiz');

            targetPage.drawText(headerTitle, {
                x: margin + (logoImage ? 92 : 0),
                y: height - margin + 12,
                size: 17,
                font: boldFont,
                color: primaryColor
            });

            targetPage.drawText(normalizePdfText(headerMeta), {
                x: margin + (logoImage ? 92 : 0),
                y: height - margin - 4,
                size: 8.5,
                font,
                color: mutedColor
            });

            targetPage.drawLine({
                start: { x: margin, y: height - margin - 18 },
                end: { x: width - margin, y: height - margin - 18 },
                thickness: 1,
                color: lineColor
            });
        };

        const addPage = () => {
            page = pdfDoc.addPage([width, height]);
            pages.push(page);
            drawPageChrome(page);
            cursorY = height - margin - headerHeight;
        };

        const ensureSpace = (linesNeeded = 1, requiredBottom = margin) => {
            if (cursorY - (linesNeeded * lineHeight) >= (requiredBottom + footerHeight)) {
                return;
            }

            addPage();
        };

        const writeParagraph = (text, {
            currentFont = font,
            size = bodySize,
            indent = 0,
            spaceAfter = 4,
            center = false,
            uppercase = false
        } = {}) => {
            const normalizedText = normalizePdfText(text);
            const paragraphs = normalizedText
                ? normalizedText.split(/\n+/).map((item) => item.trim()).filter(Boolean)
                : [''];

            paragraphs.forEach((paragraph, paragraphIndex) => {
                const lineWidth = maxWidth - indent;
                const lines = wrapText(
                    uppercase ? paragraph.toUpperCase() : paragraph,
                    currentFont,
                    size,
                    lineWidth
                );

                ensureSpace(lines.length + 1);

                lines.forEach((line) => {
                    const x = center
                        ? Math.max(margin, (width - textWidth(line, currentFont, size)) / 2)
                        : margin + indent;

                    page.drawText(line, {
                        x,
                        y: cursorY,
                        size,
                        font: currentFont,
                        color: currentFont === boldFont ? primaryColor : rgb(0.18, 0.22, 0.26)
                    });
                    cursorY -= lineHeight;
                });

                if (paragraphIndex < paragraphs.length - 1 || spaceAfter > 0) {
                    cursorY -= spaceAfter;
                }
            });
        };

        const writeRule = () => {
            ensureSpace(1);
            page.drawLine({
                start: { x: margin, y: cursorY },
                end: { x: width - margin, y: cursorY },
                thickness: 0.8,
                color: lineColor
            });
            cursorY -= 12;
        };

        const writeSectionTitle = (title) => {
            writeParagraph(title, {
                currentFont: boldFont,
                size: sectionSize,
                spaceAfter: 6
            });
        };

        const writeLabeledLine = (label, value, {
            indent = 0,
            fallback = 'Não informado'
        } = {}) => {
            writeParagraph(`${label}: ${normalizePdfText(value, fallback)}`, {
                indent,
                size: bodySize,
                spaceAfter: 2
            });
        };

        const writePartyBlock = (heading, name, lines = []) => {
            writeParagraph(heading, {
                currentFont: boldFont,
                size: smallSize,
                uppercase: true,
                spaceAfter: 2
            });
            writeParagraph(name, {
                currentFont: boldFont,
                size: bodySize,
                spaceAfter: 3
            });
            lines.forEach((line) => {
                writeParagraph(line, { size: bodySize, spaceAfter: 2 });
            });
            cursorY -= 8;
        };

        const documentTypeTitle = contract.documentType === 'rescission'
            ? 'TERMO DE RESCISÃO DO CONTRATO DE APRENDIZAGEM PROFISSIONAL'
            : contract.documentType === 'amendment'
                ? 'TERMO ADITIVO AO CONTRATO DE APRENDIZAGEM PROFISSIONAL'
                : 'CONTRATO DE APRENDIZAGEM PROFISSIONAL';

        const introduction = contract.documentType === 'rescission'
            ? 'Pelo presente termo de rescisão, as partes abaixo identificadas formalizam o encerramento do instrumento contratual vinculado ao programa de aprendizagem profissional, observando as cláusulas e os anexos que compõem este documento.'
            : contract.documentType === 'amendment'
                ? 'Pelo presente termo aditivo, as partes abaixo identificadas registram as alterações contratuais vinculadas ao programa de aprendizagem profissional, preservando o histórico do instrumento originário.'
                : 'Pelo presente instrumento particular, as partes abaixo identificadas celebram este contrato no âmbito do programa de aprendizagem profissional, observando a vigência, as cláusulas e os anexos formalmente vinculados a este documento.';

        const company = contract.parties?.company || {};
        const apprentice = contract.parties?.apprentice || {};
        const provider = contract.parties?.trainingProvider || {};
        const program = contract.programSnapshot || {};
        const execution = contract.execution || {};
        const attachments = Array.isArray(contract.attachments) ? contract.attachments : [];
        const signatories = Array.isArray(contract.signatories)
            ? [...contract.signatories].sort((left, right) => left.signingOrder - right.signingOrder)
            : [];

        const rescissionReason = (contract.renderedDocument?.complementaryClausesRendered || [])
            .find((item) => item.key === 'rescission_reason');

        addPage();

        writeParagraph(documentTypeTitle, {
            currentFont: boldFont,
            size: titleSize,
            center: true,
            uppercase: true,
            spaceAfter: 4
        });
        writeParagraph(`${contract.contractNumber} - emissão em ${formatDate(contract.issueDate || contract.createdAt)}`, {
            size: smallSize,
            center: true,
            spaceAfter: 10
        });
        writeRule();
        writeParagraph(introduction, { size: bodySize, spaceAfter: 12 });

        writeSectionTitle('I. Qualificação das partes');
        writePartyBlock('Empresa contratante', normalizePdfText(company.legalName || company.name, 'Não informado'), [
            normalizePdfText(company.cnpj, 'CNPJ não informado'),
            joinParts([
                company.address?.street,
                company.address?.number ? `Nº ${company.address.number}` : null,
                company.address?.neighborhood,
                company.address?.city,
                company.address?.state,
                company.address?.zipCode || company.address?.cep ? `CEP ${company.address?.zipCode || company.address?.cep}` : null
            ]),
            joinParts([
                company.representative?.fullName ? `Representante: ${company.representative.fullName}` : null,
                company.representative?.jobTitle
            ], 'Representante não informado')
        ]);
        writePartyBlock('Aprendiz', normalizePdfText(apprentice.fullName, 'Não informado'), [
            normalizePdfText(apprentice.cpf, 'CPF não informado'),
            joinParts([
                apprentice.rg ? `RG ${apprentice.rg}` : null,
                apprentice.birthDate ? `Nascimento ${formatDate(apprentice.birthDate)}` : null,
                hasValue(apprentice.ageAtIssue) ? `Idade na emissão ${apprentice.ageAtIssue} anos` : null
            ]),
            joinParts([
                apprentice.address?.street,
                apprentice.address?.number ? `Nº ${apprentice.address.number}` : null,
                apprentice.address?.neighborhood,
                apprentice.address?.city,
                apprentice.address?.state,
                apprentice.address?.zipCode || apprentice.address?.cep ? `CEP ${apprentice.address?.zipCode || apprentice.address?.cep}` : null
            ])
        ]);
        writePartyBlock('Entidade formadora', normalizePdfText(provider.legalName || provider.name, 'Não informado'), [
            normalizePdfText(provider.cnpj, 'CNPJ não informado'),
            joinParts([
                provider.address?.street,
                provider.address?.number ? `Nº ${provider.address.number}` : null,
                provider.address?.neighborhood,
                provider.address?.city,
                provider.address?.state,
                provider.address?.zipCode || provider.address?.cep ? `CEP ${provider.address?.zipCode || provider.address?.cep}` : null
            ]),
            joinParts([
                provider.representative?.fullName ? `Representante: ${provider.representative.fullName}` : null,
                provider.representative?.jobTitle,
                provider.representative?.cpf ? `CPF ${provider.representative.cpf}` : null
            ], 'Representante não informado')
        ]);

        writeSectionTitle('II. Programa de aprendizagem');
        writeLabeledLine('Curso / programa', program.name);
        writeLabeledLine('Código do curso', program.code);
        writeLabeledLine('Programa de aprendizagem', program.learningProgram || program.name);
        writeLabeledLine('Arco ocupacional', program.occupationalArc);
        writeLabeledLine(
            'CBOs possíveis',
            Array.isArray(program.cboCodes) && program.cboCodes.length ? program.cboCodes.join(', ') : null
        );
        writeLabeledLine('Carga horária teórica', hasValue(program.theoreticalHours) ? `${program.theoreticalHours}h` : null);
        writeLabeledLine('Carga horária prática', hasValue(program.practicalHours) ? `${program.practicalHours}h` : null);
        writeLabeledLine('Carga horária total', hasValue(program.totalHours) ? `${program.totalHours}h` : null);
        cursorY -= 6;

        writeSectionTitle('III. Execução contratual');
        writeLabeledLine(
            'Vigência',
            contract.validity?.startDate && contract.validity?.endDate
                ? `${formatDate(contract.validity.startDate)} até ${formatDate(contract.validity.endDate)}`
                : null
        );
        writeLabeledLine('Local da teoria', execution.theoryLocation);
        writeLabeledLine('Local da prática', execution.practiceLocation);
        writeLabeledLine('Jornada', execution.journey);
        writeLabeledLine('Distribuição semanal', execution.weeklyDistribution);
        writeLabeledLine('Remuneração', execution.remuneration);
        writeLabeledLine('Supervisor / responsável', execution.supervisor);
        if (rescissionReason?.body) {
            writeLabeledLine('Motivo da rescisão', rescissionReason.body);
        }
        cursorY -= 6;

        writeSectionTitle('IV. Cláusulas contratuais');
        const clauses = [
            ...(contract.renderedDocument?.baseClausesRendered || []),
            ...(contract.renderedDocument?.complementaryClausesRendered || [])
        ];

        clauses.forEach((item, index) => {
            const title = normalizePdfText(item.title || item.label || item.key || `Cláusula ${index + 1}`, `Cláusula ${index + 1}`);
            const body = normalizePdfText(item.body || item.text || '', 'Conteúdo não informado para esta cláusula.');

            writeParagraph(`CLÁUSULA ${String(index + 1).padStart(2, '0')} - ${title}`, {
                currentFont: boldFont,
                size: bodySize,
                uppercase: true,
                spaceAfter: 2
            });
            writeParagraph(body, { size: bodySize, spaceAfter: 8 });
        });

        if (Array.isArray(contract.renderedDocument?.legalBasisRendered) && contract.renderedDocument.legalBasisRendered.length) {
            writeParagraph('Base jurídica de referência', {
                currentFont: boldFont,
                size: bodySize,
                spaceAfter: 4
            });
            contract.renderedDocument.legalBasisRendered
                .sort((left, right) => left.order - right.order)
                .forEach((item) => {
                    writeParagraph(`${item.order}. ${normalizePdfText(item.title, 'Base jurídica')}`, {
                        currentFont: boldFont,
                        size: bodySize,
                        spaceAfter: 2
                    });
                    writeParagraph(normalizePdfText(item.body, 'Referência não informada.'), {
                        size: bodySize,
                        spaceAfter: 6
                    });
                });
        }

        writeSectionTitle('V. Assinaturas');
        writeParagraph('As partes e demais signatários abaixo identificados participam do fluxo de aceite eletrônico vinculado a este instrumento:', {
            size: bodySize,
            spaceAfter: 8
        });
        signatories.forEach((signatory) => {
            const identity = signatory.identitySnapshot || {};
            const acceptedLabel = signatory.signature?.acceptedAt
                ? ` - aceite em ${formatDate(signatory.signature.acceptedAt)}`
                : ' - assinatura pendente';

            writeParagraph(
                `${signatory.signingOrder}. ${normalizePdfText(signatory.label, 'Signatário')} - ${normalizePdfText(identity.fullName, 'Não informado')}${acceptedLabel}`,
                { size: bodySize, spaceAfter: 2 }
            );
        });

        cursorY -= 4;
        signatories.forEach((signatory) => {
            ensureSpace(5);
            writeParagraph('______________________________________________', {
                size: bodySize,
                spaceAfter: 1
            });
            writeParagraph(normalizePdfText(signatory.identitySnapshot?.fullName, 'Assinatura prevista'), {
                currentFont: boldFont,
                size: bodySize,
                spaceAfter: 1
            });
            writeParagraph(joinParts([
                signatory.label,
                signatory.identitySnapshot?.jobTitle,
                signatory.identitySnapshot?.relationship
            ], 'Assinatura prevista'), {
                size: smallSize,
                spaceAfter: 8
            });
        });

        if (attachments.length) {
            writeSectionTitle('VI. Anexos vinculados');
            attachments.forEach((attachment) => {
                writeParagraph(
                    `- ${normalizePdfText(attachment.title, 'Anexo')}${attachment.fileName ? ` (${normalizePdfText(attachment.fileName)})` : ''}`,
                    { size: bodySize, spaceAfter: 2 }
                );
                if (attachment.hash) {
                    writeParagraph(`Hash de integridade: ${attachment.hash}`, {
                        size: smallSize,
                        spaceAfter: 4
                    });
                }
            });
        }

        writeRule();
        writeParagraph(
            'Documento emitido pelo Academy Hub com trilha de auditoria, hash de integridade e vínculo ao histórico contratual da instituição.',
            {
                size: smallSize,
                center: true,
                spaceAfter: 0
            }
        );

        const totalPages = pages.length;
        pages.forEach((currentPage, index) => {
            const footerY = margin - 6;
            currentPage.drawLine({
                start: { x: margin, y: footerY + 14 },
                end: { x: width - margin, y: footerY + 14 },
                thickness: 0.8,
                color: lineColor
            });

            currentPage.drawText(normalizePdfText(
                `${schoolBrand?.legalName || schoolBrand?.name || 'Academy Hub'} • ${contract.contractNumber}`
            ), {
                x: margin,
                y: footerY,
                size: smallSize,
                font,
                color: mutedColor
            });

            currentPage.drawText(`Página ${index + 1} de ${totalPages}`, {
                x: width - margin - textWidth(`Página ${index + 1} de ${totalPages}`, font, smallSize),
                y: footerY,
                size: smallSize,
                font: boldFont,
                color: mutedColor
            });
        });

        return Buffer.from(await pdfDoc.save());
    }
    async _generateContractNumber(schoolId, issueDate = new Date()) {
        const year = new Date(issueDate).getFullYear();
        const prefix = `CTR-${year}-`;
        const countersCollection = mongoose.connection.collection('contract_counters');
        const counterId = `contract_number:${String(schoolId)}:${year}`;

        const latestContract = await Contract.findOne({
            school_id: schoolId,
            contractNumber: new RegExp(`^${prefix}`)
        })
            .sort({ contractNumber: -1 })
            .select('contractNumber');

        const latestSequence = latestContract?.contractNumber
            ? Number(String(latestContract.contractNumber).slice(prefix.length))
            : 0;

        const existingCounter = await countersCollection.findOne(
            { _id: counterId },
            { projection: { _id: 1, seq: 1 } }
        );

        if (!existingCounter) {
            try {
                await countersCollection.insertOne({
                    _id: counterId,
                    schoolId: String(schoolId),
                    year,
                    type: 'contract_number',
                    seq: Number.isInteger(latestSequence) && latestSequence > 0 ? latestSequence : 0,
                    createdAt: new Date(),
                    updatedAt: new Date()
                });
            } catch (error) {
                if (error?.code !== 11000) {
                    throw error;
                }
            }
        }

        const counterResult = await countersCollection.findOneAndUpdate(
            { _id: counterId },
            {
                $inc: { seq: 1 },
                $set: { updatedAt: new Date() }
            },
            {
                returnDocument: 'after'
            }
        );

        const counterDocument = counterResult?.value || counterResult;
        const nextSequence = Number(counterDocument?.seq);

        if (!Number.isInteger(nextSequence) || nextSequence < 1) {
            throw new Error('NÃ£o foi possÃ­vel alocar uma sequÃªncia vÃ¡lida para o nÃºmero do contrato.');
        }

        return `${prefix}${String(nextSequence).padStart(6, '0')}`;
    }

    async _ensureNoConflictingInitialContract(technicalEnrollmentId, schoolId) {
        const existingContract = await Contract.findOne({
            school_id: schoolId,
            documentType: 'initial',
            'binding.technicalEnrollmentId': technicalEnrollmentId,
            status: { $in: NON_TERMINAL_INITIAL_CONTRACT_STATUSES }
        }).select('_id contractNumber status');

        if (existingContract) {
            throw new Error(`JÃ¡ existe um contrato inicial nÃ£o encerrado (${existingContract.contractNumber}) para esta matrÃ­cula tÃ©cnica.`);
        }
    }

    async _buildDraftContractPayload(payload, schoolId, actor = null, options = {}) {
        const templateId = options.templateId || payload.templateId;
        const template = options.template || await this._getPublishedTemplate(templateId, schoolId);
        const issueDate = ensureOptionalDate(payload?.issueDate, 'A data de emissão do contrato') || new Date();
        const context = await this._loadBindingContext({
            technicalEnrollmentId: payload.technicalEnrollmentId,
            technicalProgramOfferingId: payload.technicalProgramOfferingId
        }, schoolId);

        const validity = ensureObject(payload?.validity, 'A vigência do contrato');
        const startDate = ensureDate(validity.startDate, 'A data inicial da vigência');
        const endDate = ensureDate(validity.endDate, 'A data final da vigência');

        if (endDate < startDate) {
            throw new Error('A data final da vigência não pode ser anterior à data inicial.');
        }

        const execution = normalizeExecutionPayload(payload?.execution || {});
        const partiesBundle = this._buildParties(context, payload, issueDate);
        const signatories = await this._buildSignatories(template, {
            company: partiesBundle.company,
            apprentice: partiesBundle.apprentice,
            trainingProvider: partiesBundle.trainingProvider
        }, context, payload, issueDate);
        const contractNumber = options.contractNumber || await this._generateContractNumber(schoolId, issueDate);
        const parameterValues = payload?.parameterValues && typeof payload.parameterValues === 'object' && !Array.isArray(payload.parameterValues)
            ? payload.parameterValues
            : {};
        const renderedDocument = this._buildRenderedDocument(
            template,
            contractNumber,
            execution,
            parameterValues,
            payload?.complementaryClauses || []
        );
        const actorUserId = this._getActorUserId(actor);
        const attachments = this._buildAttachments(template, payload?.attachments || [], actorUserId);
        const documentType = options.documentType || payload?.documentType || 'initial';
        const status = options.status || 'Rascunho';

        return {
            documentType,
            contractNumber,
            status,
            binding: {
                technicalEnrollmentId: context.enrollment._id,
                studentId: context.student._id,
                companyId: context.company._id,
                technicalProgramId: context.technicalProgram._id,
                technicalProgramOfferingId: context.offering?._id || null
            },
            generatedFromTemplate: {
                templateId: template._id,
                templateKey: template.templateKey,
                templateName: template.name,
                templateVersion: template.version
            },
            validity: {
                startDate,
                endDate
            },
            execution,
            programSnapshot: partiesBundle.programSnapshot,
            parties: {
                company: partiesBundle.company,
                apprentice: partiesBundle.apprentice,
                trainingProvider: partiesBundle.trainingProvider
            },
            signatories,
            renderedDocument,
            attachments,
            documentArtifact: {
                status: 'draft',
                frozenAt: null,
                documentHash: null,
                hashAlgorithm: 'sha256',
                hashBasisVersion: 1,
                fileName: null,
                contentType: null,
                sizeBytes: null,
                pdfData: undefined,
                lockedFields: LOCKED_AFTER_SIGNATURE_START_FIELDS
            },
            signatureFlow: {
                mode: 'internal_electronic_acceptance',
                startedAt: null,
                lockedAt: null,
                completedAt: null
            },
            lifecycleLinks: {
                rootContractId: options.rootContractId || null,
                parentContractId: options.parentContractId || null
            },
            issueDate,
            createdByUserId: options.createdByUserId || actorUserId,
            updatedByUserId: actorUserId,
            lastStatusChangedAt: new Date(),
            auditTrail: [
                makeAuditEvent({
                    eventType: options.auditEventType || 'contract_draft_created',
                    actorUserId,
                    metadata: {
                        templateId: template._id,
                        templateVersion: template.version
                    }
                })
            ],
            school_id: schoolId
        };
    }

    async createContract(payload, schoolId, actor = null) {
        await this._ensureSchoolSupportsContracts(schoolId);
        const actorUserId = this._getActorUserId(actor);
        const requestedDocumentType = payload?.documentType || 'initial';

        if (requestedDocumentType === 'initial' && payload?.technicalEnrollmentId) {
            await this._ensureNoConflictingInitialContract(payload.technicalEnrollmentId, schoolId);
        }

        for (let attempt = 0; attempt < 5; attempt += 1) {
            try {
                const draftPayload = await this._buildDraftContractPayload(payload, schoolId, actor);
                if (draftPayload.documentType === 'initial') {
                    await this._ensureNoConflictingInitialContract(draftPayload.binding.technicalEnrollmentId, schoolId);
                }
                const contract = new Contract({
                    ...draftPayload,
                    createdByUserId: actorUserId,
                    updatedByUserId: actorUserId
                });

                await contract.save();
                return contract;
            } catch (error) {
                if (error?.code === 11000 && attempt < 4) {
                    continue;
                }

                throw error;
            }
        }

        throw new Error('Não foi possível gerar um número único para o contrato.');
    }

    _buildContractSummary(contract) {
        const requiredSignatories = (contract.signatories || []).filter((signatory) => signatory.required);
        const completedSignatories = requiredSignatories.filter((signatory) => signatory.status === 'Aceita');

        return {
            id: String(contract._id),
            contractNumber: contract.contractNumber,
            documentType: contract.documentType,
            status: contract.status,
            company: {
                id: String(contract.binding.companyId),
                name: contract.parties.company.name,
                legalName: contract.parties.company.legalName,
                cnpj: contract.parties.company.cnpj
            },
            apprentice: {
                id: String(contract.binding.studentId),
                fullName: contract.parties.apprentice.fullName,
                cpf: contract.parties.apprentice.cpf,
                isMinorAtIssue: contract.parties.apprentice.isMinorAtIssue
            },
            program: {
                id: String(contract.binding.technicalProgramId),
                name: contract.programSnapshot.name,
                code: contract.programSnapshot.code
            },
            validity: contract.validity,
            signatureSummary: {
                required: requiredSignatories.length,
                completed: completedSignatories.length,
                pending: requiredSignatories.length - completedSignatories.length
            },
            document: {
                isFrozen: contract.documentArtifact?.status === 'frozen',
                documentHash: contract.documentArtifact?.documentHash || null,
                hasPdf: Boolean(contract.documentArtifact?.fileName)
            },
            createdAt: contract.createdAt,
            updatedAt: contract.updatedAt
        };
    }

    _buildContractDetail(contract) {
        const detail = contract.toObject();
        const requiredSignatories = (detail.signatories || []).filter((signatory) => signatory.required);
        const completedSignatories = requiredSignatories.filter((signatory) => signatory.status === 'Aceita');

        return {
            ...detail,
            signatureSummary: {
                required: requiredSignatories.length,
                completed: completedSignatories.length,
                pending: requiredSignatories.length - completedSignatories.length
            },
            documentDownloadPath: detail.documentArtifact?.fileName
                ? `/api/contracts/${detail._id}/document`
                : null
        };
    }

    _buildContractListQuery(filters = {}, schoolId) {
        const query = { school_id: schoolId };

        if (hasValue(filters.companyId)) {
            query['binding.companyId'] = filters.companyId;
        }

        if (hasValue(filters.studentId)) {
            query['binding.studentId'] = filters.studentId;
        }

        if (hasValue(filters.technicalProgramId)) {
            query['binding.technicalProgramId'] = filters.technicalProgramId;
        }

        if (hasValue(filters.technicalEnrollmentId)) {
            query['binding.technicalEnrollmentId'] = filters.technicalEnrollmentId;
        }

        if (hasValue(filters.documentType)) {
            query.documentType = filters.documentType;
        }

        if (hasValue(filters.status) && CONTRACT_STATUSES.includes(filters.status)) {
            query.status = filters.status;
        }

        if (String(filters.active).toLowerCase() === 'true') {
            query.status = { $in: ACTIVE_CONTRACT_STATUSES };
            query['validity.startDate'] = { $lte: new Date() };
            query['validity.endDate'] = { $gte: new Date(new Date().toISOString().slice(0, 10)) };
        }

        return query;
    }

    async listContracts(filters = {}, schoolId) {
        const query = this._buildContractListQuery(filters, schoolId);
        const contracts = await Contract.find(query)
            .sort({ issueDate: -1, createdAt: -1 });

        return contracts.map((contract) => this._buildContractSummary(contract));
    }

    async listContractsByCompany(companyId, filters = {}, schoolId) {
        return this.listContracts({
            ...filters,
            companyId
        }, schoolId);
    }

    async getContractById(id, schoolId) {
        const contract = await Contract.findOne({
            _id: id,
            school_id: schoolId
        });

        if (!contract) {
            throw new Error('Contrato não encontrado ou não pertence a esta escola.');
        }

        return this._buildContractDetail(contract);
    }

    async _getContractDocumentById(id, schoolId) {
        const contract = await Contract.findOne({
            _id: id,
            school_id: schoolId
        }).select('+documentArtifact.pdfData +attachments.fileData');

        if (!contract) {
            throw new Error('Contrato não encontrado ou não pertence a esta escola.');
        }

        return contract;
    }

    _extractDraftPayloadFromContract(contract) {
        const companyRepresentative = contract.parties?.company?.representative
            ? cloneJson(contract.parties.company.representative)
            : null;
        const trainingProviderRepresentative = contract.parties?.trainingProvider?.representative
            ? cloneJson(contract.parties.trainingProvider.representative)
            : null;
        const legalGuardianSignatory = (contract.signatories || []).find((signatory) => signatory.signatoryRole === 'legal_guardian');
        const witnessSignatories = (contract.signatories || []).filter((signatory) => signatory.signatoryRole === 'witness');

        return {
            templateId: contract.generatedFromTemplate?.templateId || null,
            technicalEnrollmentId: contract.binding.technicalEnrollmentId,
            technicalProgramOfferingId: contract.binding.technicalProgramOfferingId,
            issueDate: contract.issueDate,
            validity: cloneJson(contract.validity),
            execution: cloneJson(contract.execution || {}),
            parameterValues: Object.fromEntries((contract.renderedDocument?.resolvedParameters || []).map((parameter) => [parameter.key, parameter.value])),
            complementaryClauses: (contract.renderedDocument?.complementaryClausesRendered || []).map((clause) => ({
                key: clause.key,
                title: clause.title,
                body: clause.body,
                order: clause.order
            })),
            signatoryInputs: {
                companyRepresentative,
                trainingProviderRepresentative,
                legalGuardian: legalGuardianSignatory ? cloneJson(legalGuardianSignatory.identitySnapshot) : null,
                witnesses: witnessSignatories.map((signatory) => cloneJson(signatory.identitySnapshot))
            },
            attachments: (contract.attachments || []).map((attachment) => ({
                key: attachment.key,
                title: attachment.title,
                attachmentType: attachment.attachmentType,
                description: attachment.description,
                required: attachment.required,
                fileName: attachment.fileName,
                contentType: attachment.contentType,
                fileBuffer: attachment.fileData || null
            }))
        };
    }

    _mergeAttachmentPayloads(currentAttachments = [], nextAttachments = []) {
        if (!Array.isArray(nextAttachments)) {
            throw new Error('Os anexos precisam ser enviados como lista.');
        }

        const currentMap = new Map(currentAttachments.map((attachment) => [attachment.key, attachment]));
        const mergedMap = new Map(currentMap);

        nextAttachments.forEach((attachment) => {
            const key = normalizeString(attachment?.key);
            if (!key) {
                return;
            }

            const currentAttachment = currentMap.get(key) || {};
            mergedMap.set(key, {
                ...currentAttachment,
                ...attachment,
                key,
                fileBuffer: Buffer.isBuffer(attachment.fileBuffer)
                    ? attachment.fileBuffer
                    : hasValue(attachment.contentBase64)
                        ? Buffer.from(String(attachment.contentBase64), 'base64')
                        : currentAttachment.fileBuffer || null
            });
        });

        return Array.from(mergedMap.values());
    }

    async updateContract(id, payload, schoolId, actor = null) {
        const contract = await this._getContractDocumentById(id, schoolId);

        if (contract.status !== 'Rascunho') {
            throw new Error('Somente contratos em rascunho podem ser editados.');
        }

        const basePayload = this._extractDraftPayloadFromContract(contract);
        const mergedPayload = {
            ...basePayload,
            ...payload,
            technicalEnrollmentId: hasOwn(payload || {}, 'technicalEnrollmentId')
                ? payload.technicalEnrollmentId
                : basePayload.technicalEnrollmentId,
            technicalProgramOfferingId: hasOwn(payload || {}, 'technicalProgramOfferingId')
                ? payload.technicalProgramOfferingId
                : basePayload.technicalProgramOfferingId,
            validity: {
                ...basePayload.validity,
                ...(payload.validity || {})
            },
            execution: {
                ...basePayload.execution,
                ...(payload.execution || {})
            },
            parameterValues: {
                ...basePayload.parameterValues,
                ...(payload.parameterValues || {})
            },
            signatoryInputs: {
                ...basePayload.signatoryInputs,
                ...(payload.signatoryInputs || {})
            },
            complementaryClauses: hasOwn(payload || {}, 'complementaryClauses')
                ? payload.complementaryClauses
                : basePayload.complementaryClauses,
            attachments: hasOwn(payload || {}, 'attachments')
                ? this._mergeAttachmentPayloads(basePayload.attachments, payload.attachments)
                : basePayload.attachments
        };

        const rebuiltDraft = await this._buildDraftContractPayload(mergedPayload, schoolId, actor, {
            templateId: mergedPayload.templateId || contract.generatedFromTemplate?.templateId,
            contractNumber: contract.contractNumber,
            status: 'Rascunho',
            createdByUserId: contract.createdByUserId,
            auditEventType: 'contract_draft_updated',
            rootContractId: contract.lifecycleLinks?.rootContractId || null,
            parentContractId: contract.lifecycleLinks?.parentContractId || null
        });

        contract.binding = rebuiltDraft.binding;
        contract.generatedFromTemplate = rebuiltDraft.generatedFromTemplate;
        contract.validity = rebuiltDraft.validity;
        contract.execution = rebuiltDraft.execution;
        contract.programSnapshot = rebuiltDraft.programSnapshot;
        contract.parties = rebuiltDraft.parties;
        contract.signatories = rebuiltDraft.signatories;
        contract.renderedDocument = rebuiltDraft.renderedDocument;
        contract.attachments = rebuiltDraft.attachments;
        contract.updatedByUserId = this._getActorUserId(actor);
        contract.auditTrail.push(makeAuditEvent({
            eventType: 'contract_draft_updated',
            actorUserId: this._getActorUserId(actor)
        }));

        if (payload?.status === 'ProntoParaAssinatura') {
            await this._freezeContract(contract, actor);
        } else {
            await contract.save();
        }

        return this._buildContractDetail(contract);
    }

    async _freezeContract(contract, actor = null) {
        const requiredPendingAttachments = (contract.attachments || []).filter((attachment) => attachment.required && attachment.status !== 'attached');
        if (requiredPendingAttachments.length) {
            throw new Error('Todos os anexos obrigatórios precisam estar anexados antes de congelar o contrato.');
        }

        if (!Array.isArray(contract.signatories) || contract.signatories.length === 0) {
            throw new Error('O contrato precisa ter assinantes configurados antes de seguir para assinatura.');
        }

        const documentHash = hashValue(this._buildContractHashPayload(contract));
        const pdfBytes = await this._buildContractPdf(contract);
        const actorUserId = this._getActorUserId(actor);
        const now = new Date();

        contract.documentArtifact = {
            status: 'frozen',
            frozenAt: now,
            documentHash,
            hashAlgorithm: 'sha256',
            hashBasisVersion: 1,
            fileName: `${contract.contractNumber}.pdf`,
            contentType: 'application/pdf',
            sizeBytes: pdfBytes.length,
            pdfData: pdfBytes,
            lockedFields: LOCKED_AFTER_SIGNATURE_START_FIELDS
        };
        contract.status = 'ProntoParaAssinatura';
        contract.lastStatusChangedAt = now;
        contract.updatedByUserId = actorUserId;
        contract.auditTrail.push(makeAuditEvent({
            eventType: 'contract_frozen',
            actorUserId,
            metadata: { documentHash }
        }));

        await contract.save();
        return contract;
    }

    async startSignatureFlow(id, schoolId, actor = null) {
        const contract = await this._getContractDocumentById(id, schoolId);

        if (contract.status !== 'ProntoParaAssinatura') {
            throw new Error('O fluxo de assinatura só pode ser iniciado a partir de um contrato pronto para assinatura.');
        }

        if (contract.documentArtifact?.status !== 'frozen' || !contract.documentArtifact?.documentHash) {
            throw new Error('O contrato precisa estar congelado antes do início das assinaturas.');
        }

        const now = new Date();
        contract.status = 'EmAssinatura';
        contract.lastStatusChangedAt = now;
        contract.signatureFlow.startedAt = now;
        contract.signatureFlow.lockedAt = contract.signatureFlow.lockedAt || now;
        contract.updatedByUserId = this._getActorUserId(actor);
        contract.signatories = (contract.signatories || []).map((signatory) => ({
            ...(signatory.toObject ? signatory.toObject() : signatory),
            status: signatory.status === 'Pendente' ? 'Solicitada' : signatory.status,
            requestedAt: signatory.requestedAt || now
        }));
        contract.auditTrail.push(makeAuditEvent({
            eventType: 'signature_flow_started',
            actorUserId: this._getActorUserId(actor)
        }));

        await contract.save();
        return this._buildContractDetail(contract);
    }

    async acceptSignature(contractId, signatoryId, payload = {}, schoolId, actor = null) {
        const contract = await this._getContractDocumentById(contractId, schoolId);

        if (contract.status !== 'EmAssinatura') {
            throw new Error('O contrato precisa estar em assinatura para registrar um aceite.');
        }

        const signatory = contract.signatories.id(signatoryId);
        if (!signatory) {
            throw new Error('Assinante não encontrado neste contrato.');
        }

        if (signatory.status === 'Aceita') {
            throw new Error('Este assinante já concluiu o aceite do contrato.');
        }

        if (!['Solicitada', 'Visualizada'].includes(signatory.status)) {
            throw new Error('O aceite só pode ser registrado para assinantes com solicitação ativa.');
        }

        const blockingRequiredSignatory = contract.signatories
            .filter((item) => item.required && item.signingOrder < signatory.signingOrder)
            .find((item) => item.status !== 'Aceita');

        if (blockingRequiredSignatory) {
            throw new Error(`O aceite deste assinante depende da conclusão anterior de '${blockingRequiredSignatory.label}'.`);
        }

        const now = new Date();
        const actorUserId = this._getActorUserId(actor);
        signatory.viewedAt = signatory.viewedAt || now;
        signatory.acceptedAt = now;
        signatory.status = 'Aceita';
        signatory.acceptanceEvidence = {
            actorUserId,
            acceptedName: normalizeString(payload.acceptedName) || signatory.identitySnapshot.fullName,
            acceptedVia: 'internal_electronic_acceptance',
            ip: normalizeString(payload.ip),
            userAgent: normalizeString(payload.userAgent),
            consentTextVersion: normalizeString(payload.consentTextVersion) || 'v1',
            documentHashAtAcceptance: contract.documentArtifact.documentHash,
            evidenceHash: hashValue({
                contractId: contract._id,
                signatoryId: signatory._id,
                acceptedAt: now,
                actorUserId,
                acceptedName: normalizeString(payload.acceptedName) || signatory.identitySnapshot.fullName,
                documentHash: contract.documentArtifact.documentHash
            })
        };

        const requiredSignatories = contract.signatories.filter((item) => item.required);
        const allRequiredAccepted = requiredSignatories.every((item) => item.status === 'Aceita' || String(item._id) === String(signatory._id));

        if (allRequiredAccepted) {
            contract.signatureFlow.completedAt = now;
            if (new Date(contract.validity.startDate).getTime() <= now.getTime()) {
                contract.status = 'Vigente';
                contract.activatedAt = contract.activatedAt || now;
            } else {
                contract.status = 'Assinado';
            }
            contract.lastStatusChangedAt = now;
        }

        contract.updatedByUserId = actorUserId;
        contract.auditTrail.push(makeAuditEvent({
            eventType: 'signatory_accepted',
            actorUserId,
            metadata: {
                signatoryId: signatory._id,
                signatoryRole: signatory.signatoryRole
            }
        }));

        await contract.save();
        return this._buildContractDetail(contract);
    }

    async getDocumentFile(id, schoolId) {
        const contract = await this._getContractDocumentById(id, schoolId);

        if (!contract.documentArtifact?.pdfData) {
            throw new Error('Documento final do contrato ainda não foi gerado.');
        }

        return {
            fileName: contract.documentArtifact.fileName || `${contract.contractNumber}.pdf`,
            contentType: contract.documentArtifact.contentType || 'application/pdf',
            data: contract.documentArtifact.pdfData
        };
    }

    async createAmendment(contractId, payload, schoolId, actor = null) {
        const baseContract = await this._getContractDocumentById(contractId, schoolId);

        if (baseContract.status === 'Rascunho' || baseContract.status === 'Cancelado') {
            throw new Error('Aditivos só podem ser gerados a partir de contratos já consolidados.');
        }

        const basePayload = this._extractDraftPayloadFromContract(baseContract);
        const mergedPayload = {
            ...basePayload,
            ...payload,
            validity: {
                ...basePayload.validity,
                ...(payload.validity || {})
            },
            execution: {
                ...basePayload.execution,
                ...(payload.execution || {})
            },
            parameterValues: {
                ...basePayload.parameterValues,
                ...(payload.parameterValues || {})
            },
            signatoryInputs: {
                ...basePayload.signatoryInputs,
                ...(payload.signatoryInputs || {})
            },
            complementaryClauses: hasOwn(payload || {}, 'complementaryClauses')
                ? payload.complementaryClauses
                : basePayload.complementaryClauses,
            attachments: hasOwn(payload || {}, 'attachments')
                ? this._mergeAttachmentPayloads(basePayload.attachments, payload.attachments)
                : basePayload.attachments
        };

        const draftPayload = await this._buildDraftContractPayload(mergedPayload, schoolId, actor, {
            templateId: mergedPayload.templateId || basePayload.templateId,
            documentType: 'amendment',
            rootContractId: baseContract.lifecycleLinks?.rootContractId || baseContract._id,
            parentContractId: baseContract._id,
            auditEventType: 'amendment_draft_created'
        });

        const contract = new Contract(draftPayload);
        await contract.save();
        return contract;
    }

    async createRescission(contractId, payload, schoolId, actor = null) {
        const baseContract = await this._getContractDocumentById(contractId, schoolId);

        if (baseContract.status === 'Rascunho' || baseContract.status === 'Cancelado') {
            throw new Error('Rescisões só podem ser geradas a partir de contratos já consolidados.');
        }

        const basePayload = this._extractDraftPayloadFromContract(baseContract);
        const rescissionClauses = Array.isArray(payload?.complementaryClauses) && payload.complementaryClauses.length
            ? payload.complementaryClauses
            : [{
                key: 'rescission_reason',
                title: 'Motivo da rescisão',
                body: normalizeString(payload?.reason) || 'Rescisão formalizada pelo módulo de contratos.',
                order: 1
            }];

        const mergedPayload = {
            ...basePayload,
            ...payload,
            complementaryClauses: rescissionClauses
        };

        const draftPayload = await this._buildDraftContractPayload(mergedPayload, schoolId, actor, {
            templateId: mergedPayload.templateId || basePayload.templateId,
            documentType: 'rescission',
            rootContractId: baseContract.lifecycleLinks?.rootContractId || baseContract._id,
            parentContractId: baseContract._id,
            auditEventType: 'rescission_draft_created'
        });

        const contract = new Contract(draftPayload);
        await contract.save();
        return contract;
    }
}

module.exports = new ContractService();
