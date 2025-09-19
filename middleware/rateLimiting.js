// middleware/rateLimiting.js - Rate Limiting Middleware
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const createRateLimit = (windowMs, max, message) => rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        const ip = req.ip || req.connection.remoteAddress;
        const userAgent = req.get('User-Agent') || '';
        return crypto.createHash('sha256').update(ip + userAgent).digest('hex');
    },
    skip: (req) => {
        const apiKey = req.headers['x-api-key'];
        return apiKey && process.env.BYPASS_API_KEYS &&
            process.env.BYPASS_API_KEYS.split(',').includes(apiKey);
    }
});

// Different rate limits for different endpoints
const generalLimiter = createRateLimit(15 * 60 * 1000, 100, 'Too many requests from this IP');
const uploadLimiter = createRateLimit(15 * 60 * 1000, 10, 'Too many file uploads');
const submitLimiter = createRateLimit(15 * 60 * 1000, 5, 'Too many submissions');
const strictLimiter = createRateLimit(5 * 60 * 1000, 3, 'Rate limit exceeded');

module.exports = {
    generalLimiter,
    uploadLimiter,
    submitLimiter,
    strictLimiter
};