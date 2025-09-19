// routes/students.js - Fixed routing structure
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const studentController = require('../controllers/studentController');
const { authenticateToken } = require('../middleware/auth'); // Import auth middleware
const {
    createOrGetSession,
    validateSession,
    validateStepInput,
    spamProtection
} = require('../middleware/studentSession');
const StudentUtils = require('../utils/studentUtils');

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads/students');
        try {
            await fs.mkdir(uploadDir, { recursive: true });
            cb(null, uploadDir);
        } catch (error) {
            cb(error, null);
        }
    },
    filename: (req, file, cb) => {
        // קבלת מזהה הסטודנט מה-middleware
        const studentId = req.student?._id;
        const sessionId = req.params.sessionId;
        const timestamp = Date.now();
        const dateStr = new Date().toISOString().slice(0,10); // YYYY-MM-DD
        const ext = path.extname(file.originalname);

        // פורמט: cv-[studentId]-[date]-[timestamp].pdf
        const fileType = file.fieldname; // 'cv' או 'transcript'
        const uniqueName = `${fileType}-${studentId}-${dateStr}-${timestamp}${ext}`;

        cb(null, uniqueName);
    }
});


const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/png'
        ];

        if (allowedTypes.includes(file.mimetype)) {
            try {
                StudentUtils.validateFile(file, ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png']);
                cb(null, true);
            } catch (error) {
                cb(new Error(error.message), false);
            }
        } else {
            cb(new Error('Invalid file type'), false);
        }
    }
});

// Chat flow routes
router.post('/chat/start', spamProtection, studentController.startChat);
router.post('/chat/resume', studentController.resumeSession);
router.get('/chat/:sessionId/step', validateSession, studentController.getCurrentStep);

// File upload routes
router.post('/chat/:sessionId/upload-cv',
    validateSession,
    upload.single('cv'),
    studentController.uploadCV
);

router.post('/chat/:sessionId/upload-transcript',
    validateSession,
    upload.single('transcript'),
    studentController.uploadTranscript
);

// FIXED: Remove validateStepInput from verify-data route since it doesn't have stepNumber
router.post('/chat/:sessionId/verify-data',
    validateSession,
    studentController.verifyData
);

// Step handling routes - validateStepInput works here because it has :stepNumber
router.post('/chat/:sessionId/step/:stepNumber',
    validateSession,
    validateStepInput,
    studentController.handleStep
);

// Profile routes
router.get('/profile/:sessionId', validateSession, studentController.getProfile);

// Anonymized Admin routes (must be before general /:id routes)
router.get('/admin/students/anonymized', authenticateToken, studentController.getAnonymizedStudentsList);
router.get('/admin/students/anonymized/:id', authenticateToken, studentController.getAnonymizedStudentById);

// File serving route
router.get('/files/:filename', authenticateToken, studentController.serveStudentFile);

// Admin routes
router.get('/admin/students', authenticateToken, studentController.getStudentsList);
router.get('/admin/stats', authenticateToken, studentController.getStatistics);
router.get('/admin/students/:id', authenticateToken, studentController.getStudentById);


// Utility routes
router.get('/config/steps', (req, res) => {
    const steps = StudentUtils.generateStepConfig();
    res.json({
        success: true,
        steps
    });
});

router.post('/chat/:sessionId/replace-profile',
    validateSession,
    studentController.replaceExistingProfile
);

router.post('/chat/:sessionId/save-profile',
    validateSession,
    studentController.saveProfile
);

// Health check
router.get('/health', async (req, res) => {
    try {
        const { Student } = require('../models');
        const studentCount = await Student.countDocuments();

        res.json({
            success: true,
            service: 'student-profiles',
            status: 'healthy',
            timestamp: new Date().toISOString(),
            stats: {
                totalStudents: studentCount
            }
        });
    } catch (error) {
        res.status(503).json({
            success: false,
            service: 'student-profiles',
            status: 'unhealthy',
            error: error.message
        });
    }
});

module.exports = router;
