// routes/recruitmentEmails.js - Recruitment Email Management Routes
const express = require('express');
const { body, validationResult, param } = require('express-validator');
const { Company } = require('../models');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const { requireFeatureAccess } = require('../middleware/accessControl');
const emailService = require('../services/emailService');
const cvDistributionService = require('../services/cvDistributionService');

const router = express.Router();

// Apply authentication and feature access to all routes
router.use(authenticateToken);
router.use(requireFeatureAccess('candidates'));

// Get all recruitment emails for the company
router.get('/', async (req, res) => {
    try {
        const company = await Company.findById(req.company._id)
            .select('recruitmentEmails distributionSettings')
            .lean();

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        res.json({
            success: true,
            emails: company.recruitmentEmails || [],
            distributionSettings: company.distributionSettings || {
                enabled: true,
                maxCVsPerDay: 500,
                dailyCount: 0
            },
            totalEmails: (company.recruitmentEmails || []).length,
            activeEmails: (company.recruitmentEmails || []).filter(email => email.isActive).length
        });

    } catch (error) {
        console.error('Error fetching recruitment emails:', error);
        res.status(500).json({ error: 'שגיאה בטעינת כתובות המייל' });
    }
});

router.put('/regions',
    requirePermission('settings', 'write'),
    [
        body('supportRegions')
            .isArray({ min: 1, max: 4 })
            .withMessage('Must select 1-4 service regions'),
        body('supportRegions.*')
            .isIn(['north', 'center', 'lowlands', 'south'])
            .withMessage('Invalid region selected')
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'שגיאות באימות נתונים',
                    details: errors.array()
                });
            }

            const { supportRegions } = req.body;

            const company = await Company.findByIdAndUpdate(
                req.company._id,
                { $set: { supportRegions } },
                { new: true, runValidators: true }
            ).select('supportRegions companyName');

            res.json({
                success: true,
                message: 'אזורי השירות עודכנו בהצלחה',
                supportRegions: company.supportRegions,
                companyName: company.companyName
            });

        } catch (error) {
            console.error('Error updating service regions:', error);
            res.status(500).json({ error: 'שגיאה בעדכון אזורי השירות' });
        }
    }
);

// Add new recruitment email
router.post('/',
    requirePermission('settings', 'write'),
    [
        body('email')
            .isEmail()
            .withMessage('כתובת מייל לא תקינה')
            .normalizeEmail(),
        body('description')
            .optional()
            .trim()
            .isLength({ max: 200 })
            .withMessage('תיאור ארוך מדי')
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'שגיאות באימות נתונים',
                    details: errors.array()
                });
            }

            const { email, description = '' } = req.body;

            // Check if email already exists for this company
            const company = await Company.findById(req.company._id);
            const existingEmail = company.recruitmentEmails.find(
                emailObj => emailObj.email === email
            );

            if (existingEmail) {
                return res.status(409).json({
                    error: 'כתובת מייל זו כבר קיימת במערכת'
                });
            }

            // Add new email
            const newEmail = {
                email,
                description,
                isActive: true,
                addedAt: new Date(),
                addedBy: req.user._id
            };

            company.recruitmentEmails.push(newEmail);
            await company.save();

            // Send test email to verify the address
            try {
                await emailService.sendDistributionTestEmail(email, {
                    companyName: company.companyName,
                    supportRegions: company.supportRegions
                });
                console.log(`Test email sent to new recruitment email: ${email}`);
            } catch (emailError) {
                console.error('Failed to send test email:', emailError);
                // Don't fail the request - just log the error
            }

            res.status(201).json({
                success: true,
                message: 'כתובת המייל נוספה בהצלחה',
                email: newEmail,
                testEmailSent: true
            });

        } catch (error) {
            console.error('Error adding recruitment email:', error);
            res.status(500).json({
                error: 'שגיאה בהוספת כתובת מייל',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// Update recruitment email
router.put('/:emailId',
    requirePermission('settings', 'write'),
    [
        param('emailId').isMongoId().withMessage('מזהה מייל לא תקין'),
        body('isActive').optional().isBoolean().withMessage('סטטוס חייב להיות true או false'),
        body('description').optional().trim().isLength({ max: 200 }).withMessage('תיאור ארוך מדי')
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'שגיאות באימות נתונים',
                    details: errors.array()
                });
            }

            const { emailId } = req.params;
            const { isActive, description } = req.body;

            const company = await Company.findById(req.company._id);
            const emailIndex = company.recruitmentEmails.findIndex(
                email => email._id.toString() === emailId
            );

            if (emailIndex === -1) {
                return res.status(404).json({ error: 'כתובת מייל לא נמצאה' });
            }

            // Update email properties
            if (isActive !== undefined) {
                company.recruitmentEmails[emailIndex].isActive = isActive;
            }
            if (description !== undefined) {
                company.recruitmentEmails[emailIndex].description = description;
            }

            company.recruitmentEmails[emailIndex].updatedAt = new Date();
            company.recruitmentEmails[emailIndex].updatedBy = req.user._id;

            await company.save();

            res.json({
                success: true,
                message: 'כתובת המייל עודכנה בהצלחה',
                email: company.recruitmentEmails[emailIndex]
            });

        } catch (error) {
            console.error('Error updating recruitment email:', error);
            res.status(500).json({ error: 'שגיאה בעדכון כתובת מייל' });
        }
    }
);

// Delete recruitment email
router.delete('/:emailId',
    requirePermission('settings', 'write'),
    [param('emailId').isMongoId().withMessage('מזהה מייל לא תקין')],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'שגיאות באימות נתונים',
                    details: errors.array()
                });
            }

            const { emailId } = req.params;

            const company = await Company.findById(req.company._id);
            const emailIndex = company.recruitmentEmails.findIndex(
                email => email._id.toString() === emailId
            );

            if (emailIndex === -1) {
                return res.status(404).json({ error: 'כתובת מייל לא נמצאה' });
            }

            // Prevent deletion if it's the last active email
            const activeEmails = company.recruitmentEmails.filter(email => email.isActive);
            if (activeEmails.length === 1 && company.recruitmentEmails[emailIndex].isActive) {
                return res.status(400).json({
                    error: 'לא ניתן למחוק את כתובת המייל האחרונה הפעילה'
                });
            }

            const deletedEmail = company.recruitmentEmails[emailIndex];
            company.recruitmentEmails.splice(emailIndex, 1);
            await company.save();

            res.json({
                success: true,
                message: 'כתובת המייל נמחקה בהצלחה',
                deletedEmail: deletedEmail.email
            });

        } catch (error) {
            console.error('Error deleting recruitment email:', error);
            res.status(500).json({ error: 'שגיאה במחיקת כתובת מייל' });
        }
    }
);

// Test single recruitment email
router.post('/test/:emailId',
    requirePermission('settings', 'write'),
    [param('emailId').isMongoId().withMessage('מזהה מייל לא תקין')],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'שגיאות באימות נתונים',
                    details: errors.array()
                });
            }

            const { emailId } = req.params;

            const company = await Company.findById(req.company._id);
            const emailObj = company.recruitmentEmails.find(
                email => email._id.toString() === emailId
            );

            if (!emailObj) {
                return res.status(404).json({ error: 'כתובת מייל לא נמצאה' });
            }

            if (!emailObj.isActive) {
                return res.status(400).json({ error: 'לא ניתן לשלוח מייל לכתובת לא פעילה' });
            }

            // Send test email
            await emailService.sendDistributionTestEmail(emailObj.email, {
                companyName: company.companyName,
                supportRegions: company.supportRegions
            });

            res.json({
                success: true,
                message: `מייל בדיקה נשלח בהצלחה ל-${emailObj.email}`,
                email: emailObj.email
            });

        } catch (error) {
            console.error('Error sending test email:', error);
            res.status(500).json({
                error: 'שגיאה בשליחת מייל בדיקה',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
);

// Update distribution settings
router.put('/settings',
    requirePermission('settings', 'write'),
    [
        body('enabled').optional().isBoolean().withMessage('הגדרת הפעלה חייבת להיות true או false'),
        body('maxCVsPerDay').optional().isInt({ min: 1, max: 1000 }).withMessage('מגבלה יומית חייבת להיות בין 1-1000')
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'שגיאות באימות נתונים',
                    details: errors.array()
                });
            }

            const { enabled, maxCVsPerDay } = req.body;

            const updateData = {};
            if (enabled !== undefined) {
                updateData['distributionSettings.enabled'] = enabled;
            }
            if (maxCVsPerDay !== undefined) {
                updateData['distributionSettings.maxCVsPerDay'] = maxCVsPerDay;
            }

            const company = await Company.findByIdAndUpdate(
                req.company._id,
                { $set: updateData },
                { new: true, runValidators: true }
            ).select('distributionSettings');

            res.json({
                success: true,
                message: 'הגדרות החלוקה עודכנו בהצלחה',
                settings: company.distributionSettings
            });

        } catch (error) {
            console.error('Error updating distribution settings:', error);
            res.status(500).json({ error: 'שגיאה בעדכון הגדרות החלוקה' });
        }
    }
);

// Get distribution statistics
router.get('/statistics', async (req, res) => {
    try {
        const { days = 7 } = req.query;
        const daysNum = Math.min(30, Math.max(1, parseInt(days)));

        // Get basic company info
        const company = await Company.findById(req.company._id).lean();

        // Calculate statistics
        const stats = {
            totalEmails: (company.recruitmentEmails || []).length,
            activeEmails: (company.recruitmentEmails || []).filter(email => email.isActive).length,
            dailyLimit: company.distributionSettings?.maxCVsPerDay || 50,
            todayReceived: company.distributionSettings?.dailyCount || 0,
            distributionEnabled: company.distributionSettings?.enabled !== false,
            serviceRegions: company.supportRegions || [],
            regionLabels: {
                north: 'צפון (צפונה מחדרה)',
                center: 'מרכז (חדרה - ראשון לציון)',
                lowlands: 'שפלה (ראשון לציון - אשקלון)',
                south: 'דרום (דרומה מאשקלון)'
            },
            lastActivity: company.distributionSettings?.lastCountReset || company.updatedAt
        };

        // Calculate usage percentage
        stats.usagePercentage = Math.round((stats.todayReceived / stats.dailyLimit) * 100);

        // Get distribution efficiency (could be enhanced with more detailed tracking)
        stats.efficiency = {
            status: stats.activeEmails > 0 ? 'optimal' : 'warning',
            recommendation: stats.activeEmails === 0
                ? 'הוסף לפחות כתובת מייל אחת לקבלת קורות חיים'
                : stats.activeEmails === 1
                    ? 'מומלץ להוסיף כתובות מייל נוספות לגיבוי'
                    : 'המערכת מוכנה לקבלת קורות חיים'
        };

        res.json({
            success: true,
            period: `${daysNum} days`,
            statistics: stats
        });

    } catch (error) {
        console.error('Error fetching distribution statistics:', error);
        res.status(500).json({ error: 'שגיאה בטעינת סטטיסטיקות' });
    }
});

// Test all recruitment emails
router.post('/test-all',
    requirePermission('settings', 'write'),
    async (req, res) => {
        try {
            const company = await Company.findById(req.company._id);
            const activeEmails = company.recruitmentEmails.filter(email => email.isActive);

            if (activeEmails.length === 0) {
                return res.status(400).json({ error: 'אין כתובות מייל פעילות במערכת' });
            }

            // Send test emails to all active addresses
            const testResults = [];

            for (const emailObj of activeEmails) {
                try {
                    await emailService.sendDistributionTestEmail(emailObj.email, {
                        companyName: company.companyName,
                        supportRegions: company.supportRegions
                    });
                    testResults.push({ email: emailObj.email, status: 'success' });
                } catch (error) {
                    console.error(`Test email failed for ${emailObj.email}:`, error);
                    testResults.push({
                        email: emailObj.email,
                        status: 'failed',
                        error: error.message
                    });
                }
            }

            const successCount = testResults.filter(result => result.status === 'success').length;
            const failedCount = testResults.length - successCount;

            res.json({
                success: true,
                message: `מיילי בדיקה נשלחו: ${successCount} הצליחו, ${failedCount} נכשלו`,
                results: testResults,
                summary: {
                    total: testResults.length,
                    successful: successCount,
                    failed: failedCount
                }
            });

        } catch (error) {
            console.error('Error sending test emails to all:', error);
            res.status(500).json({ error: 'שגיאה בשליחת מיילי בדיקה' });
        }
    }
);

module.exports = router;