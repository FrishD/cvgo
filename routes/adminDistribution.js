// routes/adminDistribution.js - Admin routes for distribution management
const express = require('express');
const { param, query, body } = require('express-validator');
const { Company, Candidate, Subscription } = require('../models');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const { monitor } = require('../middleware/distributionMonitoring');
const cvDistributionService = require('../services/cvDistributionService');
const backgroundJobsManager = require('../services/backgroundJobsManager');
const emailService = require('../services/emailService');

const router = express.Router();

// Apply authentication and admin check to all routes
router.use(authenticateToken, requireAdmin);

// Get distribution system overview
router.get('/overview', async (req, res) => {
    try {
        // Get system health
        const systemHealth = monitor.getHealthStatus();
        const configValidation = await monitor.validateSystemConfiguration();
        const performanceMetrics = monitor.getPerformanceMetrics();

        // Get distribution statistics
        const distributionStats = await monitor.getDistributionStats(7);

        // Get active agencies count
        const activeAgencies = await Company.countDocuments({
            isRecruitmentAgency: true,
            isRecruitmentAccess: 'approved',
            isActive: true,
            'recruitmentEmails.0': { $exists: true }
        });

        // Get pending approval count
        const pendingApprovals = await Company.countDocuments({
            isRecruitmentAgency: true,
            isRecruitmentAccess: 'pending',
            isActive: true
        });

        // Get recent candidates
        const recentCandidates = await Candidate.countDocuments({
            submissionDate: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        });

        // Get job status
        const backgroundJobs = backgroundJobsManager.getJobStatus();

        res.json({
            success: true,
            overview: {
                systemHealth,
                configValidation,
                performanceMetrics,
                distributionStats,
                counts: {
                    activeAgencies,
                    pendingApprovals,
                    recentCandidates
                },
                backgroundJobs
            }
        });

    } catch (error) {
        console.error('Error getting admin overview:', error);
        res.status(500).json({ error: 'Failed to load system overview' });
    }
});

// Get detailed agency statistics
router.get('/agencies/stats', async (req, res) => {
    try {
        const { days = 30 } = req.query;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - parseInt(days));

        // Get agency statistics with aggregation
        const agencyStats = await Company.aggregate([
            {
                $match: {
                    isRecruitmentAgency: true,
                    isActive: true
                }
            },
            {
                $lookup: {
                    from: 'subscriptions',
                    localField: '_id',
                    foreignField: 'companyId',
                    as: 'subscription'
                }
            },
            {
                $project: {
                    companyName: 1,
                    isRecruitmentAccess: 1,
                    supportRegions: 1,
                    recruitmentEmails: 1,
                    distributionSettings: 1,
                    createdAt: 1,
                    activeSubscription: {
                        $filter: {
                            input: '$subscription',
                            cond: {
                                $and: [
                                    { $eq: ['$$this.status', 'active'] },
                                    // CORRECTED:
                                    { $gt: ['$this.expiresAt', new Date()] }
                                ]
                            }
                        }
                    },

                    emailCount: { $size: '$recruitmentEmails' },
                    activeEmails: {
                        $size: {
                            $filter: {
                                input: '$recruitmentEmails',
                                cond: { $eq: ['$this.isActive', true] }
                            }
                        }
                    }
                }
            },
            {
                $sort: { createdAt: -1 }
            }
        ]);

        // Get region distribution
        const regionStats = await Company.aggregate([
            {
                $match: {
                    isRecruitmentAgency: true,
                    isRecruitmentAccess: 'approved',
                    isActive: true
                }
            },
            { $unwind: '$supportRegions' },
            { $group: { _id: '$supportRegions', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        res.json({
            success: true,
            period: `${days} days`,
            agencies: agencyStats,
            regionDistribution: regionStats,
            summary: {
                totalAgencies: agencyStats.length,
                approvedAgencies: agencyStats.filter(a => a.isRecruitmentAccess === 'approved').length,
                pendingAgencies: agencyStats.filter(a => a.isRecruitmentAccess === 'pending').length,
                withActiveSubscription: agencyStats.filter(a => a.activeSubscription.length > 0).length
            }
        });

    } catch (error) {
        console.error('Error getting agency stats:', error);
        res.status(500).json({ error: 'Failed to load agency statistics' });
    }
});

// Get distribution health status
router.get('/health', async (req, res) => {
    try {
        const health = monitor.getHealthStatus();
        const validation = await monitor.validateSystemConfiguration();
        const performance = monitor.getPerformanceMetrics();
        const distributionStats = await monitor.getDistributionStats();

        res.json({
            success: true,
            health: {
                distribution: health,
                configuration: validation,
                performance,
                statistics: distributionStats,
                timestamp: new Date()
            }
        });

    } catch (error) {
        console.error('Error getting health status:', error);
        res.status(500).json({ error: 'Failed to get health status' });
    }
});

// Manually trigger background job
router.post('/jobs/:jobName/trigger',
    [param('jobName').isIn(['dailyCleanup', 'weeklyReports', 'resetCounters', 'healthCheck', 'subscriptionCheck'])],
    async (req, res) => {
        try {
            const { jobName } = req.params;

            await backgroundJobsManager.triggerJob(jobName);

            res.json({
                success: true,
                message: `Job ${jobName} completed successfully`,
                triggeredAt: new Date(),
                triggeredBy: req.user.fullName
            });

        } catch (error) {
            console.error(`Error triggering job ${req.params.jobName}:`, error);
            res.status(500).json({
                error: 'Failed to trigger job',
                details: error.message
            });
        }
    }
);

// Get background jobs status
router.get('/jobs', async (req, res) => {
    try {
        const jobs = backgroundJobsManager.getJobStatus();

        res.json({
            success: true,
            jobs,
            serverUptime: process.uptime(),
            lastCheck: new Date()
        });

    } catch (error) {
        console.error('Error getting jobs status:', error);
        res.status(500).json({ error: 'Failed to get jobs status' });
    }
});

// Test distribution system with mock candidate
router.post('/test-distribution', async (req, res) => {
    try {
        const mockCandidate = {
            _id: 'test_' + Date.now(),
            name: 'Test Candidate',
            email: 'test@example.com',
            phone: '050-123-4567',
            positions: [{
                title: 'Software Developer',
                category: 'מחשבים',
                experience: 'Test experience',
                skills: ['JavaScript', 'Node.js']
            }],
            submissionDate: new Date(),
            address: 'Tel Aviv',
            city: 'Tel Aviv'
        };

        // Test distribution without actually sending emails
        const result = await cvDistributionService.distributeCVToAgencies(mockCandidate);

        res.json({
            success: true,
            message: 'Distribution test completed',
            result,
            mockCandidate: {
                name: mockCandidate.name,
                region: 'מרכז',
                positions: mockCandidate.positions.map(p => p.title)
            },
            testedAt: new Date(),
            testedBy: req.user.fullName
        });

    } catch (error) {
        console.error('Error testing distribution:', error);
        res.status(500).json({
            error: 'Distribution test failed',
            details: error.message
        });
    }
});

// Get recent distribution logs
router.get('/logs', async (req, res) => {
    try {
        const { limit = 100, severity = 'all' } = req.query;

        // This would require implementing a proper logging system
        // For now, return system health and recent activity
        const health = monitor.getHealthStatus();
        const recentActivity = {
            distributions: health.metrics || {},
            timestamp: new Date()
        };

        res.json({
            success: true,
            logs: [recentActivity],
            summary: {
                totalLogs: 1,
                severity,
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        console.error('Error getting distribution logs:', error);
        res.status(500).json({ error: 'Failed to get distribution logs' });
    }
});

// Approve/reject recruitment agency
router.put('/agencies/:companyId/approval',
    [
        param('companyId').isMongoId(),
        body('action').isIn(['approve', 'reject']),
        body('reason').optional().isString().trim()
    ],
    async (req, res) => {
        try {
            const { companyId } = req.params;
            const { action, reason = '' } = req.body;

            const company = await Company.findById(companyId);
            if (!company || !company.isRecruitmentAgency) {
                return res.status(404).json({ error: 'Recruitment agency not found' });
            }

            const newStatus = action === 'approve' ? 'approved' : 'denied';
            company.isRecruitmentAccess = newStatus;

            if (action === 'approve') {
                company.approvedAt = new Date();
            }

            await company.save();

            // Find company owner to send notification
            const User = require('../models').User;
            const owner = await User.findOne({
                companyId: company._id,
                position: 'owner'
            });

            if (owner) {
                try {
                    await emailService.sendApprovalNotification(
                        {
                            ...owner.toObject(),
                            companyName: company.companyName,
                            username: owner.username
                        },
                        action === 'approve'
                    );
                } catch (emailError) {
                    console.error('Failed to send approval notification:', emailError);
                }
            }

            res.json({
                success: true,
                message: `Agency ${action}d successfully`,
                company: {
                    id: company._id,
                    name: company.companyName,
                    status: newStatus,
                    approvedAt: company.approvedAt
                },
                processedBy: req.user.fullName,
                processedAt: new Date()
            });

        } catch (error) {
            console.error('Error processing agency approval:', error);
            res.status(500).json({ error: 'Failed to process approval' });
        }
    }
);

// Get system configuration
router.get('/config', async (req, res) => {
    try {
        const config = {
            email: {
                service: 'gmail',
                configured: !!(process.env.GMAIL_USER && process.env.GMAIL_PASS),
                fromAddress: process.env.GMAIL_USER || 'Not configured'
            },
            storage: {
                path: process.env.CV_STORAGE_PATH || '../storage/cvs',
                maxSize: '100MB per company'
            },
            distribution: {
                maxBatchSize: 100,
                batchDelay: '1 second',
                maxDailyPerAgency: 50
            },
            monitoring: {
                healthCheckInterval: '5 minutes',
                alertThresholds: {
                    maxFailureRate: '10%',
                    maxQueueLength: 500,
                    maxProcessingTime: '30 seconds'
                }
            },
            backgroundJobs: {
                timezone: process.env.TIMEZONE || 'Asia/Jerusalem',
                schedules: {
                    dailyCleanup: '2:00 AM daily',
                    weeklyReports: '9:00 AM Mondays',
                    resetCounters: 'Midnight daily',
                    healthCheck: 'Every hour',
                    subscriptionCheck: '8:00 AM daily'
                }
            }
        };

        res.json({
            success: true,
            config,
            environment: process.env.NODE_ENV || 'development',
            version: process.env.npm_package_version || '1.0.0',
            retrievedAt: new Date()
        });

    } catch (error) {
        console.error('Error getting system config:', error);
        res.status(500).json({ error: 'Failed to get system configuration' });
    }
});

// Emergency stop distribution
router.post('/emergency-stop', async (req, res) => {
    try {
        const { reason = 'Emergency stop requested by admin' } = req.body;

        // This would implement emergency stop logic
        // For now, just log the request
        console.error('EMERGENCY STOP REQUESTED:', {
            reason,
            requestedBy: req.user.fullName,
            timestamp: new Date()
        });

        res.json({
            success: true,
            message: 'Emergency stop signal sent',
            reason,
            stoppedBy: req.user.fullName,
            stoppedAt: new Date()
        });

    } catch (error) {
        console.error('Error processing emergency stop:', error);
        res.status(500).json({ error: 'Failed to process emergency stop' });
    }
});

module.exports = router;