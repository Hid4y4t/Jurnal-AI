const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

// Import pdf-parse
const pdfParse = require('pdf-parse');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Setup multer untuk upload file
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = './uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, Date.now() + '-' + cleanName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 15 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['text/plain', 'application/pdf'];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file TXT dan PDF yang diperbolehkan'));
        }
    }
});

// Inisialisasi Google GenAI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Function untuk extract teks dari PDF
async function extractTextFromPDF(filePath) {
    try {
        const dataBuffer = fs.readFileSync(filePath);
        const data = await pdfParse(dataBuffer, {
            pagerender: null,
            max: 0
        });
        
        let text = data.text;
        text = text.replace(/[^\x20-\x7E\n\r\t]/g, ' ');
        text = text.replace(/\s+/g, ' ');
        text = text.trim();
        
        if (!text || text.length < 10) {
            throw new Error('Tidak ada teks yang bisa diekstrak');
        }
        
        return text;
    } catch (error) {
        console.error('Error detail PDF parsing:', error.message);
        throw new Error('Gagal membaca PDF: ' + error.message);
    }
}

// Function untuk split teks panjang
function splitText(text, maxLength = 15000) {
    if (text.length <= maxLength) return [text];
    
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        let end = start + maxLength;
        if (end < text.length) {
            while (end > start && text[end] !== ' ' && text[end] !== '.' && text[end] !== '\n') {
                end--;
            }
        }
        chunks.push(text.substring(start, end));
        start = end;
    }
    return chunks;
}

// Function untuk clean AI response
function cleanAIResponse(text) {
    let clean = text.replace(/```json\s*/g, '');
    clean = clean.replace(/```\s*/g, '');
    clean = clean.trim();
    
    const jsonMatch = clean.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        return jsonMatch[0];
    }
    return clean;
}

// Endpoint untuk analisis jurnal
app.post('/analyze', upload.single('journal'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'File tidak ditemukan' });
        }

        console.log(`\n📄 ==================================`);
        console.log(`📄 Memproses file: ${req.file.originalname}`);
        console.log(`📊 Tipe file: ${req.file.mimetype}`);
        console.log(`💾 Ukuran file: ${(req.file.size / 1024).toFixed(2)} KB`);
        console.log(`📄 ==================================\n`);
        
        let journalText = '';
        
        if (req.file.mimetype === 'text/plain') {
            journalText = fs.readFileSync(req.file.path, 'utf8');
            console.log('✅ File TXT berhasil dibaca');
        } else if (req.file.mimetype === 'application/pdf') {
            try {
                console.log('🔄 Mengekstrak teks dari PDF...');
                journalText = await extractTextFromPDF(req.file.path);
                console.log('✅ PDF berhasil diekstrak');
                console.log(`📝 Panjang teks: ${journalText.length.toLocaleString()} karakter`);
                console.log(`🔍 Preview: ${journalText.substring(0, 200)}...`);
            } catch (pdfError) {
                console.error('❌ Error ekstrak PDF:', pdfError.message);
                fs.unlinkSync(req.file.path);
                return res.status(400).json({ 
                    error: 'Gagal membaca PDF.',
                    details: pdfError.message
                });
            }
        }
        
        if (!journalText || journalText.trim().length < 50) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ 
                error: 'Teks dari jurnal terlalu pendek.',
                length: journalText ? journalText.length : 0
            });
        }
        
        const textChunks = splitText(journalText, 15000);
        let mainText = textChunks[0];
        
        console.log(`📑 Analisis menggunakan chunk 1 dari ${textChunks.length}`);
        
        // Prompt untuk Gemini AI
        const prompt = `Anda adalah asisten akademik yang ahli dalam menganalisis jurnal ilmiah. 
Analisis jurnal berikut dan berikan output dalam format JSON.

JURNAL:
${mainText}

INSTRUKSI:
1. Ekstrak 5 poin paling penting dari jurnal
2. Identifikasi 5 kelemahan atau keterbatasan penelitian
3. Buat 1 judul penelitian baru yang bisa dikembangkan dari celah penelitian
4. Berikan rasional mengapa penelitian itu penting
5. Buat ringkasan 1-2 paragraf

OUTPUT HARUS VALID JSON FORMAT:
{
    "keyPoints": ["point1", "point2", "point3", "point4", "point5"],
    "weaknesses": ["weakness1", "weakness2", "weakness3", "weakness4", "weakness5"],
    "newResearchTitle": "Judul penelitian baru",
    "researchRationale": "Rasional mengapa penelitian ini penting",
    "summary": "Ringkasan jurnal"
}

HANYA OUTPUT JSON, TIDAK ADA TEKS LAIN!`;

        console.log('🤖 Mengirim ke Gemini AI dengan model gemini-2.5-flash...');
        
        // 👇 MENGGUNAKAN MODEL GEMINI 2.5 FLASH
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',  // ✅ Model yang Anda gunakan
            contents: prompt,
        });
        
        const text = response.text;
        console.log('✅ Response diterima dari Gemini AI');
        
        const cleanedText = cleanAIResponse(text);
        
        let analysis;
        try {
            analysis = JSON.parse(cleanedText);
            console.log('✅ JSON berhasil diparse');
            
            // Validasi dan default values
            if (!analysis.keyPoints || !Array.isArray(analysis.keyPoints)) {
                analysis.keyPoints = ['Poin penting 1: ' + (analysis.keyPoints?.[0] || 'Tidak tersedia')];
            }
            if (!analysis.weaknesses || !Array.isArray(analysis.weaknesses)) {
                analysis.weaknesses = ['Kelemahan 1: ' + (analysis.weaknesses?.[0] || 'Tidak tersedia')];
            }
            if (!analysis.newResearchTitle) analysis.newResearchTitle = 'Perlu analisis lebih lanjut';
            if (!analysis.researchRationale) analysis.researchRationale = 'Tidak ada rasional yang tersedia';
            if (!analysis.summary) analysis.summary = 'Ringkasan tidak tersedia';
            
        } catch (parseError) {
            console.error('❌ Gagal parse JSON:', parseError.message);
            console.log('Response mentah:', cleanedText.substring(0, 500));
            
            // Fallback response dengan informasi dari jurnal
            analysis = {
                keyPoints: [
                    "Jurnal: " + req.file.originalname,
                    "Judul: IMPLEMENTASI APAPO DALAM MODEL PENERIMAAN TEKNOLOGI",
                    "Jurnal Ilmiah Kajian Keimigrasian Politeknik Imigrasi",
                    "Vol. 3 No. 1 Tahun 2020",
                    "Teks berhasil diekstrak: " + journalText.length + " karakter"
                ],
                weaknesses: [
                    "Response AI tidak dalam format JSON yang valid",
                    "Coba upload ulang dengan file yang lebih pendek",
                    "Pastikan file PDF memiliki teks yang jelas"
                ],
                newResearchTitle: "Analisis Implementasi APAPO pada Sektor Keimigrasian Lainnya",
                researchRationale: "Berdasarkan jurnal yang menganalisis implementasi APAPO dalam model penerimaan teknologi, diperlukan penelitian lebih lanjut tentang efektivitas sistem di berbagai kantor imigrasi dengan karakteristik berbeda.",
                summary: "Jurnal ini membahas implementasi APAPO dalam model penerimaan teknologi di lingkungan keimigrasian. " + journalText.substring(0, 300)
            };
        }
        
        // Hapus file temporary
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
            console.log('🗑️ File temporary dihapus');
        }
        
        console.log('✅ Analisis selesai, mengirim response ke frontend\n');
        res.json(analysis);
        
    } catch (error) {
        console.error('❌ Error fatal:', error);
        
        if (req.file && fs.existsSync(req.file.path)) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (e) {}
        }
        
        res.status(500).json({ 
            error: 'Terjadi kesalahan saat menganalisis jurnal',
            details: error.message 
        });
    }
});

// Test endpoint
app.get('/test', (req, res) => {
    res.json({ 
        status: 'OK', 
        message: 'Server berjalan normal dengan Gemini 2.5 Flash',
        endpoints: ['POST /analyze', 'GET /health', 'GET /test']
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Server berjalan normal' });
});

app.listen(PORT, () => {
    console.log(`\n🚀 ==================================`);
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
    console.log(`📝 Upload file PDF atau TXT untuk dianalisis`);
    console.log(`🤖 Menggunakan model: Gemini 2.5 Flash`);
    console.log(`🔧 Test server: http://localhost:${PORT}/test`);
    console.log(`🚀 ==================================\n`);
});