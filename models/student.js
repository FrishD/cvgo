// models/student.js - Fixed validation logic
const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
    // Basic Info
    name: { type: String, maxlength: 100, index: true, default: '' },
    email: {
        type: String,
        lowercase: true,
        match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        sparse: true,
        default: null
    },
    phone: { type: String, maxlength: 20, default: '' },

    education: {
        currentDegree: {
            type: String,
            enum: ['bachelor', 'master', 'certificate', 'professional_course', 'other', ''],
            default: ''
        },
        studyYear: { type: String, maxlength: 50, default: '' },
        degreeField: { type: String, maxlength: 200, default: '' },
        institution: { type: String, maxlength: 200, default: '' },
        gpa: { type: Number, min: 0, max: 100, default: null },
        transcriptFile: {
            filename: String,
            path: String,
            uploadDate: { type: Date, default: Date.now }
        }
    },

    workExperience: {
        hasExperience: { type: Boolean, default: null },
        description: { type: String, maxlength: 1000, default: '' }
    },

    specialRoles: { type: String, maxlength: 1000, default: '' },

    location: {
        city: { type: String, maxlength: 100, default: '' },
        flexible: { type: Boolean, default: false }
    },

    availability: {
        hoursPerWeek: {
            type: String,
            enum: ['full_time', 'part_time', 'flexible', 'other', ''],
            default: ''
        },
        flexibleHours: {
            available: { type: Boolean, default: false },
            details: { type: String, maxlength: 500, default: '' }
        }
    },

    personalStatement: { type: String, maxlength: 2000, default: '' },
    additionalInfo: { type: String, maxlength: 1000, default: '' },

    links: {
        github: { type: String, maxlength: 500, default: '' },
        linkedin: { type: String, maxlength: 500, default: '' },
        portfolio: { type: String, maxlength: 500, default: '' }
    },

    cvFile: {
        filename: String,
        path: String,
        uploadDate: { type: Date, default: Date.now }
    },

    chatProgress: {
        currentStep: { type: Number, default: 1, min: 1, max: 18 },
        completed: { type: Boolean, default: false },
        sessionId: { type: String, unique: true, sparse: true }
    },

    termsAccepted: { type: Boolean, default: false },
    profileComplete: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    lastUpdated: { type: Date, default: Date.now },
    replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', default: null }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Custom email uniqueness validation
studentSchema.pre('save', async function(next) {
    try {
        // Check email uniqueness if email exists
        if (this.email && this.email.trim() !== '') {
            const existingStudent = await mongoose.models.Student.findOne({
                email: this.email,
                isActive: true,
                _id: { $ne: this._id }
            });

            if (existingStudent) {
                if (this.isNew && existingStudent.replacedBy && existingStudent.replacedBy.equals(this._id)) {
                    return next();
                }

                const error = new Error('Email already exists in active profile');
                error.name = 'ValidationError';
                error.existingUser = {
                    id: existingStudent._id,
                    name: existingStudent.name,
                    email: existingStudent.email,
                    completionPercentage: this.calculateCompletionPercentage(existingStudent)
                };
                return next(error);
            }
        }

        // Profile completion validation - only when explicitly setting to true
        if (this.profileComplete && this.isModified('profileComplete')) {
            const requiredFields = [
                { field: 'name', value: this.name },
                { field: 'email', value: this.email },
                { field: 'phone', value: this.phone },
                { field: 'education.currentDegree', value: this.education?.currentDegree },
                { field: 'education.institution', value: this.education?.institution },
                { field: 'location.city', value: this.location?.city },
                { field: 'availability.hoursPerWeek', value: this.availability?.hoursPerWeek },
                { field: 'termsAccepted', value: this.termsAccepted }
            ];

            for (const { field, value } of requiredFields) {
                if (!value || value === '' || value === false) {
                    const error = new Error(`${field} is required for complete profile`);
                    error.name = 'ValidationError';
                    return next(error);
                }
            }
        }

        next();
    } catch (error) {
        next(error);
    }
});

// Helper methods
studentSchema.methods.calculateCompletionPercentage = function(student = this) {
    let completed = 0;
    const total = 10;

    if (student.name && student.email && student.phone) completed++;
    if (student.education?.currentDegree && student.education?.institution) completed++;
    if (student.education?.gpa) completed++;
    if (student.education?.transcriptFile?.filename) completed++;
    if (student.workExperience?.hasExperience !== undefined && student.workExperience?.hasExperience !== null) completed++;
    if (student.location?.city) completed++;
    if (student.availability?.hoursPerWeek) completed++;
    if (student.personalStatement) completed++;
    if (student.links?.github || student.links?.linkedin || student.links?.portfolio) completed++;
    if (student.cvFile?.filename) completed++;

    return Math.round((completed / total) * 100);
};

studentSchema.virtual('completionPercentage').get(function() {
    return this.calculateCompletionPercentage();
});

// Update progress method
studentSchema.methods.updateProgress = function(step) {
    this.chatProgress.currentStep = Math.max(this.chatProgress.currentStep, step);
    this.lastUpdated = new Date();

    if (step >= 18) {
        this.chatProgress.completed = true;

        const hasRequiredData = this.name &&
            this.email &&
            this.phone &&
            this.education?.currentDegree &&
            this.education?.institution &&
            this.location?.city &&
            this.availability?.hoursPerWeek &&
            this.termsAccepted;

        if (hasRequiredData) {
            this.profileComplete = true;
        }
    }

    return this.save();
};

studentSchema.methods.replaceExistingProfile = async function(existingUserId) {
    const existingUser = await mongoose.models.Student.findById(existingUserId);
    if (existingUser) {
        existingUser.isActive = false;
        existingUser.replacedBy = this._id;
        await existingUser.save();
    }
    return this.save();
};

studentSchema.methods.updateEmail = async function(newEmail) {
    if (!newEmail || newEmail.trim() === '') {
        this.email = null;
        return this.save();
    }

    newEmail = newEmail.toLowerCase().trim();

    const existing = await mongoose.models.Student.findOne({
        email: newEmail,
        isActive: true,
        _id: { $ne: this._id }
    });

    if (existing) {
        throw new Error('Email already exists');
    }

    this.email = newEmail;
    return this.save();
};

// Indexes
studentSchema.index({ email: 1 }, {
    sparse: true,
    unique: true,
    partialFilterExpression: {
        email: { $type: "string", $ne: null },
        isActive: true
    }
});
studentSchema.index({ phone: 1 });
studentSchema.index({ 'chatProgress.sessionId': 1 }, { sparse: true });
studentSchema.index({ profileComplete: 1, isActive: 1 });
studentSchema.index({ createdAt: -1 });

const Student = mongoose.models.Student || mongoose.model('Student', studentSchema);

module.exports = { Student };