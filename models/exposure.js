const mongoose = require('mongoose');

const exposureSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student',
        required: true,
        index: true
    },
    subscriptionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Subscription',
        required: true
    },
    exposureType: {
        type: String,
        enum: ['full_profile', 'basic_info'],
        default: 'full_profile'
    },
    expiresAt: {
        type: Date,
        required: true,
        index: true
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    accessedAt: [{
        timestamp: {
            type: Date,
            default: Date.now
        },
        ipAddress: String,
        userAgent: String
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Compound indexes
exposureSchema.index({ userId: 1, studentId: 1 }, { unique: true });
exposureSchema.index({ companyId: 1, studentId: 1 });
exposureSchema.index({ isActive: 1, expiresAt: 1 });

// Virtual for checking validity
exposureSchema.virtual('isValid').get(function() {
    return this.isActive && new Date() < this.expiresAt;
});

// Record access method
exposureSchema.methods.recordAccess = function(ipAddress, userAgent) {
    this.accessedAt.push({
        timestamp: new Date(),
        ipAddress: ipAddress || 'unknown',
        userAgent: userAgent || 'unknown'
    });

    // Keep only last 10 access records
    if (this.accessedAt.length > 10) {
        this.accessedAt = this.accessedAt.slice(-10);
    }

    return this.save();
};

// Static method to check access
exposureSchema.statics.hasAccess = async function(userId, studentId) {
    // Defensive check: if either ID is falsy, no access.
    if (!userId || !studentId) {
        return false;
    }

    // More robust check to prevent type casting issues.
    // Fetch all active exposures for the user.
    const activeExposures = await this.find({
        userId: userId,
        isActive: true,
        expiresAt: { $gt: new Date() }
    }).select('studentId');

    // Check if any of the user's active exposures match the studentId.
    // Compare string versions to ensure no type mismatch.
    const studentIdStr = studentId.toString();
    return activeExposures.some(exp => exp.studentId.toString() === studentIdStr);
};

// Get user's exposed students
exposureSchema.statics.getUserExposures = function(userId, options = {}) {
    const query = {
        userId,
        isActive: true,
        expiresAt: { $gt: new Date() }
    };

    return this.find(query)
        .populate('studentId', options.selectFields || '')
        .sort({ createdAt: -1 });
};

const Exposure = mongoose.model('Exposure', exposureSchema);

module.exports = Exposure;