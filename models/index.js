// models/index.js - Database Models (Fixed)
const mongoose = require('mongoose');

// User Schema
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, maxlength: 50, index: true },
    email: { type: String, required: true, unique: true, index: true },
    password: { type: String, required: true, minlength: 60 },
    fullName: { type: String, required: true, maxlength: 100 },
    position: {
        type: String,
        enum: ['owner', 'admin', 'member'],
        required: true
    },
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    city: { type: String, required: true, maxlength: 50 },
    address: { type: String, required: true, maxlength: 200 },
    phone: { type: String, required: true, maxlength: 20 },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    permissions: [{
        resource: { type: String, required: true },
        actions: [{ type: String, enum: ['read', 'write', 'delete', 'manage'] }]
    }],
    favoriteStudents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Student'
    }]
}, { timestamps: true });

// Company Schema
const companySchema = new mongoose.Schema({
    companyName: { type: String, required: true, maxlength: 100, index: true },
    address: { type: String, required: true, maxlength: 200 },
    city: { type: String, required: true, maxlength: 50 },
    phone: { type: String, required: true, maxlength: 20 },
    companyDescription: { type: String, required: true, maxlength: 1000 },
    logo: { type: String, maxlength: 500 },
    supportRegions: [{
        type: String,
        enum: ['north', 'center', 'lowlands', 'south']
    }],
    businessDomains: [{ type: String, maxlength: 100 }],
    isRecruitmentAgency: { type: Boolean, default: false },
    isRecruitmentAccess: {
        type: String,
        enum: ['pending', 'approved', 'denied'],
        default: 'pending'
    },
    recruitmentEmails: [{
        email: { type: String, required: true, match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
        isActive: { type: Boolean, default: true },
        addedAt: { type: Date, default: Date.now }
    }],
    distributionSettings: {
        enabled: { type: Boolean, default: true },
        maxCVsPerDay: { type: Number, default: 50 },
        dailyCount: { type: Number, default: 0 },
        lastCountReset: { type: Date, default: Date.now }
    },
    isActive: { type: Boolean, default: true },
    approvedAt: { type: Date },
    email: { type: String, required: true, unique: true, index: true },
    website: { type: String, maxlength: 255 }
}, { timestamps: true });

// Candidate Schema - Fixed enum values
const candidateSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100,
        index: true,
        validate: {
            validator: function(v) {
                return /^[\u0590-\u05FFa-zA-Z\s\-\.\']{2,}$/.test(v);
            },
            message: 'Invalid name format'
        }
    },
    email: {
        type: String,
        required: true,
        trim: true,
        lowercase: true,
        maxlength: 255,
        unique: true,
        index: true,
        validate: {
            validator: function(v) {
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: 'Invalid email format'
        }
    },
    phone: {
        type: String,
        required: true,
        trim: true,
        maxlength: 20,
        index: true,
        validate: {
            validator: function(v) {
                return /^[\d\-\s\+\(\)]+$/.test(v);
            },
            message: 'Invalid phone format'
        }
    },
    positions: [{
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
            index: true
        },
        category: {
            type: String,
            enum: ['טכנולוגי', 'משרדי', 'מכירות/שיווק', 'מחשבים', 'בכירים', 'אחר'],
            default: 'אחר'
        },
        experience: { type: String, maxlength: 500 },
        skills: [{ type: String, maxlength: 50 }]
    }],
    submissionDate: {
        type: Date,
        default: Date.now,
        index: true
    },
    ipAddress: {
        type: String,
        required: true,
        validate: {
            validator: function(v) {
                return /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$|^::ffff:[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/.test(v);
            },
            message: 'Invalid IP address'
        }
    },
    location: { type: String, maxlength: 255, default: '' },
    userAgent: { type: String, maxlength: 500 },
    fingerprint: { type: String, index: true },
    metadata: {
        filename: { type: String, maxlength: 255 },
        filesize: { type: Number, min: 0, max: 10485760 },
        textLength: { type: Number, min: 0 },
        processingTime: String,
        confidence: mongoose.Schema.Types.Mixed,
        detectionScore: { type: Number, min: 0, max: 1 }
    },
    verified: { type: Boolean, default: false },
    verificationToken: { type: String },
    source: {
        type: String,
        enum: ['upload', 'manual', 'import', 'verification_form'],
        default: 'upload'
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Spam Detection Schema
const spamDetectionSchema = new mongoose.Schema({
    identifier: { type: String, required: true, unique: true, index: true },
    ipAddress: { type: String, required: true, index: true },
    userAgent: { type: String, maxlength: 500 },
    attempts: { type: Number, default: 1, min: 0 },
    lastAttempt: { type: Date, default: Date.now, index: true },
    blocked: { type: Boolean, default: false, index: true },
    blockReason: { type: String, maxlength: 200 },
    emails: [{ type: String, maxlength: 255 }],
    phones: [{ type: String, maxlength: 20 }],
    suspiciousActivity: [{
        type: {
            type: String,
            enum: ['rapid_fire', 'duplicate_data', 'invalid_file', 'bot_pattern', 'submission_error']
        },
        timestamp: { type: Date, default: Date.now },
        details: { type: String, maxlength: 500 }
    }],
    whitelist: { type: Boolean, default: false },
    riskScore: { type: Number, min: 0, max: 10, default: 0 }
}, { timestamps: true });

// Upload Limit Schema
const uploadLimitSchema = new mongoose.Schema({
    phone: { type: String, required: true, index: true },
    email: { type: String, required: true, index: true },
    lastUpload: { type: Date, default: Date.now },
    uploadCount: { type: Number, default: 1, min: 0 },
    dailyCount: { type: Number, default: 1, min: 0 },
    lastDailyReset: { type: Date, default: Date.now }
}, { timestamps: true });

// Subscription Schema - Consolidated
const subscriptionSchema = new mongoose.Schema({
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
    type: {
        type: String,
        enum: ['basic', 'premium', 'enterprise'],
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'inactive', 'expired'],
        default: 'active',
        index: true
    },
    remainingExposures: {
        type: Number,
        default: 0,
        min: 0
    },
    expiresAt: {
        type: Date,
        required: true,
        index: true
    },
    features: [String]
}, { timestamps: true });

// Static methods for Subscription
subscriptionSchema.statics.findValidSubscription = async function(userId) {
    return this.findOne({
        userId,
        remainingExposures: { $gt: 0 },
        expiresAt: { $gt: new Date() },
        status: 'active'
    });
};

subscriptionSchema.methods.useExposure = async function() {
    if (this.remainingExposures > 0) {
        this.remainingExposures -= 1;
        await this.save();
        return this;
    } else {
        throw new Error('No remaining exposures');
    }
};

// Create models
const User = mongoose.model('User', userSchema);
const Company = mongoose.model('Company', companySchema);
const Candidate = mongoose.model('Candidate', candidateSchema);
const SpamDetection = mongoose.model('SpamDetection', spamDetectionSchema);
const UploadLimit = mongoose.model('UploadLimit', uploadLimitSchema);
const Subscription = mongoose.model('Subscription', subscriptionSchema);

// Import other models
const { Student } = require('./student');
const Exposure = require('./exposure');

module.exports = {
    User,
    Company,
    Candidate,
    Student,
    SpamDetection,
    UploadLimit,
    Exposure,
    Subscription
};