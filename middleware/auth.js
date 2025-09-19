// middleware/auth.js - Enhanced Authentication Middleware with Access Control
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config/security');
const { User, Subscription } = require('../models');
const { addFeatureAccessInfo } = require('./accessControl');

// Authentication middleware
const authenticateToken = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1] || req.session.token;

    if (!token) {
        return res.status(401).json({
            error: 'Access denied - no token provided',
            code: 'NO_TOKEN'
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);

        // Check token age for inactivity timeout
        const tokenAge = Math.floor(Date.now() / 1000) - decoded.iat;
        if (tokenAge > 1800) { // 30 minutes
            return res.status(401).json({
                error: 'Token expired due to inactivity',
                code: 'TOKEN_EXPIRED'
            });
        }

        const user = await User.findById(decoded.userId)
            .select('-password')
            .populate('companyId')
            .where('isActive').equals(true);

        if (!user || !user.companyId || !user.companyId.isActive) {
            return res.status(401).json({
                error: 'User or company not found or inactive',
                code: 'USER_INACTIVE'
            });
        }

        req.user = user;
        req.company = user.companyId;

        // Add feature access information
        await addFeatureAccessInfo(req, res, next);

    } catch (error) {
        console.error('Token verification error:', error);
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Token expired',
                code: 'TOKEN_EXPIRED'
            });
        }
        return res.status(403).json({
            error: 'Invalid token',
            code: 'INVALID_TOKEN'
        });
    }
};

// Validate subscription middleware with detailed info
const validateSubscription = async (req, res, next) => {
    try {
        const subscription = await Subscription.findOne({
            companyId: user.companyId._id,
            status: 'active',
            expiresAt: { $gt: new Date() } // CORRECTED: Changed 'expirationDate' to 'expiresAt'
        });


        if (!subscription) {
            // Get available subscriptions for this company type
            const isRecruitmentAgency = req.company.isRecruitmentAgency &&
                req.company.isRecruitmentAccess === 'approved';

            return res.status(402).json({
                error: 'Subscription expired or inactive',
                code: 'SUBSCRIPTION_REQUIRED',
                details: {
                    companyType: isRecruitmentAgency ? 'recruitment_agency' : 'regular',
                    requiresRecruitmentApproval: !isRecruitmentAgency && req.company.isRecruitmentAgency
                },
                redirectTo: '/pricing'
            });
        }

        // Check if subscription is expiring soon (within 7 days)
        const daysLeft = Math.ceil((subscription.expirationDate - new Date()) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 7) {
            req.subscriptionWarning = {
                message: `המנוי שלכם יפוג בעוד ${daysLeft} ימים`,
                daysLeft,
                urgent: daysLeft <= 3
            };
        }

        req.subscription = subscription;
        next();
    } catch (error) {
        console.error('Subscription validation error:', error);
        res.status(500).json({
            error: 'Subscription validation failed',
            code: 'SUBSCRIPTION_CHECK_ERROR'
        });
    }
};

// Enhanced permission middleware with detailed error responses
const requirePermission = (resource, action) => {
    return (req, res, next) => {
        if (!req.user.permissions) {
            return res.status(403).json({
                error: 'No permissions defined',
                code: 'NO_PERMISSIONS',
                required: { resource, action }
            });
        }

        const permission = req.user.permissions.find(p => p.resource === resource);
        if (!permission || !permission.actions.includes(action)) {
            return res.status(403).json({
                error: `Permission denied - ${action} on ${resource}`,
                code: 'INSUFFICIENT_PERMISSIONS',
                required: { resource, action },
                userPermissions: req.user.permissions.map(p => ({
                    resource: p.resource,
                    actions: p.actions
                }))
            });
        }

        next();
    };
};

// Admin middleware with role checking
const requireAdmin = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }

    if (req.user.role !== 'admin' && req.user.position !== 'owner') {
        return res.status(403).json({
            error: 'Admin access required',
            code: 'ADMIN_REQUIRED',
            userRole: req.user.role,
            userPosition: req.user.position
        });
    }
    next();
};

// Company owner middleware
const requireOwner = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }

    if (req.user.position !== 'owner') {
        return res.status(403).json({
            error: 'Company owner access required',
            code: 'OWNER_REQUIRED',
            userPosition: req.user.position
        });
    }
    next();
};

// API key validation with enhanced security
const validateApiKey = (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    const userAgent = req.headers['user-agent'];
    const ip = req.ip || req.connection.remoteAddress;

    if (apiKey) {
        const validKeys = process.env.BYPASS_API_KEYS ?
            process.env.BYPASS_API_KEYS.split(',').map(key => key.trim()) : [];

        if (validKeys.includes(apiKey)) {
            // Log API key usage for security monitoring
            console.log(`API Key used: ${apiKey.substring(0, 8)}... from IP: ${ip}, UA: ${userAgent?.substring(0, 100)}`);
            req.hasValidApiKey = true;
            req.apiKeyUsed = apiKey.substring(0, 8);
            return next();
        } else {
            console.warn(`Invalid API key attempted: ${apiKey.substring(0, 8)}... from IP: ${ip}`);
        }
    }

    req.hasValidApiKey = false;
    next();
};

// Recruitment agency access middleware
const requireRecruitmentAgency = (req, res, next) => {
    if (!req.user || !req.company) {
        return res.status(401).json({
            error: 'Authentication required',
            code: 'AUTH_REQUIRED'
        });
    }

    if (!req.company.isRecruitmentAgency) {
        return res.status(403).json({
            error: 'Recruitment agency access required',
            code: 'RECRUITMENT_AGENCY_REQUIRED',
            details: {
                message: 'תכונה זו זמינה רק לחברות השמה',
                companyType: 'regular',
                requiresUpgrade: true
            },
            redirectTo: '/pricing'
        });
    }

    if (req.company.isRecruitmentAccess !== 'approved') {
        const statusMessages = {
            'pending': 'בקשתכם לאישור חברת השמה עדיין בבדיקה',
            'denied': 'בקשתכם לאישור חברת השמה נדחתה'
        };

        return res.status(403).json({
            error: 'Recruitment agency approval required',
            code: 'RECRUITMENT_APPROVAL_REQUIRED',
            details: {
                message: statusMessages[req.company.isRecruitmentAccess] || 'נדרש אישור חברת השמה',
                approvalStatus: req.company.isRecruitmentAccess,
                contactSupport: true
            }
        });
    }

    next();
};

// Activity logging middleware
const logActivity = (activityType) => {
    return (req, res, next) => {
        if (req.user) {
            // Log user activity for security and analytics
            console.log(`Activity: ${activityType} | User: ${req.user._id} | Company: ${req.company._id} | IP: ${req.ip} | Time: ${new Date().toISOString()}`);

            // You can expand this to write to a database for audit trails
            req.activityLogged = {
                type: activityType,
                timestamp: new Date(),
                userId: req.user._id,
                companyId: req.company._id,
                ip: req.ip,
                userAgent: req.headers['user-agent']
            };
        }
        next();
    };
};

module.exports = {
    authenticateToken,
    validateSubscription,
    requirePermission,
    requireAdmin,
    requireOwner,
    validateApiKey,
    requireRecruitmentAgency,
    logActivity
};