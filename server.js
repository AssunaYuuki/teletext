const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const puppeteer = require('puppeteer');

require('dotenv').config({ quiet: true });

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
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; " +
        "img-src 'self' https://cdn.discordapp.com https://okgamer.ru/uploads/fotos/; " +
        "style-src 'self' 'unsafe-inline'; " +
        "script-src 'self' 'unsafe-inline' https://mc.yandex.ru; " +
        "font-src 'self';"
    );
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

// Multer для файлов — теперь сохраняет структуру папок
const uploadFiles = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, os.tmpdir()),
        filename: (req, file, cb) => {
            const cleanName = file.originalname
            cb(null, `upload_${Date.now()}_${cleanName}`);
        }
    }),
    fileFilter: (req, file, cb) => {
        const allowed = ['.html', '.png', '.svg', '.txt', '.css', '.js', '.json', '.jpg', '.jpeg', '.gif', '.webp'];
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
    const allowedChars = /^[a-zA-Zа-яА-ЯёЁ0-9\s,. -_\/&()'\[\]{}@#~$%^*+=<>:;]+$/u;
    if (!allowedChars.test(p)) return false;
    return !p.includes('..') && !p.startsWith('/') && !p.includes(':') && !p.includes('\\') && !p.includes('\0');
}

// Генерация превью
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
        await page.screenshot({ path: pngPath, type: 'png', fullPage: true });
    } catch (err) {
        throw err;
    } finally {
        if (browser) await browser.close();
    }
}

const MAX_CONCURRENT = 3;
async function generateThumbnailsForFolder(fullPath) {
    const htmlFiles = fs.readdirSync(fullPath).filter(f => f.endsWith('.html'));
    const tasks = htmlFiles.map(file => async () => {
        const pageStr = file.replace('.html', '');
        const page = parseInt(pageStr, 10);
        if (isNaN(page) || page < 100 || page > 999) return;
        const htmlPath = path.join(fullPath, file);
        const pngPath = path.join(fullPath, `${page}.png`);
        if (!fs.existsSync(pngPath)) {
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
}

// 🏠 Главная
app.get('/', (req, res) => {
    const dir = path.join(__dirname, 'teletext');
    const folders = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isDirectory())
        : [];
    res.render('index', { folders, disableCopy: true });
});

// ℹ️ О проекте
app.get('/about', (req, res) => {
    res.render('about', { disableCopy: true });
});

// 📁 Папка
app.get('/folder/*', async (req, res) => {
    const requestedPath = req.params[0] || '';
    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) return res.status(400).render('error', { message: 'Недопустимый путь' });

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).render('error', { message: 'Папка не найдена' });
    }

    generateThumbnailsForFolder(fullPath).catch(err => console.error('Ошибка генерации:', err));

    const items = fs.readdirSync(fullPath);
    const folders = items.filter(item => fs.statSync(path.join(fullPath, item)).isDirectory());
    const htmlFiles = items.filter(item => item.endsWith('.html'));
    const pages = htmlFiles.map(file => {
        const pageStr = file.replace('.html', '');
        const page = parseInt(pageStr, 10);
        const hasThumb = fs.existsSync(path.join(fullPath, `${pageStr}.png`));
        return { page, hasThumb };
    }).filter(p => !isNaN(p.page) && p.page >= 100 && p.page <= 999);

    const pathParts = decodedPath.split('/').filter(Boolean);
    const breadcrumb = pathParts.map((part, i) => ({ name: part, path: pathParts.slice(0, i + 1).join('/') }));

    const logoExists = fs.existsSync(path.join(fullPath, 'logo.svg'));
    const logoExistsPng = fs.existsSync(path.join(fullPath, 'logo.png'));
    const logoUrl = logoExists ? `/teletext/${decodedPath}/logo.svg` : logoExistsPng ? `/teletext/${decodedPath}/logo.png` : null;

    const folderCards = {};
    folders.forEach(folder => {
        const folderPath = path.join(fullPath, folder);
        const hasSvg = fs.existsSync(path.join(folderPath, 'logo.svg'));
        const hasPng = fs.existsSync(path.join(folderPath, 'logo.png'));

        let displayName = folder;
        const titleFile = path.join(folderPath, 'title.txt');
        if (fs.existsSync(titleFile)) {
            try {
                displayName = fs.readFileSync(titleFile, 'utf-8').trim() || folder;
            } catch (e) {
                logAction('TITLE_READ_WARN', `Не удалось прочитать title.txt в ${folder}`);
            }
        }

        let description = '';
        const descFile = path.join(folderPath, 'description.txt');
        if (fs.existsSync(descFile)) {
            try {
                description = fs.readFileSync(descFile, 'utf-8').trim();
            } catch (e) {
                logAction('DESC_READ_WARN', `Не удалось прочитать description.txt в ${folder}`);
            }
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
    });

    res.render('folder', {
        folderName: path.basename(fullPath) || 'Телетекст',
        currentPath: decodedPath,
        folders,
        pages,
        breadcrumb,
        hasLogo: logoExists || logoExistsPng,
        logoUrl,
        folderCards,
        disableCopy: true
    });
});

// 📄 Страница
app.get('/page/*/:page', async (req, res) => {
    const requestedPath = req.params[0] || '';
    const pageParam = req.params.page;

    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) return res.status(400).render('error', { message: 'Недопустимый путь' });

    const page = parseInt(pageParam, 10);
    if (isNaN(page) || page < 100 || page > 999) return res.status(400).render('error', { message: 'Некорректный номер страницы (100–999)' });

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    const htmlFile = path.join(fullPath, `${page}.html`);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) return res.status(404).render('error', { message: 'Архив не найден' });
    if (!fs.existsSync(htmlFile)) return res.status(404).render('error', { message: `Страница ${page} не найдена` });

    const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.html'));
    const pageNumbers = files.map(f => parseInt(f.replace('.html', ''), 10)).filter(n => !isNaN(n) && n >= 100 && n <= 999).sort((a, b) => a - b);
    const currentIndex = pageNumbers.indexOf(page);
    const prevPage = currentIndex > 0 ? pageNumbers[currentIndex - 1] : null;
    const nextPage = currentIndex < pageNumbers.length - 1 ? pageNumbers[currentIndex + 1] : null;

    const content = fs.readFileSync(htmlFile, 'utf-8');
    const pathParts = decodedPath.split('/').filter(Boolean);
    const breadcrumb = pathParts.map((part, i) => ({ name: part, path: pathParts.slice(0, i + 1).join('/') }));
    const pageList = pageNumbers.map(p => ({ page: p, hasThumb: fs.existsSync(path.join(fullPath, `${p}.png`)) }));
    const basePath = `/teletext/${decodedPath}/`;

    const logoExists = fs.existsSync(path.join(fullPath, 'logo.svg'));
    const logoExistsPng = fs.existsSync(path.join(fullPath, 'logo.png'));
    const logoUrl = logoExists ? `/teletext/${decodedPath}/logo.svg` : logoExistsPng ? `/teletext/${decodedPath}/logo.png` : null;

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
});

// ✨ Редактор карточки
app.get('/edit-card/*', (req, res) => {
    const requestedPath = req.params[0] || '';
    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) return res.status(400).render('error', { message: 'Недопустимый путь' });

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).render('error', { message: 'Папка не найдена' });
    }

    let title = path.basename(decodedPath);
    const titleFile = path.join(fullPath, 'title.txt');
    if (fs.existsSync(titleFile)) {
        try {
            title = fs.readFileSync(titleFile, 'utf-8').trim();
        } catch (err) {
            logAction('TITLE_READ_ERROR', `${titleFile}: ${err.message}`);
        }
    }

    let description = '';
    const descFile = path.join(fullPath, 'description.txt');
    if (fs.existsSync(descFile)) {
        try {
            description = fs.readFileSync(descFile, 'utf-8').trim();
        } catch (err) {
            logAction('DESC_READ_ERROR', `${descFile}: ${err.message}`);
        }
    }

    const logoExists = fs.existsSync(path.join(fullPath, 'logo.svg'));
    const logoExistsPng = fs.existsSync(path.join(fullPath, 'logo.png'));
    const logoUrl = logoExists ? `/teletext/${decodedPath}/logo.svg` : logoExistsPng ? `/teletext/${decodedPath}/logo.png` : null;

    res.render('edit-card', {
        archivePath: decodedPath,
        folderName: path.basename(fullPath),
        currentTitle: title,
        currentDescription: description,
        hasLogo: logoExists || logoExistsPng,
        logoUrl,
        disableCopy: true
    });
});

// 💾 Сохранение логотипа + названия + описания + переименование папки в название канала
app.post('/save-card/*', upload.single('logo'), async (req, res) => {
    const requestedPath = req.params[0] || '';
    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        logAction('CARD_SAVE_FAIL', 'Недопустимый путь');
        return res.status(400).render('error', { message: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        logAction('CARD_SAVE_FAIL', `Папка не найдена: ${requestedPath}`);
        return res.status(404).render('error', { message: 'Папка не найдена' });
    }

    const newTitle = (req.body.title || '').trim();
    const newDescription = (req.body.description || '').trim();

    if (!newTitle) {
        logAction('CARD_SAVE_FAIL', 'Пустое название');
        return res.redirect(`/edit-card/${decodedPath}`);
    }

    // --- Шаг 1: Переименование папки в название канала ---
    let finalPathAfterRename = decodedPath; // Путь после возможного переименования

    if (newTitle !== path.basename(decodedPath)) {
        const parentDir = path.dirname(fullPath);
        const newFolderPath = path.join(parentDir, newTitle);

        if (fs.existsSync(newFolderPath)) {
            logAction('CARD_SAVE_FAIL', `Папка уже существует: ${newFolderPath}`);
            return res.status(400).render('error', { message: `Папка '${newTitle}' уже существует` });
        }

        try {
            // Попытка переименования с повторами
            const maxRetries = 3;
            let success = false;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    fs.renameSync(fullPath, newFolderPath);
                    success = true;
                    logAction('FOLDER_RENAMED', `${fullPath} -> ${newFolderPath}`);
                    break;
                } catch (renameErr) {
                    if (renameErr.code === 'EPERM' && i < maxRetries - 1) {
                        logAction('FOLDER_RENAME_RETRY', `${decodedPath}: попытка ${i + 1} из ${maxRetries} (EPERM)`);
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Задержка 1 секунда
                    } else {
                        throw renameErr; // Прерываем цикл, если не EPERM или последняя попытка
                    }
                }
            }

            if (!success) {
                throw new Error(`Не удалось переименовать папку после ${maxRetries} попыток`);
            }

            // Обновляем finalPathAfterRename
            finalPathAfterRename = path.join(path.dirname(decodedPath), newTitle).replace(/^\/+/, ''); // Убираем начальный слэш, если есть

        } catch (renameErr) {
            logAction('FOLDER_RENAME_ERROR', `${decodedPath}: ${renameErr.message}`);
            // Проверяем, была ли ошибка EPERM
            if (renameErr.code === 'EPERM') {
                return res.status(500).render('error', { message: `Ошибка переименования: операция запрещена. Убедитесь, что папка не используется другим процессом (антивирус, проводник и т.д.). Попробуйте закрыть все программы, работающие с этой папкой, и сохранить снова.` });
            } else {
                return res.status(500).render('error', { message: `Ошибка переименования папки: ${renameErr.message}` });
            }
        }
    }

    // --- Шаг 2: Обновление файлов title.txt и description.txt в новой (или старой) папке ---
    const finalFullDirPath = path.join(__dirname, 'teletext', finalPathAfterRename);

    // Обновление title.txt
    const titleFile = path.join(finalFullDirPath, 'title.txt');
    try {
        fs.writeFileSync(titleFile, newTitle, 'utf-8');
        logAction('TITLE_SAVED', `${newTitle} -> ${finalPathAfterRename}`);
    } catch (err) {
        logAction('TITLE_SAVE_ERROR', `${finalPathAfterRename}: ${err.message}`);
        // Продолжаем, даже если title не сохранился
    }

    // Обновление description.txt
    if (newDescription) {
        const descFile = path.join(finalFullDirPath, 'description.txt');
        try {
            fs.writeFileSync(descFile, newDescription, 'utf-8');
            logAction('DESC_SAVED', `${newDescription.substring(0, 20)}... -> ${finalPathAfterRename}`);
        } catch (err) {
            logAction('DESC_SAVE_ERROR', `${finalPathAfterRename}: ${err.message}`);
            // Продолжаем, даже если description не сохранился
        }
    } else {
        const descFile = path.join(finalFullDirPath, 'description.txt');
        if (fs.existsSync(descFile)) {
            try {
                fs.unlinkSync(descFile);
                logAction('DESC_DELETED', `description.txt удален из ${finalPathAfterRename}`);
            } catch (err) {
                logAction('DESC_DELETE_ERROR', `${finalPathAfterRename}: ${err.message}`);
                // Продолжаем, даже если description не удалён
            }
        }
    }

    // --- Шаг 3: Обновление логотипа ---
    if (req.file) {
        const targetName = req.file.originalname.toLowerCase().endsWith('.svg') ? 'logo.svg' : 'logo.png';
        const targetPath = path.join(finalFullDirPath, targetName);
        try {
            fs.copyFileSync(req.file.path, targetPath);
            fs.unlinkSync(req.file.path);
            logAction('LOGO_UPLOADED', `${targetName} -> ${finalPathAfterRename}`);
        } catch (err) {
            logAction('LOGO_UPLOAD_ERROR', `${finalPathAfterRename}: ${err.message}`);
            // Продолжаем, даже если логотип не загрузился
        }
    }

    // --- Шаг 4: Редирект ---
    // Редиректим на страницу папки (новую, если переименовали)
    res.redirect(`/folder/${finalPathAfterRename}`);
});

// 🗑 Удаление логотипа
app.post('/logo-delete/*', (req, res) => {
    const requestedPath = req.params[0] || '';
    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        logAction('LOGO_DELETE_FAIL', 'Недопустимый путь');
        return res.status(400).render('error', { message: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        logAction('LOGO_DELETE_FAIL', `Папка не найдена: ${requestedPath}`);
        return res.status(404).render('error', { message: 'Папка не найдена' });
    }

    const logoSvg = path.join(fullPath, 'logo.svg');
    const logoPng = path.join(fullPath, 'logo.png');
    let deleted = [];

    if (fs.existsSync(logoSvg)) {
        fs.unlinkSync(logoSvg);
        deleted.push('logo.svg');
    }
    if (fs.existsSync(logoPng)) {
        fs.unlinkSync(logoPng);
        deleted.push('logo.png');
    }

    if (deleted.length > 0) {
        logAction('LOGO_DELETED', `${deleted.join(', ')} из ${decodedPath}`);
    }

    res.redirect(`/edit-card/${decodedPath}`);
});

// 📁 Файловый менеджер с подпапками
app.get('/manager/*', (req, res) => {
    const requestedPath = req.params[0] || '';
    let decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        return res.status(400).render('error', { message: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).render('error', { message: 'Папка не найдена' });
    }

    const items = fs.readdirSync(fullPath);
    const folders = [];
    const files = [];

    items.forEach(item => {
        const itemPath = path.join(fullPath, item);
        if (fs.statSync(itemPath).isDirectory()) {
            const subItems = fs.readdirSync(itemPath);
            const isEmpty = subItems.length === 0;
            folders.push({ name: item, path: decodedPath ? `${decodedPath}/${item}` : item, isEmpty });
        } else {
            files.push({
                name: item,
                size: fs.statSync(itemPath).size,
                url: `/teletext/${decodedPath ? encodeURIComponent(decodedPath) + '/' : ''}${encodeURIComponent(item)}`,
                ext: path.extname(item).toLowerCase()
            });
        }
    });

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
});

// 📁 Главная страница менеджера
app.get('/manager', (req, res) => {
    res.redirect('/manager/');
});

// ✅ Создать папку
app.post('/create-folder/*', (req, res) => {
    const requestedPath = req.params[0] || '';
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Имя папки обязательно' });
    }

    if (!isValidPath(requestedPath)) {
        return res.status(400).json({ error: 'Недопустимый путь' });
    }

    const cleanName = name.trim()

    const fullPath = path.join(__dirname, 'teletext', requestedPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).json({ error: 'Папка не найдена' });
    }

    const dirPath = path.join(fullPath, cleanName);

    if (fs.existsSync(dirPath)) {
        return res.status(400).json({ error: 'Папка уже существует' });
    }

    try {
        fs.mkdirSync(dirPath, { recursive: true });
        logAction('FOLDER_CREATED', `teletext/${requestedPath ? requestedPath + '/' : ''}${cleanName}`);
        res.json({ success: true, name: cleanName });
    } catch (err) {
        res.status(500).json({ error: `Не удалось создать: ${err.message}` });
    }
});

// ✅ Удалить файл или папку (с содержимым)
app.post('/delete-item/*', (req, res) => {
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

    if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Объект не найден' });
    }

    try {
        if (type === 'file') {
            fs.unlinkSync(fullPath);
            logAction('FILE_DELETED', `teletext/${requestedPath ? requestedPath + '/' : ''}${cleanName}`);
        } else if (type === 'folder') {
            // Удаляем папку рекурсивно
            fs.rmSync(fullPath, { recursive: true, force: true });
            logAction('FOLDER_DELETED', `teletext/${requestedPath ? requestedPath + '/' : ''}${cleanName}`);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: `Ошибка: ${err.message}` });
    }
});

// ✅ Загрузка файлов (включая папки через drag’n’drop)
app.post('/upload/*', uploadFiles.any(), async (req, res) => {
    const requestedPath = req.params[0] || '';

    if (!isValidPath(requestedPath)) {
        return res.status(400).json({ error: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, 'teletext', requestedPath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).json({ error: 'Папка не найдена' });
    }

    // req.files может быть undefined, если не переданы файлы
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

            const targetPath = path.join(fullPath, targetName);

            fs.copyFileSync(file.path, targetPath);
            fs.unlinkSync(file.path);
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
});

// 404
app.use((req, res) => {
    res.status(404).render('error', { message: 'Страница не найдена' });
});



app.listen(port, () => {
    logAction('SERVER_START', `http://localhost:${port}`);
    console.log(`✅ Телетекст-плеер запущен: http://localhost:${port}`);
});