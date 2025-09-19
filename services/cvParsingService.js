// services/cvParsingService.js - CV Parsing Service
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { spawn } = require('child_process');

// Enhanced text extraction
async function extractText(fileBuffer, mimetype, filename = '') {
    try {
        let text = '';

        if (mimetype === 'application/pdf') {
            const data = await pdfParse(fileBuffer, {
                max: 50, // Maximum pages
                version: 'v1.10.100'
            });
            text = data.text;
        } else if (mimetype === 'application/msword' ||
            mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            const result = await mammoth.extractRawText({
                buffer: fileBuffer,
                convertImage: mammoth.images.ignoreImages
            });
            text = result.value;
        } else {
            throw new Error('Unsupported file type');
        }

        // Enhanced text validation
        if (!text || text.trim().length < 50) {
            throw new Error('Insufficient text content extracted from file');
        }

        if (text.length > 100000) { // 100KB limit
            text = text.substring(0, 100000);
        }

        // Basic content validation
        const wordCount = text.trim().split(/\s+/).length;
        if (wordCount < 20) {
            throw new Error('File appears to contain insufficient content for CV parsing');
        }

        return text;
    } catch (error) {
        console.error('Text extraction error:', error.message);
        throw new Error(`Text extraction failed: ${error.message}`);
    }
}

// Enhanced CV parsing with Python algorithm
async function parseWithEnhancedAlgorithm(text) {
    return new Promise((resolve, reject) => {
        const pythonScript = `
import re
import sys
import json
import unicodedata
from collections import Counter, defaultdict

def normalize_text(text):
    """Normalize unicode characters and clean text"""
    text = unicodedata.normalize('NFKD', text)
    text = re.sub(r'[\\u200b-\\u200f\\u2028-\\u202f\\u205f-\\u206f]', '', text)
    return text

def detect_language_advanced(text):
    """Enhanced language detection"""
    hebrew_chars = len(re.findall(r'[\\u0590-\\u05FF]', text))
    english_chars = len(re.findall(r'[a-zA-Z]', text))
    arabic_chars = len(re.findall(r'[\\u0600-\\u06FF]', text))
    
    total_chars = hebrew_chars + english_chars + arabic_chars
    if total_chars == 0:
        return 'unknown'
    
    if hebrew_chars > english_chars and hebrew_chars > arabic_chars:
        return 'he'
    elif english_chars > hebrew_chars and english_chars > arabic_chars:
        return 'en'
    elif arabic_chars > 0:
        return 'ar'
    
    return 'mixed'

def clean_text_line_advanced(line):
    """Enhanced text cleaning"""
    line = normalize_text(line)
    line = re.sub(r'<[^>]*>', '', line)
    line = re.sub(r'[*_\\[\\]{}()•▪▫◦‣⁃⚫]+', ' ', line)
    line = re.sub(r'\\b\\d{1,2}(?:/\\d{1,2}(?:/\\d{2,4})?)?\\b(?!\\d)', ' ', line)
    line = re.sub(r'\\s+', ' ', line)
    line = re.sub(r'^[.•*\\-–—]+\\s*', '', line)
    line = re.sub(r'[.•*\\-–—]+\\s*$', '', line)
    return line.strip()

def extract_name_enhanced_hebrew(text):
    """Enhanced Hebrew name extraction"""
    lines = text.split('\\n')
    candidates = []
    
    extended_exclude_words = {
        'קורות', 'חיים', 'רזומה', 'מידע', 'אישי', 'פרטי', 'טלפון', 'נייד',
        'אימייל', 'מייל', 'כתובת', 'עיר', 'גיל', 'נשוי', 'רווק', 'השכלה',
        'תואר', 'אוניברסיטה', 'מכללה', 'ניסיון', 'עבודה', 'תפקיד', 'משרה'
    }
    
    for i, line in enumerate(lines[:15]):
        original_line = line
        line = clean_text_line_advanced(line)
        
        if len(line) < 4 or len(line) > 80:
            continue
        
        # Skip patterns with dates, emails, etc.
        skip_patterns = [
            r'\\d{4}|\\d{2}[/\\-]\\d{2}',
            r'@|www\\.|http',
            r'\\+972|05\\d|04\\d|03\\d|02\\d',
            r'CV|cv|resume|קורות\\s+חיים'
        ]
        
        if any(re.search(pattern, line, re.IGNORECASE) for pattern in skip_patterns):
            continue
        
        # Name patterns
        patterns = [
            r'^\\s*([\\u0590-\\u05FF]{2,}(?:\\s+[\\u0590-\\u05FF]{2,}){1,3})\\s*$',
            r'^[*"]+\\s*([\\u0590-\\u05FF]{2,}(?:\\s+[\\u0590-\\u05FF]{2,}){1,3})\\s*[*"]+$'
        ]
        
        for pattern in patterns:
            match = re.search(pattern, line, re.UNICODE)
            if match:
                name = match.group(1).strip()
                words = name.split()
                
                if not (2 <= len(words) <= 3):
                    continue
                
                if not all(2 <= len(word) <= 20 for word in words):
                    continue
                    
                if any(word in extended_exclude_words for word in words):
                    continue
                
                confidence = 0.8 - (i * 0.05)
                candidates.append((name, confidence, i))
                break

    if candidates:
        candidates.sort(key=lambda x: x[1], reverse=True)
        return candidates[0][0], candidates[0][1]
    
    return None, 0

def extract_phone_enhanced(text):
    """Enhanced phone extraction"""
    phone_patterns = [
        r'\\b0(5[0-9])[-\\s]*(\\d{3})[-\\s]*(\\d{4})\\b',  # Mobile
        r'\\b0([2-4,8-9]\\d?)[-\\s]*(\\d{3})[-\\s]*(\\d{4})\\b',  # Landline
        r'\\+972[-\\s]*([2-9])[-\\s]*(\\d{3})[-\\s]*(\\d{4})'  # International
    ]
    
    candidates = []
    
    for pattern in phone_patterns:
        matches = re.finditer(pattern, text)
        for match in matches:
            groups = [g for g in match.groups() if g]
            phone_digits = ''.join(groups)
            
            clean_phone = re.sub(r'[^\\d]', '', phone_digits)
            
            if len(clean_phone) == 9 and not clean_phone.startswith('0'):
                clean_phone = '0' + clean_phone
            
            if len(clean_phone) == 10 and clean_phone.startswith('0'):
                if clean_phone.startswith('05'):  # Mobile
                    formatted = clean_phone[:3] + '-' + clean_phone[3:6] + '-' + clean_phone[6:]
                    candidates.append((formatted, 0.95))
                elif clean_phone[1:3] in ['02', '03', '04', '08', '09']:  # Landline
                    formatted = clean_phone[:2] + '-' + clean_phone[2:5] + '-' + clean_phone[5:]
                    candidates.append((formatted, 0.9))
    
    if candidates:
        unique_candidates = {}
        for phone, confidence in candidates:
            if phone not in unique_candidates or unique_candidates[phone] < confidence:
                unique_candidates[phone] = confidence
        
        best_phone = max(unique_candidates.items(), key=lambda x: x[1])
        return best_phone
    
    return None, 0

def extract_email_enhanced(text):
    """Enhanced email extraction"""
    email_pattern = r'\\b([a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\\.[a-zA-Z]{2,})\\b'
    
    candidates = []
    matches = re.finditer(email_pattern, text, re.IGNORECASE)
    
    for match in matches:
        email = match.group(1).strip().lower()
        
        if not (5 <= len(email) <= 100):
            continue
        
        if email.count('@') != 1:
            continue
        
        local, domain = email.split('@')
        
        if not (1 <= len(local) <= 64) or not (4 <= len(domain) <= 255):
            continue
        
        confidence = 0.85
        
        popular_domains = [
            'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
            'yahoo.co.il', 'walla.com', 'walla.co.il'
        ]
        
        if domain in popular_domains:
            confidence = 0.95
        elif domain.endswith(('.co.il', '.org.il', '.ac.il')):
            confidence = 0.9
        
        candidates.append((email, confidence))
    
    if candidates:
        unique_emails = {}
        for email, confidence in candidates:
            if email not in unique_emails or unique_emails[email] < confidence:
                unique_emails[email] = confidence
        
        best_email = max(unique_emails.items(), key=lambda x: x[1])
        return best_email
    
    return None, 0

def extract_position_enhanced(text):
    """Enhanced position extraction"""
    position_keywords = {
        'hebrew': {
            'tech': [
                'מפתח תוכנה', 'מהנדס תוכנה', 'בודק תוכנה', 'מנהל מערכות',
                'מנהל פרויקטים', 'מנהל מוצר', 'DevOps', 'מהנדס נתונים',
                'מנתח מערכות', 'אדריכל תוכנה', 'טכנאי מחשבים', 'מנהל IT'
            ],
            'management': [
                'מנהל בכיר', 'מנהל כללי', 'מנהל אזורי', 'מנהל סניף',
                'מנהל צוות', 'מנהל מכירות', 'מנהל שיווק', 'מנכ"ל', 'סמנכ"ל'
            ],
            'sales': [
                'נציג מכירות', 'איש מכירות', 'מנהל חשבונות', 'יועץ מכירות',
                'רכז שיווק', 'מנהל שיווק דיגיטלי'
            ]
        }
    }
    
    all_positions = []
    for lang in position_keywords:
        for category in position_keywords[lang]:
            for pos in position_keywords[lang][category]:
                all_positions.append((pos, 0.8, category))
    
    all_positions.sort(key=lambda x: len(x[0]), reverse=True)
    
    candidates = []
    lines = text.split('\\n')[:20]
    
    for i, line in enumerate(lines):
        line = clean_text_line_advanced(line)
        
        if len(line) < 3 or len(line) > 150:
            continue
        
        for position, base_score, category in all_positions:
            pattern = re.escape(position).replace('\\\\ ', '\\\\s+')
            pattern = f'\\\\b{pattern}\\\\b'
            
            if re.search(pattern, line, re.IGNORECASE):
                score = base_score - (i * 0.01)
                candidates.append((position, score, i, category))
                break
    
    if candidates:
        candidates.sort(key=lambda x: (x[1], -x[2]), reverse=True)
        return candidates[0][0], candidates[0][1]
    
    return None, 0

def parse_cv_enhanced(text):
    """Main CV parsing function"""
    try:
        text = normalize_text(text)
        lang = detect_language_advanced(text)
        
        result = {
            'name': None,
            'phone': None,
            'email': None,
            'position': None,
            'confidence': {},
            'language': lang,
            'additional_info': {}
        }
        
        # Extract name based on language
        if lang in ['he', 'mixed']:
            name, confidence = extract_name_enhanced_hebrew(text)
        else:
            name, confidence = None, 0  # English extraction simplified for brevity
        
        if name and confidence > 0.4:
            result['name'] = name
            result['confidence']['name'] = confidence
        
        # Extract phone
        phone, phone_conf = extract_phone_enhanced(text)
        if phone and phone_conf > 0.6:
            result['phone'] = phone
            result['confidence']['phone'] = phone_conf
        
        # Extract email
        email, email_conf = extract_email_enhanced(text)
        if email and email_conf > 0.6:
            result['email'] = email
            result['confidence']['email'] = email_conf
        
        # Extract position
        position, pos_conf = extract_position_enhanced(text)
        if position and pos_conf > 0.3:
            result['position'] = position
            result['confidence']['position'] = pos_conf
        
        # Calculate overall confidence
        total_score = 0
        total_weight = 0
        weights = {'name': 0.3, 'email': 0.25, 'phone': 0.25, 'position': 0.2}
        
        for field, weight in weights.items():
            if field in result['confidence'] and result[field]:
                total_score += result['confidence'][field] * weight
                total_weight += weight
        
        result['overall_confidence'] = total_score / total_weight if total_weight > 0 else 0
        
        return result
    
    except Exception as e:
        return {'error': str(e)}

if __name__ == "__main__":
    text = sys.stdin.read()
    result = parse_cv_enhanced(text)
    print(json.dumps(result, ensure_ascii=False))
        `;

        const python = spawn('py', ['-c', pythonScript]);

        let output = '';
        let error = '';

        python.stdout.on('data', (data) => {
            output += data.toString();
        });

        python.stderr.on('data', (data) => {
            error += data.toString();
        });

        python.on('close', (code) => {
            if (code !== 0) {
                console.error('Python script error:', error);
                reject(new Error('Enhanced parsing failed: ' + error));
            } else {
                try {
                    const result = JSON.parse(output);
                    if (result.error) {
                        reject(new Error(result.error));
                    } else {
                        resolve(result);
                    }
                } catch (e) {
                    reject(new Error('Failed to parse output: ' + e.message));
                }
            }
        });

        python.stdin.write(text);
        python.stdin.end();
    });
}

// Fallback regex parser
function parseWithRegexFallback(text) {
    const data = {
        name: null,
        phone: null,
        email: null,
        position: null,
        confidence: {},
        additional_info: {}
    };

    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    // Simple name extraction
    for (let i = 0; i < Math.min(10, lines.length); i++) {
        const line = lines[i];

        if (line.includes('@') || line.includes('www') || /\d{4}/.test(line)) {
            continue;
        }

        // Hebrew name pattern
        const hebrewMatch = line.match(/^[\s\*]*?([\u0590-\u05FF]+(?:\s+[\u0590-\u05FF]+){1,2})[\s\*]*?$/);
        if (hebrewMatch) {
            const name = hebrewMatch[1].trim();
            const words = name.split(/\s+/);
            if (words.length >= 2 && words.length <= 3) {
                data.name = name;
                data.confidence.name = Math.max(0.4, 0.8 - (i * 0.05));
                break;
            }
        }

        // English name pattern
        const englishMatch = line.match(/^[\s\*]*?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})[\s\*]*?$/);
        if (englishMatch && !data.name) {
            const name = englishMatch[1].trim();
            data.name = name;
            data.confidence.name = Math.max(0.4, 0.7 - (i * 0.05));
            break;
        }
    }

    // Email extraction
    const emailMatch = text.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
    if (emailMatch) {
        data.email = emailMatch[1].toLowerCase();
        data.confidence.email = 0.8;
    }

    // Phone extraction
    const phoneMatch = text.match(/\b0([5][0-9])[-\s]*(\d{3})[-\s]*(\d{4})\b/);
    if (phoneMatch) {
        const phone = `${phoneMatch[0].substring(0, 3)}-${phoneMatch[0].substring(3, 6)}-${phoneMatch[0].substring(6)}`;
        data.phone = phone.replace(/\s/g, '');
        data.confidence.phone = 0.8;
    }

    return data;
}

// Main parsing function
async function parseCV(fileData, filename = '') {
    console.log('Starting CV parsing...');

    try {
        const startTime = Date.now();

        // Extract text from file
        let text;
        if (fileData.buffer) {
            text = await extractText(fileData.buffer, fileData.mimetype, filename);
            fileData.textLength = text.length;
        } else {
            throw new Error('Invalid file data');
        }

        // Try enhanced parsing first
        try {
            const enhancedResult = await parseWithEnhancedAlgorithm(text);

            enhancedResult.processingTime = Date.now() - startTime;
            enhancedResult.method = 'enhanced';

            return enhancedResult;
        } catch (enhancedError) {
            console.log('Enhanced parsing failed, using fallback:', enhancedError.message);

            const fallbackResult = parseWithRegexFallback(text);
            fallbackResult.processingTime = Date.now() - startTime;
            fallbackResult.method = 'fallback';
            fallbackResult.error = enhancedError.message;

            return fallbackResult;
        }

    } catch (error) {
        console.error('CV parsing error:', error);
        throw error;
    }
}

module.exports = {
    parseCV,
    extractText
};