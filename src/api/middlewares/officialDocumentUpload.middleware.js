const multer = require('multer');

const {
  getOfficialDocumentMaxPdfBytes,
} = require('../validators/officialDocument.validator');

const buildSignedPdfUpload = (fieldName = 'file') => {
  const uploader = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: getOfficialDocumentMaxPdfBytes(),
    },
    fileFilter(req, file, cb) {
      if (!file) {
        return cb(null, true);
      }

      if (String(file.mimetype || '').toLowerCase() !== 'application/pdf') {
        return cb(new Error('Apenas arquivos PDF sao permitidos.'), false);
      }

      return cb(null, true);
    },
  }).single(fieldName);

  return (req, res, next) => uploader(req, res, (error) => {
    if (!error) {
      return next();
    }

    const statusCode = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(statusCode).json({
      message: error.message || 'Falha ao processar o upload do PDF.',
    });
  });
};

module.exports = {
  buildSignedPdfUpload,
};
