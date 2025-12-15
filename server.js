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

// Multer для загрузки
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

// Вспомогательные функции
function isValidPath(p) {
    if (!p) return true;
    // Разрешаем: буквы (лат. и кириллица), цифры, пробел, запятую, точку, дефис, подчёркивание, слэш, амперсанд, скобки
    const allowedChars = /^[a-zA-Zа-яА-ЯёЁ0-9\s,. -_\/&()'\[\]{}@#~$%^*+=<>:;]+$/u;
    if (!allowedChars.test(p)) {
        return false;
    }
    // Запрещаем опасные последовательности
    return !p.includes('..') && !p.startsWith('/') && !p.includes(':') && !p.includes('\\') && !p.includes('\0');
}

// 🖼️ Генерация PNG
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

    // Просто используем raw path — без декодирования
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

    // ✅ Чтение названий и описаний для подпапок
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

        // ✅ Читаем description.txt
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
            description // ✅ Передаём описание
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
    const basePath = `/teletext/${decodedPath}/`; // УБРАНО .replace(/ /g, '%20')

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

    // ✅ Читаем description.txt
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
        archivePath: decodedPath, // Передаём decodedPath, а не raw
        folderName: path.basename(fullPath),
        currentTitle: title,
        currentDescription: description, // ✅ Передаём описание
        hasLogo: logoExists || logoExistsPng,
        logoUrl,
        disableCopy: true
    });
});

// 💾 Сохранение логотипа + названия + описания
app.post('/save-card/*', upload.single('logo'), (req, res) => {
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
    const newDescription = (req.body.description || '').trim(); // ✅ Новое поле
    if (!newTitle) {
        logAction('CARD_SAVE_FAIL', 'Пустое название');
        return res.redirect(`/edit-card/${decodedPath}`); // ← decodedPath
    }

    // 1️⃣ Сохраняем название
    const titleFile = path.join(fullPath, 'title.txt');
    try {
        fs.writeFileSync(titleFile, newTitle, 'utf-8');
        logAction('TITLE_SAVED', `${newTitle} → ${decodedPath}`);
    } catch (err) {
        logAction('TITLE_SAVE_ERROR', `${decodedPath}: ${err.message}`);
    }

    // 2️⃣ Сохраняем описание
    if (newDescription) {
        const descFile = path.join(fullPath, 'description.txt');
        try {
            fs.writeFileSync(descFile, newDescription, 'utf-8');
            logAction('DESC_SAVED', `${newDescription.substring(0, 20)}... → ${decodedPath}`);
        } catch (err) {
            logAction('DESC_SAVE_ERROR', `${decodedPath}: ${err.message}`);
        }
    } else {
        // Если описание пустое — удаляем файл, если он был
        const descFile = path.join(fullPath, 'description.txt');
        if (fs.existsSync(descFile)) {
            try {
                fs.unlinkSync(descFile);
                logAction('DESC_DELETED', `description.txt удален из ${decodedPath}`);
            } catch (err) {
                logAction('DESC_DELETE_ERROR', `${decodedPath}: ${err.message}`);
            }
        }
    }

    // 3️⃣ Сохраняем логотип (если загружен)
    if (req.file) {
        const targetName = req.file.originalname.toLowerCase().endsWith('.svg') ? 'logo.svg' : 'logo.png';
        const targetPath = path.join(fullPath, targetName);
        try {
            fs.copyFileSync(req.file.path, targetPath);
            fs.unlinkSync(req.file.path);
            logAction('LOGO_UPLOADED', `${targetName} → ${decodedPath}`);
        } catch (err) {
            logAction('LOGO_UPLOAD_ERROR', `${decodedPath}: ${err.message}`);
        }
    }

    res.redirect(`/folder/${decodedPath}`); // ← decodedPath
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

    res.redirect(`/edit-card/${decodedPath}`); // ← decodedPath
});

// 404
app.use((req, res) => {
    res.status(404).render('error', { message: 'Страница не найдена' });
});

// ✅ Автоматическое переименование папок с '&&.&&.&&&&', 'XX.XX.&&&&', 'XX.XX.&&&', 'XX.XX.&&'
function autoRenameFoldersWithPattern(baseDir) {
    console.log('[AUTO-RENAME] Поиск папок с "&&.&&.&&&&", "XX.XX.&&&&", "XX.XX.&&&", "XX.XX.&&" во всём дереве...');

    function processDirectory(dir) {
        const items = fs.readdirSync(dir);
        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stats = fs.statSync(fullPath);

            if (stats.isDirectory()) {
                let newName = null;

                // 1. Проверяем '&&.&&.&&&&'
                if (item.includes('&&.&&.&&&&')) {
                    newName = item.replace('&&.&&.&&&&', 'xx.xx.xxxx');
                }
                // 2. Проверяем 'XX.XX.&&&&' (например, '12.09.&&&&')
                else if (item.match(/.*\d+\.\d+\.&&&&$/)) {
                    newName = item.replace('.&&&&', '.xxxx');
                }
                // 3. Проверяем 'XX.XX.&&&' (например, '10.11.&&&')
                else if (item.match(/.*\d+\.\d+\.&&&$/)) {
                    newName = item.replace('.&&&', '.xxx');
                }
                // 4. Проверяем 'XX.XX.&&' (например, '10.11.&&')
                else if (item.match(/.*\d+\.\d+\.&&$/)) {
                    newName = item.replace('.&&', '.xx');
                }

                if (newName !== null) {
                    const newFullPath = path.join(dir, newName);

                    // Проверяем, существует ли уже такая папка
                    if (fs.existsSync(newFullPath)) {
                        console.log(`[AUTO-RENAME] ⚠️ Папка уже существует: ${newFullPath}`);
                    } else {
                        try {
                            fs.renameSync(fullPath, newFullPath);
                            console.log(`[AUTO-RENAME] ✅ Переименовано: ${fullPath} → ${newFullPath}`);
                        } catch (err) {
                            console.error(`[AUTO-RENAME] ❌ Ошибка при переименовании: ${err.message}`);
                        }

                        // Рекурсивно обрабатываем подпапки
                        if (fs.existsSync(newFullPath)) {
                            processDirectory(newFullPath);
                        }
                    }
                } else {
                    // Рекурсивно обрабатываем подпапки
                    processDirectory(fullPath);
                }
            }
        }
    }

    processDirectory(baseDir);
    console.log('[AUTO-RENAME] Готово!');
}

// Запуск автоматического переименования при старте сервера
const teletextDir = path.join(__dirname, 'teletext');
if (fs.existsSync(teletextDir)) {
    autoRenameFoldersWithPattern(teletextDir);
} else {
    console.warn('[AUTO-RENAME] ❗ Папка teletext не найдена!');
}


app.listen(port, () => {
    logAction('SERVER_START', `http://localhost:${port}`);
    console.log(`✅ Телетекст-плеер запущен: http://localhost:${port}`);
});