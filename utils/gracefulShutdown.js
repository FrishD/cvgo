// utils/gracefulShutdown.js - Graceful Shutdown Utility
const mongoose = require('mongoose');

const gracefulShutdown = (signal) => {
    console.log(`Received ${signal}, shutting down gracefully...`);

    mongoose.connection.close(() => {
        console.log('MongoDB connection closed');
        process.exit(0);
    });
};

module.exports = {
    gracefulShutdown
};