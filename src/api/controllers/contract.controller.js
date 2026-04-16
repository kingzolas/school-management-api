const ContractService = require('../services/contract.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuario nao autenticado ou nao associado a uma escola.');
    }

    return req.user.school_id;
};

const getActor = (req) => req.user || null;

const normalizeMessage = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const handleCommonErrors = (error, res, next) => {
    if (error?.code === 11000) {
        return res.status(409).json({ message: 'Conflito de unicidade ao salvar o recurso de contrato.' });
    }

    const message = error?.message || 'Erro interno ao processar o modulo de contratos.';
    const normalizedMessage = normalizeMessage(message);

    if (normalizedMessage.includes('nao autenticado') || normalizedMessage.includes('nao associado')) {
        return res.status(403).json({ message });
    }

    if (normalizedMessage.includes('nao encontrado') || normalizedMessage.includes('nao pertence')) {
        return res.status(404).json({ message });
    }

    if (
        normalizedMessage.includes('ja existe')
        || normalizedMessage.includes('nova versao')
        || normalizedMessage.includes('ja concluiu')
        || normalizedMessage.includes('so pode ser iniciado')
        || normalizedMessage.includes('so podem ser gerados')
        || normalizedMessage.includes('documento final do contrato ainda nao foi gerado')
        || normalizedMessage.includes('contrato inicial')
        || message.includes('contrato inicial')
    ) {
        return res.status(409).json({ message });
    }

    if (error.name === 'ValidationError') {
        return res.status(400).json({ message: 'Erro de validacao.', error: message });
    }

    if (
        normalizedMessage.includes('obrigatorio')
        || normalizedMessage.includes('invalido')
        || normalizedMessage.includes('somente')
        || normalizedMessage.includes('apenas')
        || normalizedMessage.includes('precisa')
        || normalizedMessage.includes('exige')
        || normalizedMessage.includes('nao pode')
        || normalizedMessage.includes('disponivel apenas')
        || normalizedMessage.includes('geracao de contratos exige')
        || normalizedMessage.includes('solicitacao ativa')
        || normalizedMessage.includes('depende da conclusao anterior')
    ) {
        return res.status(400).json({ message });
    }

    return next(error);
};

class ContractController {
    async createTemplate(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const template = await ContractService.createTemplate(req.body, schoolId, getActor(req));
            res.status(201).json(template);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async listTemplates(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const templates = await ContractService.listTemplates(req.query, schoolId);
            res.status(200).json(templates);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async getTemplateById(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const template = await ContractService.getTemplateById(req.params.id, schoolId);
            res.status(200).json(template);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async updateTemplate(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const template = await ContractService.updateTemplate(req.params.id, req.body, schoolId, getActor(req));
            res.status(200).json(template);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async publishTemplate(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const template = await ContractService.publishTemplate(req.params.id, schoolId, getActor(req));
            res.status(200).json(template);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async createTemplateVersion(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const template = await ContractService.createTemplateVersion(req.params.id, req.body, schoolId, getActor(req));
            res.status(201).json(template);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async createContract(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const contract = await ContractService.createContract(req.body, schoolId, getActor(req));
            res.status(201).json(contract);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async listContracts(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const contracts = await ContractService.listContracts(req.query, schoolId);
            res.status(200).json(contracts);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async listContractsByCompany(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const contracts = await ContractService.listContractsByCompany(req.params.companyId, req.query, schoolId);
            res.status(200).json(contracts);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async getContractById(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const contract = await ContractService.getContractById(req.params.id, schoolId);
            res.status(200).json(contract);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async updateContract(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const contract = await ContractService.updateContract(req.params.id, req.body, schoolId, getActor(req));
            res.status(200).json(contract);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async startSignatureFlow(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const contract = await ContractService.startSignatureFlow(req.params.id, schoolId, getActor(req));
            res.status(200).json(contract);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async acceptSignature(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const contract = await ContractService.acceptSignature(
                req.params.id,
                req.params.signatoryId,
                req.body,
                schoolId,
                getActor(req)
            );
            res.status(200).json(contract);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async downloadDocument(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const file = await ContractService.getDocumentFile(req.params.id, schoolId);
            res.setHeader('Content-Type', file.contentType);
            res.setHeader('Content-Disposition', `inline; filename=${file.fileName}`);
            res.status(200).send(file.data);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async createAmendment(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const contract = await ContractService.createAmendment(req.params.id, req.body, schoolId, getActor(req));
            res.status(201).json(contract);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }

    async createRescission(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const contract = await ContractService.createRescission(req.params.id, req.body, schoolId, getActor(req));
            res.status(201).json(contract);
        } catch (error) {
            handleCommonErrors(error, res, next);
        }
    }
}

module.exports = new ContractController();
