const mongoose = require('mongoose');

const { Schema } = mongoose;

const stripBinaryFields = (ret) => {
    if (ret?.documentArtifact) {
        delete ret.documentArtifact.pdfData;
        ret.documentArtifact.hasPdf = Boolean(ret.documentArtifact.fileName);
    }

    if (Array.isArray(ret?.attachments)) {
        ret.attachments = ret.attachments.map((attachment) => {
            const nextAttachment = { ...attachment };
            delete nextAttachment.fileData;
            nextAttachment.hasFile = Boolean(nextAttachment.fileName);
            return nextAttachment;
        });
    }

    return ret;
};

const addressSnapshotSchema = new Schema({
    street: { type: String, default: null, trim: true },
    neighborhood: { type: String, default: null, trim: true },
    number: { type: String, default: null, trim: true },
    block: { type: String, default: null, trim: true },
    lot: { type: String, default: null, trim: true },
    city: { type: String, default: null, trim: true },
    state: { type: String, default: null, trim: true },
    cep: { type: String, default: null, trim: true },
    zipCode: { type: String, default: null, trim: true }
}, { _id: false });

const representativeSnapshotSchema = new Schema({
    fullName: { type: String, required: true, trim: true },
    jobTitle: { type: String, default: null, trim: true },
    cpf: { type: String, default: null, trim: true },
    rg: { type: String, default: null, trim: true },
    relationship: { type: String, default: null, trim: true },
    phone: { type: String, default: null, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true }
}, { _id: false });

const templateClauseSchema = new Schema({
    key: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    order: { type: Number, required: true, min: 1 },
    locked: { type: Boolean, default: true }
}, { _id: false });

const parameterDefinitionSchema = new Schema({
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    type: {
        type: String,
        enum: ['text', 'textarea', 'number', 'date', 'boolean', 'select', 'currency'],
        default: 'text'
    },
    required: { type: Boolean, default: false },
    placeholder: { type: String, default: null, trim: true },
    helpText: { type: String, default: null, trim: true },
    defaultValue: { type: Schema.Types.Mixed, default: null },
    options: { type: [String], default: [] }
}, { _id: false });

const complementaryClauseDefinitionSchema = new Schema({
    key: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    instructions: { type: String, default: null, trim: true },
    required: { type: Boolean, default: false },
    allowMultiple: { type: Boolean, default: false },
    defaultBody: { type: String, default: null, trim: true }
}, { _id: false });

const attachmentRuleSchema = new Schema({
    key: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: null, trim: true },
    attachmentType: { type: String, required: true, trim: true },
    required: { type: Boolean, default: false }
}, { _id: false });

const signatureBlueprintSchema = new Schema({
    role: {
        type: String,
        required: true,
        enum: [
            'company_representative',
            'apprentice',
            'legal_guardian',
            'training_provider_representative',
            'witness'
        ]
    },
    partyRole: {
        type: String,
        required: true,
        enum: ['company', 'apprentice', 'trainingProvider', 'guardian', 'witness']
    },
    label: { type: String, required: true, trim: true },
    required: { type: Boolean, default: true },
    signingOrder: { type: Number, required: true, min: 1 },
    condition: {
        type: String,
        enum: ['always', 'minor_only', 'optional'],
        default: 'always'
    }
}, { _id: false });

const legalBasisSchema = new Schema({
    key: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    reference: { type: String, default: null, trim: true },
    body: { type: String, default: null, trim: true },
    order: { type: Number, required: true, min: 1 }
}, { _id: false });

const templateHistoryEventSchema = new Schema({
    eventType: { type: String, required: true, trim: true },
    occurredAt: { type: Date, default: Date.now },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, default: null, trim: true },
    metadata: { type: Schema.Types.Mixed, default: null }
}, { _id: false });

const contractTemplateSchema = new Schema({
    name: {
        type: String,
        required: [true, 'O nome do template de contrato é obrigatório.'],
        trim: true
    },
    templateKey: {
        type: String,
        required: [true, 'A chave do template de contrato é obrigatória.'],
        trim: true
    },
    version: {
        type: Number,
        required: true,
        min: 1
    },
    status: {
        type: String,
        enum: ['Rascunho', 'Publicado', 'Substituido', 'Arquivado'],
        default: 'Rascunho',
        index: true
    },
    description: {
        type: String,
        default: null,
        trim: true
    },
    baseClauses: {
        type: [templateClauseSchema],
        default: []
    },
    parameterDefinitions: {
        type: [parameterDefinitionSchema],
        default: []
    },
    complementaryClauseDefinitions: {
        type: [complementaryClauseDefinitionSchema],
        default: []
    },
    requiredAttachmentRules: {
        type: [attachmentRuleSchema],
        default: []
    },
    signatureBlueprint: {
        type: [signatureBlueprintSchema],
        default: []
    },
    legalBasis: {
        type: [legalBasisSchema],
        default: []
    },
    previousVersionTemplateId: {
        type: Schema.Types.ObjectId,
        ref: 'ContractTemplate',
        default: null
    },
    supersededByTemplateId: {
        type: Schema.Types.ObjectId,
        ref: 'ContractTemplate',
        default: null
    },
    publishedAt: {
        type: Date,
        default: null
    },
    publishedByUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    archivedAt: {
        type: Date,
        default: null
    },
    createdByUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    updatedByUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    history: {
        type: [templateHistoryEventSchema],
        default: []
    },
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola é obrigatória.'],
        index: true
    }
}, {
    timestamps: true
});

contractTemplateSchema.index({ school_id: 1, templateKey: 1, version: 1 }, { unique: true });
contractTemplateSchema.index({ school_id: 1, templateKey: 1, status: 1 });

const bindingSchema = new Schema({
    technicalEnrollmentId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalEnrollment',
        required: true,
        index: true
    },
    studentId: {
        type: Schema.Types.ObjectId,
        ref: 'Student',
        required: true,
        index: true
    },
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    technicalProgramId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgram',
        required: true,
        index: true
    },
    technicalProgramOfferingId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgramOffering',
        default: null,
        index: true
    }
}, { _id: false });

const generatedFromTemplateSchema = new Schema({
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'ContractTemplate',
        default: null
    },
    templateKey: {
        type: String,
        default: null,
        trim: true
    },
    templateName: {
        type: String,
        default: null,
        trim: true
    },
    templateVersion: {
        type: Number,
        default: null
    }
}, { _id: false });

const companyPartySchema = new Schema({
    referenceId: {
        type: Schema.Types.ObjectId,
        ref: 'Company',
        required: true
    },
    name: { type: String, required: true, trim: true },
    legalName: { type: String, required: true, trim: true },
    cnpj: { type: String, required: true, trim: true },
    address: {
        type: addressSnapshotSchema,
        required: true
    },
    representative: {
        type: representativeSnapshotSchema,
        default: null
    }
}, { _id: false });

const apprenticePartySchema = new Schema({
    referenceId: {
        type: Schema.Types.ObjectId,
        ref: 'Student',
        required: true
    },
    fullName: { type: String, required: true, trim: true },
    birthDate: { type: Date, required: true },
    ageAtIssue: { type: Number, required: true, min: 0 },
    rg: { type: String, default: null, trim: true },
    cpf: { type: String, default: null, trim: true },
    address: {
        type: addressSnapshotSchema,
        required: true
    },
    isMinorAtIssue: { type: Boolean, default: false }
}, { _id: false });

const trainingProviderPartySchema = new Schema({
    referenceId: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: true
    },
    name: { type: String, required: true, trim: true },
    legalName: { type: String, required: true, trim: true },
    cnpj: { type: String, default: null, trim: true },
    address: {
        type: addressSnapshotSchema,
        default: () => ({})
    },
    representative: {
        type: representativeSnapshotSchema,
        required: true
    }
}, { _id: false });

const signatoryIdentitySnapshotSchema = new Schema({
    fullName: { type: String, required: true, trim: true },
    jobTitle: { type: String, default: null, trim: true },
    cpf: { type: String, default: null, trim: true },
    email: { type: String, default: null, trim: true, lowercase: true },
    phone: { type: String, default: null, trim: true },
    relationship: { type: String, default: null, trim: true }
}, { _id: false });

const signatoryAcceptanceEvidenceSchema = new Schema({
    actorUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    acceptedName: { type: String, default: null, trim: true },
    acceptedVia: { type: String, default: 'internal_electronic_acceptance', trim: true },
    ip: { type: String, default: null, trim: true },
    userAgent: { type: String, default: null, trim: true },
    consentTextVersion: { type: String, default: 'v1', trim: true },
    documentHashAtAcceptance: { type: String, default: null, trim: true },
    evidenceHash: { type: String, default: null, trim: true }
}, { _id: false });

const signatorySchema = new Schema({
    partyRole: {
        type: String,
        required: true,
        enum: ['company', 'apprentice', 'trainingProvider', 'guardian', 'witness']
    },
    signatoryRole: {
        type: String,
        required: true,
        enum: [
            'company_representative',
            'apprentice',
            'legal_guardian',
            'training_provider_representative',
            'witness'
        ]
    },
    label: { type: String, required: true, trim: true },
    required: { type: Boolean, default: true },
    condition: {
        type: String,
        enum: ['always', 'minor_only', 'optional'],
        default: 'always'
    },
    signingOrder: { type: Number, required: true, min: 1 },
    status: {
        type: String,
        enum: ['Pendente', 'Solicitada', 'Visualizada', 'Aceita', 'Recusada', 'Expirada', 'Cancelada'],
        default: 'Pendente'
    },
    referenceModel: {
        type: String,
        enum: ['Company', 'Student', 'School', 'Tutor', 'User', null],
        default: null
    },
    referenceId: {
        type: Schema.Types.ObjectId,
        default: null
    },
    identitySnapshot: {
        type: signatoryIdentitySnapshotSchema,
        required: true
    },
    requestedAt: { type: Date, default: null },
    viewedAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    refusalReason: { type: String, default: null, trim: true },
    acceptanceEvidence: {
        type: signatoryAcceptanceEvidenceSchema,
        default: null
    },
    providerInfo: {
        type: Schema.Types.Mixed,
        default: null
    }
}, {
    timestamps: true
});

const renderedClauseSchema = new Schema({
    key: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    order: { type: Number, required: true, min: 1 },
    sourceType: {
        type: String,
        enum: ['base', 'complementary', 'legal_basis'],
        required: true
    },
    locked: { type: Boolean, default: true }
}, { _id: false });

const resolvedParameterSchema = new Schema({
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    value: { type: Schema.Types.Mixed, default: null },
    displayValue: { type: String, default: null, trim: true },
    sourceType: {
        type: String,
        enum: ['template', 'execution', 'override'],
        default: 'override'
    }
}, { _id: false });

const attachmentSchema = new Schema({
    key: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    attachmentType: { type: String, required: true, trim: true },
    description: { type: String, default: null, trim: true },
    required: { type: Boolean, default: false },
    status: {
        type: String,
        enum: ['pending', 'attached'],
        default: 'pending'
    },
    fileName: { type: String, default: null, trim: true },
    contentType: { type: String, default: null, trim: true },
    sizeBytes: { type: Number, default: null, min: 0 },
    hash: { type: String, default: null, trim: true },
    fileData: { type: Buffer, select: false },
    uploadedAt: { type: Date, default: null },
    uploadedByUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    }
}, { _id: false });

const documentArtifactSchema = new Schema({
    status: {
        type: String,
        enum: ['draft', 'frozen'],
        default: 'draft'
    },
    frozenAt: { type: Date, default: null },
    documentHash: { type: String, default: null, trim: true },
    hashAlgorithm: { type: String, default: 'sha256', trim: true },
    hashBasisVersion: { type: Number, default: 1, min: 1 },
    fileName: { type: String, default: null, trim: true },
    contentType: { type: String, default: null, trim: true },
    sizeBytes: { type: Number, default: null, min: 0 },
    pdfData: { type: Buffer, select: false },
    lockedFields: { type: [String], default: [] }
}, { _id: false });

const auditEventSchema = new Schema({
    eventType: { type: String, required: true, trim: true },
    occurredAt: { type: Date, default: Date.now },
    actorUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    note: { type: String, default: null, trim: true },
    metadata: { type: Schema.Types.Mixed, default: null }
}, { _id: false });

const validitySchema = new Schema({
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true }
}, { _id: false });

const executionSchema = new Schema({
    theoryLocation: { type: String, default: null, trim: true },
    practiceLocation: { type: String, default: null, trim: true },
    journey: { type: String, default: null, trim: true },
    weeklyDistribution: { type: String, default: null, trim: true },
    remuneration: { type: String, default: null, trim: true },
    supervisorName: { type: String, default: null, trim: true },
    supervisorRole: { type: String, default: null, trim: true }
}, { _id: false });

const programSnapshotSchema = new Schema({
    referenceId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgram',
        required: true
    },
    offeringReferenceId: {
        type: Schema.Types.ObjectId,
        ref: 'TechnicalProgramOffering',
        default: null
    },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: null, trim: true },
    apprenticeshipProgramName: { type: String, default: null, trim: true },
    occupationalArc: { type: String, default: null, trim: true },
    cboCodes: { type: [String], default: [] },
    theoreticalWorkloadHours: { type: Number, default: null, min: 0 },
    practicalWorkloadHours: { type: Number, default: null, min: 0 },
    totalWorkloadHours: { type: Number, required: true, min: 0 }
}, { _id: false });

const renderedDocumentSchema = new Schema({
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: null, trim: true },
    baseClausesRendered: { type: [renderedClauseSchema], default: [] },
    complementaryClausesRendered: { type: [renderedClauseSchema], default: [] },
    legalBasisRendered: { type: [renderedClauseSchema], default: [] },
    resolvedParameters: { type: [resolvedParameterSchema], default: [] }
}, { _id: false });

const lifecycleLinksSchema = new Schema({
    rootContractId: {
        type: Schema.Types.ObjectId,
        ref: 'Contract',
        default: null
    },
    parentContractId: {
        type: Schema.Types.ObjectId,
        ref: 'Contract',
        default: null
    }
}, { _id: false });

const signatureFlowSchema = new Schema({
    mode: {
        type: String,
        enum: ['internal_electronic_acceptance'],
        default: 'internal_electronic_acceptance'
    },
    startedAt: { type: Date, default: null },
    lockedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
}, { _id: false });

const contractSchema = new Schema({
    documentType: {
        type: String,
        enum: ['initial', 'amendment', 'rescission'],
        default: 'initial',
        index: true
    },
    contractNumber: {
        type: String,
        required: true,
        trim: true
    },
    status: {
        type: String,
        enum: ['Rascunho', 'ProntoParaAssinatura', 'EmAssinatura', 'Assinado', 'Vigente', 'Concluido', 'Cancelado', 'Rescindido'],
        default: 'Rascunho',
        index: true
    },
    binding: {
        type: bindingSchema,
        required: true
    },
    generatedFromTemplate: {
        type: generatedFromTemplateSchema,
        default: () => ({})
    },
    validity: {
        type: validitySchema,
        required: true
    },
    execution: {
        type: executionSchema,
        default: () => ({})
    },
    programSnapshot: {
        type: programSnapshotSchema,
        required: true
    },
    parties: {
        company: {
            type: companyPartySchema,
            required: true
        },
        apprentice: {
            type: apprenticePartySchema,
            required: true
        },
        trainingProvider: {
            type: trainingProviderPartySchema,
            required: true
        }
    },
    signatories: {
        type: [signatorySchema],
        default: []
    },
    renderedDocument: {
        type: renderedDocumentSchema,
        required: true
    },
    attachments: {
        type: [attachmentSchema],
        default: []
    },
    documentArtifact: {
        type: documentArtifactSchema,
        default: () => ({})
    },
    signatureFlow: {
        type: signatureFlowSchema,
        default: () => ({})
    },
    lifecycleLinks: {
        type: lifecycleLinksSchema,
        default: () => ({})
    },
    issueDate: {
        type: Date,
        default: Date.now
    },
    activatedAt: {
        type: Date,
        default: null
    },
    completedAt: {
        type: Date,
        default: null
    },
    cancelledAt: {
        type: Date,
        default: null
    },
    rescindedAt: {
        type: Date,
        default: null
    },
    createdByUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    updatedByUserId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    lastStatusChangedAt: {
        type: Date,
        default: Date.now
    },
    auditTrail: {
        type: [auditEventSchema],
        default: []
    },
    school_id: {
        type: Schema.Types.ObjectId,
        ref: 'School',
        required: [true, 'A referência da escola é obrigatória.'],
        index: true
    }
}, {
    timestamps: true
});

contractSchema.index({ school_id: 1, contractNumber: 1 }, { unique: true });
contractSchema.index({ school_id: 1, 'binding.technicalEnrollmentId': 1, documentType: 1, status: 1 });
contractSchema.index({ school_id: 1, 'binding.companyId': 1, status: 1, issueDate: -1 });
contractSchema.index({ school_id: 1, 'binding.studentId': 1, issueDate: -1 });
contractSchema.index({ school_id: 1, 'binding.technicalProgramId': 1, issueDate: -1 });

contractTemplateSchema.set('toJSON', {
    transform: (_, ret) => ret
});

contractTemplateSchema.set('toObject', {
    transform: (_, ret) => ret
});

contractSchema.set('toJSON', {
    transform: (_, ret) => stripBinaryFields(ret)
});

contractSchema.set('toObject', {
    transform: (_, ret) => stripBinaryFields(ret)
});

const ContractTemplate = mongoose.models.ContractTemplate || mongoose.model('ContractTemplate', contractTemplateSchema);
const Contract = mongoose.models.Contract || mongoose.model('Contract', contractSchema);

module.exports = {
    ContractTemplate,
    Contract
};
