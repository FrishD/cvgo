// utils/studentUtils.js - Student Profile Utilities
const path = require('path');
const fs = require('fs').promises;

class StudentUtils {
    // Validate file type and size
    static validateFile(file, allowedTypes = ['pdf', 'doc', 'docx']) {
        const fileExtension = path.extname(file.originalname).toLowerCase().substring(1);

        if (!allowedTypes.includes(fileExtension)) {
            throw new Error(`Invalid file type. Allowed types: ${allowedTypes.join(', ')}`);
        }

        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
            throw new Error('File size too large. Maximum size is 10MB');
        }

        return true;
    }

    // Clean and validate text input
    static cleanTextInput(text, maxLength = 1000) {
        if (!text) return '';

        // Remove excessive whitespace and normalize
        let cleaned = text.trim()
            .replace(/\s+/g, ' ')
            .replace(/[^\u0590-\u05FFa-zA-Z0-9\s\-\.,!?\(\)]/g, '');

        if (cleaned.length > maxLength) {
            cleaned = cleaned.substring(0, maxLength);
        }

        return cleaned;
    }

    // Validate email format
    static isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Validate Israeli phone number
    static isValidIsraeliPhone(phone) {
        // Remove all non-digits
        const digits = phone.replace(/\D/g, '');

        // Israeli phone patterns
        const patterns = [
            /^05\d{8}$/, // Mobile: 05XXXXXXXX
            /^0[2-4,8-9]\d{7,8}$/, // Landline: 02-XXXXXXX, 03-XXXXXXX, etc.
            /^972[2-9]\d{7,8}$/ // International format without +
        ];

        return patterns.some(pattern => pattern.test(digits));
    }

    // Format Israeli phone number
    static formatIsraeliPhone(phone) {
        const digits = phone.replace(/\D/g, '');

        if (digits.length === 10 && digits.startsWith('05')) {
            // Mobile: 050-123-4567
            return `${digits.substring(0, 3)}-${digits.substring(3, 6)}-${digits.substring(6)}`;
        } else if (digits.length >= 9 && digits.startsWith('0')) {
            // Landline: 02-123-4567
            return `${digits.substring(0, 2)}-${digits.substring(2, 5)}-${digits.substring(5)}`;
        }

        return phone; // Return original if no pattern matches
    }

    // Validate URL
    static isValidUrl(url) {
        try {
            const urlObj = new URL(url);
            return ['http:', 'https:'].includes(urlObj.protocol);
        } catch {
            return false;
        }
    }

    // Generate session fingerprint
    static generateFingerprint(req) {
        const components = [
            req.ip || req.connection.remoteAddress,
            req.get('User-Agent') || '',
            req.get('Accept-Language') || '',
            req.get('Accept-Encoding') || ''
        ];

        return Buffer.from(components.join('|')).toString('base64');
    }

    // Calculate profile completion score
    static calculateCompletionScore(student) {
        const weights = {
            basicInfo: 0.25, // name, email, phone
            education: 0.25, // degree, institution, gpa
            files: 0.2, // CV and transcript
            experience: 0.1, // work experience
            availability: 0.1, // location and hours
            personal: 0.1 // personal statement and additional info
        };

        let score = 0;

        // Basic info
        if (student.name && student.email && student.phone) {
            score += weights.basicInfo;
        }

        // Education
        let educationScore = 0;
        if (student.education?.currentDegree) educationScore += 0.4;
        if (student.education?.institution) educationScore += 0.4;
        if (student.education?.gpa) educationScore += 0.2;
        score += weights.education * educationScore;

        // Files
        let filesScore = 0;
        if (student.cvFile?.filename) filesScore += 0.6;
        if (student.education?.transcriptFile?.filename) filesScore += 0.4;
        score += weights.files * filesScore;

        // Work experience
        if (student.workExperience?.hasExperience !== undefined) {
            score += weights.experience;
        }

        // Availability
        let availabilityScore = 0;
        if (student.location?.city) availabilityScore += 0.5;
        if (student.availability?.hoursPerWeek) availabilityScore += 0.5;
        score += weights.availability * availabilityScore;

        // Personal
        let personalScore = 0;
        if (student.personalStatement) personalScore += 0.7;
        if (student.additionalInfo) personalScore += 0.3;
        score += weights.personal * personalScore;

        return Math.round(score * 100);
    }

    // Generate step response format
    static formatStepResponse(stepNumber, student, nextStep = null) {
        return {
            success: true,
            currentStep: stepNumber,
            nextStep,
            completionPercentage: this.calculateCompletionScore(student),
            isComplete: student.chatProgress.completed,
            timestamp: new Date().toISOString()
        };
    }

    // Generate error response
    static formatErrorResponse(message, statusCode = 500, details = null) {
        const error = {
            success: false,
            error: message,
            timestamp: new Date().toISOString()
        };

        if (details) {
            error.details = details;
        }

        return { statusCode, response: error };
    }

    // Async file cleanup
    static async cleanupFile(filePath) {
        try {
            if (filePath && typeof filePath === 'string') {
                await fs.unlink(filePath);
                console.log(`Cleaned up file: ${filePath}`);
            }
        } catch (error) {
            console.error(`File cleanup failed for ${filePath}:`, error.message);
        }
    }

    // Sanitize student data for public API
    static sanitizeStudentData(student, includeProgress = false) {
        const sanitized = {
            id: student._id,
            name: student.name,
            email: student.email,
            phone: student.phone,
            education: student.education,
            workExperience: student.workExperience,
            specialRoles: student.specialRoles,
            location: student.location,
            availability: student.availability,
            personalStatement: student.personalStatement,
            additionalInfo: student.additionalInfo,
            links: student.links,
            completionPercentage: this.calculateCompletionScore(student),
            profileComplete: student.profileComplete,
            createdAt: student.createdAt,
            lastUpdated: student.lastUpdated
        };

        if (includeProgress) {
            sanitized.chatProgress = {
                currentStep: student.chatProgress.currentStep,
                completed: student.chatProgress.completed
            };
        }

        return sanitized;
    }

    static blurSensitiveInfo(text, studentName = '') {
        if (!text) return '';

        let blurredText = text;
        const placeholder = '[REDACTED]';

        // More aggressive regex patterns
        const emailRegex = /[\w-\.]+@([\w-]+\.)+[\w-]{2,4}/g;
        const phoneRegex = /(\+972|0)[-.\s]?(\d{1,2})[-.\s]?(\d{3})[-.\s]?(\d{4})/g;
        const urlRegex = /((https?|ftp|file):\/\/|www\.)[-A-Z0-9+&@#\/%?=~_|$!:,.;]*[A-Z0-9+&@#\/%=~_|$]/ig;
        const numberRegex = /\b\d{3,}\b/g; // Redact standalone numbers of 3+ digits

        blurredText = blurredText.replace(emailRegex, placeholder);
        blurredText = blurredText.replace(phoneRegex, placeholder);
        blurredText = blurredText.replace(urlRegex, placeholder);
        blurredText = blurredText.replace(numberRegex, placeholder);

        // Expanded list of common Israeli names and sensitive keywords
        const commonNames = ['שי', 'משה', 'דוד', 'יוסף', 'אברהם', 'יצחק', 'יעקב', 'ישראל', 'שרה', 'רבקה', 'רחל', 'לאה', 'יעל', 'תמר', 'נועה', 'מיכל', 'חיים', 'דניאל', 'אורי', 'איתי'];
        const sensitiveKeywords = ['linkedin', 'github', 'gmail', 'hotmail', 'walla', 'outlook', 'behance', 'dribbble', 'facebook', 'instagram', 'twitter', 'gitlab'];

        // Function to create a safe regex for a name, allowing it to be a whole word or part of a compound name
        const createNameRegex = (name) => {
            // Escape special characters in the name for use in regex
            const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            // Create a regex that matches the name when it's not part of a larger word
            return new RegExp(`(^|\\s|\\W)${escapedName}($|\\s|\\W)`, 'gi');
        };

        const replaceWithPadding = (match, p1, p2) => `${p1}${placeholder}${p2}`;

        // Blur student's full name and parts
        if (studentName) {
            const nameParts = studentName.split(' ').filter(part => part.length >= 2);
            nameParts.forEach(part => {
                blurredText = blurredText.replace(createNameRegex(part), replaceWithPadding);
            });
        }

        // Blur common names
        commonNames.forEach(name => {
            blurredText = blurredText.replace(createNameRegex(name), replaceWithPadding);
        });

        // Blur sensitive keywords
        sensitiveKeywords.forEach(keyword => {
            const regex = new RegExp(keyword, 'gi');
            blurredText = blurredText.replace(regex, placeholder);
        });

        return blurredText;
    }

    static anonymizeStudentForRecruiterView(student) {
        if (!student) return null;

        const placeholder = '&*******&';

        // Deep copy education to avoid modifying the original object and remove sensitive path
        const education = student.education ? JSON.parse(JSON.stringify(student.education)) : undefined;
        if (education?.transcriptFile?.path) {
            delete education.transcriptFile.path;
        }

        const anonymized = {
            id: student._id,
            // Anonymized fields
            name: placeholder,
            personalStatement: this.blurSensitiveInfo(student.personalStatement, student.name),
            additionalInfo: this.blurSensitiveInfo(student.additionalInfo, student.name),

            // Fields to keep
            education: education,
            workExperience: student.workExperience,
            specialRoles: this.blurSensitiveInfo(student.specialRoles, student.name),
            location: student.location,
            availability: student.availability,
            completionPercentage: this.calculateCompletionScore(student),
            profileComplete: student.profileComplete,
            createdAt: student.createdAt,
            lastUpdated: student.lastUpdated,

            // Explicitly removed fields
            email: undefined,
            phone: undefined,
            links: undefined,

            // Files (only showing filename, not path)
            cvFile: student.cvFile && student.cvFile.filename ? { filename: student.cvFile.filename, uploadDate: student.cvFile.uploadDate } : undefined,
        };

        return anonymized;
    }

    static generateStepConfig() {
        return {
            1: {
                message: "היי! בוא נקים את הפרופיל שלך. קודם כל, תעלה את קובץ ה-CV שלך.",
                type: "file_upload",
                required: true,
                accept: ".pdf,.doc,.docx",
                buttonText: "העלה קובץ CV"
            },
            2: {
                message: "מצוין! בדקנו את הפרטים האלה:",
                type: "verification",
                required: true
            },
            3: {
                message: "מה אתה לומד עכשיו?",
                type: "buttons",
                required: true,
                options: [
                    { value: "bachelor", label: "תואר ראשון" },
                    { value: "master", label: "תואר שני" },
                    { value: "certificate", label: "תעודה" },
                    { value: "professional_course", label: "קורס מקצועי" },
                    { value: "other", label: "אחר" }
                ]
            },
            4: {
                message: "באיזו שנה אתה?",
                type: "buttons",
                required: true,
                options: [
                    { value: "1", label: "שנה א'" },
                    { value: "2", label: "שנה ב'" },
                    { value: "3", label: "שנה ג'" },
                    { value: "4", label: "שנה ד'" },
                    { value: "graduate", label: "בוגר" },
                    { value: "advanced", label: "מתקדם יותר" }
                ]
            },
            5: {
                message: "תואר במה?",
                type: "search_select",
                required: true,
                placeholder: "חפש תחום לימודים...",
                options: "degrees"
            },
            6: {
                message: "איפה אתה לומד?",
                type: "search_select",
                required: true,
                placeholder: "חפש מוסד לימודים...",
                options: "institutions"
            },
            7: { message: "מה הממוצע שלך?", type: "number", required: true, min: 0, max: 100 },
            8: { message: "העלה גליון ציונים", type: "file_upload", required: true, accept: ".pdf,.jpg,.jpeg,.png" },
            9: { message: "יש לך ניסיון עבודה?", type: "yes_no", required: true },
            10: { message: "עשית משהו מיוחד באוניברסיטה?", type: "textarea", required: false },
            11: { message: "איפה אתה גר/מחפש עבודה?", type: "text", required: true },
            12: { message: "כמה שעות בשבוע תוכל לעבוד?", type: "buttons", required: true },
            13: { message: "אתה גמיש בשעות?", type: "yes_no", required: false },
            14: { message: "ספר על עצמך בקצרה", type: "textarea", required: false },
            15: { message: "יש משהו נוסף שחשוב לך לשתף?", type: "textarea", required: false },
            16: { message: "רוצה להוסיף לינקים?", type: "links", required: false },
            17: {
                message: "בוא נסכם את הפרופיל שלך",
                type: "summary",
                required: false
            },
            18: {
                message: "אנא אשר את תנאי השימוש",
                type: "terms",
                required: true
            }

        };
    }

    // Validate Hebrew text
    static isHebrewText(text) {
        const hebrewRegex = /[\u0590-\u05FF]/;
        return hebrewRegex.test(text);
    }

    // Format date for Hebrew locale
    static formatHebrewDate(date) {
        return new Intl.DateTimeFormat('he-IL', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(date));
    }

    // Generate profile completion tips
    static getCompletionTips(student) {
        const tips = [];

        if (!student.education?.gpa) {
            tips.push("הוסף את הממוצע שלך כדי לשפר את הפרופיל");
        }

        if (!student.education?.transcriptFile?.filename) {
            tips.push("העלה גליון ציונים לאימות הממוצע");
        }

        if (!student.personalStatement) {
            tips.push("כתוב משפט אישי קצר על עצמך");
        }

        if (!student.links?.github && !student.links?.linkedin && !student.links?.portfolio) {
            tips.push("הוסף קישורים מקצועיים (GitHub, LinkedIn)");
        }

        if (!student.workExperience?.description && student.workExperience?.hasExperience) {
            tips.push("תאר את ניסיון העבודה שלך");
        }

        return tips;
    }

    // Create session summary for logging
    static createSessionSummary(student) {
        return {
            sessionId: student.chatProgress.sessionId,
            studentId: student._id,
            currentStep: student.chatProgress.currentStep,
            completionPercentage: StudentUtils.calculateCompletionScore(student),
            startDate: student.createdAt,
            lastUpdate: student.lastUpdated,
            isComplete: student.chatProgress.completed
        };
    }

    // Clean old files (utility function)
    static async cleanupOldFiles(directory, maxAgeDays = 30) {
        try {
            const files = await fs.readdir(directory);
            const now = Date.now();
            const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;

            for (const file of files) {
                const filePath = path.join(directory, file);
                const stats = await fs.stat(filePath);

                if (now - stats.mtime.getTime() > maxAge) {
                    await fs.unlink(filePath);
                    console.log(`Cleaned up old file: ${file}`);
                }
            }
        } catch (error) {
            console.error('File cleanup error:', error);
        }
    }
}

module.exports = StudentUtils;
