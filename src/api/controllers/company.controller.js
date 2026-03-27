const CompanyService = require('../services/company.service');

const getSchoolId = (req) => {
    if (!req.user || !req.user.school_id) {
        throw new Error('Usuário não autenticado ou não associado a uma escola.');
    }

    return req.user.school_id;
};

const parseMaybeJson = (value) => {
    if (typeof value !== 'string') {
        return value;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    if (trimmed === 'null' || trimmed === 'undefined') {
        return null;
    }

    try {
        return JSON.parse(trimmed);
    } catch (error) {
        return value;
    }
};

const buildNestedObject = (body, fieldMap) => {
    const nested = {};
    let hasValue = false;

    Object.entries(fieldMap).forEach(([nestedKey, sourceKeys]) => {
        const keys = Array.isArray(sourceKeys) ? sourceKeys : [sourceKeys];

        for (const key of keys) {
            if (body[key] !== undefined) {
                nested[nestedKey] = body[key];
                hasValue = true;
                return;
            }
        }
    });

    return hasValue ? nested : null;
};

const normalizeCompanyBody = (body) => {
    const cleaned = { ...body };

    cleaned.address = parseMaybeJson(cleaned.address);
    cleaned.contactPerson = parseMaybeJson(cleaned.contactPerson);

    if (!cleaned.address) {
        const address = buildNestedObject(cleaned, {
            street: ['address[street]', 'address.street'],
            neighborhood: ['address[neighborhood]', 'address.neighborhood'],
            number: ['address[number]', 'address.number'],
            block: ['address[block]', 'address.block'],
            lot: ['address[lot]', 'address.lot'],
            cep: ['address[cep]', 'address.cep'],
            city: ['address[city]', 'address.city'],
            state: ['address[state]', 'address.state']
        });

        if (address) {
            cleaned.address = address;
        }
    }

    if (!cleaned.contactPerson) {
        const contactPerson = buildNestedObject(cleaned, {
            fullName: ['contactPerson[fullName]', 'contactPerson.fullName'],
            jobTitle: ['contactPerson[jobTitle]', 'contactPerson.jobTitle'],
            phone: ['contactPerson[phone]', 'contactPerson.phone'],
            email: ['contactPerson[email]', 'contactPerson.email']
        });

        if (contactPerson) {
            cleaned.contactPerson = contactPerson;
        }
    }

    return cleaned;
};

class CompanyController {
    async create(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const createData = normalizeCompanyBody(req.body);
            const company = await CompanyService.createCompany(createData, schoolId, req.file);

            res.status(201).json(company);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.code === 11000 || error.message.includes('já existe')) {
                return res.status(409).json({ message: error.message });
            }
            if (error.name === 'ValidationError') {
                return res.status(400).json({ message: 'Erro de validação.', error: error.message });
            }
            next(error);
        }
    }

    async getAll(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const companies = await CompanyService.getAllCompanies(req.query, schoolId);

            res.status(200).json(companies);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            next(error);
        }
    }

    async getById(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const company = await CompanyService.getCompanyById(req.params.id, schoolId);

            res.status(200).json(company);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async getLogo(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const logo = await CompanyService.getCompanyLogo(req.params.id, schoolId);

            res.set('Content-Type', logo.contentType);
            res.status(200).send(logo.data);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }

    async update(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const updateData = normalizeCompanyBody(req.body);
            const updatedCompany = await CompanyService.updateCompany(
                req.params.id,
                updateData,
                schoolId,
                req.file
            );

            res.status(200).json(updatedCompany);
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            if (error.message.includes('já está em uso')) {
                return res.status(409).json({ message: error.message });
            }
            if (error.name === 'ValidationError') {
                return res.status(400).json({ message: 'Erro de validação.', error: error.message });
            }
            next(error);
        }
    }

    async inactivate(req, res, next) {
        try {
            const schoolId = getSchoolId(req);
            const company = await CompanyService.inactivateCompany(req.params.id, schoolId);

            res.status(200).json({ message: 'Empresa inativada com sucesso', company });
        } catch (error) {
            if (error.message.includes('não autenticado')) {
                return res.status(403).json({ message: error.message });
            }
            if (error.message.includes('não encontrada')) {
                return res.status(404).json({ message: error.message });
            }
            next(error);
        }
    }
}

module.exports = new CompanyController();
