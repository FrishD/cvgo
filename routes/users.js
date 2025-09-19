// routes/users.js - User Management Routes
const express = require('express');
const { body, validationResult } = require('express-validator');
const { User, Company, Exposure, Subscription } = require('../models');
const { authenticateToken, requirePermission } = require('../middleware/auth');
const mongoose = require("mongoose");

const router = express.Router();

// Get user profile with company data
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        if (!req.user || !req.company) {
            return res.status(404).json({ error: 'User or company not found' });
        }

        res.json({
            success: true,
            user: {
                id: req.user._id,
                username: req.user.username,
                fullName: req.user.fullName,
                email: req.user.email,
                position: req.user.position,
                role: req.user.role,
                phone: req.user.phone,
                address: req.user.address,
                city: req.user.city,
                permissions: req.user.permissions,
                lastLoginAt: req.user.lastLoginAt
            },
            company: {
                id: req.company._id,
                name: req.company.companyName,
                address: req.company.address,
                city: req.company.city,
                phone: req.company.phone,
                email: req.company.email,
                website: req.company.website,
                supportRegions: req.company.supportRegions,
                businessDomains: req.company.businessDomains,
                isRecruitmentAgency: req.company.isRecruitmentAgency,
                isRecruitmentAccess: req.company.isRecruitmentAccess
            }
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({
            error: 'Failed to fetch profile',
            details: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

// Change Email
router.put('/change-email',
    authenticateToken,
    [
        body('newEmail').isEmail().normalizeEmail(),
        body('currentPassword').notEmpty(),
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { newEmail, currentPassword } = req.body;
            const userId = req.user._id;

            const existingUser = await User.findOne({ email: newEmail });
            if (existingUser) {
                return res.status(409).json({ error: 'That email address is already in use.' });
            }

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const bcrypt = require('bcryptjs');
            const isValid = await bcrypt.compare(currentPassword, user.password);
            if (!isValid) {
                return res.status(403).json({ error: 'Incorrect password.' });
            }

            user.email = newEmail;
            await user.save();

            res.json({ success: true, message: 'Email changed successfully.' });

        } catch (error) {
            console.error('Email change error:', error);
            res.status(500).json({ error: 'Failed to change email.' });
        }
    }
);

// Expose a student
router.post('/expose/:studentId', authenticateToken, async (req, res) => {
    try {
        const { studentId } = req.params;
        const userId = req.user._id;
        const companyId = req.user.companyId;

        // בדוק אם כבר קיימת חשיפה
        const existingExposure = await Exposure.findOne({
            userId,
            studentId,
            isActive: true,
            expiresAt: { $gt: new Date() }
        });

        if (existingExposure) {
            return res.status(409).json({ error: 'Student already exposed to you.' });
        }

        // מצא subscription פעילה - Fixed line
        const subscription = await Subscription.findValidSubscription(userId);

        if (!subscription) {
            return res.status(403).json({
                error: 'No active exposure package. Please purchase an exposure package first.'
            });
        }

        // צור חשיפה חדשה
        const exposure = new Exposure({
            userId,
            companyId,
            studentId,
            subscriptionId: subscription._id,
            expiresAt: subscription.expiresAt
        });

        await exposure.save();

        // השתמש בחשיפה מהמנוי
        await subscription.useExposure();

        res.json({
            success: true,
            message: 'Student exposed successfully.',
            remainingExposures: subscription.remainingExposures - 1
        });

    } catch (error) {
        console.error('Expose student error:', error);
        res.status(500).json({ error: 'Failed to expose student' });
    }
});

// Update user profile
router.put('/update-profile',
    authenticateToken,
    [
        body('fullName').trim().isLength({ min: 2, max: 100 }),
        body('phone').matches(/^[\d\-\s\+\(\)]+$/),
        body('email').isEmail().normalizeEmail(),
        body('address').trim().isLength({ min: 5, max: 200 })
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { fullName, phone, email, address } = req.body;

            const existingUser = await User.findOne({
                email,
                _id: { $ne: req.user._id }
            });

            if (existingUser) {
                return res.status(409).json({ error: 'Email already taken' });
            }

            const updatedUser = await User.findByIdAndUpdate(
                req.user._id,
                { fullName, phone, email, address },
                { new: true, runValidators: true }
            ).select('-password');

            res.json({
                success: true,
                user: updatedUser
            });

        } catch (error) {
            console.error('Profile update error:', error);
            res.status(500).json({ error: 'Failed to update profile' });
        }
    }
);

// Update company (admin/owner only)
router.put('/update-company',
    authenticateToken,
    requirePermission('settings', 'write'),
    [
        body('address').trim().isLength({ min: 5, max: 200 }),
        body('city').trim().isLength({ min: 2, max: 50 }),
        body('phone').matches(/^[\d\-\s\+\(\)]+$/),
        body('email').isEmail().normalizeEmail(),
        body('supportRegions').isArray({ min: 1 }),
        body('website').optional().isURL()
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { address, city, phone, email, supportRegions, website } = req.body;

            const existingCompany = await Company.findOne({
                email,
                _id: { $ne: req.company._id }
            });

            if (existingCompany) {
                return res.status(409).json({ error: 'Email already taken' });
            }

            const updatedCompany = await Company.findByIdAndUpdate(
                req.company._id,
                { address, city, phone, email, supportRegions, website },
                { new: true, runValidators: true }
            );

            res.json({
                success: true,
                company: updatedCompany
            });

        } catch (error) {
            console.error('Company update error:', error);
            res.status(500).json({ error: 'Failed to update company' });
        }
    }
);

// Change password
router.put('/change-password',
    authenticateToken,
    [
        body('currentPassword').notEmpty(),
        body('newPassword')
            .isLength({ min: 8 })
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/)
            .withMessage('Password must contain uppercase, lowercase, number and special character')
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { currentPassword, newPassword } = req.body;

            const user = await User.findById(req.user._id);
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            const bcrypt = require('bcryptjs');
            const isValid = await bcrypt.compare(currentPassword, user.password);
            if (!isValid) {
                return res.status(400).json({ error: 'Current password is incorrect' });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 14);

            user.password = hashedPassword;
            await user.save();

            res.json({
                success: true,
                message: 'Password changed successfully'
            });

        } catch (error) {
            console.error('Password change error:', error);
            res.status(500).json({ error: 'Failed to change password' });
        }
    }
);

// Get company users (admin/owner only)
router.get('/company-users',
    authenticateToken,
    requirePermission('users', 'read'),
    async (req, res) => {
        try {
            const users = await User.find({
                companyId: req.company._id,
                isActive: true
            })
                .select('-password')
                .sort({ createdAt: -1 });

            res.json({
                success: true,
                users,
                count: users.length
            });

        } catch (error) {
            console.error('Error fetching company users:', error);
            res.status(500).json({ error: 'Failed to fetch users' });
        }
    }
);

// Invite new user (owner only)
router.post('/invite-user',
    authenticateToken,
    requirePermission('users', 'manage'),
    [
        body('email').isEmail().normalizeEmail(),
        body('fullName').trim().isLength({ min: 2, max: 100 }),
        body('position').isIn(['admin', 'member']),
        body('permissions').optional().isArray()
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { email, fullName, position, permissions } = req.body;

            const existingUser = await User.findOne({ email });
            if (existingUser) {
                return res.status(409).json({ error: 'User already exists' });
            }

            const tempPassword = require('crypto').randomBytes(12).toString('base64');
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash(tempPassword, 14);

            let userPermissions = permissions;
            if (!userPermissions) {
                userPermissions = position === 'admin' ? [
                    { resource: 'candidates', actions: ['read', 'write', 'delete'] },
                    { resource: 'users', actions: ['read', 'write'] },
                    { resource: 'settings', actions: ['read', 'write'] },
                    { resource: 'reports', actions: ['read'] }
                ] : [
                    { resource: 'candidates', actions: ['read', 'write'] },
                    { resource: 'reports', actions: ['read'] }
                ];
            }

            const newUser = new User({
                username: email.split('@')[0] + '_' + Date.now(),
                email,
                password: hashedPassword,
                fullName,
                position,
                companyId: req.company._id,
                city: req.company.city,
                address: req.company.address,
                phone: '',
                permissions: userPermissions,
                role: position === 'admin' ? 'admin' : 'user'
            });

            const savedUser = await newUser.save();

            try {
                const emailService = require('../services/emailService');
                await emailService.sendUserInvitation({
                    ...savedUser.toObject(),
                    tempPassword,
                    companyName: req.company.companyName,
                    invitedBy: req.user.fullName
                });
            } catch (emailError) {
                console.error('Failed to send invitation email:', emailError);
            }

            res.status(201).json({
                success: true,
                message: 'User invited successfully',
                user: {
                    id: savedUser._id,
                    email: savedUser.email,
                    fullName: savedUser.fullName,
                    position: savedUser.position,
                    permissions: savedUser.permissions
                }
            });

        } catch (error) {
            console.error('User invitation error:', error);
            res.status(500).json({ error: 'Failed to invite user' });
        }
    }
);

// Update user permissions (owner only)
router.put('/update-permissions/:userId',
    authenticateToken,
    requirePermission('users', 'manage'),
    [body('permissions').isArray()],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { permissions } = req.body;
            const { userId } = req.params;

            const targetUser = await User.findOne({
                _id: userId,
                companyId: req.company._id,
                isActive: true
            });

            if (!targetUser) {
                return res.status(404).json({ error: 'User not found' });
            }

            if (targetUser.position === 'owner') {
                return res.status(403).json({ error: 'Cannot modify owner permissions' });
            }

            targetUser.permissions = permissions;
            await targetUser.save();

            res.json({
                success: true,
                message: 'User permissions updated successfully',
                user: {
                    id: targetUser._id,
                    fullName: targetUser.fullName,
                    permissions: targetUser.permissions
                }
            });

        } catch (error) {
            console.error('Permission update error:', error);
            res.status(500).json({ error: 'Failed to update permissions' });
        }
    }
);

// Deactivate user (owner only)
router.delete('/deactivate/:userId',
    authenticateToken,
    requirePermission('users', 'delete'),
    async (req, res) => {
        try {
            const { userId } = req.params;

            const targetUser = await User.findOne({
                _id: userId,
                companyId: req.company._id
            });

            if (!targetUser) {
                return res.status(404).json({ error: 'User not found' });
            }

            if (targetUser.position === 'owner') {
                return res.status(403).json({ error: 'Cannot deactivate company owner' });
            }

            if (targetUser._id.toString() === req.user._id.toString()) {
                return res.status(403).json({ error: 'Cannot deactivate yourself' });
            }

            targetUser.isActive = false;
            await targetUser.save();

            res.json({
                success: true,
                message: 'User deactivated successfully'
            });

        } catch (error) {
            console.error('User deactivation error:', error);
            res.status(500).json({ error: 'Failed to deactivate user' });
        }
    }
);

module.exports = router;
