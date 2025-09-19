// services/cvDistributionService.js - CV Distribution to Recruitment Agencies
const { Company, Subscription } = require('../models');
const emailService = require('./emailService');
const fs = require('fs').promises;
const path = require('path');

class CVDistributionService {
    constructor() {
        this.isProcessing = false;
        this.distributionQueue = [];
        this.maxBatchSize = 100;
        this.batchDelay = 1000; // 1 second between batches
    }

    // Main distribution methodכ
    async distributeCVToAgencies(candidate) {
        try {
            if (!candidate || !candidate.positions || candidate.positions.length === 0) {
                throw new Error('Invalid candidate data');
            }

            // Get candidate's preferred region
            const candidateRegion = this.extractRegionFromCandidate(candidate);

            console.log(`Starting CV distribution for candidate: ${candidate._id}, region: ${candidateRegion}`);

            // Find active recruitment agencies with valid subscriptions
            const eligibleAgencies = await this.getEligibleAgencies(candidateRegion);

            if (eligibleAgencies.length === 0) {
                console.log('No eligible agencies found for distribution');
                return { success: true, distributed: 0 };
            }

            console.log(`Found ${eligibleAgencies.length} eligible agencies for distribution`);

            // Add to processing queue
            const distributionTask = {
                candidate,
                agencies: eligibleAgencies,
                timestamp: new Date(),
                id: `${candidate._id}_${Date.now()}`
            };

            this.distributionQueue.push(distributionTask);

            // Process queue if not already processing
            if (!this.isProcessing) {
                this.processDistributionQueue();
            }

            return { success: true, distributed: eligibleAgencies.length };

        } catch (error) {
            console.error('CV distribution error:', error);
            throw error;
        }
    }

    // Extract region from candidate data - UPDATED
    extractRegionFromCandidate(candidate) {
        // Use the location field directly if it exists and is valid
        if (candidate.location &&
            ['north', 'center', 'lowlands', 'south'].includes(candidate.location.toLowerCase())) {
            return candidate.location.toLowerCase();
        }

        // Fallback to address/city mapping if location is not set
        const location = (candidate.address || candidate.city || '').toLowerCase();

        const regionMap = {
            // North (צפונית לחדרה / north of Hadera)
            'חיפה': 'north', 'נצרת': 'north', 'טבריה': 'north', 'קריית שמונה': 'north',
            'עכו': 'north', 'נהריה': 'north', 'צפת': 'north', 'קצרין': 'north',
            'כרמיאל': 'north', 'מעלות': 'north', 'קריית ביאליק': 'north',

            // Center (הרצליה עד ראשון לציון / Herzliya to Rishon Lezion)
            'תל אביב': 'center', 'רמת גן': 'center', 'פתח תקווה': 'center',
            'הרצליה': 'center', 'נתניה': 'center', 'רעננה': 'center',
            'הוד השרון': 'center', 'ראשון לציון': 'center', 'בני ברק': 'center',
            'רמת השרון': 'center', 'כפר סבא': 'center', 'רחובות': 'center',

            // Lowlands (ראשון לציון עד אשקלון / Rishon Lezion to Ashkelon)
            'אשדוד': 'lowlands', 'גדרה': 'lowlands', 'יבנה': 'lowlands',
            'אשקלון': 'lowlands', 'נס ציונה': 'lowlands', 'קריית מלאכי': 'lowlands',

            // South (דרומית לאשקלון / south of Ashkelon)
            'באר שבע': 'south', 'אילת': 'south', 'דימונה': 'south',
            'נתיבות': 'south', 'אופקים': 'south', 'ערד': 'south',

            // Jerusalem (special case)
            'ירושלים': 'center', 'בית שמש': 'center', 'מעלה אדומים': 'center'
        };

        for (const [city, region] of Object.entries(regionMap)) {
            if (location.includes(city)) {
                return region;
            }
        }

        return 'center'; // Default fallback
    }

    // Get eligible recruitment agencies
    async getEligibleAgencies(candidateRegion) {
        try {
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            console.log(`Looking for agencies serving region: ${candidateRegion}`);

            // Find active recruitment agencies with valid subscriptions - SEND TO ALL
            const agencies = await Company.find({
                isRecruitmentAgency: true,
                isRecruitmentAccess: 'approved',
                isActive: true,
                'recruitmentEmails.0': { $exists: true },
                supportRegions: { $in: [candidateRegion] } // Filter by selected regions
            }).lean();

            console.log(`Found ${agencies.length} agencies matching region criteria`);

            // Get companies with active subscriptions
            const companyIds = agencies.map(agency => agency._id);
            const activeSubscriptions = await Subscription.find({
                companyId: { $in: companyIds },
                status: 'active',
                expirationDate: { $gt: now }
            }).lean();

            console.log(`Found ${activeSubscriptions.length} active subscriptions`);

            const activeCompanyIds = new Set(activeSubscriptions.map(sub => sub.companyId.toString()));

            // Filter agencies with active subscriptions and check daily limits
            const eligibleAgencies = [];

            for (const agency of agencies) {
                if (!activeCompanyIds.has(agency._id.toString())) {
                    console.log(`Agency ${agency.companyName} skipped - no active subscription`);
                    continue; // Skip agencies without active subscription
                }

                // Check daily limit
                const settings = agency.distributionSettings || {};
                const maxDaily = settings.maxCVsPerDay || 50;
                const dailyCount = settings.dailyCount || 0;
                const lastReset = settings.lastCountReset || new Date(0);

                // Reset daily counter if needed
                let currentDailyCount = dailyCount;
                if (lastReset < oneDayAgo) {
                    currentDailyCount = 0;
                }

                if (currentDailyCount < maxDaily) {
                    eligibleAgencies.push({
                        ...agency,
                        currentDailyCount
                    });
                    console.log(`Agency ${agency.companyName} added - daily count: ${currentDailyCount}/${maxDaily}`);
                } else {
                    console.log(`Agency ${agency.companyName} skipped - daily limit reached: ${currentDailyCount}/${maxDaily}`);
                }
            }

            return eligibleAgencies;

        } catch (error) {
            console.error('Error getting eligible agencies:', error);
            throw error;
        }
    }

    // Process distribution queue
    async processDistributionQueue() {
        if (this.isProcessing || this.distributionQueue.length === 0) {
            return;
        }

        this.isProcessing = true;
        console.log(`Processing distribution queue: ${this.distributionQueue.length} tasks`);

        try {
            while (this.distributionQueue.length > 0) {
                const task = this.distributionQueue.shift();
                await this.processSingleDistribution(task);

                // Small delay between tasks to prevent overwhelming
                if (this.distributionQueue.length > 0) {
                    await this.delay(this.batchDelay);
                }
            }
        } catch (error) {
            console.error('Queue processing error:', error);
        } finally {
            this.isProcessing = false;
        }
    }

    // Process single distribution task
    async processSingleDistribution(task) {
        const { candidate, agencies } = task;
        const batchPromises = [];

        // Process in batches to prevent overwhelming email service
        for (let i = 0; i < agencies.length; i += this.maxBatchSize) {
            const batch = agencies.slice(i, i + this.maxBatchSize);

            const batchPromise = this.processBatch(candidate, batch);
            batchPromises.push(batchPromise);

            // Small delay between batches
            if (i + this.maxBatchSize < agencies.length) {
                await this.delay(500);
            }
        }

        // Wait for all batches to complete
        const results = await Promise.allSettled(batchPromises);

        // Log results
        let successCount = 0;
        let errorCount = 0;

        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                successCount += result.value.success;
                errorCount += result.value.errors;
            } else {
                errorCount += this.maxBatchSize;
                console.error(`Batch ${index} failed:`, result.reason);
            }
        });

        console.log(`Distribution completed for candidate ${candidate._id}: ${successCount} success, ${errorCount} errors`);
    }

    // Process single batch
    async processBatch(candidate, agencies) {
        const promises = agencies.map(agency => this.sendCVToAgency(candidate, agency));
        const results = await Promise.allSettled(promises);

        let success = 0;
        let errors = 0;

        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                success++;
                // Update daily count for successful sends
                this.updateDailyCount(agencies[index]._id);
            } else {
                errors++;
                console.error(`Failed to send to agency ${agencies[index]._id}:`, result.reason);
            }
        });

        return { success, errors };
    }

    // Send CV to single agency
    async sendCVToAgency(candidate, agency) {
        try {
            // Get active recruitment emails for this agency
            const activeEmails = (agency.recruitmentEmails || [])
                .filter(emailObj => emailObj.isActive)
                .map(emailObj => emailObj.email);

            if (activeEmails.length === 0) {
                throw new Error('No active recruitment emails found');
            }

            // Generate CV data for email
            const cvData = this.formatCandidateDataForEmail(candidate);

            // Send email to all active recruitment emails
            const emailPromises = activeEmails.map(email =>
                emailService.sendCVDistributionEmail(email, cvData, agency)
            );

            await Promise.all(emailPromises);

            console.log(`CV sent successfully to agency ${agency.companyName} (${activeEmails.length} recipients)`);
            return true;

        } catch (error) {
            console.error(`Error sending CV to agency ${agency.companyName}:`, error);
            throw error;
        }
    }

    // Format candidate data for email
    formatCandidateDataForEmail(candidate) {
        const primaryPosition = candidate.positions[0] || {};
        const allPositions = candidate.positions.map(p => p.title).join(', ');

        // Extract experience years if available
        const experienceText = primaryPosition.experience || '';
        const experienceMatch = experienceText.match(/(\d+).*?(שנ|year)/i);
        const experienceYears = experienceMatch ? experienceMatch[1] : 'לא צוין';

        // Extract region from address
        const region = this.extractRegionFromCandidate(candidate);

        return {
            name: candidate.name,
            email: candidate.email,
            phone: candidate.phone,
            previousJob: primaryPosition.title || 'לא צוין',
            experienceYears,
            requestedPositions: allPositions,
            region,
            submissionDate: candidate.submissionDate || new Date(),
            candidateId: candidate._id
        };
    }

    // Update daily count for agency
    async updateDailyCount(companyId) {
        try {
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

            await Company.findOneAndUpdate(
                {
                    _id: companyId,
                    'distributionSettings.lastCountReset': { $lt: oneDayAgo }
                },
                {
                    $set: {
                        'distributionSettings.dailyCount': 1,
                        'distributionSettings.lastCountReset': now
                    }
                }
            );

            // If not reset, just increment
            await Company.findByIdAndUpdate(companyId, {
                $inc: { 'distributionSettings.dailyCount': 1 }
            });

        } catch (error) {
            console.error('Error updating daily count:', error);
        }
    }

    // Utility delay function
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Get distribution statistics
    async getDistributionStats(days = 7) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            // This would require additional tracking - implement based on needs
            return {
                totalDistributions: 0,
                successfulDistributions: 0,
                failedDistributions: 0,
                activeAgencies: 0
            };
        } catch (error) {
            console.error('Error getting distribution stats:', error);
            return null;
        }
    }
}

// Export singleton instance
module.exports = new CVDistributionService();