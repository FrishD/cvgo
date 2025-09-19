// middleware/spamDetection.js - Spam Detection Middleware
const crypto = require('crypto');
const { SpamDetection } = require('../models');

const enhancedSpamDetection = async (req, res, next) => {
    try {
        let clientIP = req.ip || req.connection.remoteAddress;
        if (clientIP === '::1') clientIP = '127.0.0.1';

        const userAgent = req.get('User-Agent') || '';
        const identifier = crypto.createHash('sha256').update(clientIP + userAgent).digest('hex');

        const now = new Date();
        const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
        const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        let spamRecord = await SpamDetection.findOne({ identifier });

        if (!spamRecord) {
            spamRecord = new SpamDetection({
                identifier,
                ipAddress: clientIP,
                userAgent: userAgent.substring(0, 500)
            });
        }

        if (spamRecord.blocked && !spamRecord.whitelist) {
            return res.status(429).json({
                error: 'Access blocked due to suspicious activity',
                blockReason: spamRecord.blockReason || 'Multiple violations'
            });
        }

        // Reset daily counters
        if (spamRecord.lastAttempt < oneDayAgo) {
            spamRecord.attempts = 1;
            spamRecord.emails = [];
            spamRecord.phones = [];
            spamRecord.suspiciousActivity = spamRecord.suspiciousActivity.filter(
                activity => activity.timestamp > oneDayAgo
            );
            spamRecord.riskScore = Math.max(0, spamRecord.riskScore - 1);
        } else if (spamRecord.lastAttempt < fifteenMinutesAgo) {
            spamRecord.attempts = Math.max(1, spamRecord.attempts - 2);
        } else {
            spamRecord.attempts++;
        }

        spamRecord.lastAttempt = now;

        let riskIncrease = 0;

        // Check for rapid fire requests
        if (spamRecord.attempts > 5) {
            riskIncrease += 2;
            spamRecord.suspiciousActivity.push({
                type: 'rapid_fire',
                details: `${spamRecord.attempts} attempts in short period`
            });
        }

        // Check for bot patterns
        if (!userAgent || userAgent.length < 20 || /bot|crawler|spider/i.test(userAgent)) {
            riskIncrease += 1;
            spamRecord.suspiciousActivity.push({
                type: 'bot_pattern',
                details: `Suspicious user agent: ${userAgent.substring(0, 100)}`
            });
        }

        spamRecord.riskScore = Math.min(10, spamRecord.riskScore + riskIncrease);

        // Block if risk is too high
        if (spamRecord.riskScore >= 8 && !spamRecord.whitelist) {
            spamRecord.blocked = true;
            spamRecord.blockReason = 'High risk score reached';
            await spamRecord.save();
            return res.status(429).json({
                error: 'Access blocked due to suspicious activity patterns'
            });
        }

        // Block if too many attempts
        if (spamRecord.attempts > 20 && !spamRecord.whitelist) {
            spamRecord.blocked = true;
            spamRecord.blockReason = 'Excessive request attempts';
            await spamRecord.save();
            return res.status(429).json({
                error: 'Too many attempts - access blocked'
            });
        }

        await spamRecord.save();
        req.spamRecord = spamRecord;
        next();
    } catch (error) {
        console.error('Enhanced spam detection error:', error);
        next();
    }
};

module.exports = {
    enhancedSpamDetection
};