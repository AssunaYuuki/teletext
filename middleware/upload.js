const multer = require('multer');
const path = require('path');
const os = require('os');

// Для логотипов (SVG/PNG/JPG)
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, os.tmpdir()),
        filename: (req, file, cb) => cb(null, `logo_${Date.now()}${path.extname(file.originalname)}`)
    }),
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'image/svg+xml' || file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Только SVG/PNG/JPG'), false);
        }
    }
});

// Для файлов менеджера - ПРИНИМАЕМ ВСЁ
const uploadFiles = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, os.tmpdir()),
        filename: (req, file, cb) => {
            // Сохраняем оригинальное имя с префиксом timestamp
            const cleanName = file.originalname
                .replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s._\-()]/g, '_')
                .replace(/\s+/g, '_');
            cb(null, `upload_${Date.now()}_${cleanName}`);
        }
    }),
    fileFilter: (req, file, cb) => {
        // ✅ ПРИНИМАЕМ ЛЮБЫЕ ФАЙЛЫ без фильтрации
        cb(null, true);
    },
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB лимит
    }
});

module.exports = { upload, uploadFiles };