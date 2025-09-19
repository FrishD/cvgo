// routes/auth.js - Authentication Routes
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { User, Company, Subscription } = require('../models');
const { JWT_SECRET } = require('../config/security');
const emailService = require('../services/emailService');

const router = express.Router();

// Registration endpoint
router.post('/register', [
    body('username').trim().isLength({ min: 3, max: 50 }).matches(/^[a-zA-Z0-9_]+$/),
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/),
    body('fullName').trim().isLength({ min: 2, max: 100 }),
    body('companyName').trim().isLength({ min: 2, max: 100 }),
    body('supportRegions').isArray({ min: 1 }),
    body('position').isIn(['owner', 'admin', 'member']),
    body('city').trim().isLength({ min: 2, max: 50 }),
    body('address').trim().isLength({ min: 5, max: 200 }),
    body('phone').matches(/^[\d\-\s\+\(\)]+$/),
    body('companyDescription').trim().isLength({ min: 10, max: 1000 }),
    body('businessDomains').optional().isArray(),
    body('website').optional().isURL(),
    body('isRecruitmentAgency').optional().isBoolean()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array()
        });
    }

    try {
        const {
            username, email, password, fullName, position,
            companyName, supportRegions, city, address, phone,
            companyDescription, businessDomains, website,
            isRecruitmentAgency = false
        } = req.body;

        // Check if user or company already exists
        const [existingUser, existingCompany] = await Promise.all([
            User.findOne({ $or: [{ email }, { username }] }),
            Company.findOne({ $or: [{ email }, { companyName }] })
        ]);

        if (existingUser) {
            return res.status(409).json({
                error: 'User already exists',
                field: existingUser.email === email ? 'email' : 'username'
            });
        }

        if (existingCompany) {
            return res.status(409).json({
                error: 'Company already exists',
                field: existingCompany.email === email ? 'email' : 'companyName'
            });
        }

        // Create company first
        const company = new Company({
            companyName,
            address,
            city,
            phone,
            companyDescription,
            supportRegions,
            businessDomains: businessDomains || [],
            email,
            website: website || null,
            isRecruitmentAgency,
            isRecruitmentAccess: isRecruitmentAgency ? 'pending' : 'approved'
        });

        const savedCompany = await company.save();

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 14);

        // Set default permissions
        let defaultPermissions = [];
        if (position === 'owner') {
            defaultPermissions = [
                { resource: 'candidates', actions: ['read', 'write', 'delete', 'manage'] },
                { resource: 'users', actions: ['read', 'write', 'delete', 'manage'] },
                { resource: 'settings', actions: ['read', 'write', 'manage'] },
                { resource: 'billing', actions: ['read', 'write', 'manage'] },
                { resource: 'reports', actions: ['read', 'manage'] }
            ];
        } else if (position === 'admin') {
            defaultPermissions = [
                { resource: 'candidates', actions: ['read', 'write', 'delete'] },
                { resource: 'users', actions: ['read', 'write'] },
                { resource: 'settings', actions: ['read', 'write'] },
                { resource: 'reports', actions: ['read'] }
            ];
        } else {
            defaultPermissions = [
                { resource: 'candidates', actions: ['read', 'write'] },
                { resource: 'reports', actions: ['read'] }
            ];
        }

        // Create user
        const user = new User({
            username,
            email,
            password: hashedPassword,
            fullName,
            position,
            companyId: savedCompany._id,
            city,
            address,
            phone,
            permissions: defaultPermissions,
            role: position === 'owner' ? 'admin' : 'user'
        });

        const savedUser = await user.save();

        // Send welcome emails
        try {
            if (typeof emailService !== 'undefined') {
                if (isRecruitmentAgency) {
                    await emailService.sendRegistrationConfirmation({
                        ...savedUser.toObject(),
                        companyName: savedCompany.companyName
                    });
                } else {
                    await emailService.sendUserWelcomeEmail({
                        ...savedUser.toObject(),
                        companyName: savedCompany.companyName
                    });
                }
            }
        } catch (emailError) {
            console.error('Email sending failed:', emailError);
        }

        res.status(201).json({
            success: true,
            message: 'Registration completed successfully',
            data: {
                userId: savedUser._id,
                companyId: savedCompany._id,
                isRecruitmentAgency,
                requiresApproval: isRecruitmentAgency,
                permissions: defaultPermissions.map(p => ({
                    resource: p.resource,
                    actions: p.actions
                }))
            }
        });

    } catch (error) {
        console.error('Registration error:', error);

        if (error.code === 11000) {
            const field = Object.keys(error.keyPattern)[0];
            return res.status(409).json({
                error: `${field} already exists`,
                field
            });
        }

        res.status(500).json({
            error: 'Registration failed',
            details: process.env.NODE_ENV === 'development' ?
                error.message : 'Please try again'
        });
    }
});

// Login endpoint
router.post('/login', [
    body('username').trim().notEmpty(),
    body('password').notEmpty()
], async (req, res) => {
    try {
        const { username, password } = req.body;

        const user = await User.findOne({
            $or: [{ username }, { email: username }],
            isActive: true
        }).populate('companyId');

        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check if account is locked
        if (user.lockUntil && user.lockUntil > Date.now()) {
            const remainingTime = Math.ceil((user.lockUntil - Date.now()) / (1000 * 60));
            return res.status(423).json({
                error: 'Account temporarily locked',
                remainingMinutes: remainingTime
            });
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) {
            user.loginAttempts = (user.loginAttempts || 0) + 1;
            if (user.loginAttempts >= 5) {
                const lockDuration = Math.min(30 * Math.pow(2, user.loginAttempts - 5), 24 * 60);
                user.lockUntil = Date.now() + lockDuration * 60 * 1000;
            }
            await user.save();
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Check company status
        if (!user.companyId || !user.companyId.isActive) {
            return res.status(403).json({
                error: 'Company account inactive',
                code: 'COMPANY_INACTIVE'
            });
        }

        // Get active subscription
        const subscription = await Subscription.findOne({
            companyId: user.companyId._id,
            status: 'active',
            expiresAt: { $gt: new Date() } // CORRECTED: Changed 'expirationDate' to 'expiresAt'
        });




        const subscriptionStatus = {
            hasActive: !!subscription,
            expired: !subscription,
            expiresAt: subscription?.expiresAt, // CORRECTED
            daysLeft: subscription ?
                Math.ceil((subscription.expiresAt - new Date()) / (1000 * 60 * 60 * 24)) : 0, // CORRECTED
            features: subscription?.features || []
        };


        // Reset login attempts
        user.loginAttempts = 0;
        user.lockUntil = undefined;
        user.lastLoginAt = new Date();
        await user.save();

        // Generate JWT
        const token = jwt.sign(
            {
                userId: user._id,
                companyId: user.companyId._id,
                role: user.role,
                position: user.position,
                iat: Math.floor(Date.now() / 1000),
                sessionId: require('crypto').randomUUID()
            },
            JWT_SECRET,
            { expiresIn: '15m' }
        );

        req.session.token = token;

        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                username: user.username,
                fullName: user.fullName,
                email: user.email,
                position: user.position,
                role: user.role,
                phone: user.phone,
                address: user.address,
                city: user.city,
                permissions: user.permissions,
                lastLoginAt: user.lastLoginAt
            },
            company: {
                id: user.companyId._id,
                name: user.companyId.companyName,
                address: user.companyId.address,
                city: user.companyId.city,
                phone: user.companyId.phone,
                email: user.companyId.email,
                website: user.companyId.website,
                supportRegions: user.companyId.supportRegions,
                businessDomains: user.companyId.businessDomains,
                isRecruitmentAgency: user.companyId.isRecruitmentAgency,
                isRecruitmentAccess: user.companyId.isRecruitmentAccess
            },
            subscription: subscriptionStatus,
            warnings: !subscriptionStatus.hasActive ? ['Subscription expired - limited access'] : []
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            error: 'Login failed',
            details: process.env.NODE_ENV === 'development' ?
                error.message : 'Please try again'
        });
    }
});

// Logout endpoint
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Session destruction error:', err);
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    });
});

module.exports = router;