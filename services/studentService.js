// services/studentService.js - Fixed service with proper validation

const { Student } = require('../models/student');
const { Exposure } = require('../models');
const { parseCV } = require('../services/cvParsingService');
const fs = require('fs').promises;
const StudentUtils = require('../utils/studentUtils');

class StudentService {
    constructor() {
        this.chatSteps = StudentUtils.generateStepConfig();
    }

    async updateStepData(sessionId, stepNumber, responseData) {
        try {
            const student = await this.getBySessionId(sessionId);
            const { response, additionalData } = responseData;

            console.log(`Updating step ${stepNumber} for session ${sessionId}:`, responseData);

            switch (stepNumber) {
                case 3: // Education degree type
                    if (!student.education) student.education = {};
                    student.education.currentDegree = response;
                    student.markModified('education');
                    break;

                case 4: // Study year
                    if (!student.education) student.education = {};
                    student.education.studyYear = response;
                    student.markModified('education');
                    break;

                case 5: // Degree field - FIXED: Proper validation and save
                    if (!student.education) student.education = {};
                    if (response && response.trim()) {
                        student.education.degreeField = StudentUtils.cleanTextInput(response, 200);
                        student.markModified('education');
                        await student.save(); // Save immediately
                        console.log('Saved degree field:', student.education.degreeField);
                    }
                    break;

                case 6: // Institution - FIXED: Proper validation and save
                    if (!student.education) student.education = {};
                    if (response && response.trim()) {
                        student.education.institution = StudentUtils.cleanTextInput(response, 200);
                        student.markModified('education');
                        await student.save(); // Save immediately
                        console.log('Saved institution:', student.education.institution);
                    }
                    break;

                case 7: // GPA - FIXED: Proper number validation and save
                    if (!student.education) student.education = {};
                    if (response !== null && response !== undefined && response !== '') {
                        const gpa = parseFloat(response);
                        if (isNaN(gpa) || gpa < 0 || gpa > 100) {
                            throw new Error('GPA must be between 0 and 100');
                        }
                        student.education.gpa = gpa;
                        student.markModified('education');
                        await student.save(); // Save immediately
                        console.log('Saved GPA:', student.education.gpa);
                    }
                    break;

                case 9: // Work experience - FIXED
                    if (!student.workExperience) student.workExperience = {};
                    student.workExperience.hasExperience = response === 'yes';
                    if (additionalData?.description) {
                        student.workExperience.description = StudentUtils.cleanTextInput(additionalData.description, 1000);
                    }
                    student.markModified('workExperience');
                    await student.save(); // Save immediately
                    console.log('Saved work experience:', student.workExperience);
                    break;

                case 10: // Special roles - FIXED
                    if (response && response.trim() && response !== 'דילגתי על השאלה') {
                        student.specialRoles = StudentUtils.cleanTextInput(response.trim(), 1000);
                        await student.save(); // Save immediately
                        console.log('Saved special roles:', student.specialRoles);
                    }
                    break;

                case 11: // Location - FIXED
                    if (!student.location) student.location = {};
                    if (response && response.trim()) {
                        student.location.city = StudentUtils.cleanTextInput(response.trim(), 100);
                        student.markModified('location');
                        await student.save(); // Save immediately
                        console.log('Saved location:', student.location.city);
                    }
                    break;

                case 12: // Work hours - FIXED
                    if (!student.availability) student.availability = {};
                    student.availability.hoursPerWeek = response;
                    student.markModified('availability');
                    await student.save(); // Save immediately
                    console.log('Saved availability hours:', student.availability.hoursPerWeek);
                    break;

                case 13: // Flexible hours - FIXED
                    if (!student.availability) student.availability = {};
                    if (!student.availability.flexibleHours) student.availability.flexibleHours = {};
                    student.availability.flexibleHours.available = response === 'yes';
                    if (additionalData?.details) {
                        student.availability.flexibleHours.details = StudentUtils.cleanTextInput(additionalData.details, 500);
                    }
                    student.markModified('availability');
                    await student.save(); // Save immediately
                    console.log('Saved flexible hours:', student.availability.flexibleHours);
                    break;

                case 14: // Personal statement - FIXED
                    if (response && response.trim() && response !== 'דילגתי על השאלה') {
                        student.personalStatement = StudentUtils.cleanTextInput(response.trim(), 2000);
                        await student.save(); // Save immediately
                        console.log('Saved personal statement:', student.personalStatement?.substring(0, 50) + '...');
                    }
                    break;

                case 15: // Additional info - FIXED
                    if (response && response.trim() && response !== 'דילגתי על השאלה') {
                        student.additionalInfo = StudentUtils.cleanTextInput(response.trim(), 1000);
                        await student.save(); // Save immediately
                        console.log('Saved additional info:', student.additionalInfo?.substring(0, 50) + '...');
                    }
                    break;

                case 16: // Links - FIXED
                    if (!student.links) student.links = {};
                    if (additionalData && typeof additionalData === 'object') {
                        if (additionalData.github && StudentUtils.isValidUrl(additionalData.github)) {
                            student.links.github = additionalData.github;
                        }
                        if (additionalData.linkedin && StudentUtils.isValidUrl(additionalData.linkedin)) {
                            student.links.linkedin = additionalData.linkedin;
                        }
                        if (additionalData.portfolio && StudentUtils.isValidUrl(additionalData.portfolio)) {
                            student.links.portfolio = additionalData.portfolio;
                        }
                    }
                    student.markModified('links');
                    await student.save(); // Save immediately
                    console.log('Saved links:', student.links);
                    break;

                case 18: // Terms acceptance - FIXED
                    student.termsAccepted = response === 'agreed';
                    student.termsAcceptedDate = new Date();
                    await student.save(); // Save immediately
                    console.log('Saved terms acceptance:', student.termsAccepted);
                    break;

                default:
                    console.warn(`Unknown step number: ${stepNumber}`);
                    break;
            }

            // Update progress only after saving data
            const nextStep = Math.min(stepNumber + 1, 18);
            student.chatProgress.currentStep = nextStep;
            student.lastUpdated = new Date();

            // Final save for progress update
            await student.save();
            console.log(`Step ${stepNumber} completed, next step: ${nextStep}`);

            return {
                student,
                nextStep: nextStep <= 18 ? nextStep : null,
                isComplete: nextStep > 18
            };

        } catch (error) {
            console.error('Failed to update step data:', error);
            throw new Error(`Failed to update step data: ${error.message}`);
        }
    }


    async getProfileSummary(sessionId) {
        try {
            const student = await this.getBySessionId(sessionId);

            console.log('Getting profile summary for student:', {
                id: student._id,
                name: student.name,
                email: student.email,
                phone: student.phone,
                education: student.education,
                workExperience: student.workExperience,
                location: student.location,
                availability: student.availability,
                personalStatement: student.personalStatement?.substring(0, 50) + '...',
                additionalInfo: student.additionalInfo?.substring(0, 50) + '...',
                links: student.links,
                completionScore: StudentUtils.calculateCompletionScore(student)
            });

            return StudentUtils.sanitizeStudentData(student, true);
        } catch (error) {
            console.error('Failed to get profile summary:', error);
            throw new Error(`Failed to get profile: ${error.message}`);
        }
    }

    async validateStudentData(sessionId) {
        try {
            const student = await this.getBySessionId(sessionId);

            const validationReport = {
                hasBasicInfo: !!(student.name && student.email && student.phone),
                hasEducation: !!(student.education?.currentDegree && student.education?.institution),
                hasGPA: !!student.education?.gpa,
                hasWorkExperience: student.workExperience?.hasExperience !== undefined,
                hasLocation: !!student.location?.city,
                hasAvailability: !!student.availability?.hoursPerWeek,
                hasPersonalStatement: !!student.personalStatement,
                hasLinks: !!(student.links?.github || student.links?.linkedin || student.links?.portfolio),
                completionPercentage: StudentUtils.calculateCompletionScore(student)
            };

            console.log('Validation report for student:', validationReport);
            return validationReport;

        } catch (error) {
            console.error('Validation error:', error);
            throw error;
        }
    }

    async createSession(sessionId, initialData = {}) {
        try {
            // Always try to find existing session first
            let student = await Student.findOne({
                'chatProgress.sessionId': sessionId
            });

            if (student) {
                // Reactivate existing session
                student.isActive = true;
                student.lastAccessed = new Date();
                await student.save();
                console.log('Reactivated existing session:', sessionId);
                return student;
            }

            // Create new session only if none exists
            student = new Student({
                name: initialData.name || '',
                email: initialData.email ? initialData.email.toLowerCase() : null,
                phone: initialData.phone || '',
                'chatProgress.sessionId': sessionId,
                'chatProgress.currentStep': 1,
                isActive: true
            });

            await student.save();
            console.log('Created new session:', sessionId);
            return student;
        } catch (error) {
            // If duplicate key error, try to find and return existing
            if (error.code === 11000) {
                const existing = await Student.findOne({ 'chatProgress.sessionId': sessionId });
                if (existing) {
                    existing.isActive = true;
                    existing.lastAccessed = new Date();
                    await existing.save();
                    return existing;
                }
            }
            throw new Error(`Failed to create session: ${error.message}`);
        }
    }


    async getBySessionId(sessionId) {
        try {
            const student = await Student.findOne({ 'chatProgress.sessionId': sessionId });
            if (!student) {
                throw new Error('Session not found');
            }
            return student;
        } catch (error) {
            throw new Error(`Failed to get student: ${error.message}`);
        }
    }

    getCurrentStepConfig(stepNumber) {
        return this.chatSteps[stepNumber] || null;
    }

    // תיקון הטיפול בפרופילים קיימים בעת העלאת CV
    async processCVUpload(sessionId, fileData, filename) {
        try {
            const student = await this.getBySessionId(sessionId);

            console.log('Processing CV upload for session:', sessionId);
            const parsedData = await parseCV(fileData, filename);
            console.log('CV parsing result:', parsedData);

            const cleanEmail = parsedData.email?.toLowerCase();

            // בדיקת משתמש קיים
            if (cleanEmail) {
                const existing = await this.checkExistingUser(cleanEmail, parsedData.phone);

                if (existing && existing.chatProgress.sessionId !== sessionId) {
                    console.log('Found existing user:', existing.name, existing.email);

                    // החזרת מידע על משתמש קיים - הלקוח יחליט מה לעשות
                    return {
                        student,
                        parsedData,
                        requiresConfirmation: true,
                        existingUser: {
                            id: existing._id,
                            name: existing.name,
                            email: existing.email,
                            completionPercentage: StudentUtils.calculateCompletionScore(existing)
                        },
                        message: `נמצא פרופיל קיים עבור ${existing.name} (${existing.email}). האם ברצונך לעדכן אותו או ליצור חדש?`
                    };
                }
            }

            // עדכון הסטודנט הנוכחי עם הנתונים החדשים
            const updates = {};
            if (parsedData.name && parsedData.name.trim()) {
                updates.name = StudentUtils.cleanTextInput(parsedData.name.trim(), 100);
            }
            if (parsedData.email && StudentUtils.isValidEmail(parsedData.email)) {
                updates.email = parsedData.email.toLowerCase();
            }
            if (parsedData.phone) {
                const cleanPhone = StudentUtils.formatIsraeliPhone(parsedData.phone);
                if (StudentUtils.isValidIsraeliPhone(cleanPhone)) {
                    updates.phone = cleanPhone;
                }
            }

            updates.cvFile = {
                filename,
                uploadDate: new Date()
            };

            Object.assign(student, updates);
            student.chatProgress.currentStep = 2;

            console.log('CV processed and student updated:', {
                name: student.name,
                email: student.email,
                phone: student.phone
            });

            return {
                student,
                parsedData: {
                    name: student.name,
                    email: student.email,
                    phone: student.phone
                },
                confidence: parsedData.confidence || {}
            };
        } catch (error) {
            console.error('CV processing error:', error);
            throw new Error(`Failed to process CV: ${error.message}`);
        }
    }

    // מתודה חדשה לטיפול בהחלפת פרופיל קיים
    async replaceExistingProfile(sessionId, existingUserId) {
        try {
            const currentStudent = await this.getBySessionId(sessionId);
            const existingStudent = await Student.findById(existingUserId);

            if (!existingStudent) {
                throw new Error('Existing user not found');
            }

            console.log('Replacing existing profile:', existingUserId, 'with session:', sessionId);

            // העברת נתונים מהפרופיל הקיים לנוכחי (אם יש)
            if (!currentStudent.name && existingStudent.name) {
                currentStudent.name = existingStudent.name;
            }
            if (!currentStudent.email && existingStudent.email) {
                currentStudent.email = existingStudent.email;
            }
            if (!currentStudent.phone && existingStudent.phone) {
                currentStudent.phone = existingStudent.phone;
            }

            // סימון הפרופיל הישן כמוחלף
            existingStudent.isActive = false;
            existingStudent.replacedBy = currentStudent._id;
            await existingStudent.save();

            // שמירת הפרופיל הנוכחי
            currentStudent.lastUpdated = new Date();
            await currentStudent.save();

            console.log('Profile replacement completed');

            return {
                success: true,
                message: 'הפרופיל הישן הוחלף בהצלחה. ממשיכים עם הפרופיל החדש.',
                student: currentStudent
            };

        } catch (error) {
            console.error('Failed to replace existing profile:', error);
            throw new Error(`Failed to replace profile: ${error.message}`);
        }
    }

    async processTranscriptUpload(sessionId, filename) {
        try {
            const student = await this.getBySessionId(sessionId);

            if (!student.education) student.education = {};
            student.education.transcriptFile = {
                filename,
                uploadDate: new Date()
            };
            student.markModified('education');

            await student.save();
            return student;
        } catch (error) {
            throw new Error(`Failed to process transcript: ${error.message}`);
        }
    }

    async verifyParsedData(sessionId, verificationData) {
        try {
            const student = await this.getBySessionId(sessionId);
            const { name, email, phone, isCorrect } = verificationData;

            if (!isCorrect) {
                if (name?.trim()) {
                    student.name = StudentUtils.cleanTextInput(name.trim(), 100);
                }
                if (email && StudentUtils.isValidEmail(email)) {
                    // שימוש במתודה הבטוחה לעדכון אימייל
                    try {
                        await student.updateEmail(email);
                    } catch (emailError) {
                        console.error('Email update failed:', emailError.message);
                        throw new Error('האימייל הזה כבר קיים במערכת');
                    }
                }
                if (phone?.trim()) {
                    const cleanPhone = StudentUtils.formatIsraeliPhone(phone.trim());
                    if (StudentUtils.isValidIsraeliPhone(cleanPhone)) {
                        student.phone = cleanPhone;
                    }
                }
            }

            await student.updateProgress(3);
            return student;
        } catch (error) {
            throw new Error(`Failed to verify data: ${error.message}`);
        }
    }

    async checkExistingUser(email, phone) {
        const query = {
            isActive: true
        };

        const conditions = [];
        if (email) conditions.push({ email: email.toLowerCase() });
        if (phone) conditions.push({ phone });

        if (conditions.length > 0) {
            query.$or = conditions;
            const existing = await Student.findOne(query);
            return existing;
        }

        return null;
    }

    // Admin functions remain the same
    async getStudentsList(filters = {}, anonymize = false, userId = null) {
        try {
            const {
                page = 1,
                limit = 20,
                search,
                completed,
                gpaMin,
                gpaMax,
                hasExperience,
                institution,
                degreeField,
                currentDegree,
                hoursPerWeek,
                studyYear,
                city,
                flexibleHours,
                favoritesOnly // New filter
            } = filters;

            const query = { isActive: true };

        if (favoritesOnly === 'true' && userId) {
                const { User } = require('../models');
                const user = await User.findById(userId).select('favoriteStudents');
                if (user) {
                    query._id = { $in: user.favoriteStudents };
                }
            }

            if (search) {
                const searchRegex = new RegExp(search, 'i');
                query.$or = [
                    { name: searchRegex },
                    { 'education.institution': searchRegex },
                    { 'education.degreeField': searchRegex },
                    { 'location.city': searchRegex }
                ];
            }

            if (completed !== undefined) {
                query.profileComplete = completed === 'true' || completed === true;
            }
            if (gpaMin || gpaMax) {
                query['education.gpa'] = {};
                if (gpaMin) {
                    query['education.gpa'].$gte = parseFloat(gpaMin);
                }
                if (gpaMax) {
                    query['education.gpa'].$lte = parseFloat(gpaMax);
                }
            }
            if (hasExperience !== undefined) {
                query['workExperience.hasExperience'] = hasExperience === 'true';
            }
            if (institution) {
                query['education.institution'] = institution;
            }
            if (degreeField) {
                query['education.degreeField'] = degreeField;
            }
            if (currentDegree) {
                query['education.currentDegree'] = currentDegree;
            }
            if (hoursPerWeek) {
                query['availability.hoursPerWeek'] = hoursPerWeek;
            }
            if (studyYear) {
                query['education.studyYear'] = studyYear;
            }
            if (city) {
                query['location.city'] = new RegExp(city, 'i');
            }
            if (flexibleHours !== undefined) {
                query['availability.flexibleHours.available'] = flexibleHours === 'true';
            }


            const students = await Student.find(query)
                .sort({ createdAt: -1 })
                .limit(limit * 1)
                .skip((page - 1) * limit)
                .select('-chatProgress.sessionId');

            const total = await Student.countDocuments(query);

            let processedStudents = students;
            if (anonymize && userId) {
                const userExposures = await Exposure.find({ userId: userId, isActive: true, expiresAt: { $gt: new Date() } }).select('studentId');
                const exposedStudentIds = new Set(userExposures.map(exp => exp.studentId.toString()));

                processedStudents = students.map(student => {
                    const hasAccess = exposedStudentIds.has(student._id.toString());
                    const anonymizedStudent = StudentUtils.anonymizeStudentForRecruiterView(student);
                    if (hasAccess) {
                        anonymizedStudent.name = student.name; // Restore the real name
                        anonymizedStudent.hasAccess = true; // Add a flag for the frontend
                    }
                    return anonymizedStudent;
                });
            } else if (anonymize) {
                processedStudents = students.map(student => StudentUtils.anonymizeStudentForRecruiterView(student));
            }

            return {
                students: processedStudents,
                pagination: {
                    current: parseInt(page),
                    pages: Math.ceil(total / limit),
                    total
                }
            };
        } catch (error) {
            throw new Error(`Failed to get students list: ${error.message}`);
        }
    }

    async getStudentById(id, anonymize = false) {
        try {
            const student = await Student.findById(id).select('-chatProgress.sessionId');
            if (!student) {
                throw new Error('Student not found');
            }
            return anonymize ? StudentUtils.anonymizeStudentForRecruiterView(student) : student;
        } catch (error) {
            throw new Error(`Failed to get student: ${error.message}`);
        }
    }

    async getStatistics() {
        try {
            const total = await Student.countDocuments({ isActive: true });
            const completed = await Student.countDocuments({
                isActive: true,
                profileComplete: true
            });

            const recentStudents = await Student.find({ isActive: true })
                .sort({ createdAt: -1 })
                .limit(5)
                .select('name email createdAt');

            return {
                total,
                completed,
                inProgress: total - completed,
                completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
                recentStudents: recentStudents.map(student => StudentUtils.sanitizeStudentData(student))
            };
        } catch (error) {
            throw new Error(`Failed to get statistics: ${error.message}`);
        }
    }
}

module.exports = new StudentService();
