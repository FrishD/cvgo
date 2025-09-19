// middleware/distributionMonitoring.js - Distribution Monitoring and Health Checks
const { Company, Candidate } = require('../models');

class DistributionMonitor {
    constructor() {
        this.healthChecks = new Map();
        this.alertThresholds = {
            maxFailureRate: 0.1, // 10% failure rate
            maxQueueLength: 500,
            maxProcessingTime: 30000, // 30 seconds
            minSuccessRate: 0.9 // 90% success rate required
        };

        // Start periodic health checks
        this.startHealthChecks();
    }

    // Log distribution attempt
    async logDistributionAttempt(candidateId, agencyId, success, error = null, processingTime = 0) {
        try {
            const logEntry = {
                timestamp: new Date(),
                candidateId,
                agencyId,
                success,
                error: error ? error.message : null,
                processingTime
            };

            // Store in memory for immediate monitoring
            const key = `${Date.now()}_${Math.random()}`;
            this.healthChecks.set(key, logEntry);

            // Clean old entries (keep last 1000)
            if (this.healthChecks.size > 1000) {
                const oldestKeys = Array.from(this.healthChecks.keys()).slice(0, 100);
                oldestKeys.forEach(key => this.healthChecks.delete(key));
            }

            // Log to console for external monitoring tools
            if (success) {
                console.log(`Distribution success: Candidate ${candidateId} -> Agency ${agencyId} (${processingTime}ms)`);
            } else {
                console.error(`Distribution failed: Candidate ${candidateId} -> Agency ${agencyId} - ${error?.message}`);
            }

            return logEntry;

        } catch (error) {
            console.error('Error logging distribution attempt:', error);
        }
    }

    // Get health status
    getHealthStatus() {
        try {
            const recentLogs = Array.from(this.healthChecks.values())
                .filter(log => Date.now() - log.timestamp.getTime() < 3600000); // Last hour

            if (recentLogs.length === 0) {
                return {
                    status: 'unknown',
                    message: 'No recent distribution activity',
                    metrics: {
                        totalAttempts: 0,
                        successRate: 0,
                        failureRate: 0,
                        avgProcessingTime: 0
                    }
                };
            }

            const totalAttempts = recentLogs.length;
            const successful = recentLogs.filter(log => log.success).length;
            const failed = totalAttempts - successful;
            const successRate = successful / totalAttempts;
            const failureRate = failed / totalAttempts;
            const avgProcessingTime = recentLogs
                .reduce((sum, log) => sum + (log.processingTime || 0), 0) / totalAttempts;

            // Determine health status
            let status = 'healthy';
            let issues = [];

            if (failureRate > this.alertThresholds.maxFailureRate) {
                status = 'warning';
                issues.push(`High failure rate: ${(failureRate * 100).toFixed(1)}%`);
            }

            if (avgProcessingTime > this.alertThresholds.maxProcessingTime) {
                status = 'warning';
                issues.push(`Slow processing: ${avgProcessingTime.toFixed(0)}ms average`);
            }

            if (successRate < this.alertThresholds.minSuccessRate) {
                status = 'critical';
                issues.push(`Low success rate: ${(successRate * 100).toFixed(1)}%`);
            }

            return {
                status,
                message: status === 'healthy' ? 'All systems operational' : issues.join(', '),
                metrics: {
                    totalAttempts,
                    successful,
                    failed,
                    successRate: Math.round(successRate * 100) / 100,
                    failureRate: Math.round(failureRate * 100) / 100,
                    avgProcessingTime: Math.round(avgProcessingTime)
                },
                issues: status !== 'healthy' ? issues : []
            };

        } catch (error) {
            console.error('Error getting health status:', error);
            return {
                status: 'error',
                message: 'Health check failed',
                error: error.message
            };
        }
    }

    // Start periodic health checks
    startHealthChecks() {
        // Health check every 5 minutes
        setInterval(() => {
            const health = this.getHealthStatus();

            if (health.status === 'critical') {
                console.error('CRITICAL: Distribution system health degraded:', health.message);
                this.sendHealthAlert(health);
            } else if (health.status === 'warning') {
                console.warn('WARNING: Distribution system performance issues:', health.message);
            }

        }, 5 * 60 * 1000); // 5 minutes

        console.log('Distribution monitoring started');
    }

    // Send health alerts (integrate with your alerting system)
    async sendHealthAlert(healthStatus) {
        try {
            // You can integrate with external alerting services here
            // For now, just log critical issues
            console.error('=== DISTRIBUTION SYSTEM ALERT ===');
            console.error('Status:', healthStatus.status);
            console.error('Message:', healthStatus.message);
            console.error('Metrics:', JSON.stringify(healthStatus.metrics, null, 2));
            console.error('Time:', new Date().toISOString());
            console.error('================================');

            // Send email alert to admins if email service is available
            try {
                const emailService = require('../services/emailService');
                if (emailService && process.env.ADMIN_EMAILS) {
                    // Implementation would go here
                }
            } catch (emailError) {
                console.error('Failed to send email alert:', emailError);
            }

        } catch (error) {
            console.error('Error sending health alert:', error);
        }
    }

    // Get distribution statistics for reporting
    async getDistributionStats(days = 7) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            // Get active agencies
            const activeAgencies = await Company.countDocuments({
                isRecruitmentAgency: true,
                isRecruitmentAccess: 'approved',
                isActive: true,
                'recruitmentEmails.0': { $exists: true }
            });

            // Get candidates submitted in period
            const candidatesInPeriod = await Candidate.countDocuments({
                submissionDate: { $gte: startDate }
            });

            // Get recent health metrics
            const recentHealth = this.getHealthStatus();

            return {
                period: `${days} days`,
                activeAgencies,
                candidatesProcessed: candidatesInPeriod,
                estimatedDistributions: candidatesInPeriod * activeAgencies,
                systemHealth: recentHealth,
                lastUpdated: new Date()
            };

        } catch (error) {
            console.error('Error getting distribution stats:', error);
            return null;
        }
    }

    // Validate system configuration
    async validateSystemConfiguration() {
        try {
            const issues = [];

            // Check database connectivity
            const mongoose = require('mongoose');
            if (mongoose.connection.readyState !== 1) {
                issues.push('Database connection issue');
            }

            // Check for agencies with no active emails
            const agenciesWithoutEmails = await Company.countDocuments({
                isRecruitmentAgency: true,
                isRecruitmentAccess: 'approved',
                isActive: true,
                $or: [
                    { recruitmentEmails: { $size: 0 } },
                    { 'recruitmentEmails.isActive': { $ne: true } }
                ]
            });

            if (agenciesWithoutEmails > 0) {
                issues.push(`${agenciesWithoutEmails} active agencies without valid email addresses`);
            }

            // Check storage space (if applicable)
            try {
                const cvFileService = require('../services/cvFileService');
                const storageStats = await cvFileService.getStorageStats();
                if (storageStats && storageStats.usagePercentage > 90) {
                    issues.push(`Storage almost full: ${storageStats.usagePercentage}% used`);
                }
            } catch (storageError) {
                issues.push('Unable to check storage status');
            }

            return {
                isValid: issues.length === 0,
                issues,
                checkedAt: new Date()
            };

        } catch (error) {
            console.error('Error validating system configuration:', error);
            return {
                isValid: false,
                issues: ['System configuration validation failed'],
                error: error.message,
                checkedAt: new Date()
            };
        }
    }

    // Get performance metrics
    getPerformanceMetrics() {
        try {
            const process = require('process');
            const used = process.memoryUsage();
            const cpuUsage = process.cpuUsage();

            return {
                memory: {
                    heapUsed: Math.round(used.heapUsed / 1024 / 1024),
                    heapTotal: Math.round(used.heapTotal / 1024 / 1024),
                    external: Math.round(used.external / 1024 / 1024),
                    rss: Math.round(used.rss / 1024 / 1024)
                },
                cpu: {
                    user: cpuUsage.user,
                    system: cpuUsage.system
                },
                uptime: process.uptime(),
                distributionQueue: this.healthChecks.size,
                timestamp: new Date()
            };

        } catch (error) {
            console.error('Error getting performance metrics:', error);
            return null;
        }
    }
}

// Export singleton instance
const monitor = new DistributionMonitor();

// Middleware function for route monitoring
const monitorDistribution = (req, res, next) => {
    req.distributionMonitor = monitor;
    next();
};

module.exports = {
    monitor,
    monitorDistribution
};