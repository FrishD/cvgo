// routes/features.js - Feature Access & Subscription Routes
const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const {
    requireFeatureAccess,
    checkFeatureAccess,
    getUserAccessibleFeatures,
    getAvailableFeatures,
    addFeatureAccessInfo
} = require('../middleware/accessControl');
const { body, validationResult } = require('express-validator');
const router = express.Router();

// Add feature access info to all requests
router.use(authenticateToken, addFeatureAccessInfo);

// Get user's feature access status
router.get('/access-status', async (req, res) => {
    try {
        res.json({
            success: true,
            accessibleFeatures: req.accessibleFeatures || [],
            availableFeatures: req.availableFeatures || {},
            isRecruitmentAgency: req.isApprovedRecruitmentAgency || false,
            company: {
                name: req.company.companyName,
                isRecruitmentAgency: req.company.isRecruitmentAgency,
                isRecruitmentAccess: req.company.isRecruitmentAccess
            }
        });
    } catch (error) {
        console.error('Error getting access status:', error);
        res.status(500).json({ error: 'שגיאה בטעינת מצב הגישה' });
    }
});

// Check specific feature access
router.get('/check/:featureId', checkFeatureAccess);

// Protected feature endpoints
router.get('/candidates', requireFeatureAccess('candidates'), (req, res) => {
    res.json({
        message: 'גישה למועמדים מאושרת',
        feature: 'candidates',
        hasAccess: true
    });
});

router.get('/students', requireFeatureAccess('students'), (req, res) => {
    res.json({
        message: 'גישה לסטודנטים מאושרת',
        feature: 'students',
        hasAccess: true
    });
});

router.get('/executives', requireFeatureAccess('executives'), (req, res) => {
    res.json({
        message: 'גישה לבכירים מאושרת',
        feature: 'executives',
        hasAccess: true
    });
});

router.get('/job-posting', requireFeatureAccess('job-posting'), (req, res) => {
    res.json({
        message: 'גישה לפרסום משרות מאושרת',
        feature: 'job-posting',
        hasAccess: true
    });
});

router.get('/recruitment-emails', requireFeatureAccess('candidates'), async (req, res) => {
    try {
        res.json({
            success: true,
            emails: req.company.recruitmentEmails || [],
            distributionEnabled: req.company.distributionSettings?.enabled || false
        });
    } catch (error) {
        res.status(500).json({ error: 'שגיאה בטעינת כתובות מייל' });
    }
});

router.post('/recruitment-emails', requireFeatureAccess('candidates'), [
    body('email').isEmail().normalizeEmail(),
    body('enabled').optional().isBoolean()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, enabled = true } = req.body;

        await Company.findByIdAndUpdate(req.company._id, {
            $addToSet: {
                recruitmentEmails: {
                    email,
                    isActive: enabled,
                    addedAt: new Date()
                }
            }
        });

        res.json({ success: true, message: 'כתובת המייל נוספה בהצלחה' });
    } catch (error) {
        console.error(error); // 👈 כדאי להוסיף בשביל דיבוג
        res.status(500).json({ error: 'שגיאה בהוספת כתובת מייל' });
    }
});


module.exports = router;