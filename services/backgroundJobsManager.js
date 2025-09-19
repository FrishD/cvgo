// services/backgroundJobsManager.js - Background Jobs for CV Distribution System
const cron = require('node-cron');
const { Company, Candidate, Subscription } = require('../models');
const emailService = require('./emailService');
const cvFileService = require('./cvFileService');
const { monitor } = require('../middleware/distributionMonitoring');

class BackgroundJobsManager {
    constructor() {
        this.jobs = new Map();
        this.isShuttingDown = false;

        this.initializeJobs();
    }

    // Initialize all background jobs
    initializeJobs() {
        try {
            // Daily cleanup job - runs at 2 AM
            this.scheduleJob('dailyCleanup', '0 2 * * *', this.runDailyCleanup.bind(this));

            // Reset daily counters - runs at midnight
            this.scheduleJob('resetCounters', '0 0 * * *', this.resetDailyCounters.bind(this));

            // System health check - runs every hour
            this.scheduleJob('healthCheck', '0 * * * *', this.systemHealthCheck.bind(this));

            // Subscription expiry check - runs at 8 AM daily
            this.scheduleJob('subscriptionCheck', '0 8 * * *', this.checkSubscriptionExpiry.bind(this));

            console.log('Background jobs initialized successfully');

        } catch (error) {
            console.error('Error initializing background jobs:', error);
        }
    }

    // Schedule a cron job
    scheduleJob(name, schedule, jobFunction) {
        try {
            const task = cron.schedule(schedule, async () => {
                if (this.isShuttingDown) return;

                try {
                    console.log(`Starting background job: ${name}`);
                    const startTime = Date.now();

                    await jobFunction();

                    const duration = Date.now() - startTime;
                    console.log(`Completed background job: ${name} (${duration}ms)`);

                } catch (error) {
                    console.error(`Background job ${name} failed:`, error);
                    await this.handleJobError(name, error);
                }
            }, {
                scheduled: false,
                timezone: process.env.TIMEZONE || 'Asia/Jerusalem'
            });

            this.jobs.set(name, task);
            task.start();

            console.log(`Scheduled job: ${name} with schedule: ${schedule}`);

        } catch (error) {
            console.error(`Error scheduling job ${name}:`, error);
        }
    }

    // Daily cleanup job
    async runDailyCleanup() {
        try {
            console.log('Running daily cleanup...');

            // Clean old CV files (older than 90 days)
            const cleanupResult = await cvFileService.cleanupOldFiles(90);
            console.log(`Cleanup: Removed ${cleanupResult.deletedCount} old CV files`);

            // Clean old spam detection records (older than 30 days)
            const SpamDetection = require('../models').SpamDetection;
            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

            const spamCleanup = await SpamDetection.deleteMany({
                lastAttempt: { $lt: thirtyDaysAgo },
                blocked: false,
                riskScore: { $lt: 5 }
            });
            console.log(`Cleanup: Removed ${spamCleanup.deletedCount} old spam detection records`);

            // Clean old upload limit records (older than 7 days)
            const UploadLimit = require('../models').UploadLimit;
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

            const uploadCleanup = await UploadLimit.deleteMany({
                lastUpload: { $lt: sevenDaysAgo }
            });
            console.log(`Cleanup: Removed ${uploadCleanup.deletedCount} old upload limit records`);

            // Log storage statistics
            const storageStats = await cvFileService.getStorageStats();
            if (storageStats) {
                console.log(`Storage: ${storageStats.totalFiles} files, ${storageStats.totalSizeMB}MB total`);
            }

        } catch (error) {
            console.error('Daily cleanup failed:', error);
            throw error;
        }
    }

    // Get weekly statistics for a specific agency
    async getAgencyWeeklyStats(agency, startDate) {
        try {
            // Get candidates in agency's regions
            const regionQuery = agency.supportRegions.includes('כל הארץ')
                ? {}
                : { 'positions.category': { $in: agency.businessDomains || [] } };

            const candidatesInRegion = await Candidate.countDocuments({
                submissionDate: { $gte: startDate },
                ...regionQuery
            });

            // Get top requested positions
            const topPositions = await Candidate.aggregate([
                { $match: { submissionDate: { $gte: startDate } } },
                { $unwind: '$positions' },
                { $group: { _id: '$positions.title', count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 5 },
                { $project: { _id: 1 } }
            ]);

            return {
                companyName: agency.companyName,
                recruitmentEmails: agency.recruitmentEmails,
                cvsReceived: candidatesInRegion,
                topPositions: topPositions.map(p => p._id),
                serviceRegions: agency.supportRegions,
                dailyLimit: agency.distributionSettings?.maxCVsPerDay || 50,
                dailyUsage: agency.distributionSettings?.dailyCount || 0,
                weekStarting: startDate
            };

        } catch (error) {
            console.error(`Error getting weekly stats for ${agency.companyName}:`, error);
            return {
                companyName: agency.companyName,
                recruitmentEmails: agency.recruitmentEmails,
                cvsReceived: 0,
                topPositions: [],
                serviceRegions: agency.supportRegions,
                dailyLimit: 50,
                dailyUsage: 0
            };
        }
    }

    // Reset daily counters for all agencies
    async resetDailyCounters() {
        try {
            console.log('Resetting daily distribution counters...');

            const result = await Company.updateMany(
                {
                    isRecruitmentAgency: true,
                    'distributionSettings.dailyCount': { $gt: 0 }
                },
                {
                    $set: {
                        'distributionSettings.dailyCount': 0,
                        'distributionSettings.lastCountReset': new Date()
                    }
                }
            );

            console.log(`Reset daily counters for ${result.modifiedCount} agencies`);

        } catch (error) {
            console.error('Failed to reset daily counters:', error);
            throw error;
        }
    }

    // System health check
    async systemHealthCheck() {
        try {
            const health = monitor.getHealthStatus();
            const validation = await monitor.validateSystemConfiguration();
            const performance = monitor.getPerformanceMetrics();

            // Log critical issues
            if (health.status === 'critical' || !validation.isValid) {
                console.error('SYSTEM HEALTH ALERT:', {
                    distributionHealth: health.status,
                    configurationValid: validation.isValid,
                    issues: [...(health.issues || []), ...(validation.issues || [])]
                });
            }

            // Log performance warnings
            if (performance && performance.memory.heapUsed > 500) { // More than 500MB
                console.warn(`High memory usage: ${performance.memory.heapUsed}MB`);
            }

            // Check database connection
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState !== 1) {
                console.error('Database connection issue detected');
            }

        } catch (error) {
            console.error('System health check failed:', error);
        }
    }

    // Check subscription expiry and send notifications
    async checkSubscriptionExpiry() {
        try {
            console.log('Checking subscription expiry...');

            const now = new Date();
            const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
            const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

            // Find subscriptions expiring soon
            const expiringSoon = await Subscription.find({
                status: 'active',
                expirationDate: {
                    $gte: now,
                    $lte: sevenDaysFromNow
                }
            }).populate('companyId').lean();

            let notificationsSent = 0;

            for (const subscription of expiringSoon) {
                try {
                    const daysLeft = Math.ceil((subscription.expirationDate - now) / (1000 * 60 * 60 * 24));

                    // Send notification for 7 days, 3 days, and 1 day remaining
                    if ([7, 3, 1].includes(daysLeft)) {
                        // You would implement sendSubscriptionExpiryNotification in emailService
                        console.log(`Subscription expiring in ${daysLeft} days: ${subscription.companyId.companyName}`);
                        notificationsSent++;
                    }

                } catch (error) {
                    console.error(`Failed to process expiry notification for subscription ${subscription._id}:`, error);
                }
            }

            // Mark expired subscriptions
            const expiredResult = await Subscription.updateMany(
                {
                    status: 'active',
                    expirationDate: { $lt: now }
                },
                {
                    $set: { status: 'expired' }
                }
            );

            console.log(`Subscription check: ${notificationsSent} notifications sent, ${expiredResult.modifiedCount} subscriptions marked as expired`);

        } catch (error) {
            console.error('Subscription expiry check failed:', error);
            throw error;
        }
    }

    // Handle job errors
    async handleJobError(jobName, error) {
        try {
            const errorInfo = {
                job: jobName,
                error: error.message,
                timestamp: new Date(),
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            };

            console.error('Background job error:', errorInfo);

            // Could send alert to admins here
            // await emailService.sendJobErrorAlert(errorInfo);

        } catch (handlerError) {
            console.error('Error in job error handler:', handlerError);
        }
    }

    // Get job status
    getJobStatus() {
        const status = new Map();

        for (const [name, task] of this.jobs) {
            status.set(name, {
                name,
                running: task.running,
                scheduled: task.scheduled,
                lastRun: task.lastDate,
                nextRun: task.nextDate
            });
        }

        return Array.from(status.values());
    }

    // Stop all jobs
    async shutdown() {
        try {
            console.log('Shutting down background jobs...');
            this.isShuttingDown = true;

            for (const [name, task] of this.jobs) {
                task.stop();
                console.log(`Stopped job: ${name}`);
            }

            this.jobs.clear();
            console.log('All background jobs stopped');

        } catch (error) {
            console.error('Error shutting down background jobs:', error);
        }
    }

    // Manually trigger a job (for testing/admin use)
    async triggerJob(jobName) {
        const jobMethods = {
            'dailyCleanup': this.runDailyCleanup.bind(this),
            'resetCounters': this.resetDailyCounters.bind(this),
            'healthCheck': this.systemHealthCheck.bind(this),
            'subscriptionCheck': this.checkSubscriptionExpiry.bind(this)
        };

        const jobMethod = jobMethods[jobName];
        if (!jobMethod) {
            throw new Error(`Job not found: ${jobName}`);
        }

        console.log(`Manually triggering job: ${jobName}`);
        await jobMethod();
        console.log(`Job completed: ${jobName}`);
    }
}

// Export singleton instance
const jobsManager = new BackgroundJobsManager();

// Graceful shutdown handler
process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down background jobs gracefully');
    jobsManager.shutdown();
});

process.on('SIGINT', () => {
    console.log('Received SIGINT, shutting down background jobs gracefully');
    jobsManager.shutdown();
});

module.exports = jobsManager;