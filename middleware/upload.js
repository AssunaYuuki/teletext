const multer = require('multer');
const path = require('path');
const os = require('os');

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

const uploadFiles = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, os.tmpdir()),
        filename: (req, file, cb) => {
            const cleanName = file.originalname
                .replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s._\-()]/g, '_')
                .replace(/\s+/g, '_');
            cb(null, `upload_${Date.now()}_${cleanName}`);
        }
    }),
    fileFilter: (req, file, cb) => {
        const allowed = ['.html', '.png', '.svg', '.txt', '.css', '.js', '.json', '.jpg', '.jpeg', '.gif', '.webp', '.ttf'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error(`Запрещённый тип файла: ${ext}. Разрешены: ${allowed.join(', ')}`));
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 }
});

module.exports = { upload, uploadFiles };
