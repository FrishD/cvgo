// routes/secureStudentData.js - Ultra-secure student data endpoints
const express = require('express');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const { Student } = require('../models');

const router = express.Router();

// Ultra-secure authentication middleware
const ultraSecureAuth = (req, res, next) => {
    const serverSecret = process.env.ULTRA_SECURE_SERVER_SECRET || 'your-ultra-secure-server-secret-key-2025';
    const timestamp = req.headers['x-timestamp'];
    const signature = req.headers['x-signature'];
    const serverToken = req.headers['x-server-token'];

    // Validate timestamp (request must be within 30 seconds)
    const currentTime = Math.floor(Date.now() / 1000);
    const requestTime = parseInt(timestamp);

    if (!timestamp || !signature || !serverToken) {
        return res.status(401).json({ error: 'Missing security headers' });
    }

    if (Math.abs(currentTime - requestTime) > 30) {
        return res.status(401).json({ error: 'Request timestamp expired' });
    }

    // Validate server token
    const expectedToken = crypto
        .createHmac('sha256', serverSecret)
        .update(`internal-server-development`) // קבוע במקום משתנה
        .digest('hex');

    if (serverToken !== expectedToken) {
        return res.status(401).json({ error: 'Invalid server token' });
    }

    // Validate signature
    const payload = `${timestamp}:${req.method}:${req.originalUrl}`;
    const expectedSignature = crypto
        .createHmac('sha256', serverSecret)
        .update(payload)
        .digest('hex');

    if (signature !== expectedSignature) {
        return res.status(401).json({ error: 'Invalid request signature' });
    }

    next();
};

// Helper function to encrypt sensitive data
const encryptSensitiveData = (text) => {
    if (!text || typeof text !== 'string') return text;

    // Replace phone numbers (Israeli format)
    text = text.replace(/0[5-9]\d{8}/g, '&*******&');
    text = text.replace(/\+972[5-9]\d{8}/g, '&*******&');

    // Replace email addresses
    text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '&*******&');

    // Replace names (Hebrew and English patterns)
    text = text.replace(/\b[\u0590-\u05FF]{2,}\s+[\u0590-\u05FF]{2,}\b/g, '&*******&');
    text = text.replace(/\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/g, '&*******&');

    // Replace numbers (but keep years like 2023, 2024)
    text = text.replace(/\b(?!20[0-9]{2}\b)\d{2,}\b/g, '&*******&');

    return text;
};

// 1. Unencrypted Data Endpoint - Full student data with files
router.get('/unencrypted/:studentId', ultraSecureAuth, async (req, res) => {
    try {
        const { studentId } = req.params;

        if (!studentId.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ error: 'Invalid student ID format' });
        }

        const student = await Student.findById(studentId);

        if (!student || !student.isActive) {
            return res.status(404).json({ error: 'Student not found or inactive' });
        }

        // Prepare file data
        const fileData = {};

        // Get CV file if exists
        if (student.cvFile?.path) {
            try {
                const cvPath = path.resolve(student.cvFile.path);
                const cvExists = await fs.access(cvPath).then(() => true).catch(() => false);

                if (cvExists) {
                    const cvBuffer = await fs.readFile(cvPath);
                    fileData.cv = {
                        filename: student.cvFile.filename,
                        data: cvBuffer.toString('base64'),
                        uploadDate: student.cvFile.uploadDate,
                        size: cvBuffer.length
                    };
                }
            } catch (error) {
                console.error('Error reading CV file:', error);
                fileData.cv = { error: 'File not accessible' };
            }
        }

        // Get transcript file if exists
        if (student.education?.transcriptFile?.path) {
            try {
                const transcriptPath = path.resolve(student.education.transcriptFile.path);
                const transcriptExists = await fs.access(transcriptPath).then(() => true).catch(() => false);

                if (transcriptExists) {
                    const transcriptBuffer = await fs.readFile(transcriptPath);
                    fileData.transcript = {
                        filename: student.education.transcriptFile.filename,
                        data: transcriptBuffer.toString('base64'),
                        uploadDate: student.education.transcriptFile.uploadDate,
                        size: transcriptBuffer.length
                    };
                }
            } catch (error) {
                console.error('Error reading transcript file:', error);
                fileData.transcript = { error: 'File not accessible' };
            }
        }

        res.json({
            success: true,
            data: {
                student: student.toObject(),
                files: fileData,
                metadata: {
                    retrievedAt: new Date().toISOString(),
                    completionPercentage: student.completionPercentage,
                    profileStatus: student.profileComplete ? 'complete' : 'incomplete'
                }
            }
        });

    } catch (error) {
        console.error('Unencrypted endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// 2. Encrypted Data Endpoint - Partial data with sensitive information masked
router.get('/encrypted/:studentId', ultraSecureAuth, async (req, res) => {
    try {
        const { studentId } = req.params;

        if (!studentId.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ error: 'Invalid student ID format' });
        }

        const student = await Student.findById(studentId);

        if (!student || !student.isActive) {
            return res.status(404).json({ error: 'Student not found or inactive' });
        }

        // Extract only required fields
        const encryptedData = {
            _id: student._id,
            education: {
                currentDegree: student.education?.currentDegree,
                studyYear: student.education?.studyYear,
                degreeField: student.education?.degreeField,
                institution: student.education?.institution,
                gpa: student.education?.gpa
            },
            workExperience: {
                hasExperience: student.workExperience?.hasExperience
            },
            location: {
                city: student.location?.city,
                flexible: student.location?.flexible
            },
            availability: {
                hoursPerWeek: student.availability?.hoursPerWeek,
                flexibleHours: student.availability?.flexibleHours
            },
            personalStatement: encryptSensitiveData(student.personalStatement),
            additionalInfo: encryptSensitiveData(student.additionalInfo),
            lastUpdated: student.lastUpdated,
            createdAt: student.createdAt,
            metadata: {
                encryptedAt: new Date().toISOString(),
                completionPercentage: student.completionPercentage,
                profileStatus: student.profileComplete ? 'complete' : 'incomplete',
                dataType: 'encrypted'
            }
        };

        res.json({
            success: true,
            data: encryptedData
        });

    } catch (error) {
        console.error('Encrypted endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Batch endpoints for multiple students
router.post('/unencrypted/batch', ultraSecureAuth, async (req, res) => {
    try {
        const { studentIds } = req.body;

        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return res.status(400).json({ error: 'Invalid student IDs array' });
        }

        if (studentIds.length > 50) {
            return res.status(400).json({ error: 'Too many students requested (max 50)' });
        }

        const validIds = studentIds.filter(id => id.match(/^[0-9a-fA-F]{24}$/));

        const students = await Student.find({
            _id: { $in: validIds },
            isActive: true
        });

        const results = [];

        for (const student of students) {
            const studentData = {
                student: student.toObject(),
                files: {},
                metadata: {
                    retrievedAt: new Date().toISOString(),
                    completionPercentage: student.completionPercentage
                }
            };

            // Add file data if exists (simplified for batch)
            if (student.cvFile?.filename) {
                studentData.files.cv = {
                    filename: student.cvFile.filename,
                    uploadDate: student.cvFile.uploadDate,
                    hasFile: true
                };
            }

            if (student.education?.transcriptFile?.filename) {
                studentData.files.transcript = {
                    filename: student.education.transcriptFile.filename,
                    uploadDate: student.education.transcriptFile.uploadDate,
                    hasFile: true
                };
            }

            results.push(studentData);
        }

        res.json({
            success: true,
            count: results.length,
            data: results
        });

    } catch (error) {
        console.error('Batch unencrypted endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.post('/encrypted/batch', ultraSecureAuth, async (req, res) => {
    try {
        const { studentIds } = req.body;

        if (!Array.isArray(studentIds) || studentIds.length === 0) {
            return res.status(400).json({ error: 'Invalid student IDs array' });
        }

        if (studentIds.length > 100) {
            return res.status(400).json({ error: 'Too many students requested (max 100)' });
        }

        const validIds = studentIds.filter(id => id.match(/^[0-9a-fA-F]{24}$/));

        const students = await Student.find({
            _id: { $in: validIds },
            isActive: true
        });

        const results = students.map(student => ({
            _id: student._id,
            education: {
                currentDegree: student.education?.currentDegree,
                studyYear: student.education?.studyYear,
                degreeField: student.education?.degreeField,
                institution: student.education?.institution,
                gpa: student.education?.gpa
            },
            workExperience: {
                hasExperience: student.workExperience?.hasExperience
            },
            location: {
                city: student.location?.city,
                flexible: student.location?.flexible
            },
            availability: {
                hoursPerWeek: student.availability?.hoursPerWeek,
                flexibleHours: student.availability?.flexibleHours
            },
            personalStatement: encryptSensitiveData(student.personalStatement),
            additionalInfo: encryptSensitiveData(student.additionalInfo),
            lastUpdated: student.lastUpdated,
            createdAt: student.createdAt,
            metadata: {
                encryptedAt: new Date().toISOString(),
                completionPercentage: student.completionPercentage,
                profileStatus: student.profileComplete ? 'complete' : 'incomplete',
                dataType: 'encrypted'
            }
        }));

        res.json({
            success: true,
            count: results.length,
            data: results
        });

    } catch (error) {
        console.error('Batch encrypted endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// All Students Data Endpoint - Complete unencrypted data for all students
router.get('/all-unencrypted', ultraSecureAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 100;
        const skip = (page - 1) * limit;

        // Count total students
        const totalStudents = await Student.countDocuments({ isActive: true });

        // Get students with pagination, sorted by creation date (newest first)
        const students = await Student.find({ isActive: true })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const results = [];

        for (const student of students) {
            const studentData = {
                _id: student._id,
                student: student.toObject(),
                files: {},
                metadata: {
                    retrievedAt: new Date().toISOString(),
                    completionPercentage: student.completionPercentage,
                    profileStatus: student.profileComplete ? 'complete' : 'incomplete'
                }
            };

            // Get CV file data if exists
            if (student.cvFile?.path) {
                try {
                    const cvPath = path.resolve(student.cvFile.path);
                    const cvExists = await fs.access(cvPath).then(() => true).catch(() => false);

                    if (cvExists) {
                        const cvBuffer = await fs.readFile(cvPath);
                        studentData.files.cv = {
                            filename: student.cvFile.filename,
                            data: cvBuffer.toString('base64'),
                            uploadDate: student.cvFile.uploadDate,
                            size: cvBuffer.length
                        };
                    }
                } catch (error) {
                    studentData.files.cv = { error: 'File not accessible' };
                }
            }

            // Get transcript file data if exists
            if (student.education?.transcriptFile?.path) {
                try {
                    const transcriptPath = path.resolve(student.education.transcriptFile.path);
                    const transcriptExists = await fs.access(transcriptPath).then(() => true).catch(() => false);

                    if (transcriptExists) {
                        const transcriptBuffer = await fs.readFile(transcriptPath);
                        studentData.files.transcript = {
                            filename: student.education.transcriptFile.filename,
                            data: transcriptBuffer.toString('base64'),
                            uploadDate: student.education.transcriptFile.uploadDate,
                            size: transcriptBuffer.length
                        };
                    }
                } catch (error) {
                    studentData.files.transcript = { error: 'File not accessible' };
                }
            }

            results.push(studentData);
        }

        res.json({
            success: true,
            pagination: {
                currentPage: page,
                totalPages: Math.ceil(totalStudents / limit),
                totalStudents,
                studentsPerPage: limit,
                hasNextPage: page < Math.ceil(totalStudents / limit),
                hasPrevPage: page > 1
            },
            count: results.length,
            data: results
        });

    } catch (error) {
        console.error('All students unencrypted endpoint error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Security test endpoint (for development only)
router.get('/security-test', (req, res) => {
    if (process.env.NODE_ENV === 'production') {
        return res.status(404).json({ error: 'Not found' });
    }

    const serverSecret = process.env.ULTRA_SECURE_SERVER_SECRET || 'your-ultra-secure-server-secret-key-2025';
    const timestamp = Math.floor(Date.now() / 1000);
    const method = 'GET';
    const url = '/api/secure-students/security-test';

    const payload = `${timestamp}:${method}:${url}`;
    const signature = crypto
        .createHmac('sha256', serverSecret)
        .update(payload)
        .digest('hex');

    const serverToken = crypto
        .createHmac('sha256', serverSecret)
        .update(`internal-server-${process.env.NODE_ENV || 'development'}`)
        .digest('hex');

    res.json({
        success: true,
        message: 'Security test - use these headers for authenticated requests',
        headers: {
            'x-timestamp': timestamp.toString(),
            'x-signature': signature,
            'x-server-token': serverToken
        },
        examples: {
            allStudents: `curl -X GET "http://localhost:3000/api/secure-students/all-unencrypted?page=1&limit=50" -H "x-timestamp: ${timestamp}" -H "x-signature: ${signature}" -H "x-server-token: ${serverToken}"`,
            singleStudent: `curl -X GET "http://localhost:3000/api/secure-students/unencrypted/[STUDENT_ID]" -H "x-timestamp: ${timestamp}" -H "x-signature: ${signature}" -H "x-server-token: ${serverToken}"`
        }
    });
});

module.exports = router;