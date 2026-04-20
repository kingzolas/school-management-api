const {
  createHttpError,
  getOfficialDocumentMaxPdfBytes,
  hashBufferSha256,
  isPdfBuffer,
  sanitizeFileName,
  slugify,
} = require('../validators/officialDocument.validator');

const OFFICIAL_DOCUMENT_STORAGE_PROVIDER = 'mongodb_buffer';

const buildStorageKey = ({
  schoolId,
  studentId,
  documentId = 'pending',
  version = 1,
  fileName = 'documento-assinado.pdf',
}) => {
  const safeName = slugify(fileName) || 'documento-assinado-pdf';
  return [
    'official-documents',
    String(schoolId || 'school'),
    String(studentId || 'student'),
    `v${version}`,
    `${String(documentId)}-${safeName}`,
  ].join('/');
};

const assertValidSignedPdf = (file) => {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw createHttpError('O PDF assinado final e obrigatorio.', 400, {
      code: 'signed_pdf_required',
    });
  }

  const fileSize = Number(file.size || file.buffer.length || 0);
  const maxBytes = getOfficialDocumentMaxPdfBytes();
  if (fileSize <= 0) {
    throw createHttpError('O arquivo enviado esta vazio.', 400, {
      code: 'empty_file',
    });
  }

  if (fileSize > maxBytes) {
    throw createHttpError(`O PDF assinado excede o limite configurado de ${maxBytes} bytes.`, 413, {
      code: 'file_too_large',
      maxBytes,
    });
  }

  if (String(file.mimetype || '').toLowerCase() !== 'application/pdf') {
    throw createHttpError('A API aceita apenas arquivos PDF assinados.', 400, {
      code: 'invalid_mimetype',
    });
  }

  if (!isPdfBuffer(file.buffer)) {
    throw createHttpError('O arquivo enviado nao possui cabecalho PDF valido.', 400, {
      code: 'invalid_pdf_header',
    });
  }
};

const storeSignedPdf = (file, context = {}) => {
  assertValidSignedPdf(file);

  const fileName = sanitizeFileName(
    file.originalname || context.fallbackFileName || 'documento-assinado.pdf'
  );
  const fileSize = Number(file.size || file.buffer.length || 0);

  return {
    storageProvider: OFFICIAL_DOCUMENT_STORAGE_PROVIDER,
    storageKey: buildStorageKey({
      schoolId: context.schoolId,
      studentId: context.studentId,
      documentId: context.documentId,
      version: context.version,
      fileName,
    }),
    fileName,
    mimeType: 'application/pdf',
    fileSize,
    fileHash: hashBufferSha256(file.buffer),
    fileData: file.buffer,
  };
};

const readStoredPdf = (document = {}) => {
  if (!document?.fileData) {
    throw createHttpError('Arquivo do documento nao encontrado.', 404, {
      code: 'document_file_not_found',
    });
  }

  return {
    fileName: document.fileName || 'documento-assinado.pdf',
    mimeType: document.mimeType || 'application/pdf',
    data: document.fileData,
  };
};

module.exports = {
  OFFICIAL_DOCUMENT_STORAGE_PROVIDER,
  buildStorageKey,
  assertValidSignedPdf,
  storeSignedPdf,
  readStoredPdf,
};
