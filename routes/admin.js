// routes/admin.js - Admin Routes
const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { User, Candidate, SpamDetection } = require('../models');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const emailService = require('../services/emailService');

const router = express.Router();

// Approve/reject user registration
router.post('/approve-user/:userId',
    authenticateToken,
    requireAdmin,
    [body('action').isIn(['approve', 'reject'])],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ error: 'Invalid action' });
            }

            const { action } = req.body;
            const user = await User.findById(req.params.userId);

            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }

            user.isRecruitmentAccess = action === 'approve' ? 'approved' : 'denied';
            user.approvedBy = req.user._id;
            user.approvedAt = new Date();

            // Generate API key for approved users
            if (action === 'approve' && !user.apiKey) {
                user.apiKey = crypto.randomBytes(32).toString('hex');
            }

            await user.save();

            // Send notification email
            try {
                await emailService.sendApprovalNotification(user, action === 'approve');
            } catch (emailError) {
                console.error('Failed to send approval email:', emailError);
            }

            res.json({
                success: true,
                message: `User ${action}d successfully`,
                apiKey: action === 'approve' ? user.apiKey : undefined
            });
        } catch (error) {
            console.error('Approval error:', error);
            res.status(500).json({ error: 'Approval failed' });
        }
    }
);

// Get pending registrations
router.get('/pending-users',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const pendingUsers = await User.find({
                isRecruitmentAccess: 'pending',
                isActive: true
            })
                .populate('companyId', 'companyName address city')
                .select('-password -apiKey')
                .sort({ createdAt: -1 })
                .limit(100);

            res.json({
                success: true,
                users: pendingUsers,
                count: pendingUsers.length
            });
        } catch (error) {
            console.error('Error fetching pending users:', error);
            res.status(500).json({ error: 'Failed to fetch pending users' });
        }
    }
);

// Admin dashboard stats
router.get('/dashboard-stats',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const [
                totalUsers,
                pendingUsers,
                totalCandidates,
                blockedIPs,
                recentActivity,
                todayCandidates
            ] = await Promise.all([
                User.countDocuments({ isActive: true }),
                User.countDocuments({ isRecruitmentAccess: 'pending', isActive: true }),
                Candidate.countDocuments(),
                SpamDetection.countDocuments({ blocked: true }),
                Candidate.find()
                    .sort({ submissionDate: -1 })
                    .limit(10)
                    .select('name email submissionDate positions'),
                Candidate.countDocuments({
                    submissionDate: {
                        $gte: new Date(new Date().setHours(0, 0, 0, 0))
                    }
                })
            ]);

            res.json({
                success: true,
                stats: {
                    totalUsers,
                    pendingUsers,
                    totalCandidates,
                    todayCandidates,
                    blockedIPs
                },
                recentActivity
            });
        } catch (error) {
            console.error('Dashboard stats error:', error);
            res.status(500).json({ error: 'Failed to load dashboard stats' });
        }
    }
);

// Whitelist IP endpoint
router.post('/whitelist-ip',
    authenticateToken,
    requireAdmin,
    [body('ipAddress').isIP()],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ error: 'Invalid IP address' });
            }

            const { ipAddress } = req.body;
            const userAgent = req.body.userAgent || '';
            const identifier = crypto.createHash('sha256').update(ipAddress + userAgent).digest('hex');

            await SpamDetection.findOneAndUpdate(
                { identifier },
                {
                    identifier,
                    ipAddress,
                    userAgent,
                    blocked: false,
                    whitelist: true,
                    riskScore: 0,
                    attempts: 0
                },
                { upsert: true }
            );

            res.json({
                success: true,
                message: 'IP address whitelisted successfully'
            });
        } catch (error) {
            console.error('Whitelist error:', error);
            res.status(500).json({ error: 'Failed to whitelist IP' });
        }
    }
);

// Get blocked IPs
router.get('/blocked-ips',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const blockedIPs = await SpamDetection.find({
                blocked: true
            })
                .select('ipAddress userAgent blockReason attempts riskScore lastAttempt')
                .sort({ lastAttempt: -1 })
                .limit(100);

            res.json({
                success: true,
                blockedIPs,
                count: blockedIPs.length
            });
        } catch (error) {
            console.error('Error fetching blocked IPs:', error);
            res.status(500).json({ error: 'Failed to fetch blocked IPs' });
        }
    }
);

// Unblock IP
router.post('/unblock-ip',
    authenticateToken,
    requireAdmin,
    [body('ipAddress').isIP()],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ error: 'Invalid IP address' });
            }

            const { ipAddress } = req.body;

            const result = await SpamDetection.updateOne(
                { ipAddress },
                {
                    blocked: false,
                    riskScore: 0,
                    attempts: 0,
                    blockReason: null
                }
            );

            if (result.modifiedCount === 0) {
                return res.status(404).json({ error: 'IP address not found or not blocked' });
            }

            res.json({
                success: true,
                message: 'IP address unblocked successfully'
            });
        } catch (error) {
            console.error('Unblock error:', error);
            res.status(500).json({ error: 'Failed to unblock IP' });
        }
    }
);

// Get system logs (last 100 entries)
router.get('/system-logs',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const logs = await SpamDetection.aggregate([
                {
                    $unwind: '$suspiciousActivity'
                },
                {
                    $project: {
                        ipAddress: 1,
                        type: '$suspiciousActivity.type',
                        details: '$suspiciousActivity.details',
                        timestamp: '$suspiciousActivity.timestamp',
                        riskScore: 1,
                        blocked: 1
                    }
                },
                {
                    $sort: { timestamp: -1 }
                },
                {
                    $limit: 100
                }
            ]);

            res.json({
                success: true,
                logs,
                count: logs.length
            });
        } catch (error) {
            console.error('Error fetching system logs:', error);
            res.status(500).json({ error: 'Failed to fetch system logs' });
        }
    }
);

module.exports = router;