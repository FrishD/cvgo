// config/security.js - Security Configuration
const corsConfig = {
    origin: process.env.ALLOWED_ORIGINS ?
        process.env.ALLOWED_ORIGINS.split(',') : ['http://localhost:3000'],
    credentials: true
};

const helmetConfig = {
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://cdnjs.cloudflare.com",
                "https://unpkg.com",
                "https://cdn.tailwindcss.com",
                "https://cdn.jsdelivr.net"
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://fonts.googleapis.com",
                "https://fonts.gstatic.com",
                "https://cdn.jsdelivr.net",
                "https://cdnjs.cloudflare.com"
            ],
            fontSrc: ["'self'", "https:", "data:"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"]
        }
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
};

const JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(64).toString('hex');
const SESSION_SECRET = process.env.SESSION_SECRET || require('crypto').randomBytes(64).toString('hex');

module.exports = {
    corsConfig,
    helmetConfig,
    JWT_SECRET,
    SESSION_SECRET
};