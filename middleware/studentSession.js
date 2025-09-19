// middleware/studentSession.js - Fixed session validation and step handling
const { Student } = require('../models/student');
const StudentUtils = require('../utils/studentUtils');
const rateLimit = require('express-rate-limit');

// Create or get session
const createOrGetSession = async (req, res, next) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId) {
            return res.status(400).json(
                StudentUtils.formatErrorResponse('Session ID is required', 400).response
            );
        }

        const student = await Student.findOne({
            'chatProgress.sessionId': sessionId,
            isActive: true
        });

        if (!student) {
            return res.status(404).json(
                StudentUtils.formatErrorResponse('Session not found', 404).response
            );
        }

        req.student = student;
        next();
    } catch (error) {
        console.error('Session middleware error:', error);
        res.status(500).json(
            StudentUtils.formatErrorResponse('Session validation failed', 500).response
        );
    }
};

// Validate session exists and is active - FIXED: Allow same session resume
const validateSession = async (req, res, next) => {
    try {
        const { sessionId } = req.params;

        if (!sessionId) {
            return res.status(400).json(
                StudentUtils.formatErrorResponse('Session ID is required', 400).response
            );
        }

        const student = await Student.findOne({
            'chatProgress.sessionId': sessionId,
            isActive: true
        });

        if (!student) {
            return res.status(404).json(
                StudentUtils.formatErrorResponse('Session not found or expired', 404).response
            );
        }

        // FIXED: Don't check session age for active sessions - allow resume
        // Check if session is too old only if not actively being used
        const sessionAge = Date.now() - student.createdAt.getTime();
        const maxAge = 48 * 60 * 60 * 1000; // 48 hours (increased)

        if (sessionAge > maxAge && !student.chatProgress.completed && !student.lastUpdated) {
            return res.status(410).json(
                StudentUtils.formatErrorResponse('Session expired. Please start a new session.', 410).response
            );
        }

        // Update last accessed time for active sessions
        student.lastAccessed = new Date();
        await student.save();

        req.student = student;
        next();
    } catch (error) {
        console.error('Session validation error:', error);
        res.status(500).json(
            StudentUtils.formatErrorResponse('Session validation failed', 500).response
        );
    }
};

// FIXED: Improved step validation with proper number handling
const validateStepInput = (req, res, next) => {
    try {
        // Check if stepNumber parameter exists in the route
        if (!req.params.stepNumber) {
            console.log('No stepNumber parameter found, skipping step validation');
            return next();
        }

        const stepNumber = parseInt(req.params.stepNumber);

        if (isNaN(stepNumber) || stepNumber < 1 || stepNumber > 18) {
            return res.status(400).json(
                StudentUtils.formatErrorResponse('Invalid step number', 400).response
            );
        }

        // Validate student is on correct step or can advance
        const student = req.student;
        if (stepNumber > student.chatProgress.currentStep + 1) {
            return res.status(409).json(
                StudentUtils.formatErrorResponse(
                    `Cannot skip steps. Current step: ${student.chatProgress.currentStep}`,
                    409
                ).response
            );
        }

        // Validate required fields based on step
        const { response, additionalData } = req.body;

        // FIXED: Allow empty responses for optional steps and textarea fields
        if (!response && stepNumber !== 8 && stepNumber !== 10 && stepNumber !== 13 && stepNumber !== 15) {
            // Steps 8, 10, 13, 15 can be empty (file uploads, textareas, optional fields)
            if (stepNumber !== 14) { // Personal statement can also be empty
                return res.status(400).json(
                    StudentUtils.formatErrorResponse('Response is required', 400).response
                );
            }
        }

        // Step-specific validations
        switch (stepNumber) {
            case 7: // FIXED: GPA validation
                if (response !== null && response !== undefined && response !== '') {
                    const gpa = parseFloat(response);
                    if (isNaN(gpa) || gpa < 0 || gpa > 100) {
                        return res.status(400).json(
                            StudentUtils.formatErrorResponse('GPA must be between 0 and 100', 400).response
                        );
                    }
                }
                break;

            case 11: // Location validation - FIXED: Make it optional
                if (response && response.trim() && response.trim().length > 200) {
                    return res.status(400).json(
                        StudentUtils.formatErrorResponse('Location is too long', 400).response
                    );
                }
                break;

            case 16: // Links validation
                if (additionalData) {
                    for (const [key, url] of Object.entries(additionalData)) {
                        if (url && !StudentUtils.isValidUrl(url)) {
                            return res.status(400).json(
                                StudentUtils.formatErrorResponse(`Invalid ${key} URL format`, 400).response
                            );
                        }
                    }
                }
                break;

            case 14: // Personal statement - optional
            case 15: // Additional info - optional
                // These can be empty, no validation needed
                break;
        }

        req.stepNumber = stepNumber;
        next();
    } catch (error) {
        console.error('Step input validation error:', error);
        res.status(500).json(
            StudentUtils.formatErrorResponse('Input validation failed', 500).response
        );
    }
};

// Spam protection for student chat
const spamProtection = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15, // Increased to 15 requests per windowMs to allow for resume scenarios
    message: {
        success: false,
        error: 'Too many requests. Please wait before trying again.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Use IP + user agent for rate limiting
        return StudentUtils.generateFingerprint(req);
    },
    skip: (req) => {
        // Skip rate limiting for completed sessions
        return req.student?.chatProgress?.completed === true;
    }
});

// File upload validation middleware
const validateFileUpload = (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json(
                StudentUtils.formatErrorResponse('No file uploaded', 400).response
            );
        }

        // Additional file validations
        const allowedMimeTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'image/jpeg',
            'image/png'
        ];

        if (!allowedMimeTypes.includes(req.file.mimetype)) {
            return res.status(400).json(
                StudentUtils.formatErrorResponse('Invalid file type', 400).response
            );
        }

        // File size validation (10MB)
        if (req.file.size > 10 * 1024 * 1024) {
            return res.status(400).json(
                StudentUtils.formatErrorResponse('File too large. Maximum size is 10MB', 400).response
            );
        }

        next();
    } catch (error) {
        console.error('File upload validation error:', error);
        res.status(500).json(
            StudentUtils.formatErrorResponse('File validation failed', 500).response
        );
    }
};

// Session cleanup middleware (for completed or expired sessions)
const sessionCleanup = async (req, res, next) => {
    try {
        // Clean up expired sessions (older than 48 hours) that haven't been accessed recently
        const expiredTime = new Date(Date.now() - 48 * 60 * 60 * 1000);

        await Student.updateMany(
            {
                createdAt: { $lt: expiredTime },
                lastAccessed: { $lt: expiredTime }, // Also check last accessed time
                'chatProgress.completed': false,
                isActive: true
            },
            {
                $set: { isActive: false }
            }
        );

        next();
    } catch (error) {
        console.error('Session cleanup error:', error);
        // Don't fail the request if cleanup fails
        next();
    }
};

module.exports = {
    createOrGetSession,
    validateSession,
    validateStepInput,
    spamProtection,
    validateFileUpload,
    sessionCleanup
};