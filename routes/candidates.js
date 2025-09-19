// routes/candidates.js - Candidates Routes
const express = require('express');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const { Candidate, UploadLimit } = require('../models');
const { authenticateToken } = require('../middleware/auth');
const { enhancedSpamDetection } = require('../middleware/spamDetection');
const { uploadLimiter, submitLimiter, strictLimiter, generalLimiter } = require('../middleware/rateLimiting');
const { validateApiKey } = require('../middleware/auth');
const { uploadMiddleware, validateFileUpload } = require('../services/fileUploadService');
const { parseCV } = require('../services/cvParsingService');
const emailService = require('../services/emailService');

const router = express.Router();

// Enhanced candidate data validation
const validateCandidateData = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Name must be between 2-100 characters')
        .matches(/^[\u0590-\u05FFa-zA-Z\s\-\.\']+$/)
        .withMessage('Name contains invalid characters')
        .custom((value) => {
            const words = value.split(/\s+/);
            if (words.length < 2 || words.length > 4) {
                throw new Error('Name must contain 2-4 words');
            }
            return true;
        }),

    body('email')
        .isEmail()
        .withMessage('Invalid email format')
        .normalizeEmail()
        .isLength({ max: 255 })
        .withMessage('Email too long')
        .custom((value) => {
            const [local, domain] = value.split('@');
            if (local.length > 64 || domain.length > 253) {
                throw new Error('Email format invalid');
            }
            return true;
        }),

    body('phone')
        .trim()
        .matches(/^[\d\-\s\+\(\)]+$/)
        .withMessage('Invalid phone number format')
        .isLength({ min: 9, max: 20 })
        .withMessage('Phone number length invalid')
        .custom((value) => {
            const cleaned = value.replace(/[^\d]/g, '');
            if (cleaned.length < 9 || cleaned.length > 15) {
                throw new Error('Phone number invalid');
            }
            return true;
        }),

    body('positions')
        .isArray({ min: 1, max: 4 })
        .withMessage('Must select 1-4 positions'),

    body('positions.*.title')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Position title must be between 2-100 characters')
];

// Enhanced position category mapping
function getPositionCategory(position) {
    if (!position || typeof position !== 'string') {
        return 'אחר';
    }

    const categories = {
        'מחשבים': [
            'מפתח', 'developer', 'engineer', 'programmer', 'בודק', 'tester', 'qa',
            'devops', 'מנהל מערכות', 'system', 'network', 'database', 'data',
            'software', 'תוכנה', 'web', 'mobile', 'app', 'frontend', 'backend',
            'fullstack', 'architect', 'אדריכל', 'technical', 'טכני', 'it support'
        ],
        'בכירים': [
            'מנהל בכיר', 'מנכ"ל', 'סמנכ"ל', 'ceo', 'cto', 'cfo', 'coo', 'vp',
            'vice president', 'director', 'מנהל כללי', 'ראש', 'head', 'chief',
            'executive', 'president', 'senior manager', 'מנהל אזורי'
        ],
        'מכירות/שיווק': [
            'מכירות', 'sales', 'שיווק', 'marketing', 'נציג', 'representative',
            'account', 'business development', 'לקוחות', 'customer', 'קמפיין',
            'campaign', 'דיגיטלי', 'digital', 'מנהל מכירות', 'מנהל שיווק'
        ]
    };

    const positionLower = position.toLowerCase();

    for (const [category, keywords] of Object.entries(categories)) {
        if (keywords.some(keyword => positionLower.includes(keyword.toLowerCase()))) {
            return category;
        }
    }

    return 'אחר';
}

// CV parsing endpoint
router.post('/parse-cv',
    validateApiKey,
    uploadLimiter,
    uploadMiddleware,
    validateFileUpload,
    enhancedSpamDetection,
    async (req, res) => {
        try {
            const startTime = Date.now();

            if (!req.file) {
                return res.status(400).json({ error: 'No file uploaded' });
            }

            // Parse CV with enhanced algorithm
            const cvData = await parseCV(req.file, req.file.originalname);


            // Add metadata
            cvData.metadata = {
                filename: req.file.originalname,
                filesize: req.file.size,
                textLength: req.file.textLength,
                processingTime: Date.now() - startTime + 'ms',
                method: cvData.method,
                confidence: cvData.confidence,
                detectionScore: cvData.overall_confidence || 0
            };

            // Update spam record with success
            if (req.spamRecord && cvData.email) {
                if (!req.spamRecord.emails.includes(cvData.email)) {
                    req.spamRecord.emails.push(cvData.email);
                }
                if (cvData.phone && !req.spamRecord.phones.includes(cvData.phone)) {
                    req.spamRecord.phones.push(cvData.phone);
                }
                await req.spamRecord.save();
            }

            res.json({
                success: true,
                data: cvData
            });

        } catch (error) {
            console.error('CV parsing error:', error);

            // Update spam record with failure
            if (req.spamRecord) {
                req.spamRecord.suspiciousActivity.push({
                    type: 'invalid_file',
                    details: error.message
                });
                req.spamRecord.riskScore = Math.min(10, req.spamRecord.riskScore + 1);
                await req.spamRecord.save();
            }

            res.status(500).json({
                error: 'CV processing failed',
                details: process.env.NODE_ENV === 'development' ? 
                    error.message : 'Please try again with a different file'
            });
        }
    }
);

async function checkAndUpdateUploadLimit(cvData, req) {
    if (!cvData.phone) return;

    const cleanPhone = cvData.phone.replace(/[^\d]/g, '');
    const now = new Date();
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    let uploadRecord = await UploadLimit.findOne({ phone: cleanPhone });

    // Weekly limit
    if (uploadRecord?.lastUpload >= oneWeekAgo && !req.hasValidApiKey) {
        const daysSinceUpload = Math.ceil((now - uploadRecord.lastUpload) / (1000 * 60 * 60 * 24));
        throw {
            status: 429,
            error: 'CV upload limit reached',
            message: `You can only upload a CV once per week. Last upload was ${daysSinceUpload} days ago.`,
            nextAllowedUpload: new Date(uploadRecord.lastUpload.getTime() + 7 * 24 * 60 * 60 * 1000)
        };
    }

    // Daily limit
    if (uploadRecord) {
        if (uploadRecord.lastDailyReset < oneDayAgo) {
            uploadRecord.dailyCount = 0;
            uploadRecord.lastDailyReset = now;
        }
        if (uploadRecord.dailyCount >= 3 && !req.hasValidApiKey) {
            throw {
                status: 429,
                error: 'Daily upload limit exceeded',
                message: 'Maximum 3 uploads per day allowed'
            };
        }

        uploadRecord.lastUpload = now;
        uploadRecord.uploadCount += 1;
        uploadRecord.dailyCount += 1;
        await uploadRecord.save();
    } else {
        await UploadLimit.create({
            phone: cleanPhone,
            email: cvData.email || '',
            lastUpload: now,
            uploadCount: 1,
            dailyCount: 1,
            lastDailyReset: now
        });
    }
}

// Submit candidate endpoint
router.post('/submit',
    validateApiKey,
    submitLimiter,
    enhancedSpamDetection,
    validateCandidateData,

    async (req, res) => {
        try {

            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { name, email, phone, positions, location } = req.body;
            const clientIP = req.ip || req.connection.remoteAddress;
            const userAgent = req.get('User-Agent') || '';

            const cvData = {
                phone: req.body.phone,
                email: req.body.email || ''
            };

            // Apply upload limits
            try {
                await checkAndUpdateUploadLimit(cvData, req);
            } catch (limitError) {
                return res.status(limitError.status).json(limitError);
            }

            // Create browser fingerprint
            const fingerprint = crypto.createHash('sha256')
                .update(clientIP + userAgent + (req.headers['accept-language'] || ''))
                .digest('hex');

            // Enhanced duplicate checking
            const duplicateChecks = [
                { email: email },
                { phone: { $regex: phone.replace(/[^\d]/g, '') } },
                { 
                    fingerprint: fingerprint, 
                    submissionDate: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } 
                }
            ];

            const existingCandidate = await Candidate.findOne({ $or: duplicateChecks });

            if (existingCandidate && !req.hasValidApiKey) {
                let duplicateType = 'unknown';
                if (existingCandidate.email === email) duplicateType = 'email';
                else if (existingCandidate.phone.replace(/[^\d]/g, '') === phone.replace(/[^\d]/g, '')) duplicateType = 'phone';
                else if (existingCandidate.fingerprint === fingerprint) duplicateType = 'device';

                return res.status(409).json({
                    error: 'Duplicate candidate detected',
                    type: duplicateType,
                    existingId: existingCandidate._id
                });
            }

            // Weekly submission limit per phone
            const cleanPhone = phone.replace(/[^\d]/g, '');
            const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

            const recentSubmission = await Candidate.findOne({
                phone: { $regex: cleanPhone },
                submissionDate: { $gte: oneWeekAgo }
            });

            if (recentSubmission && !req.hasValidApiKey) {
                const daysRemaining = Math.ceil((recentSubmission.submissionDate.getTime() + 7 * 24 * 60 * 60 * 1000 - Date.now()) / (1000 * 60 * 60 * 24));
                return res.status(429).json({
                    error: 'Submission limit exceeded',
                    message: `You can only submit once per week. Please wait ${daysRemaining} more days.`,
                    nextAllowedSubmission: new Date(recentSubmission.submissionDate.getTime() + 7 * 24 * 60 * 60 * 1000)
                });
            }

            // Process positions with enhanced categorization
            const processedPositions = positions.map(pos => {
                const title = pos.title || pos;
                return {
                    title: title,
                    category: getPositionCategory(title),
                    experience: pos.experience || '',
                    skills: pos.skills || []
                };
            });

            // Create candidate
            const candidate = new Candidate({
                name,
                email,
                phone,
                positions: processedPositions,
                ipAddress: clientIP,
                location: location || '',
                userAgent: userAgent.substring(0, 500),
                fingerprint,
                metadata: {
                    ...req.body.metadata,
                    submissionMethod: req.hasValidApiKey ? 'api' : 'web',
                    detectionScore: req.body.detectionScore || 0
                },
                source: req.body.source || 'upload'
            });

            const savedCandidate = await candidate.save();
            try {
                const cvDistributionService = require('../services/cvDistributionService');
                await cvDistributionService.distributeCVToAgencies(savedCandidate);
                console.log('CV distributed to agencies for candidate:', savedCandidate._id);
            } catch (distributionError) {
                console.error('CV distribution failed:', distributionError);
                // Don't fail the main request - log error for monitoring
            }

            // Send confirmation email
            try {
                await emailService.sendConfirmationEmail(savedCandidate);
                console.log('Confirmation email sent to:', savedCandidate.email);
            } catch (emailError) {
                console.error('Failed to send confirmation email:', emailError);
            }

            // Distribute CV to recruitment agencies
            try {
                const cvDistributionService = require('../services/cvDistributionService');
                await cvDistributionService.distributeCVToAgencies(savedCandidate);
                console.log('CV distributed to agencies for candidate:', savedCandidate._id);
            } catch (distributionError) {
                console.error('CV distribution failed:', distributionError);
                // Don't fail the main request - log error for monitoring
            }


            // Update spam record with successful submission
            if (req.spamRecord) {
                if (!req.spamRecord.emails.includes(email)) {
                    req.spamRecord.emails.push(email);
                }
                if (!req.spamRecord.phones.includes(phone)) {
                    req.spamRecord.phones.push(phone);
                }
                req.spamRecord.riskScore = Math.max(0, req.spamRecord.riskScore - 0.5);
                await req.spamRecord.save();
            }

            console.log('Candidate saved successfully:', savedCandidate._id);

            res.status(201).json({
                success: true,
                message: 'Candidate submitted successfully',
                candidateId: savedCandidate._id,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error saving candidate:', error);

            // Update spam record with failure
            if (req.spamRecord) {
                req.spamRecord.suspiciousActivity.push({
                    type: 'submission_error',
                    details: error.message.substring(0, 500)
                });
                req.spamRecord.riskScore = Math.min(10, req.spamRecord.riskScore + 0.5);
                await req.spamRecord.save();
            }

            if (error.code === 11000) {
                return res.status(409).json({
                    error: 'Duplicate candidate - already exists in system'
                });
            }

            res.status(500).json({
                error: 'Failed to save candidate',
                details: process.env.NODE_ENV === 'development' ? 
                    error.message : 'Please try again'
            });
        }
    }
);

// Search candidates endpoint
router.get('/search',
    authenticateToken,
    strictLimiter,
    async (req, res) => {
        try {
            const {
                name, email, phone, position, category,
                page = 1, limit = 20, sortBy = 'submissionDate', sortOrder = 'desc',
                dateFrom, dateTo, verified
            } = req.query;

            // Validate pagination
            const pageNum = Math.max(1, parseInt(page));
            const limitNum = Math.min(100, Math.max(1, parseInt(limit)));

            // Build search query
            const searchQuery = {};

            if (name) {
                searchQuery.name = {
                    $regex: name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                    $options: 'i'
                };
            }

            if (email) {
                searchQuery.email = {
                    $regex: email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                    $options: 'i'
                };
            }

            if (phone) {
                const cleanPhone = phone.replace(/[^\d]/g, '');
                searchQuery.phone = { $regex: cleanPhone };
            }

            if (position) {
                searchQuery['positions.title'] = {
                    $regex: position.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                    $options: 'i'
                };
            }

            if (category && ['מחשבים', 'בכירים', 'מכירות/שיווק', 'אחר'].includes(category)) {
                searchQuery['positions.category'] = category;
            }

            if (dateFrom || dateTo) {
                searchQuery.submissionDate = {};
                if (dateFrom) searchQuery.submissionDate.$gte = new Date(dateFrom);
                if (dateTo) searchQuery.submissionDate.$lte = new Date(dateTo);
            }

            if (verified !== undefined) {
                searchQuery.verified = verified === 'true';
            }

            // Validate sort parameters
            const allowedSortFields = ['name', 'email', 'phone', 'submissionDate', 'verified'];
            const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'submissionDate';
            const validSortOrder = ['asc', 'desc'].includes(sortOrder) ? sortOrder : 'desc';

            const skip = (pageNum - 1) * limitNum;
            const sortOptions = {};
            sortOptions[validSortBy] = validSortOrder === 'desc' ? -1 : 1;

            // Execute search
            const [candidates, total] = await Promise.all([
                Candidate.find(searchQuery)
                    .select('-userAgent -fingerprint -metadata.confidence -ipAddress')
                    .sort(sortOptions)
                    .skip(skip)
                    .limit(limitNum)
                    .lean(),
                Candidate.countDocuments(searchQuery)
            ]);

            res.json({
                success: true,
                candidates,
                pagination: {
                    current: pageNum,
                    total: Math.ceil(total / limitNum),
                    count: candidates.length,
                    totalCandidates: total,
                    hasNext: skip + limitNum < total,
                    hasPrev: pageNum > 1
                }
            });

        } catch (error) {
            console.error('Search error:', error);
            res.status(500).json({
                error: 'Search failed',
                details: process.env.NODE_ENV === 'development' ? error.message : 'Please try again'
            });
        }
    }
);


// Get statistics
router.get('/statistics',
    authenticateToken,
    generalLimiter,
    async (req, res) => {
        try {
            const { days = 30 } = req.query;
            const daysNum = Math.min(365, Math.max(1, parseInt(days)));

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - daysNum);

            const [
                totalCandidates,
                recentCandidates,
                todayCandidates,
                positionStats,
                categoryStats,
                dailyStats
            ] = await Promise.all([
                Candidate.countDocuments(),
                Candidate.countDocuments({
                    submissionDate: { $gte: startDate }
                }),
                Candidate.countDocuments({
                    submissionDate: {
                        $gte: new Date(new Date().setHours(0, 0, 0, 0))
                    }
                }),
                Candidate.aggregate([
                    { $match: { submissionDate: { $gte: startDate } } },
                    { $unwind: '$positions' },
                    { $group: { _id: '$positions.title', count: { $sum: 1 } } },
                    { $sort: { count: -1 } },
                    { $limit: 15 }
                ]),
                Candidate.aggregate([
                    { $match: { submissionDate: { $gte: startDate } } },
                    { $unwind: '$positions' },
                    { $group: { _id: '$positions.category', count: { $sum: 1 } } },
                    { $sort: { count: -1 } }
                ]),
                Candidate.aggregate([
                    { $match: { submissionDate: { $gte: startDate } } },
                    {
                        $group: {
                            _id: { $dateToString: { format: "%Y-%m-%d", date: "$submissionDate" } },
                            count: { $sum: 1 }
                        }
                    },
                    { $sort: { _id: 1 } },
                    { $limit: daysNum }
                ])
            ]);

            // Calculate growth rate
            const previousPeriodStart = new Date(startDate);
            previousPeriodStart.setDate(previousPeriodStart.getDate() - daysNum);

            const previousCandidates = await Candidate.countDocuments({
                submissionDate: {
                    $gte: previousPeriodStart,
                    $lt: startDate
                }
            });

            const growthRate = previousCandidates > 0
                ? ((recentCandidates - previousCandidates) / previousCandidates * 100).toFixed(1)
                : 'N/A';

            res.json({
                success: true,
                period: `${daysNum} days`,
                summary: {
                    totalCandidates,
                    recentCandidates,
                    todayCandidates,
                    growthRate: growthRate + '%',
                    avgPerDay: (recentCandidates / daysNum).toFixed(1)
                },
                charts: {
                    topPositions: positionStats,
                    categoryDistribution: categoryStats,
                    dailySubmissions: dailyStats
                }
            });

        } catch (error) {
            console.error('Statistics error:', error);
            res.status(500).json({
                error: 'Failed to load statistics',
                details: process.env.NODE_ENV === 'development' ? 
                    error.message : 'Please try again'
            });
        }
    }
);

module.exports = router;