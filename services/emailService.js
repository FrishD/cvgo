const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');

// Create the transporter with Gmail
const createTransporter = () => {
    return nodemailer.createTransport({
        host: 'smtp.office365.com',
        port: 587,
        secure: false, // STARTTLS
        auth: {
            user: process.env.CVGO_EMAIL || 'noreply@cvgo.pro',
            pass: process.env.CVGO_PASS  || 'scvxyvnhfqgpcyfj'// סיסמה רגילה או App Password אם MFA פעיל
        },
        tls: {
            rejectUnauthorized: false
        },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000
    });
};


// Common email template structure - Using exact HTML template design
const createEmailTemplate = (title, successBadgeText, greeting, name, contentBody, ctaText = 'Access TalentMatch', ctaUrl = null) => {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const finalCtaUrl = ctaUrl || `${baseUrl}/login.html`;

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>TalentMatch - ${title}</title>
        <style type="text/css">
            * { margin: 0; padding: 0; }
            body, table, td { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
            table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
            img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
            body { font-family: Arial, sans-serif; background-color: #f5f5f5; margin: 0; padding: 0; line-height: 1.6; }
            .email-wrapper { width: 100%; background-color: #f5f5f5; padding: 20px 0; }
            .email-container { max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
            .header { background-color: #191c40; padding: 40px 30px 30px; text-align: center; }
            .header-accent { height: 3px; background-color: #b29758; width: 100%; }
            .logo { margin-bottom: 15px; }
            .logo h1 { color: #ffffff; font-size: 26px; font-weight: bold; margin: 0; letter-spacing: -0.5px; }
            .header-subtitle { color: #c3c0c0; font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; margin: 0; }
            .content { padding: 40px 30px; }
            .success-badge { background-color: #5c5f7c; color: white; padding: 10px 20px; border-radius: 4px; display: inline-block; font-size: 14px; font-weight: 500; margin-bottom: 30px; }
            .greeting h2 { color: #191c40; font-size: 22px; font-weight: 600; margin: 0 0 15px 0; }
            .greeting p { color: #5c5f7c; font-size: 16px; margin: 0 0 30px 0; line-height: 1.5; }
            .info-card { background-color: #fafafa; border: 1px solid #e8e8e8; border-left: 3px solid #b29758; border-radius: 6px; padding: 20px; margin-bottom: 30px; }
            .info-card h3 { color: #191c40; font-size: 16px; font-weight: 600; margin: 0 0 15px 0; }
            .info-item { display: table; width: 100%; margin-bottom: 10px; }
            .info-item:last-child { margin-bottom: 0; }
            .info-label { display: table-cell; color: #5c5f7c; font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.8px; width: 40%; }
            .info-value { display: table-cell; color: #191c40; font-size: 15px; font-weight: 600; text-align: right; }
            .highlight-value { background-color: #b29758; color: white; padding: 4px 12px; border-radius: 3px; font-size: 12px; font-weight: 500; }
            .main-message { background-color: #f9f9f9; border: 1px solid #e0e0e0; border-left: 4px solid #b29758; border-radius: 6px; padding: 25px; margin-bottom: 30px; }
            .main-message p { color: #404472; font-size: 15px; line-height: 1.6; margin: 0 0 15px 0; }
            .main-message p:last-child { margin-bottom: 0; }
            .main-message ul { color: #404472; font-size: 15px; line-height: 1.8; margin: 15px 0; padding-left: 20px; }
            .main-message strong { color: #191c40; }
            .cta-section { text-align: center; margin-bottom: 30px; }
            .cta-button { background-color: #404472; color: white; padding: 12px 30px; border-radius: 4px; font-size: 14px; font-weight: 500; text-decoration: none; display: inline-block; }
            .footer { background-color: #191c40; padding: 30px; text-align: center; color: white; }
            .footer h4 { font-size: 16px; font-weight: 600; margin: 0 0 8px 0; color: #ffffff; }
            .footer p { color: #c3c0c0; font-size: 12px; margin: 4px 0; }
            .footer-links { margin: 20px 0; }
            .footer-links a { color: #b29758; text-decoration: none; font-weight: 500; font-size: 12px; margin: 0 12px; }
            .divider { height: 1px; background-color: #5c5f7c; margin: 20px 0; }
            @media screen and (max-width: 600px) {
                .email-container { margin: 0 10px; border-radius: 4px; }
                .header, .content, .footer { padding: 25px 20px; }
                .greeting h2 { font-size: 20px; }
                .footer-links a { display: block; margin: 8px 0; }
            }
        </style>
    </head>
    <body>
    <div class="email-wrapper">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
            <tr>
                <td>
                    <div class="email-container">
                        <div class="header-accent"></div>
                        <div class="header">
                            <div class="logo">
                                <h1>TalentMatch</h1>
                            </div>
                            <p class="header-subtitle">Professional Recruitment Platform</p>
                        </div>
                        <div class="content">
                            <div class="success-badge">
                                ${successBadgeText}
                            </div>
                            <div class="greeting">
                                <h2>${greeting} ${name},</h2>
                                ${contentBody}
                            </div>
                            <div class="cta-section">
                                <a href="${finalCtaUrl}" class="cta-button">${ctaText}</a>
                            </div>
                        </div>
                        <div class="footer">
                            <div class="footer-content">
                                <h4>TalentMatch</h4>
                                <p>Connecting professionals with opportunities since 2025</p>
                            </div>
                            <div class="footer-links">
                                <a href="#">Privacy Policy</a>
                                <a href="#">Terms of Service</a>
                                <a href="#">Contact Support</a>
                                <a href="#">Unsubscribe</a>
                            </div>
                            <div class="divider"></div>
                            <div class="footer-content">
                                <p>© ${new Date().getFullYear()} TalentMatch. All rights reserved.</p>
                                <p>This is an automated message. Please do not reply to this email.</p>
                            </div>
                        </div>
                    </div>
                </td>
            </tr>
        </table>
    </div>
    </body>
    </html>`;
};

// Send agency verification request confirmation to user
const sendRegistrationConfirmation = async (user) => {
    try {
        const transporter = createTransporter();

        const contentBody = `
            <p>Thank you for requesting verification for your recruitment agency. Your request has been successfully received and is under review.</p>
            
            <div class="info-card">
                <h3>Verification Request Details</h3>
                <div class="info-item">
                    <div class="info-label">Agency Name</div>
                    <div class="info-value">${user.companyName}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Contact Person</div>
                    <div class="info-value">${user.fullName}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Username</div>
                    <div class="info-value">${user.username}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Position</div>
                    <div class="info-value">${user.position}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Submitted Date</div>
                    <div class="info-value">
                        <span class="highlight-value">${new Date().toLocaleDateString('en-US')}</span>
                    </div>
                </div>
            </div>

            <div class="main-message">
                <p><strong>Important:</strong> You can already use most TalentMatch features immediately. However, verification as a legitimate recruitment agency is required to access premium candidate profiles and advanced matching features.</p>
                <p>Our verification team will review your agency details within 48 hours. You'll receive another email once the verification is complete.</p>
            </div>
        `;

        const html = createEmailTemplate(
            'Agency Verification Request',
            '✓ Request Received',
            'Dear',
            user.fullName,
            contentBody,
            'Access TalentMatch System'
        );

        const result = await transporter.sendMail({
            from: process.env.GMAIL_USER || "noreply@cvgo.pro",
            to: user.email,
            subject: 'Agency Verification Request Received - TalentMatch',
            html: html
        });

        console.log('Agency verification confirmation email sent:', result.messageId);
        return { success: true, messageId: result.messageId };

    } catch (error) {
        console.error('Failed to send agency verification confirmation:', error);
        throw error;
    }
};

// Send notification to admin about new agency verification request
const sendAdminNotification = async (user) => {
    try {
        const transporter = createTransporter();

        const adminEmails = process.env.ADMIN_EMAILS ?
            process.env.ADMIN_EMAILS.split(',') :
            ['admin@yourdomain.com'];

        const contentBody = `
            <p>A new recruitment agency has requested verification and needs admin review.</p>
            
            <div class="info-card">
                <h3>Agency Details</h3>
                <div class="info-item">
                    <div class="info-label">Agency Name</div>
                    <div class="info-value">${user.companyName}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Contact Person</div>
                    <div class="info-value">${user.fullName}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Username</div>
                    <div class="info-value">${user.username}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Email</div>
                    <div class="info-value">${user.email}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Phone</div>
                    <div class="info-value">${user.phone}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Position</div>
                    <div class="info-value">${user.position}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Address</div>
                    <div class="info-value">${user.address}, ${user.city}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Service Regions</div>
                    <div class="info-value">${user.regions.join(', ')}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Submitted</div>
                    <div class="info-value">
                        <span class="highlight-value">${new Date(user.createdAt || new Date()).toLocaleString('en-US')}</span>
                    </div>
                </div>
            </div>

            <div class="main-message">
                <p><strong>Note:</strong> This agency can already access basic TalentMatch features. Verification approval will grant access to premium candidate profiles and advanced matching capabilities.</p>
                <p><strong>Agency Description:</strong> ${user.companyDescription}</p>
            </div>
        `;

        const html = createEmailTemplate(
            'Admin Notification',
            '🔔 New Request',
            'Admin Alert:',
            'New Agency Verification',
            contentBody,
            'Review in Admin Panel',
            `${process.env.BASE_URL || 'http://localhost:3000'}/admin.html`
        );

        const emailPromises = adminEmails.map(email => {
            return transporter.sendMail({
                from: process.env.GMAIL_USER || "noreply@cvgo.pro",
                to: email.trim(),
                subject: '🔔 New Agency Verification Request - TalentMatch',
                html: html
            });
        });

        await Promise.all(emailPromises);
        console.log('Admin notification sent successfully');

    } catch (error) {
        console.error('Failed to send admin notification:', error);
        throw error;
    }
};

// Send approval/rejection email to user
const sendApprovalNotification = async (user, approved) => {
    const transporter = createTransporter();

    if (approved) {
        const contentBody = `
            <p>Congratulations! Your recruitment agency has been successfully verified and approved for premium access to TalentMatch.</p>
            
            <div class="info-card">
                <h3>Your Premium Access Includes</h3>
                <div class="info-item">
                    <div class="info-label">Premium Profiles</div>
                    <div class="info-value">Full candidate details</div>
                </div>
                <div class="info-item">
                    <div class="info-label">AI Matching</div>
                    <div class="info-value">Advanced recommendations</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Direct Contact</div>
                    <div class="info-value">Connect with candidates</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Regional Access</div>
                    <div class="info-value">Your service regions</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Analytics</div>
                    <div class="info-value">Performance tracking</div>
                </div>
            </div>

            <div class="main-message">
                <p>Your professional profile has been verified and you now have <strong>full access</strong> to all TalentMatch premium features.</p>
                <p><strong>Username:</strong> ${user.username}</p>
                <p>Welcome to the verified TalentMatch community!</p>
            </div>
        `;

        const html = createEmailTemplate(
            'Agency Verification Approved',
            '✓ Verification Approved',
            'Congratulations',
            user.fullName,
            contentBody,
            'Access Premium Features'
        );

        return transporter.sendMail({
            from: process.env.GMAIL_USER || "noreply@cvgo.pro",
            to: user.email,
            subject: 'Agency Verification Approved - TalentMatch',
            html: html
        });
    } else {
        const contentBody = `
            <p>After reviewing your agency verification request, we were unable to approve it at this time.</p>
            
            <div class="info-card">
                <h3>Next Steps</h3>
                <div class="info-item">
                    <div class="info-label">Support Email</div>
                    <div class="info-value">${process.env.SUPPORT_EMAIL || 'support@talentmatch.com'}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Basic Access</div>
                    <div class="info-value">Still available</div>
                </div>
            </div>

            <div class="main-message">
                <p>If you believe this decision was made in error or if you have additional documentation to support your verification request, please contact our support team.</p>
                <p><strong>Note:</strong> You can still access basic TalentMatch features with your current account. Premium features require agency verification.</p>
                <p>Thank you for your understanding.</p>
            </div>
        `;

        const html = createEmailTemplate(
            'Agency Verification Status',
            '❌ Review Required',
            'Dear',
            user.fullName,
            contentBody,
            'Contact Support',
            `mailto:${process.env.SUPPORT_EMAIL || 'support@talentmatch.com'}`
        );

        return transporter.sendMail({
            from: process.env.GMAIL_USER || "noreply@cvgo.pro",
            to: user.email,
            subject: 'Agency Verification Status - TalentMatch',
            html: html
        });
    }
};

// Send CV confirmation email
const sendConfirmationEmail = async (candidateData) => {
    try {
        const transporter = createTransporter();
        const emailTemplate = await loadEmailTemplate(candidateData);

        const mailOptions = {
            from: process.env.GMAIL_USER || "noreply@cvgo.pro",
            to: candidateData.email,
            subject: 'Resume Distribution Confirmation - TalentMatch',
            html: emailTemplate
        };

        const result = await transporter.sendMail(mailOptions);
        console.log('Email sent successfully:', result.messageId);
        return { success: true, messageId: result.messageId };

    } catch (error) {
        console.error('Email sending failed:', error);
        return { success: false, error: error.message };
    }
};

// Load email template for resume confirmation
const loadEmailTemplate = async (candidateData) => {
    const templatePath = path.join(__dirname, 'emailTemplate.html');
    let template;

    try {
        template = fs.readFileSync(templatePath, 'utf8');

        // Replace placeholders in the existing template
        const firstName = candidateData.name.split(' ')[0];
        const lastName = candidateData.name.split(' ').slice(1).join(' ');
        const profession = candidateData.positions?.[0]?.title || 'Professional';
        const currentDateTime = new Date().toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        template = template
            .replace('{{firstName}}', firstName)
            .replace('{{lastName}}', lastName)
            .replace('{{profession}}', profession)
            .replace('{date&time}', currentDateTime);

        return template;
    } catch (error) {
        // Fallback template using exact design
        const firstName = candidateData.name.split(' ')[0];
        const lastName = candidateData.name.split(' ').slice(1).join(' ');
        const profession = candidateData.positions?.[0]?.title || 'Professional';
        const currentDateTime = new Date().toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const contentBody = `
            <p>Your resume has been successfully processed and distributed to our network of specialized recruitment partners.</p>
            
            <div class="info-card">
                <h3>Distribution Summary</h3>
                <div class="info-item">
                    <div class="info-label">Profession</div>
                    <div class="info-value">${profession}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Processing Date</div>
                    <div class="info-value">
                        <span class="highlight-value">${currentDateTime}</span>
                    </div>
                </div>
            </div>

            <div class="main-message">
                <p>Your professional profile has been matched and distributed to <strong>specialized recruitment agencies</strong> within our network. These agencies have been carefully selected based on your experience and career objectives. Should they identify suitable opportunities that align with your profile, they will contact you directly.</p>
            </div>
        `;

        return createEmailTemplate(
            'Resume Distribution',
            '✓ Distribution Completed',
            'Dear',
            `${firstName} ${lastName}`,
            contentBody,
            'Explore Opportunities'
        );
    }
};

// Send welcome email to regular users (non-recruitment agencies)
const sendUserWelcomeEmail = async (user) => {
    try {
        const transporter = createTransporter();

        const contentBody = `
           <p>Welcome to TalentMatch! Your account has been successfully created and is ready to use.</p>
           
           <div class="info-card">
               <h3>Your Account Details</h3>
               <div class="info-item">
                   <div class="info-label">Full Name</div>
                   <div class="info-value">${user.fullName}</div>
               </div>
               <div class="info-item">
                   <div class="info-label">Username</div>
                   <div class="info-value">${user.username}</div>
               </div>
               <div class="info-item">
                   <div class="info-label">Company</div>
                   <div class="info-value">${user.companyName}</div>
               </div>
               <div class="info-item">
                   <div class="info-label">Account Type</div>
                   <div class="info-value">
                       <span class="highlight-value">Standard User</span>
                   </div>
               </div>
           </div>

           <div class="main-message">
               <p>You now have access to TalentMatch basic features including candidate browsing and basic search functionality.</p>
               <p><strong>Note:</strong> Advanced features like premium candidate profiles and AI-powered matching are available for verified recruitment agencies only.</p>
               <p>If you operate a recruitment agency, please contact support to upgrade your account verification status.</p>
           </div>
       `;

        const html = createEmailTemplate(
            'Welcome to TalentMatch',
            '✓ Account Created',
            'Welcome',
            user.fullName,
            contentBody,
            'Access TalentMatch Platform'
        );

        const result = await transporter.sendMail({
            from: process.env.GMAIL_USER || "noreply@cvgo.pro",
            to: user.email,
            subject: 'Welcome to TalentMatch - Account Created',
            html: html
        });

        console.log('User welcome email sent:', result.messageId);
        return { success: true, messageId: result.messageId };

    } catch (error) {
        console.error('Failed to send user welcome email:', error);
        throw error;
    }
};

// Send CV distribution email to recruitment agencies
const sendCVDistributionEmail = async (recruitmentEmail, candidateData, agency) => {
    try {
        const transporter = createTransporter();

        const contentBody = `
            <p>Dear recruitment professional,</p>
            <p>We have a new candidate that matches your service area and may be of interest to your agency.</p>
            
            <div class="info-card">
                <h3>Candidate Profile</h3>
                <div class="info-item">
                    <div class="info-label">Full Name</div>
                    <div class="info-value">${candidateData.name}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Phone Number</div>
                    <div class="info-value">${candidateData.phone}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Email Address</div>
                    <div class="info-value">${candidateData.email}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Previous Position</div>
                    <div class="info-value">${candidateData.previousJob}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Experience</div>
                    <div class="info-value">
                        <span class="highlight-value">${candidateData.experienceYears} years</span>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-label">Requested Positions</div>
                    <div class="info-value">${candidateData.requestedPositions}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Preferred Region</div>
                    <div class="info-value">${candidateData.region}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Submitted</div>
                    <div class="info-value">
                        <span class="highlight-value">${new Date(candidateData.submissionDate).toLocaleDateString('he-IL')}</span>
                    </div>
                </div>
            </div>

            <div class="main-message">
                <p><strong>Professional Summary:</strong> This candidate is actively seeking new opportunities in the positions listed above within the ${candidateData.region} region.</p>
                <p>If this profile matches any of your current job openings, please contact the candidate directly using the provided contact information.</p>
                <p><strong>Note:</strong> This candidate has provided consent for their CV to be distributed to verified recruitment agencies in our network.</p>
            </div>
        `;

        const html = createEmailTemplate(
            'New Candidate Match',
            '🎯 Candidate Alert',
            'Hello',
            'Recruitment Team',
            contentBody,
            'Contact Candidate',
            `mailto:${candidateData.email}?subject=Job Opportunity - ${candidateData.requestedPositions}&body=Hello ${candidateData.name.split(' ')[0]}, I represent ${agency.companyName} recruitment agency...`
        );

        const result = await transporter.sendMail({
            from: process.env.GMAIL_USER || "noreply@cvgo.pro",
            to: recruitmentEmail,
            subject: `New Candidate Alert - ${candidateData.name} (${candidateData.previousJob})`,
            html: html,
            headers: {
                'X-Priority': '3',
                'X-Candidate-ID': candidateData.candidateId,
                'X-Agency-ID': agency._id
            }
        });

        console.log(`CV distribution email sent to ${recruitmentEmail}:`, result.messageId);
        return { success: true, messageId: result.messageId };

    } catch (error) {
        console.error(`Failed to send CV distribution to ${recruitmentEmail}:`, error);
        throw error;
    }
};


// Test distribution system
const sendDistributionTestEmail = async (testEmail, agencyInfo) => {
    try {
        const transporter = createTransporter();

        const mockCandidate = {
            name: 'ישראל ישראלי',
            phone: '050-123-4567',
            email: 'test@example.com',
            previousJob: 'מפתח תוכנה Senior',
            experienceYears: '5',
            requestedPositions: 'Full Stack Developer, Backend Developer, Team Lead',
            region: 'מרכז',
            submissionDate: new Date()
        };

        const contentBody = `
            <p><strong>🧪 TEST EMAIL - CV Distribution System</strong></p>
            <p>This is a test email to verify your CV distribution system is working correctly.</p>
            
            <div class="info-card">
                <h3>Sample Candidate Profile</h3>
                <div class="info-item">
                    <div class="info-label">Full Name</div>
                    <div class="info-value">${mockCandidate.name}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Phone Number</div>
                    <div class="info-value">${mockCandidate.phone}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Email Address</div>
                    <div class="info-value">${mockCandidate.email}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Previous Position</div>
                    <div class="info-value">${mockCandidate.previousJob}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Experience</div>
                    <div class="info-value">
                        <span class="highlight-value">${mockCandidate.experienceYears} years</span>
                    </div>
                </div>
                <div class="info-item">
                    <div class="info-label">Requested Positions</div>
                    <div class="info-value">${mockCandidate.requestedPositions}</div>
                </div>
                <div class="info-item">
                    <div class="info-label">Preferred Region</div>
                    <div class="info-value">${mockCandidate.region}</div>
                </div>
            </div>

            <div class="main-message">
                <p><strong>This is a test message.</strong> Your CV distribution system is configured and working properly.</p>
                <p>When real candidates submit their CVs, you'll receive similar emails with actual candidate information.</p>
                <p>Agency: <strong>${agencyInfo.companyName}</strong></p>
                <p>Service Regions: <strong>${agencyInfo.supportRegions ? agencyInfo.supportRegions.join(', ') : 'N/A'}</strong></p>
            </div>
        `;

        const html = createEmailTemplate(
            'Distribution System Test',
            '🧪 TEST MESSAGE',
            'Hello',
            'Recruitment Team',
            contentBody,
            'Access Dashboard',
            `${process.env.BASE_URL || 'http://localhost:3000'}/dashboard.html`
        );

        const result = await transporter.sendMail({
            from: process.env.GMAIL_USER || "noreply@cvgo.pro",
            to: testEmail,
            subject: '🧪 TEST - TalentMatch CV Distribution System',
            html: html,
            headers: {
                'X-Priority': '3',
                'X-Test-Email': 'true'
            }
        });

        console.log(`Test distribution email sent to ${testEmail}:`, result.messageId);
        return { success: true, messageId: result.messageId };

    } catch (error) {
        console.error(`Failed to send test distribution email:`, error);
        throw error;
    }
};


module.exports = {
    sendConfirmationEmail,
    sendAdminNotification,
    sendUserWelcomeEmail,
    sendApprovalNotification,
    sendRegistrationConfirmation,
    sendCVDistributionEmail,
    sendDistributionTestEmail

};