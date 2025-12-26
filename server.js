const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const multer = require('multer');
const os = require('os');
const puppeteer = require('puppeteer');
const sharp = require('sharp');

require('dotenv').config({ quiet: true });

// ============================================
// ОБРАБОТКА ОШИБОК
// ============================================

// Логирование ошибок в файл
async function logError(error, req) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        error: {
            message: error.message,
            stack: error.stack,
            code: error.code
        },
        request: {
            method: req.method,
            url: req.url,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('user-agent')
        }
    };

    const logDir = path.join(__dirname, 'logs');
    const logFile = path.join(logDir, `error-${new Date().toISOString().split('T')[0]}.log`);

    try {
        await fs.mkdir(logDir, { recursive: true });
        await fs.appendFile(logFile, JSON.stringify(logEntry, null, 2) + '\n');
    } catch (err) {
        console.error('Failed to write error log:', err);
    }
}

// Wrapper для асинхронных маршрутов
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// Класс для кастомных ошибок
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

// Глобальный обработчик ошибок
const errorHandler = async (err, req, res, next) => {
    // Логируем ошибку
    await logError(err, req);
    console.error(`[ERROR] ${err.message}`, err.stack);

    // Определяем статус код
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Внутренняя ошибка сервера';
    let userMessage = message;

    // Обработка специфичных ошибок
    switch (err.code) {
        case 'ENOENT':
            statusCode = 404;
            userMessage = 'Файл или папка не найдены';
            break;
        case 'EPERM':
        case 'EACCES':
            statusCode = 403;
            userMessage = 'Доступ запрещён. Проверьте права доступа к файлам.';
            break;
        case 'EEXIST':
            statusCode = 409;
            userMessage = 'Файл или папка уже существует';
            break;
        case 'ENOTDIR':
            statusCode = 400;
            userMessage = 'Указанный путь не является папкой';
            break;
        case 'EISDIR':
            statusCode = 400;
            userMessage = 'Указанный путь является папкой';
            break;
        case 'EMFILE':
        case 'ENFILE':
            statusCode = 503;
            userMessage = 'Слишком много открытых файлов. Попробуйте позже.';
            break;
    }

    // Ошибки валидации Multer
    if (err instanceof Error && err.message.includes('Только SVG/PNG/JPG')) {
        statusCode = 400;
        userMessage = err.message;
    }

    // Ошибки Puppeteer
    if (err.message && err.message.includes('Navigation timeout')) {
        statusCode = 504;
        userMessage = 'Превышено время ожидания загрузки страницы';
    }

    // Отправляем ответ
    if (req.accepts('html')) {
        return res.status(statusCode).render('error', {
            message: userMessage,
            status: statusCode,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
            disableCopy: true
        });
    } else {
        return res.status(statusCode).json({
            error: userMessage,
            status: statusCode,
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    }
};

// 404 обработчик
const notFoundHandler = (req, res) => {
    const statusCode = 404;
    const message = 'Страница не найдена';

    if (req.accepts('html')) {
        return res.status(statusCode).render('error', {
            message,
            status: statusCode,
            disableCopy: true
        });
    } else {
        return res.status(statusCode).json({
            error: message,
            status: statusCode
        });
    }
};

// ============================================
// ОСНОВНЫЕ ФУНКЦИИ
// ============================================

function logAction(action, details = '') {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${action}${details ? ` - ${details}` : ''}\n`;
    console.log(line.trim());
}

const app = express();
const port = process.env.HTTP_PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/teletext', express.static(path.join(__dirname, 'teletext')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Security headers
app.use((req, res, next) => {
    const csp = [
        "default-src 'self'",
        "img-src 'self' https://cdn.discordapp.com https://okgamer.ru/uploads/fotos/ https://mc.yandex.ru https://yastatic.net https://tele.assunayuuki.ru data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline' https://mc.yandex.ru https://yastatic.net",
        "script-src-elem 'self' 'unsafe-inline' https://mc.yandex.ru https://yastatic.net",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self' https://mc.yandex.ru wss://mc.yandex.ru https://yastatic.net https://stats.g.doubleclick.net",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'"
    ].join('; ');

    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// Multer для логотипов
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

// Multer для файлов
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

// Валидация путей
function isValidPath(p) {
    if (!p) return true;
    const allowedChars = /^[a-zA-Zа-яА-ЯёЁ0-9\s,. -_\/&()'$$$${}@#~$%^*+=<>:;]+$/u;
    if (!allowedChars.test(p)) return false;
    return !p.includes('..') && !p.startsWith('/') && !p.includes(':') && !p.includes('\\') && !p.includes('\0');
}

// ✅ Генерация превью (асинхронная)
async function generateThumbnail(htmlPath, pngPath) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-web-security'
            ],
            defaultViewport: { width: 800, height: 600 }
        });
        const page = await browser.newPage();
        await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle2', timeout: 15000 });
        const buffer = await page.screenshot({ type: 'png', fullPage: true });

        const resizedBuffer = await sharp(buffer)
            .resize(250, 250, { fit: 'cover', position: 'center' })
            .png({ quality: 80, palette: true, dither: 0.5 })
            .toBuffer();

        await fs.writeFile(pngPath, resizedBuffer);
        logAction('THUMBNAIL_GENERATED_250x250_OPTIMIZED', pngPath);

    } catch (err) {
        throw new AppError(`Ошибка генерации превью: ${err.message}`, 500);
    } finally {
        if (browser) await browser.close();
    }
}

const MAX_CONCURRENT = 3;
async function generateThumbnailsForFolder(fullPath) {
    try {
        const items = await fs.readdir(fullPath);
        const htmlFiles = items.filter(f => f.endsWith('.html'));

        const tasks = htmlFiles.map(file => async () => {
            const pageStr = file.replace('.html', '');
            const page = parseInt(pageStr, 10);
            if (isNaN(page) || page < 100 || page > 999) return;

            const htmlPath = path.join(fullPath, file);
            const pngPath = path.join(fullPath, `${page}.png`);

            const pngExists = await fs.access(pngPath).then(() => true).catch(() => false);

            if (!pngExists) {
                try {
                    await generateThumbnail(htmlPath, pngPath);
                    logAction('THUMBNAIL_GENERATED', `${pngPath}`);
                } catch (err) {
                    logAction('THUMBNAIL_ERROR', `${pngPath}: ${err.message}`);
                }
            }
        });

        for (let i = 0; i < tasks.length; i += MAX_CONCURRENT) {
            const chunk = tasks.slice(i, i + MAX_CONCURRENT);
            await Promise.all(chunk.map(task => task()));
        }
    } catch (err) {
        logAction('THUMBNAIL_FOLDER_ERROR', `${fullPath}: ${err.message}`);
    }
}

// ============================================
// МАРШРУТЫ
// ============================================

// 🏠 Главная
app.get('/', asyncHandler(async (req, res) => {
    const dir = path.join(__dirname, 'teletext');

    let folders = [];
    const dirExists = await fs.access(dir).then(() => true).catch(() => false);

    if (dirExists) {
        const items = await fs.readdir(dir);
        const folderStats = await Promise.all(
            items.map(async item => {
                const itemPath = path.join(dir, item);
                const stats = await fs.stat(itemPath);
                return { item, isDirectory: stats.isDirectory() };
            })
        );
        folders = folderStats.filter(f => f.isDirectory).map(f => f.item);
    }

    res.render('index', { folders, disableCopy: true });
}));

// ℹ️ О проекте
app.get('/about', (req, res) => {
    res.render('about', { disableCopy: true });
});

// 📁 Папка (асинхронная версия)
app.get('/folder/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);

    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        throw new AppError('Папка не найдена', 404);
    }

    generateThumbnailsForFolder(fullPath).catch(err =>
        logAction('THUMBNAIL_GEN_ERROR', err.message)
    );

    const items = await fs.readdir(fullPath);
    const folders = [];
    const htmlFiles = [];

    await Promise.all(items.map(async item => {
        const itemPath = path.join(fullPath, item);
        const itemStats = await fs.stat(itemPath);

        if (itemStats.isDirectory()) {
            folders.push(item);
        } else if (item.endsWith('.html')) {
            htmlFiles.push(item);
        }
    }));

    let pages = [];
    const pagesByYear = {};

    for (const file of htmlFiles) {
        const pageStr = file.replace('.html', '');
        const page = parseInt(pageStr, 10);
        if (isNaN(page) || page < 100 || page > 999) continue;

        let year = 0;
        const yearMatch = file.match(/_(\d{2}|\d{4})\.html$/);
        if (yearMatch) {
            const yearPart = yearMatch[1];
            if (yearPart.length === 4) {
                year = parseInt(yearPart, 10);
            } else if (yearPart.length === 2) {
                const num = parseInt(yearPart, 10);
                year = num > 25 ? 1900 + num : 2000 + num;
            }
        }

        const pngPath = path.join(fullPath, `${pageStr}.png`);
        const hasThumb = await fs.access(pngPath).then(() => true).catch(() => false);

        if (!pagesByYear[year]) {
            pagesByYear[year] = [];
        }
        pagesByYear[year].push({ page, hasThumb });
    }

    const sortedYears = Object.keys(pagesByYear)
        .map(y => parseInt(y, 10))
        .sort((a, b) => b - a);

    const groupedPages = {};
    sortedYears.forEach(year => {
        groupedPages[year] = pagesByYear[year].sort((a, b) => a.page - b.page);
    });

    pages = htmlFiles.map(file => {
        const pageStr = file.replace('.html', '');
        const page = parseInt(pageStr, 10);
        const pngPath = path.join(fullPath, `${pageStr}.png`);
        const hasThumb = fsSync.existsSync(pngPath);
        return { page, hasThumb };
    }).filter(p => !isNaN(p.page) && p.page >= 100 && p.page <= 999);

    const foldersByYear = {};
    folders.forEach(folder => {
        let year = 0;
        const dateMatch = folder.match(/(\d{2}|\d{4})$/);
        if (dateMatch) {
            const yearPart = dateMatch[1];
            if (yearPart.length === 4) {
                year = parseInt(yearPart, 10);
            } else if (yearPart.length === 2) {
                const num = parseInt(yearPart, 10);
                year = num > 25 ? 1900 + num : 2000 + num;
            }
        }

        if (!foldersByYear[year]) {
            foldersByYear[year] = [];
        }
        foldersByYear[year].push(folder);
    });

    const sortedFolderYears = Object.keys(foldersByYear)
        .map(y => parseInt(y, 10))
        .sort((a, b) => b - a);

    const groupedFolders = {};
    sortedFolderYears.forEach(year => {
        groupedFolders[year] = foldersByYear[year].sort();
    });

    const pathParts = decodedPath.split('/').filter(Boolean);
    const breadcrumb = pathParts.map((part, i) => ({
        name: part,
        path: pathParts.slice(0, i + 1).join('/')
    }));

    const logoSvgPath = path.join(fullPath, 'logo.svg');
    const logoPngPath = path.join(fullPath, 'logo.png');
    const logoExists = await fs.access(logoSvgPath).then(() => true).catch(() => false);
    const logoExistsPng = await fs.access(logoPngPath).then(() => true).catch(() => false);
    const logoUrl = logoExists
        ? `/teletext/${decodedPath}/logo.svg`
        : logoExistsPng
            ? `/teletext/${decodedPath}/logo.png`
            : null;

    const folderCards = {};
    await Promise.all(folders.map(async folder => {
        const folderPath = path.join(fullPath, folder);
        const hasSvg = await fs.access(path.join(folderPath, 'logo.svg')).then(() => true).catch(() => false);
        const hasPng = await fs.access(path.join(folderPath, 'logo.png')).then(() => true).catch(() => false);

        let displayName = folder;
        const titleFile = path.join(folderPath, 'title.txt');
        try {
            const titleContent = await fs.readFile(titleFile, 'utf-8');
            displayName = titleContent.trim() || folder;
        } catch (e) {
            // Файл не существует
        }

        let description = '';
        const descFile = path.join(folderPath, 'description.txt');
        try {
            description = await fs.readFile(descFile, 'utf-8').then(d => d.trim());
        } catch (e) {
            // Файл не существует
        }

        folderCards[folder] = {
            logoUrl: hasSvg
                ? `/teletext/${decodedPath ? decodedPath + '/' : ''}${folder}/logo.svg`
                : hasPng
                    ? `/teletext/${decodedPath ? decodedPath + '/' : ''}${folder}/logo.png`
                    : null,
            displayName,
            description
        };
    }));

    res.render('folder', {
        folderName: path.basename(fullPath) || 'Телетекст',
        currentPath: decodedPath,
        folders,
        groupedPages,
        groupedFolders,
        pages,
        breadcrumb,
        hasLogo: logoExists || logoExistsPng,
        logoUrl,
        folderCards,
        disableCopy: true
    });
}));

// 📄 Страница
app.get('/page/*/:page', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    const pageParam = req.params.page;

    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const page = parseInt(pageParam, 10);
    if (isNaN(page) || page < 100 || page > 999) {
        throw new AppError('Некорректный номер страницы (100–999)', 400);
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    const htmlFile = path.join(fullPath, `${page}.html`);

    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        throw new AppError('Архив не найден', 404);
    }

    const htmlExists = await fs.access(htmlFile).then(() => true).catch(() => false);
    if (!htmlExists) {
        throw new AppError(`Страница ${page} не найдена`, 404);
    }

    const files = await fs.readdir(fullPath);
    const htmlFilesOnly = files.filter(f => f.endsWith('.html'));
    const pageNumbers = htmlFilesOnly
        .map(f => parseInt(f.replace('.html', ''), 10))
        .filter(n => !isNaN(n) && n >= 100 && n <= 999)
        .sort((a, b) => a - b);

    const currentIndex = pageNumbers.indexOf(page);
    const prevPage = currentIndex > 0 ? pageNumbers[currentIndex - 1] : null;
    const nextPage = currentIndex < pageNumbers.length - 1 ? pageNumbers[currentIndex + 1] : null;

    const content = await fs.readFile(htmlFile, 'utf-8');
    const pathParts = decodedPath.split('/').filter(Boolean);
    const breadcrumb = pathParts.map((part, i) => ({
        name: part,
        path: pathParts.slice(0, i + 1).join('/')
    }));

    const pageList = await Promise.all(pageNumbers.map(async p => {
        const pngPath = path.join(fullPath, `${p}.png`);
        const hasThumb = await fs.access(pngPath).then(() => true).catch(() => false);
        return { page: p, hasThumb };
    }));

    const basePath = `/teletext/${decodedPath}/`;

    const logoSvgPath = path.join(fullPath, 'logo.svg');
    const logoPngPath = path.join(fullPath, 'logo.png');
    const logoExists = await fs.access(logoSvgPath).then(() => true).catch(() => false);
    const logoExistsPng = await fs.access(logoPngPath).then(() => true).catch(() => false);
    const logoUrl = logoExists
        ? `/teletext/${decodedPath}/logo.svg`
        : logoExistsPng
            ? `/teletext/${decodedPath}/logo.png`
            : null;

    res.render('page', {
        pageNumber: page,
        content,
        currentPath: decodedPath,
        folderName: path.basename(fullPath) || 'Архив',
        prevPage,
        nextPage,
        pageList,
        breadcrumb,
        basePath,
        hasLogo: logoExists || logoExistsPng,
        logoUrl,
        disableCopy: true
    });
}));

// ✨ Редактор карточки
app.get('/edit-card/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        throw new AppError('Папка не найдена', 404);
    }

    let title = path.basename(decodedPath);
    const titleFile = path.join(fullPath, 'title.txt');
    try {
        const titleContent = await fs.readFile(titleFile, 'utf-8');
        title = titleContent.trim();
    } catch (err) {
        // Файл не существует
    }

    let description = '';
    const descFile = path.join(fullPath, 'description.txt');
    try {
        description = await fs.readFile(descFile, 'utf-8').then(d => d.trim());
    } catch (err) {
        // Файл не существует
    }

    const logoSvgPath = path.join(fullPath, 'logo.svg');
    const logoPngPath = path.join(fullPath, 'logo.png');
    const logoExists = await fs.access(logoSvgPath).then(() => true).catch(() => false);
    const logoExistsPng = await fs.access(logoPngPath).then(() => true).catch(() => false);
    const logoUrl = logoExists
        ? `/teletext/${decodedPath}/logo.svg`
        : logoExistsPng
            ? `/teletext/${decodedPath}/logo.png`
            : null;

    res.render('edit-card', {
        archivePath: decodedPath,
        folderName: path.basename(fullPath),
        currentTitle: title,
        currentDescription: description,
        hasLogo: logoExists || logoExistsPng,
        logoUrl,
        disableCopy: true
    });
}));

// 💾 Сохранение карточки (продолжение)
app.post('/save-card/*', upload.single('logo'), asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        throw new AppError('Папка не найдена', 404);
    }

    const newTitle = (req.body.title || '').trim();
    const newDescription = (req.body.description || '').trim();

    if (!newTitle) {
        return res.redirect(`/edit-card/${decodedPath}`);
    }

    let finalPathAfterRename = decodedPath;

    if (newTitle !== path.basename(decodedPath)) {
        const parentDir = path.dirname(fullPath);
        const newFolderPath = path.join(parentDir, newTitle);

        const newFolderExists = await fs.access(newFolderPath).then(() => true).catch(() => false);
        if (newFolderExists) {
            throw new AppError(`Папка '${newTitle}' уже существует`, 400);
        }

        try {
            const maxRetries = 3;
            let success = false;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    await fs.rename(fullPath, newFolderPath);
                    success = true;
                    logAction('FOLDER_RENAMED', `${fullPath} -> ${newFolderPath}`);
                    break;
                } catch (renameErr) {
                    if (renameErr.code === 'EPERM' && i < maxRetries - 1) {
                        logAction('FOLDER_RENAME_RETRY', `${decodedPath}: попытка ${i + 1} из ${maxRetries} (EPERM)`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    } else {
                        throw renameErr;
                    }
                }
            }

            if (!success) {
                throw new AppError(`Не удалось переименовать после ${maxRetries} попыток`, 500);
            }

            finalPathAfterRename = path.join(path.dirname(decodedPath), newTitle).replace(/^\/+/, '');

        } catch (renameErr) {
            logAction('FOLDER_RENAME_ERROR', `${decodedPath}: ${renameErr.message}`);
            if (renameErr.code === 'EPERM') {
                throw new AppError('Ошибка переименования: операция запрещена. Убедитесь, что папка не используется другим процессом.', 500);
            } else {
                throw renameErr;
            }
        }
    }

    const finalFullDirPath = path.join(__dirname, 'teletext', finalPathAfterRename);

    const titleFile = path.join(finalFullDirPath, 'title.txt');
    try {
        await fs.writeFile(titleFile, newTitle, 'utf-8');
        logAction('TITLE_SAVED', `${newTitle} -> ${finalPathAfterRename}`);
    } catch (err) {
        logAction('TITLE_SAVE_ERROR', `${finalPathAfterRename}: ${err.message}`);
    }

    if (newDescription) {
        const descFile = path.join(finalFullDirPath, 'description.txt');
        try {
            await fs.writeFile(descFile, newDescription, 'utf-8');
            logAction('DESC_SAVED', `${newDescription.substring(0, 20)}... -> ${finalPathAfterRename}`);
        } catch (err) {
            logAction('DESC_SAVE_ERROR', `${finalPathAfterRename}: ${err.message}`);
        }
    } else {
        const descFile = path.join(finalFullDirPath, 'description.txt');
        const descExists = await fs.access(descFile).then(() => true).catch(() => false);
        if (descExists) {
            try {
                await fs.unlink(descFile);
                logAction('DESC_DELETED', `description.txt удален из ${finalPathAfterRename}`);
            } catch (err) {
                logAction('DESC_DELETE_ERROR', `${finalPathAfterRename}: ${err.message}`);
            }
        }
    }

    if (req.file) {
        const targetName = req.file.originalname.toLowerCase().endsWith('.svg') ? 'logo.svg' : 'logo.png';
        const targetPath = path.join(finalFullDirPath, targetName);
        try {
            await fs.copyFile(req.file.path, targetPath);
            await fs.unlink(req.file.path);
            logAction('LOGO_UPLOADED', `${targetName} -> ${finalPathAfterRename}`);
        } catch (err) {
            logAction('LOGO_UPLOAD_ERROR', `${finalPathAfterRename}: ${err.message}`);
        }
    }

    res.redirect(`/folder/${finalPathAfterRename}`);
}));

// 🗑 Удаление логотипа
app.post('/logo-delete/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        throw new AppError('Папка не найдена', 404);
    }

    const logoSvg = path.join(fullPath, 'logo.svg');
    const logoPng = path.join(fullPath, 'logo.png');
    let deleted = [];

    const svgExists = await fs.access(logoSvg).then(() => true).catch(() => false);
    if (svgExists) {
        await fs.unlink(logoSvg);
        deleted.push('logo.svg');
    }

    const pngExists = await fs.access(logoPng).then(() => true).catch(() => false);
    if (pngExists) {
        await fs.unlink(logoPng);
        deleted.push('logo.png');
    }

    if (deleted.length > 0) {
        logAction('LOGO_DELETED', `${deleted.join(', ')} из ${decodedPath}`);
    }

    res.redirect(`/edit-card/${decodedPath}`);
}));

// 📁 Файловый менеджер
app.get('/manager/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        throw new AppError('Папка не найдена', 404);
    }

    const items = await fs.readdir(fullPath);
    const folders = [];
    const files = [];

    await Promise.all(items.map(async item => {
        const itemPath = path.join(fullPath, item);
        const itemStats = await fs.stat(itemPath);

        if (itemStats.isDirectory()) {
            const subItems = await fs.readdir(itemPath);
            const isEmpty = subItems.length === 0;
            folders.push({
                name: item,
                path: decodedPath ? `${decodedPath}/${item}` : item,
                isEmpty
            });
        } else {
            files.push({
                name: item,
                size: itemStats.size,
                url: `/teletext/${decodedPath ? encodeURIComponent(decodedPath) + '/' : ''}${encodeURIComponent(item)}`,
                ext: path.extname(item).toLowerCase()
            });
        }
    }));

    const pathParts = decodedPath.split('/').filter(Boolean);
    const breadcrumb = pathParts.map((part, i) => ({
        name: part,
        path: pathParts.slice(0, i + 1).join('/')
    }));

    res.render('manager', {
        folders,
        files,
        currentPath: decodedPath,
        breadcrumb,
        disableCopy: true
    });
}));

// 📁 Главная страница менеджера
app.get('/manager', (req, res) => {
    res.redirect('/manager/');
});

// ✅ Создать папку
app.post('/create-folder/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Имя папки обязательно' });
    }

    if (!isValidPath(requestedPath)) {
        return res.status(400).json({ error: 'Недопустимый путь' });
    }

    const cleanName = name.trim()
        .replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s._\-()]/g, '_')
        .replace(/\s+/g, '_');

    const fullPath = path.join(__dirname, 'teletext', requestedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        return res.status(404).json({ error: 'Папка не найдена' });
    }

    const dirPath = path.join(fullPath, cleanName);

    const dirExists = await fs.access(dirPath).then(() => true).catch(() => false);
    if (dirExists) {
        return res.status(400).json({ error: 'Папка уже существует' });
    }

    try {
        await fs.mkdir(dirPath, { recursive: true });
        logAction('FOLDER_CREATED', `teletext/${requestedPath ? requestedPath + '/' : ''}${cleanName}`);
        res.json({ success: true, name: cleanName });
    } catch (err) {
        throw new AppError(`Не удалось создать: ${err.message}`, 500);
    }
}));

// ✅ Удалить файл или папку
app.post('/delete-item/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    const { name, type } = req.body;

    if (!name || !type || !['file', 'folder'].includes(type)) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    if (!isValidPath(requestedPath)) {
        return res.status(400).json({ error: 'Недопустимый путь' });
    }

    const cleanName = path.basename(name);
    const fullPath = path.join(__dirname, 'teletext', requestedPath, cleanName);

    const itemExists = await fs.access(fullPath).then(() => true).catch(() => false);
    if (!itemExists) {
        return res.status(404).json({ error: 'Объект не найден' });
    }

    try {
        if (type === 'file') {
            await fs.unlink(fullPath);
            logAction('FILE_DELETED', `teletext/${requestedPath ? requestedPath + '/' : ''}${cleanName}`);
        } else if (type === 'folder') {
            await fs.rm(fullPath, { recursive: true, force: true });
            logAction('FOLDER_DELETED', `teletext/${requestedPath ? requestedPath + '/' : ''}${cleanName}`);
        }
        res.json({ success: true });
    } catch (err) {
        throw new AppError(`Ошибка удаления: ${err.message}`, 500);
    }
}));

// ✅ Переименовать файл или папку
app.post('/rename-item/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    const { oldName, newName, type } = req.body;

    if (!isValidPath(requestedPath) || !oldName || !newName || !['file', 'folder'].includes(type)) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    const cleanOldName = path.basename(oldName);
    const cleanNewName = path.basename(newName);
    const sourcePath = path.join(__dirname, 'teletext', requestedPath, cleanOldName);
    const targetPath = path.join(__dirname, 'teletext', requestedPath, cleanNewName);

    const sourceExists = await fs.access(sourcePath).then(() => true).catch(() => false);
    if (!sourceExists) {
        return res.status(404).json({ error: 'Объект не найден' });
    }

    const targetExists = await fs.access(targetPath).then(() => true).catch(() => false);
    if (targetExists) {
        return res.status(400).json({ error: 'Объект с таким именем уже существует' });
    }

    try {
        const maxRetries = 3;
        let success = false;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await fs.rename(sourcePath, targetPath);
                success = true;
                logAction('ITEM_RENAMED', `${type} ${sourcePath} -> ${targetPath}`);
                break;
            } catch (renameErr) {
                if (renameErr.code === 'EPERM' && i < maxRetries - 1) {
                    logAction('ITEM_RENAME_RETRY', `${requestedPath}/${cleanOldName}: попытка ${i + 1} из ${maxRetries} (EPERM)`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    throw renameErr;
                }
            }
        }

        if (!success) {
            throw new AppError(`Не удалось переименовать после ${maxRetries} попыток`, 500);
        }

        res.json({ success: true });
    } catch (err) {
        logAction('ITEM_RENAME_ERROR', `${requestedPath}/${cleanOldName}: ${err.message}`);
        if (err.code === 'EPERM') {
            return res.status(500).json({ error: 'Ошибка переименования: операция запрещена. Убедитесь, что объект не используется другим процессом.' });
        } else {
            throw err;
        }
    }
}));

// ✅ Переместить файл или папку
app.post('/move-item/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    const { itemName, targetPath, type } = req.body;

    if (!isValidPath(requestedPath) || !itemName || !['file', 'folder'].includes(type)) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    const finalTargetPath = targetPath ? path.join(targetPath) : requestedPath;
    if (!isValidPath(finalTargetPath)) {
        return res.status(400).json({ error: 'Недопустимый путь назначения' });
    }

    const cleanItemName = path.basename(itemName);
    const sourcePath = path.join(__dirname, 'teletext', requestedPath, cleanItemName);
    const targetDirPath = path.join(__dirname, 'teletext', finalTargetPath);
    const targetItemPath = path.join(targetDirPath, cleanItemName);

    const sourceExists = await fs.access(sourcePath).then(() => true).catch(() => false);
    if (!sourceExists) {
        return res.status(404).json({ error: 'Объект не найден' });
    }

    const targetDirStats = await fs.stat(targetDirPath).catch(() => null);
    if (!targetDirStats || !targetDirStats.isDirectory()) {
        return res.status(404).json({ error: 'Папка назначения не найдена' });
    }

    const targetItemExists = await fs.access(targetItemPath).then(() => true).catch(() => false);
    if (targetItemExists) {
        return res.status(400).json({ error: 'Объект с таким именем уже существует в папке назначения' });
    }

    try {
        await fs.rename(sourcePath, targetItemPath);
        logAction('ITEM_MOVED', `${type} ${sourcePath} -> ${targetItemPath}`);
        res.json({ success: true });
    } catch (err) {
        logAction('ITEM_MOVE_ERROR', `${requestedPath}/${cleanItemName} -> ${finalTargetPath}: ${err.message}`);
        if (err.code === 'EPERM') {
            return res.status(500).json({ error: 'Ошибка перемещения: операция запрещена. Убедитесь, что объект не используется другим процессом.' });
        } else {
            throw err;
        }
    }
}));

// ✅ Загрузка файлов
app.post('/upload/*', uploadFiles.any(), asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';

    if (!isValidPath(requestedPath)) {
        return res.status(400).json({ error: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, 'teletext', requestedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        return res.status(404).json({ error: 'Папка не найдена' });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Нет файлов для загрузки' });
    }

    const errors = [];
    const saved = [];

    for (const file of req.files) {
        try {
            let targetName = path.basename(file.originalname);
            if (targetName.includes('..') || targetName.startsWith('/')) {
                throw new Error('Недопустимое имя файла');
            }

            targetName = targetName
                .replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s._\-()]/g, '_')
                .replace(/\s+/g, '_');

            const targetPath = path.join(fullPath, targetName);

            await fs.copyFile(file.path, targetPath);
            await fs.unlink(file.path);
            saved.push(targetName);
            logAction('FILE_UPLOADED', `${targetName} → teletext/${requestedPath ? requestedPath + '/' : ''}`);
        } catch (err) {
            errors.push(`${file.originalname}: ${err.message}`);
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({ error: 'Частичная ошибка загрузки', errors, saved });
    }

    res.json({ success: true, saved });
}));

// ✅ Перегенерация превью (SSE)
app.get('/regenerate-thumbnails-stream/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        return res.status(400).json({ error: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        return res.status(404).json({ error: 'Папка не найдена' });
    }

    const items = await fs.readdir(fullPath);
    const htmlFiles = items.filter(f => f.endsWith('.html'));
    const totalFiles = htmlFiles.length;

    if (totalFiles === 0) {
        return res.json({ success: true, message: 'Нет HTML-файлов для генерации превьюшек' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
    });

    const errors = [];
    const generated = [];

    for (let i = 0; i < htmlFiles.length; i++) {
        const file = htmlFiles[i];
        const pageStr = file.replace('.html', '');
        const page = parseInt(pageStr, 10);
        if (isNaN(page) || page < 100 || page > 999) continue;

        const htmlPath = path.join(fullPath, file);
        const pngPath = path.join(fullPath, `${page}.png`);

        try {
            await generateThumbnail(htmlPath, pngPath);
            generated.push(`${page}.png`);
            logAction('THUMBNAIL_REGENERATED', pngPath);

            const progress = Math.round(((i + 1) / totalFiles) * 100);
            const data = {
                progress,
                current: i + 1,
                total: totalFiles,
                generated: [`${page}.png`]
            };
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (err) {
            errors.push(`${file}: ${err.message}`);
            logAction('THUMBNAIL_REGEN_ERROR', `${pngPath}: ${err.message}`);
        }
    }

    const finalData = {
        success: true,
        errors: errors.length > 0 ? errors : undefined,
        generated,
        message: 'Все превьюшки обновлены!'
    };

    res.write(`data: ${JSON.stringify(finalData)}\n\n`);
    res.end();
}));

// ✅ Быстрая перегенерация превью (для manager.ejs)
app.post('/manager/regenerate-thumbnails-fast/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        return res.status(400).json({ error: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        return res.status(404).json({ error: 'Папка не найдена' });
    }

    const items = await fs.readdir(fullPath);
    const htmlFiles = items.filter(f => f.endsWith('.html'));
    const totalFiles = htmlFiles.length;

    if (totalFiles === 0) {
        return res.json({ success: true, message: 'Нет HTML-файлов для генерации превьюшек' });
    }

    res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
    });

    const errors = [];
    const generated = [];

    const MAX_CONCURRENT_PAGES = 5;
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-web-security'
            ],
            defaultViewport: { width: 800, height: 600 }
        });

        let currentIndex = 0;
        let completed = 0;

        const workers = new Array(MAX_CONCURRENT_PAGES).fill(null).map(async () => {
            const page = await browser.newPage();
            while (currentIndex < totalFiles) {
                let index;
                if (currentIndex < totalFiles) {
                    index = currentIndex++;
                } else {
                    break;
                }
                const file = htmlFiles[index];
                const pageStr = file.replace('.html', '');
                const pageNum = parseInt(pageStr, 10);
                if (isNaN(pageNum) || pageNum < 100 || pageNum > 999) {
                    completed++;
                    if (completed % 5 === 0 || completed === totalFiles) {
                        const progress = Math.round((completed / totalFiles) * 100);
                        res.write(`${JSON.stringify({ progress, current: completed, total: totalFiles, generated: [] })}\n\n`);
                    }
                    continue;
                }

                const htmlPath = path.join(fullPath, file);
                const pngPath = path.join(fullPath, `${pageNum}.png`);

                try {
                    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle2', timeout: 15000 });
                    const buffer = await page.screenshot({ type: 'png', fullPage: true });

                    const resizedBuffer = await sharp(buffer)
                        .resize(250, 250, { fit: 'cover', position: 'center' })
                        .png({ quality: 80, palette: true, dither: 0.5 })
                        .toBuffer();

                    await fs.writeFile(pngPath, resizedBuffer);
                    generated.push(`${pageNum}.png`);
                    logAction('THUMBNAIL_GENERATED_250x250', pngPath);
                } catch (err) {
                    errors.push(`${file}: ${err.message}`);
                    logAction('THUMBNAIL_REGEN_ERROR', `${pngPath}: ${err.message}`);
                }

                completed++;
                if (completed % 5 === 0 || completed === totalFiles) {
                    const progress = Math.round((completed / totalFiles) * 100);
                    res.write(`${JSON.stringify({ progress, current: completed, total: totalFiles, generated: [`${pageNum}.png`] })}\n\n`);
                }
            }
            await page.close();
        });

        await Promise.all(workers);
    } finally {
        if (browser) await browser.close();
    }

    const finalData = {
        success: true,
        errors: errors.length > 0 ? errors : undefined,
        generated,
        message: 'Все превьюшки обновлены!'
    };

    res.write(`${JSON.stringify(finalData)}\n\n`);
    res.end();
}));

// ============================================
// ОБРАБОТЧИКИ ОШИБОК (ДОЛЖНЫ БЫТЬ ПОСЛЕДНИМИ)
// ============================================

// 404
app.use(notFoundHandler);

// Глобальный обработчик ошибок
app.use(errorHandler);

// ============================================
// ЗАПУСК СЕРВЕРА
// ============================================

app.listen(port, () => {
    logAction('SERVER_START', `http://localhost:${port}`);
    console.log(`✅ Телетекст-плеер запущен: http://localhost:${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    logAction('SERVER_SHUTDOWN', 'Graceful shutdown...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logAction('SERVER_SHUTDOWN', 'Graceful shutdown...');
    process.exit(0);
});