// services/fileUploadService.js - File Upload Service
const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.memoryStorage();

const uploadMiddleware = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
        files: 1,
        fields: 10
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];

        const allowedExtensions = ['.pdf', '.doc', '.docx'];
        const fileExtension = path.extname(file.originalname).toLowerCase();

        if (allowedTypes.includes(file.mimetype) && allowedExtensions.includes(fileExtension)) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported file type - only PDF, DOC, DOCX allowed'), false);
        }
    }
}).single('cv');

// Enhanced file validation
const validateFileUpload = (req, res, next) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }

    const file = req.file;

    // Size validation
    if (file.size < 1000) {
        return res.status(400).json({ error: 'File too small - minimum 1KB' });
    }

    // File signature validation (magic numbers)
    const buffer = file.buffer;
    const signature = buffer.slice(0, 4);

    // PDF signature: %PDF
    const pdfSignature = Buffer.from([0x25, 0x50, 0x44, 0x46]);
    // DOC signature: D0CF11E0
    const docSignature = Buffer.from([0xD0, 0xCF, 0x11, 0xE0]);
    // DOCX signature: 504B (ZIP-like)
    const docxSignature = Buffer.from([0x50, 0x4B]);

    const isValidFile = signature.equals(pdfSignature) ||
        signature.equals(docSignature) ||
        signature.slice(0, 2).equals(docxSignature);

    if (!isValidFile) {
        return res.status(400).json({
            error: 'Invalid file format - file signature mismatch'
        });
    }

    next();
};

module.exports = {
    uploadMiddleware,
    validateFileUpload
};