// controllers/studentController.js - תיקוניים ולוגיקה מפורטים

const mongoose = require('mongoose');
const studentService = require('../services/studentService');
const emailService = require('../services/emailService');
const StudentUtils = require('../utils/studentUtils');
const { Student, Subscription, Exposure } = require('../models');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

class StudentController {
    // Handle step response - תיקון עם לוגיקה מפורטים
    async handleStep(req, res) {
        try {
            const { sessionId } = req.params;
            const stepNumber = req.stepNumber;

            console.log(`=== Step ${stepNumber} Handler ===`);
            console.log('Session ID:', sessionId);
            console.log('Request body:', JSON.stringify(req.body, null, 2));

            // בדיקה שהנתונים מגיעים בפורמט נכון
            if (!req.body || typeof req.body !== 'object') {
                console.error('Invalid request body format:', req.body);
                const errorResponse = StudentUtils.formatErrorResponse('Invalid request format', 400);
                return res.status(errorResponse.statusCode).json(errorResponse.response);
            }

            const result = await studentService.updateStepData(sessionId, stepNumber, req.body);

            console.log('Step processing result:', {
                studentId: result.student._id,
                nextStep: result.nextStep,
                completionScore: StudentUtils.calculateCompletionScore(result.student)
            });

            const response = StudentUtils.formatStepResponse(
                stepNumber,
                result.student,
                result.nextStep
            );

            if (result.nextStep) {
                response.stepConfig = studentService.getCurrentStepConfig(result.nextStep);
            }

            console.log('Response sent:', JSON.stringify(response, null, 2));
            res.json(response);

        } catch (error) {
            console.error('Handle step error:', error);
            const errorResponse = StudentUtils.formatErrorResponse('Failed to process step response', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    // Get current step information - הוספת מידע מפורט + תמיכה בהמשך session
    async getCurrentStep(req, res) {
        try {
            const { sessionId } = req.params;
            const student = await Student.findOne({
                'chatProgress.sessionId': sessionId,
                isActive: true
            });

            if (!student) {
                return res.status(404).json({
                    success: false,
                    error: 'Session not found or expired'
                });
            }

            console.log(`=== Get Current Step ===`);
            console.log('Session ID:', sessionId);
            console.log('Current step:', student.chatProgress.currentStep);

            const currentStep = student.chatProgress.currentStep;
            const stepConfig = studentService.getCurrentStepConfig(currentStep);

            let additionalData = null;

            if (currentStep === 2) {
                // For verification step, return the parsed data
                additionalData = {
                    name: student.name || '',
                    email: student.email || '',
                    phone: student.phone || ''
                };
            } else if (currentStep === 15) {
                additionalData = await studentService.getProfileSummary(sessionId);
            }

            const response = {
                success: true,
                currentStep,
                stepConfig,
                completionPercentage: StudentUtils.calculateCompletionScore(student),
                additionalData,
                // הוספת מידע דיבוג
                debugInfo: {
                    studentData: {
                        name: student.name,
                        email: student.email,
                        phone: student.phone,
                        education: student.education,
                        workExperience: student.workExperience,
                        location: student.location,
                        availability: student.availability,
                        links: student.links
                    },
                    timestamps: {
                        created: student.createdAt,
                        lastUpdated: student.lastUpdated
                    }
                }
            };

            console.log('Current step response:', JSON.stringify(response, null, 2));
            res.json(response);

        } catch (error) {
            console.error('Get current step error:', error);
            const errorResponse = StudentUtils.formatErrorResponse('Failed to get current step', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    // Verify parsed data - תיקון טיפול בנתונים
    async verifyData(req, res) {
        try {
            const { sessionId } = req.params;

            console.log('=== Verify Data ===');
            console.log('Session ID:', sessionId);
            console.log('Verification data:', JSON.stringify(req.body, null, 2));

            const student = await studentService.verifyParsedData(sessionId, req.body);

            const response = StudentUtils.formatStepResponse(3, student, 3);

            console.log('Verification completed, response:', JSON.stringify(response, null, 2));
            res.json(response);

        } catch (error) {
            console.error('Verify data error:', error);
            const errorResponse = StudentUtils.formatErrorResponse('Failed to verify data', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    // Get complete profile - הוספת ולידציה
    async getProfile(req, res) {
        try {
            const { sessionId } = req.params;

            console.log('=== Get Profile Summary ===');
            console.log('Session ID:', sessionId);

            // קבלת פרופיל מלא
            const profile = await studentService.getProfileSummary(sessionId);

            // בדיקת שלמות נתונים
            const validation = await studentService.validateStudentData(sessionId);

            console.log('Profile retrieved:', JSON.stringify(profile, null, 2));
            console.log('Validation results:', validation);

            res.json({
                success: true,
                profile,
                validation,
                completionPercentage: validation.completionPercentage
            });

        } catch (error) {
            console.error('Get profile error:', error);
            const errorResponse = StudentUtils.formatErrorResponse('Failed to get profile', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    // Upload CV - הוספת לוגיקה מפורטים
    async uploadCV(req, res) {
        let uploadedFile = null;
        try {
            const { sessionId } = req.params;

            console.log('=== CV Upload ===');
            console.log('Session ID:', sessionId);

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    error: 'No CV file uploaded'
                });
            }

            uploadedFile = req.file;
            console.log('Processing file:', req.file.originalname);

            // Use real CV parsing API
            const parseFormData = new FormData();
            const fs = require('fs');
            const fileBuffer = fs.readFileSync(req.file.path);

            // Create blob-like object for parsing API
            const fileBlob = new Blob([fileBuffer], { type: req.file.mimetype });
            parseFormData.append('cv', fileBlob, req.file.originalname);

            console.log('Sending to CV parser...');
            const parseResponse = await fetch('http://localhost:3000/api/candidates/parse-cv', {
                method: 'POST',
                body: parseFormData
            });

            const parseData = await parseResponse.json();

            if (!parseResponse.ok) {
                throw new Error(parseData.error || 'CV parsing failed');
            }

            console.log('CV parsed successfully:', parseData);

            // Extract relevant data
            const extractedData = {
                name: parseData.data?.name || '',
                email: parseData.data?.email || '',
                phone: parseData.data?.phone || ''
            };

            console.log('Extracted data:', extractedData);

            // Check for existing user
            if (extractedData.email || extractedData.phone) {
                const existingUser = await studentService.checkExistingUser(
                    extractedData.email,
                    extractedData.phone
                );

                if (existingUser && existingUser.chatProgress.sessionId !== sessionId) {
                    return res.json({
                        success: true,
                        existingUser: {
                            id: existingUser._id,
                            name: existingUser.name,
                            email: existingUser.email,
                            completionPercentage: StudentUtils.calculateCompletionScore(existingUser)
                        },
                        message: `נמצא פרופיל קיים עבור ${existingUser.name}`
                    });
                }
            }

            // Update student with parsed data
            const student = req.student;
            if (extractedData.name) student.name = StudentUtils.cleanTextInput(extractedData.name, 100);
            if (extractedData.email && StudentUtils.isValidEmail(extractedData.email)) {
                student.email = extractedData.email.toLowerCase();
            }
            if (extractedData.phone) {
                const cleanPhone = StudentUtils.formatIsraeliPhone(extractedData.phone);
                if (StudentUtils.isValidIsraeliPhone(cleanPhone)) {
                    student.phone = cleanPhone;
                }
            }

            // Save CV file info
            student.cvFile = {
                filename: req.file.filename,
                originalFilename: req.file.originalname,
                path: req.file.path,
                uploadDate: new Date()
            };

            await student.save();

            student.chatProgress.currentStep = 2;

            res.json({
                success: true,
                parsedData: extractedData,
                confidence: parseData.confidence || {},
                nextStep: 2,
                completionPercentage: StudentUtils.calculateCompletionScore(student)
            });

        } catch (error) {
            console.error('CV upload error:', error);

            if (uploadedFile?.path) {
                await StudentUtils.cleanupFile(uploadedFile.path);
            }

            res.status(500).json({
                success: false,
                error: 'Failed to process CV: ' + error.message
            });
        }
    }

    async startChat(req, res) {
        try {
            const { email, phone, forceNew } = req.body;

            console.log('=== Start Chat Request ===');
            console.log('Data:', { email, phone, forceNew });

            // אם לא forceNew, חפש session קיים פתוח
            if (!forceNew) {
                const recentSession = await Student.findOne({
                    isActive: true,
                    'chatProgress.completed': false,
                    lastAccessed: {
                        $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // 24 שעות
                    }
                }).sort({ lastAccessed: -1 });

                if (recentSession) {
                    console.log('Found recent uncompleted session');

                    if (!recentSession.chatProgress.sessionId) {
                        recentSession.chatProgress.sessionId = uuidv4();
                        await recentSession.save();
                    }

                    const stepConfig = studentService.getCurrentStepConfig(recentSession.chatProgress.currentStep);

                    return res.json({
                        success: true,
                        sessionId: recentSession.chatProgress.sessionId,
                        currentStep: recentSession.chatProgress.currentStep,
                        stepConfig,
                        studentId: recentSession._id,
                        completionPercentage: StudentUtils.calculateCompletionScore(recentSession),
                        resumed: true
                    });
                }
            }

            // צור session חדש רק אם לא נמצא קיים
            const sessionId = uuidv4();
            const student = await studentService.createSession(sessionId, { email, phone });
            const stepConfig = studentService.getCurrentStepConfig(1);

            const response = {
                success: true,
                sessionId: student.chatProgress.sessionId,
                currentStep: student.chatProgress.currentStep,
                stepConfig,
                studentId: student._id,
                completionPercentage: StudentUtils.calculateCompletionScore(student)
            };

            console.log('New session created:', response);
            res.json(response);

        } catch (error) {
            console.error('Start chat error:', error);
            const errorResponse = StudentUtils.formatErrorResponse('Failed to start chat session', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    async replaceExistingProfile(req, res) {
        try {
            const { sessionId } = req.params;
            const { existingUserId, confirm } = req.body;

            if (confirm) {
                // Delete existing profile
                await Student.findByIdAndUpdate(existingUserId, { isActive: false });

                // Continue with current session
                return res.json({
                    success: true,
                    message: 'הפרופיל הישן נמחק. ממשיכים עם הפרופיל החדש.',
                    nextStep: 2
                });
            }

            return res.json({
                success: false,
                message: 'הפעולה בוטלה.'
            });
        } catch (error) {
            console.error('Replace profile error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    }

    async resumeSession(req, res) {
        try {
            const { email, phone } = req.body;

            console.log('=== Resume Session ===');
            console.log('Resume data:', { email, phone });

            if (!email && !phone) {
                const errorResponse = StudentUtils.formatErrorResponse('Email or phone is required to resume session', 400);
                return res.status(errorResponse.statusCode).json(errorResponse.response);
            }

            const query = {};
            if (email) query.email = email.toLowerCase();
            if (phone) query.phone = phone;

            const student = await Student.findOne({
                $or: [query],
                'chatProgress.completed': false,
                isActive: true
            });

            if (!student) {
                const errorResponse = StudentUtils.formatErrorResponse('No incomplete session found', 404);
                return res.status(errorResponse.statusCode).json(errorResponse.response);
            }

            if (!student.chatProgress.sessionId) {
                student.chatProgress.sessionId = uuidv4();
                await student.save();
            }

            const currentStep = student.chatProgress.currentStep;
            const stepConfig = studentService.getCurrentStepConfig(currentStep);

            console.log('Session resumed:', {
                sessionId: student.chatProgress.sessionId,
                currentStep,
                completionPercentage: StudentUtils.calculateCompletionScore(student)
            });

            res.json({
                success: true,
                sessionId: student.chatProgress.sessionId,
                currentStep,
                stepConfig,
                completionPercentage: StudentUtils.calculateCompletionScore(student),
                resumed: true
            });

        } catch (error) {
            console.error('Resume session error:', error);
            const errorResponse = StudentUtils.formatErrorResponse('Failed to resume session', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    // controllers/studentController.js - תיקון uploadTranscript
    async uploadTranscript(req, res) {
        let uploadedFile = null;
        try {
            const { sessionId } = req.params;

            if (!req.file) {
                const errorResponse = StudentUtils.formatErrorResponse('No transcript file uploaded', 400);
                return res.status(errorResponse.statusCode).json(errorResponse.response);
            }

            uploadedFile = req.file;

            const student = await studentService.getBySessionId(sessionId);
            if (!student) {
                const errorResponse = StudentUtils.formatErrorResponse('Student not found for this session', 404);
                return res.status(errorResponse.statusCode).json(errorResponse.response);
            }

            if (!student.education) student.education = {};

            // Ensure we are saving the correct server filename and the original filename
            student.education.transcriptFile = {
                path: req.file.path,
                filename: req.file.filename, // The name of the file on the server
                originalFilename: req.file.originalname, // The name of the file from the user
                uploadDate: new Date()
            };
            student.markModified('education');

            await student.save();

            res.json({
                success: true,
                message: 'גליון הציונים נשמר בהצלחה!',
                nextStep: 9,
                stepConfig: studentService.getCurrentStepConfig(9),
                completionPercentage: StudentUtils.calculateCompletionScore(student)
            });

        } catch (error) {
            if (uploadedFile?.path) {
                await StudentUtils.cleanupFile(uploadedFile.path);
            }
            const errorResponse = StudentUtils.formatErrorResponse('Failed to upload transcript', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    // שמירה רק לאחר אישור תנאים
    async saveProfile(req, res) {
        try {
            const { sessionId } = req.params;
            const { profileData, termsAccepted, basicData } = req.body;

            console.log('=== Save Profile ===');
            console.log('Session ID:', sessionId);
            console.log('Terms accepted:', termsAccepted);
            console.log('Basic data:', basicData);
            console.log('Profile data steps:', Object.keys(profileData));

            if (!termsAccepted) {
                return res.status(400).json({
                    success: false,
                    error: 'Terms must be accepted before saving profile'
                });
            }

            const student = await studentService.getBySessionId(sessionId);

            // Save basic data first
            if (basicData) {
                if (basicData.name && basicData.name.trim()) {
                    student.name = StudentUtils.cleanTextInput(basicData.name.trim(), 100);
                }
                if (basicData.email && StudentUtils.isValidEmail(basicData.email)) {
                    student.email = basicData.email.toLowerCase();
                }
                if (basicData.phone && basicData.phone.trim()) {
                    const cleanPhone = StudentUtils.formatIsraeliPhone(basicData.phone.trim());
                    if (StudentUtils.isValidIsraeliPhone(cleanPhone)) {
                        student.phone = cleanPhone;
                    }
                }
                // Save basic data first
                await student.save();
                console.log('Basic data saved:', { name: student.name, email: student.email, phone: student.phone });
            }

            // Process all step data and save each one
            for (const [stepNum, data] of Object.entries(profileData)) {
                const step = parseInt(stepNum);
                if (step >= 3 && step <= 18 && data) {
                    try {
                        console.log(`Processing step ${step} with data:`, data);

                        // Call updateStepData which now saves immediately
                        const result = await studentService.updateStepData(sessionId, step, data);

                        console.log(`Step ${step} processed successfully`);

                    } catch (stepError) {
                        console.error(`Failed to save step ${step}:`, stepError);
                        // Continue with other steps instead of failing completely
                    }
                }
            }

            // Final updates after all data is saved
            const finalStudent = await studentService.getBySessionId(sessionId);
            finalStudent.profileComplete = true;
            finalStudent.chatProgress.completed = true;
            finalStudent.chatProgress.completedAt = new Date();
            finalStudent.termsAccepted = true;
            finalStudent.termsAcceptedDate = new Date();

            await finalStudent.save();

            console.log('Final profile save completed');

            // Send confirmation email
            try {
                await emailService.sendConfirmationEmail(finalStudent);
                console.log(`Confirmation email sent to ${finalStudent.email}`);
            } catch (emailError) {
                console.error(`Failed to send confirmation email to ${finalStudent.email}:`, emailError);
                // Do not block the response for this, just log it
            }
            console.log('Final student data check:', {
                name: finalStudent.name,
                email: finalStudent.email,
                phone: finalStudent.phone,
                education: finalStudent.education,
                workExperience: finalStudent.workExperience,
                location: finalStudent.location,
                availability: finalStudent.availability,
                personalStatement: finalStudent.personalStatement?.substring(0, 50) + '...',
                additionalInfo: finalStudent.additionalInfo?.substring(0, 50) + '...',
                specialRoles: finalStudent.specialRoles?.substring(0, 50) + '...',
                completionScore: StudentUtils.calculateCompletionScore(finalStudent)
            });

            res.json({
                success: true,
                message: 'Profile saved successfully',
                completionPercentage: StudentUtils.calculateCompletionScore(finalStudent)
            });

        } catch (error) {
            console.error('Save profile error:', error);
            const errorResponse = StudentUtils.formatErrorResponse('Failed to save profile', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    // Admin functions
    async getStudentsList(req, res) {
        try {
            console.log('=== Get Students List (Raw) ===');
            console.log('Query params:', req.query);

            // Calls service without anonymization
            const result = await studentService.getStudentsList(req.query, false, req.user._id);

            res.json({
                success: true,
                ...result
            });

        } catch (error) {
            console.error('Get students list error:', error);
            const errorResponse = StudentUtils.formatErrorResponse('Failed to get students list', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    async getStudentById(req, res) {
        try {
            const { id } = req.params;
            console.log('=== Get Student By ID (Raw) ===');
            console.log('Student ID:', id);

            // Calls service without anonymization
            const student = await studentService.getStudentById(id, false);

            res.json({
                success: true,
                student
            });

        } catch (error) {
            console.error('Get student by ID error:', error);
            const errorResponse = StudentUtils.formatErrorResponse('Failed to get student', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    async getAnonymizedStudentsList(req, res) {
        try {
            console.log('=== Get Anonymized Students List ===');
            console.log('Query params:', req.query);

            // Calls service with anonymization flag set to true
            const result = await studentService.getStudentsList(req.query, true, req.user._id);

            res.json({
                success: true,
                ...result
            });

        } catch (error) {
            console.error('Get anonymized students list error:', error);
            const errorResponse = StudentUtils.formatErrorResponse('Failed to get students list', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    async getAnonymizedStudentById(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user._id;

            console.log('=== Get Anonymized Student By ID ===');
            console.log('Student ID:', id, 'User ID:', userId);

            // Check for an active exposure subscription
            const hasAccess = await Exposure.hasAccess(userId, id);

            console.log('User has access:', hasAccess);

            // If user has access, return full details, otherwise return anonymized details
            const student = await studentService.getStudentById(id, !hasAccess);

            res.json({
                success: true,
                student,
                hasAccess // Send this to the frontend to update the UI
            });

        } catch (error) {
            console.error('Get anonymized student by ID error:', error);
            const errorResponse = StudentUtils.formatErrorResponse('Failed to get student', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    async getStatistics(req, res) {
        try {
            console.log('=== Get Statistics ===');
            const stats = await studentService.getStatistics();

            console.log('Statistics retrieved:', stats);
            res.json({
                success: true,
                stats
            });

        } catch (error) {
            console.error('Get statistics error:', error);
            const errorResponse = StudentUtils.formatErrorResponse('Failed to get statistics', 500, error.message);
            res.status(errorResponse.statusCode).json(errorResponse.response);
        }
    }

    async serveStudentFile(req, res) {
        try {
            const { filename } = req.params;
            const { disposition } = req.query;
            const userId = req.user._id;

            console.log('=== Serve Student File ===');
            console.log('Filename:', filename);
            console.log('User ID:', userId);

            // Security: Extract student ID from filename
            // Format: cv-[studentId]-... or transcript-[studentId]-...
            const parts = filename.split('-');
            if (parts.length < 2) {
                console.error('Invalid filename format:', filename);
                return res.status(400).json({ success: false, error: 'Invalid filename format' });
            }

            const studentId = parts[1];
            console.log('Extracted student ID:', studentId);

            // Validate ObjectId format before creating
            if (!mongoose.Types.ObjectId.isValid(studentId)) {
                console.error('Invalid ObjectId format:', studentId);
                return res.status(400).json({ success: false, error: 'Invalid student ID format in filename' });
            }

            // Authorization: Check if the user has access to this student
            let studentObjectId;
            try {
                studentObjectId = new mongoose.Types.ObjectId(studentId);
                console.log('Valid ObjectId created:', studentObjectId);
            } catch (e) {
                console.error('ObjectId creation failed:', e);
                return res.status(400).json({ success: false, error: 'Invalid student ID format in filename' });
            }

            const hasAccess = await Exposure.hasAccess(userId, studentObjectId);
            console.log('User has access:', hasAccess);

            if (!hasAccess) {
                return res.status(403).json({ success: false, error: 'You do not have permission to view this file.' });
            }

            // Basic security: prevent directory traversal
            const safeFilename = path.basename(filename);
            const filePath = path.join(__dirname, '..', 'uploads', 'students', safeFilename);

            console.log('File path:', filePath);

            // Check if file exists
            if (fs.existsSync(filePath)) {
                const isDownload = disposition === 'download';
                res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename="${safeFilename}"`);
                res.sendFile(filePath);
            } else {
                console.error('File not found:', filePath);
                res.status(404).json({ success: false, error: 'File not found' });
            }
        } catch (error) {
            console.error('Serve file error:', error);
            res.status(500).json({ success: false, error: 'Could not serve file' });
        }
    }
}

module.exports = new StudentController();
