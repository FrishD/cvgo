// services/cvFileService.js - CV File Management and PDF Generation
const fs = require('fs').promises;
const path = require('path');
const PDFDocument = require('pdfkit');
const { Readable } = require('stream');

class CVFileService {
    constructor() {
        this.cvStoragePath = process.env.CV_STORAGE_PATH || path.join(__dirname, '../storage/cvs');
        this.tempPath = process.env.TEMP_PATH || path.join(__dirname, '../temp');
        this.maxStorageSize = 100 * 1024 * 1024; // 100MB per company
        this.allowedExtensions = ['.pdf', '.doc', '.docx'];

        this.initializeStorage();
    }

    // Initialize storage directories
    async initializeStorage() {
        try {
            await fs.mkdir(this.cvStoragePath, { recursive: true });
            await fs.mkdir(this.tempPath, { recursive: true });
            console.log('CV storage initialized');
        } catch (error) {
            console.error('Failed to initialize CV storage:', error);
        }
    }

    // Store original CV file
    async storeOriginalCV(candidateId, fileBuffer, originalFilename, metadata = {}) {
        try {
            const fileExtension = path.extname(originalFilename).toLowerCase();
            if (!this.allowedExtensions.includes(fileExtension)) {
                throw new Error('Unsupported file type');
            }

            const fileName = `${candidateId}_original${fileExtension}`;
            const filePath = path.join(this.cvStoragePath, fileName);

            // Store file with metadata
            await fs.writeFile(filePath, fileBuffer);

            // Create metadata file
            const metadataPath = path.join(this.cvStoragePath, `${candidateId}_metadata.json`);
            const fileMetadata = {
                candidateId,
                originalFilename,
                storedFilename: fileName,
                fileSize: fileBuffer.length,
                fileType: fileExtension,
                storedAt: new Date(),
                ...metadata
            };

            await fs.writeFile(metadataPath, JSON.stringify(fileMetadata, null, 2));

            console.log(`CV stored: ${fileName}`);
            return {
                success: true,
                filePath,
                fileName,
                metadata: fileMetadata
            };

        } catch (error) {
            console.error('Error storing CV:', error);
            throw error;
        }
    }

    // Generate formatted PDF from candidate data
    async generateFormattedPDF(candidateData) {
        try {
            const doc = new PDFDocument({
                margins: { top: 50, bottom: 50, left: 50, right: 50 },
                info: {
                    Title: `CV - ${candidateData.name}`,
                    Author: 'TalentMatch System',
                    Creator: 'TalentMatch CV Distribution',
                    Producer: 'TalentMatch',
                    CreationDate: new Date()
                }
            });

            // Create PDF content
            this.addPDFHeader(doc, candidateData);
            this.addPersonalInfo(doc, candidateData);
            this.addPositions(doc, candidateData);
            this.addFooter(doc, candidateData);

            // Convert to buffer
            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));

            return new Promise((resolve, reject) => {
                doc.on('end', () => {
                    const pdfBuffer = Buffer.concat(chunks);
                    resolve(pdfBuffer);
                });

                doc.on('error', reject);
                doc.end();
            });

        } catch (error) {
            console.error('Error generating PDF:', error);
            throw error;
        }
    }

    // Add PDF header
    addPDFHeader(doc, candidateData) {
        // Header background
        doc.rect(0, 0, doc.page.width, 80)
            .fill('#191c40');

        // Title
        doc.fillColor('#ffffff')
            .fontSize(24)
            .font('Helvetica-Bold')
            .text('CURRICULUM VITAE', 50, 25);

        // Subtitle
        doc.fontSize(10)
            .fillColor('#b29758')
            .text('TalentMatch Professional Profile', 50, 50);

        // Reset position
        doc.y = 100;
        doc.fillColor('#000000');
    }

    // Add personal information
    addPersonalInfo(doc, candidateData) {
        doc.fontSize(18)
            .font('Helvetica-Bold')
            .fillColor('#191c40')
            .text(candidateData.name, 50, doc.y);

        doc.y += 25;

        // Contact information in two columns
        const leftColumn = 50;
        const rightColumn = 300;
        const lineHeight = 20;

        doc.fontSize(12)
            .font('Helvetica')
            .fillColor('#000000');

        // Left column
        doc.text('Phone:', leftColumn, doc.y);
        doc.text(candidateData.phone, leftColumn + 50, doc.y);
        doc.y += lineHeight;

        doc.text('Email:', leftColumn, doc.y);
        doc.text(candidateData.email, leftColumn + 50, doc.y);
        doc.y += lineHeight;

        // Right column (reset Y position)
        doc.y -= lineHeight * 2;
        doc.text('Region:', rightColumn, doc.y);
        doc.text(candidateData.region || 'Not specified', rightColumn + 50, doc.y);
        doc.y += lineHeight;

        doc.text('Submitted:', rightColumn, doc.y);
        doc.text(new Date(candidateData.submissionDate).toLocaleDateString('he-IL'), rightColumn + 70, doc.y);
        doc.y += lineHeight * 2;

        // Add line separator
        doc.moveTo(50, doc.y)
            .lineTo(doc.page.width - 50, doc.y)
            .stroke('#cccccc');

        doc.y += 20;
    }

    // Add positions and experience
    addPositions(doc, candidateData) {
        doc.fontSize(16)
            .font('Helvetica-Bold')
            .fillColor('#191c40')
            .text('Professional Background', 50, doc.y);

        doc.y += 25;

        if (candidateData.positions && candidateData.positions.length > 0) {
            candidateData.positions.forEach((position, index) => {
                // Check if we need a new page
                if (doc.y > doc.page.height - 150) {
                    doc.addPage();
                    doc.y = 50;
                }

                // Position title
                doc.fontSize(14)
                    .font('Helvetica-Bold')
                    .fillColor('#404472')
                    .text(`${index + 1}. ${position.title}`, 50, doc.y);

                doc.y += 20;

                // Category
                doc.fontSize(12)
                    .font('Helvetica')
                    .fillColor('#666666')
                    .text(`Category: ${position.category || 'Other'}`, 70, doc.y);

                doc.y += 15;

                // Experience if available
                if (position.experience) {
                    doc.text('Experience:', 70, doc.y);
                    doc.text(position.experience, 70, doc.y + 15, {
                        width: doc.page.width - 120,
                        align: 'left'
                    });
                    doc.y += 40;
                }

                // Skills if available
                if (position.skills && position.skills.length > 0) {
                    doc.text('Skills:', 70, doc.y);
                    doc.text(position.skills.join(', '), 70, doc.y + 15, {
                        width: doc.page.width - 120,
                        align: 'left'
                    });
                    doc.y += 30;
                }

                doc.y += 10; // Space between positions
            });
        } else {
            doc.fontSize(12)
                .font('Helvetica')
                .fillColor('#666666')
                .text('No specific positions listed', 70, doc.y);
            doc.y += 30;
        }
    }

    // Add PDF footer
    addFooter(doc, candidateData) {
        const footerY = doc.page.height - 80;

        // Footer background
        doc.rect(0, footerY, doc.page.width, 80)
            .fill('#f5f5f5');

        // Footer text
        doc.fontSize(9)
            .fillColor('#666666')
            .text('Generated by TalentMatch Professional Recruitment System', 50, footerY + 20);

        doc.text(`Generated on: ${new Date().toLocaleString('en-US')}`, 50, footerY + 35);
        doc.text(`Candidate ID: ${candidateData.candidateId}`, 50, footerY + 50);

        // Right side
        doc.text('TalentMatch.com', doc.page.width - 120, footerY + 20);
        doc.text('Professional Recruitment', doc.page.width - 150, footerY + 35);
    }

    // Create email attachment from candidate data
    async createEmailAttachment(candidateData) {
        try {
            const pdfBuffer = await this.generateFormattedPDF(candidateData);

            return {
                filename: `CV_${candidateData.name.replace(/\s+/g, '_')}.pdf`,
                content: pdfBuffer,
                contentType: 'application/pdf',
                encoding: 'base64'
            };

        } catch (error) {
            console.error('Error creating email attachment:', error);
            throw error;
        }
    }

    // Retrieve stored CV
    async getStoredCV(candidateId) {
        try {
            const metadataPath = path.join(this.cvStoragePath, `${candidateId}_metadata.json`);

            // Check if metadata exists
            try {
                await fs.access(metadataPath);
            } catch {
                return null; // No stored CV found
            }

            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            const metadata = JSON.parse(metadataContent);

            const filePath = path.join(this.cvStoragePath, metadata.storedFilename);
            const fileBuffer = await fs.readFile(filePath);

            return {
                buffer: fileBuffer,
                metadata,
                exists: true
            };

        } catch (error) {
            console.error('Error retrieving stored CV:', error);
            return null;
        }
    }

    // Clean up old CV files (maintenance)
    async cleanupOldFiles(daysOld = 90) {
        try {
            const files = await fs.readdir(this.cvStoragePath);
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);

            let deletedCount = 0;

            for (const file of files) {
                const filePath = path.join(this.cvStoragePath, file);
                const stats = await fs.stat(filePath);

                if (stats.mtime < cutoffDate) {
                    await fs.unlink(filePath);
                    deletedCount++;
                    console.log(`Deleted old CV file: ${file}`);
                }
            }

            console.log(`Cleanup completed: ${deletedCount} files deleted`);
            return { deletedCount };

        } catch (error) {
            console.error('Error during cleanup:', error);
            throw error;
        }
    }

    // Get storage statistics
    async getStorageStats() {
        try {
            const files = await fs.readdir(this.cvStoragePath);
            let totalSize = 0;
            let fileCount = 0;

            for (const file of files) {
                const filePath = path.join(this.cvStoragePath, file);
                const stats = await fs.stat(filePath);
                totalSize += stats.size;

                if (file.endsWith('_original.pdf') || file.endsWith('_original.doc') || file.endsWith('_original.docx')) {
                    fileCount++;
                }
            }

            return {
                totalFiles: fileCount,
                totalSize,
                totalSizeMB: Math.round(totalSize / (1024 * 1024)),
                maxSizeMB: Math.round(this.maxStorageSize / (1024 * 1024)),
                usagePercentage: Math.round((totalSize / this.maxStorageSize) * 100)
            };

        } catch (error) {
            console.error('Error getting storage stats:', error);
            return null;
        }
    }
}

// Export singleton instance
module.exports = new CVFileService();