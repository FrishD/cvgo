// Updated server.js to include student profile chat feature
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');

// Import configurations
const { connectToMongoDB } = require('./config/database');
const { sessionConfig } = require('./config/session');
const { corsConfig, helmetConfig } = require('./config/security');

// Import middleware
const { generalLimiter } = require('./middleware/rateLimiting');
const { globalErrorHandler } = require('./middleware/errorHandler');
const { authenticateToken, addFeatureAccessInfo } = require('./middleware/auth');

// Import routes
const authRoutes = require('./routes/auth');
const candidateRoutes = require('./routes/candidates');
const adminRoutes = require('./routes/admin');
const userRoutes = require('./routes/users');
const featureRoutes = require('./routes/features');
const recruitmentEmailRoutes = require('./routes/recruitmentEmails');
const adminDistributionRoutes = require('./routes/adminDistribution');
const studentRoutes = require('./routes/students'); // NEW: Student profile chat

const backgroundJobsManager = require('./services/backgroundJobsManager');
console.log('Background jobs manager initialized');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database connection
connectToMongoDB();

// Security middleware
app.use(helmet(helmetConfig));
app.use(compression());
app.use(cors(corsConfig));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session(sessionConfig));

// Rate limiting
app.use(generalLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/features', featureRoutes);
app.use('/api/recruitment-emails', recruitmentEmailRoutes);
app.use('/api/admin/distribution', adminDistributionRoutes);
app.use('/api/students', studentRoutes); // NEW: Student profile chat routes
app.use('/api/secure-students', require('./routes/secureStudentData'));

// Health check
app.get('/api/health', (req, res) => {
    const mongoose = require('mongoose');
    const health = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '1.0.0',
        services: {
            mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
            },
            features: {
                studentProfiles: true,
                cvParsing: true,
                chatFlow: true
            }
        }
    };

    const httpStatus = health.services.mongodb === 'connected' ? 200 : 503;
    res.status(httpStatus).json(health);
});

// Static pages
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/verify.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'verify.html'));
});

// NEW: Student profile chat page
app.get('/student-chat.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'student-chat.html'));
});

// NEW: Student admin page
app.get('/student-admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'student-admin.html'));
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.originalUrl
    });
});

// Global error handler
app.use(globalErrorHandler);

// Graceful shutdown
const { gracefulShutdown } = require('./utils/gracefulShutdown');
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
const server = app.listen(PORT, () => {
    console.log(`Enhanced CV Parser Server with Student Profiles running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`New Features: Student Profile Chat (/api/students)`);

    const mongoose = require('mongoose');
    console.log(`MongoDB: ${mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected'}`);
});

server.on('error', (error) => {
    console.error('Server error:', error);
    process.exit(1);
});

module.exports = app;