const DEFAULT_ERROR_CODE = 'INTERNAL_ERROR';
const DEFAULT_ERROR_STATUS = 500;

class ApiError extends Error {
    constructor({
        message,
        code = 'API_ERROR',
        status = 400,
        details = [],
        blockingReasons = [],
        meta = {}
    }) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.status = status;
        this.details = Array.isArray(details) ? details : [];
        this.blockingReasons = Array.isArray(blockingReasons) ? blockingReasons : [];
        this.meta = meta && typeof meta === 'object' ? meta : {};
    }

    toResponse() {
        return {
            message: this.message,
            code: this.code,
            details: this.details,
            blockingReasons: this.blockingReasons,
            meta: this.meta
        };
    }
}

function normalizeValidationDetails(error) {
    if (!error || !error.errors || typeof error.errors !== 'object') {
        return [];
    }

    return Object.entries(error.errors).map(([field, fieldError]) => ({
        field,
        code: fieldError?.kind || 'VALIDATION_ERROR',
        message: fieldError?.message || 'Campo invalido.'
    }));
}

function normalizeMessage(message) {
    return String(message || '').toLowerCase();
}

function inferStatusAndCodeFromMessage(message) {
    const normalizedMessage = normalizeMessage(message);

    if (normalizedMessage.includes('nao autenticado')) {
        return { status: 403, code: 'UNAUTHORIZED' };
    }

    if (normalizedMessage.includes('nao encontrado')) {
        return { status: 404, code: 'NOT_FOUND' };
    }

    if (normalizedMessage.includes('ja existe') || normalizedMessage.includes('conflito')) {
        return { status: 409, code: 'CONFLICT' };
    }

    if (normalizedMessage.includes('invalida') || normalizedMessage.includes('invalido')) {
        return { status: 400, code: 'INVALID_DATA' };
    }

    return { status: DEFAULT_ERROR_STATUS, code: DEFAULT_ERROR_CODE };
}

function formatApiError(error) {
    if (error instanceof ApiError) {
        return {
            status: error.status,
            body: error.toResponse()
        };
    }

    if (error?.name === 'ValidationError') {
        return {
            status: 400,
            body: {
                message: 'Erro de validacao.',
                code: 'VALIDATION_ERROR',
                details: normalizeValidationDetails(error),
                blockingReasons: [],
                meta: {}
            }
        };
    }

    if (error?.name === 'CastError' || normalizeMessage(error?.message).includes('cast to objectid failed')) {
        return {
            status: 400,
            body: {
                message: error?.message || 'Erro de validacao.',
                code: 'INVALID_DATA',
                details: [],
                blockingReasons: [],
                meta: {}
            }
        };
    }

    const message = error?.message || 'Erro interno inesperado.';
    const { status, code } = inferStatusAndCodeFromMessage(message);

    return {
        status,
        body: {
            message,
            code,
            details: [],
            blockingReasons: [],
            meta: {}
        }
    };
}

module.exports = {
    ApiError,
    formatApiError
};
