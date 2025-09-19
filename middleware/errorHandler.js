// middleware/errorHandler.js - Error Handler Middleware
const multer = require('multer');

const globalErrorHandler = (error, req, res, next) => {
    console.error('Global error handler:', error);

    // Multer errors
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: 'File too large - maximum 10MB allowed'
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                error: 'Only one file upload allowed'
            });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                error: 'Unexpected file field'
            });
        }
    }

    // Mongoose validation errors
    if (error.name === 'ValidationError') {
        const errors = Object.values(error.errors).map(e => e.message);
        return res.status(400).json({
            error: 'Validation failed',
            details: errors
        });
    }

    // Mongoose duplicate key error
    if (error.code === 11000) {
        const field = Object.keys(error.keyValue)[0];
        return res.status(409).json({
            error: `Duplicate ${field} - already exists in system`
        });
    }

    // JWT errors
    if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
            error: 'Invalid authentication token'
        });
    }

    if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
            error: 'Authentication token expired'
        });
    }

    // MongoDB connection errors
    if (error.name === 'MongoNetworkError' || error.name === 'MongoTimeoutError') {
        return res.status(503).json({
            error: 'Database temporarily unavailable'
        });
    }

    // Default error response
    res.status(error.status || 500).json({
        error: error.message || 'Internal server error',
        details: process.env.NODE_ENV === 'development' ?
            error.stack : 'Please try again later'
    });
};

module.exports = {
    globalErrorHandler
};