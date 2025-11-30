const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const os = require('os');
const puppeteer = require('puppeteer'); // ✅ Подключаем Puppeteer

const app = express();
const port = 3000;

// Настройка EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use('/teletext', express.static(path.join(__dirname, 'teletext')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Настройка загрузки файлов
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
function decodeURIComponentSafely(str) {
    try { return decodeURIComponent(str); } catch (e) { return str; }
}

function isValidPath(p) {
    if (!p) return true;
    return !p.includes('..') && !p.startsWith('/') && !p.includes(':') && !p.includes('\\') && !p.includes('\0');
}

// 🖼️ Функция генерации PNG из HTML — с GPU-ускорением
async function generateThumbnail(htmlPath, pngPath) {
    const browser = await puppeteer.launch({
        headless: true, // ✅ Максимальная производительность
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu', // ❗️ Раскомментируйте, если GPU не работает
            // '--use-gl=desktop', // ✅ Аппаратное ускорение (если поддерживается)
            // '--disable-software-rasterizer', // ✅ Отключаем софт-рендеринг
            '--disable-web-security', // ✅ Для локальных файлов
            '--disable-background-timer-throttling',
            '--disable-background-timer-throttling',
            '--disable-background-timer-throttling',
            '--disable-background-timer-throttling'
        ],
        defaultViewport: { width: 800, height: 600 }
    });

    const page = await browser.newPage();

    // Загружаем HTML
    await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle2' });

    // Скриншот
    await page.screenshot({
        path: pngPath,
        type: 'png',
        fullPage: true
    });

    await browser.close();
}

// 🚀 Ограничение по количеству параллельных задач
const MAX_CONCURRENT = 5; // ⚙️ Можно изменить

// 🖼️ Функция генерации всех .png в папке
async function generateThumbnailsForFolder(fullPath) {
    const htmlFiles = fs.readdirSync(fullPath).filter(f => f.endsWith('.html'));


    // Создаём массив задач
    const tasks = htmlFiles.map(file => async () => {
        const pageStr = file.replace('.html', '');
        const page = parseInt(pageStr, 10);

        if (isNaN(page) || page < 100 || page > 999) return;

        const htmlPath = path.join(fullPath, file);
        const pngPath = path.join(fullPath, `${page}.png`);

        if (!fs.existsSync(pngPath)) {
            console.log(`🖼️ Генерация ${pngPath}...`);
            try {
                await generateThumbnail(htmlPath, pngPath);
                console.log(`✅ ${pngPath} — готов!`);
            } catch (err) {
                console.error(`❌ Ошибка генерации ${pngPath}:`, err);
            }
        } else {

        }
    });

    // Запускаем задачи с ограничением
    for (let i = 0; i < tasks.length; i += MAX_CONCURRENT) {
        const chunk = tasks.slice(i, i + MAX_CONCURRENT);
        await Promise.all(chunk.map(task => task()));
    }


}

// 🏠 Главная — с флагами стран
app.get('/', (req, res) => {
    const dir = path.join(__dirname, 'teletext');
    let folders = [];

    if (fs.existsSync(dir)) {
        folders = fs.readdirSync(dir).filter(file => {
            return fs.statSync(path.join(dir, file)).isDirectory();
        });
    }

    res.render('index', { folders });
});

// ℹ️ О проекте
app.get('/about', (req, res) => {
    res.render('about');
});

// 📁 Просмотр папки
app.get('/folder/*', async (req, res) => {
    const requestedPath = req.params[0] || '';
    if (!isValidPath(requestedPath)) {
        return res.status(400).render('error', { message: 'Недопустимый путь' });
    }

    const decodedPath = decodeURIComponentSafely(requestedPath);
    const fullPath = path.join(__dirname, 'teletext', decodedPath);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).render('error', { message: 'Папка не найдена' });
    }

    // ✅ Запускаем генерацию .png в фоне
    generateThumbnailsForFolder(fullPath).catch(err => console.error('Ошибка генерации:', err));

    const items = fs.readdirSync(fullPath);
    const folders = items.filter(item => {
        const stat = fs.statSync(path.join(fullPath, item));
        return stat.isDirectory();
    });

    const htmlFiles = items.filter(item => item.endsWith('.html'));
    const pages = htmlFiles.map(file => {
        const pageStr = file.replace('.html', '');
        const page = parseInt(pageStr, 10);
        const hasThumb = fs.existsSync(path.join(fullPath, `${pageStr}.png`));
        return { page, hasThumb };
    }).filter(p => !isNaN(p.page) && p.page >= 100 && p.page <= 999);

    const pathParts = decodedPath.split('/').filter(Boolean);
    const breadcrumb = pathParts.map((part, i) => ({
        name: part,
        path: pathParts.slice(0, i + 1).join('/')
    }));

    // ✅ Проверяем наличие логотипа в текущей папке
    const logoExists = fs.existsSync(path.join(fullPath, 'logo.svg'));
    const logoExistsPng = fs.existsSync(path.join(fullPath, 'logo.png'));
    const logoUrl = logoExists ? `/teletext/${decodedPath}/logo.svg` :
        logoExistsPng ? `/teletext/${decodedPath}/logo.png` : null;

    // ✅ Для каждой подпапки — проверяем наличие логотипа
    const folderLogos = {};
    folders.forEach(folder => {
        const folderPath = path.join(fullPath, folder);
        const logoExists = fs.existsSync(path.join(folderPath, 'logo.svg'));
        const logoExistsPng = fs.existsSync(path.join(folderPath, 'logo.png'));
        if (logoExists || logoExistsPng) {
            folderLogos[folder] = logoExists
                ? `/teletext/${decodedPath ? decodedPath + '/' : ''}${folder}/logo.svg`
                : `/teletext/${decodedPath ? decodedPath + '/' : ''}${folder}/logo.png`;
        }
    });

    // ✅ Список папок с светлыми логотипами (для CSS)
    const lightLogos = [
        '1KANAL, ORT',
        'Culture',
        'DTV',
        'NTV',
        'PTP',
        'Tvcenter'
    ];

    res.render('folder', {
        folderName: path.basename(fullPath) || 'Телетекст',
        currentPath: decodedPath,
        folders,
        pages,
        breadcrumb,
        hasLogo: logoExists || logoExistsPng,
        logoUrl,
        folderLogos,
        lightLogos
    });
});

// 📄 Просмотр страницы
app.get('/page/*/:page', async (req, res) => {
    const requestedPath = req.params[0] || '';
    const pageParam = req.params.page;

    if (!isValidPath(requestedPath)) {
        return res.status(400).render('error', { message: 'Недопустимый путь' });
    }

    const decodedPath = decodeURIComponentSafely(requestedPath);
    const page = parseInt(pageParam, 10);

    if (isNaN(page) || page < 100 || page > 999) {
        return res.status(400).render('error', { message: 'Некорректный номер страницы (только 100–999)' });
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    const htmlFile = path.join(fullPath, `${page}.html`);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).render('error', { message: 'Архив не найден' });
    }

    if (!fs.existsSync(htmlFile)) {
        return res.status(404).render('error', { message: `Страница ${page} не найдена` });
    }

    const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.html'));
    const pageNumbers = files
        .map(f => parseInt(f.replace('.html', ''), 10))
        .filter(n => !isNaN(n) && n >= 100 && n <= 999)
        .sort((a, b) => a - b);

    const currentIndex = pageNumbers.indexOf(page);
    const prevPage = currentIndex > 0 ? pageNumbers[currentIndex - 1] : null;
    const nextPage = currentIndex < pageNumbers.length - 1 ? pageNumbers[currentIndex + 1] : null;

    const content = fs.readFileSync(htmlFile, 'utf-8');

    const pathParts = decodedPath.split('/').filter(Boolean);
    const breadcrumb = pathParts.map((part, i) => ({
        name: part,
        path: pathParts.slice(0, i + 1).join('/')
    }));

    const pageList = pageNumbers.map(p => ({
        page: p,
        hasThumb: fs.existsSync(path.join(fullPath, `${p}.png`))
    }));

    const basePath = `/teletext/${decodedPath}/`.replace(/ /g, '%20');

    // ✅ Проверяем наличие логотипа
    const logoExists = fs.existsSync(path.join(fullPath, 'logo.svg'));
    const logoExistsPng = fs.existsSync(path.join(fullPath, 'logo.png'));
    const logoUrl = logoExists ? `/teletext/${decodedPath}/logo.svg` :
        logoExistsPng ? `/teletext/${decodedPath}/logo.png` : null;

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
        logoUrl
    });
});

// 🛠 Админка — список всех папок (рекурсивно)
app.get('/admin', (req, res) => {
    const teletextDir = path.join(__dirname, 'teletext');
    const archives = [];

    function scanDirectory(dirPath, parentPath = '') {
        if (!fs.existsSync(dirPath)) return;

        const items = fs.readdirSync(dirPath);
        items.forEach(item => {
            const fullPath = path.join(dirPath, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                const relativePath = parentPath ? `${parentPath}/${item}` : item;
                const logoExists = fs.existsSync(path.join(fullPath, 'logo.svg'));
                const logoExistsPng = fs.existsSync(path.join(fullPath, 'logo.png'));

                archives.push({
                    path: relativePath,
                    hasLogo: logoExists || logoExistsPng,
                    name: item,
                    level: parentPath.split('/').length // уровень вложенности
                });

                // Рекурсия
                scanDirectory(fullPath, relativePath);
            }
        });
    }

    scanDirectory(teletextDir);

    res.render('admin', { archives });
});

// 📤 Редактирование архива (GET)
app.get('/admin/edit/:path*', (req, res) => {
    const requestedPath = req.params.path + (req.params[0] || '');
    if (!isValidPath(requestedPath)) {
        return res.status(400).render('error', { message: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, 'teletext', requestedPath);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).render('error', { message: 'Архив не найден' });
    }

    // ✅ Проверяем наличие логотипа
    const logoExists = fs.existsSync(path.join(fullPath, 'logo.svg'));
    const logoExistsPng = fs.existsSync(path.join(fullPath, 'logo.png'));
    const logoUrl = logoExists ? `/teletext/${requestedPath}/logo.svg` :
        logoExistsPng ? `/teletext/${requestedPath}/logo.png` : null;

    res.render('admin-edit', {
        archivePath: requestedPath,
        logoUrl,
        hasLogo: logoExists || logoExistsPng
    });
});

// 📤 Загрузка логотипа (POST)
app.post('/admin/upload/:path*', upload.single('logo'), (req, res) => {
    const requestedPath = req.params.path + (req.params[0] || '');
    if (!isValidPath(requestedPath)) {
        return res.status(400).render('error', { message: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, 'teletext', requestedPath);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).render('error', { message: 'Архив не найден' });
    }

    if (!req.file) {
        return res.redirect(`/admin/edit/${requestedPath}`);
    }

    // Копируем файл в папку архива как logo.svg или logo.png
    const targetName = req.file.originalname.toLowerCase().endsWith('.svg') ? 'logo.svg' : 'logo.png';
    const targetPath = path.join(fullPath, targetName);

    fs.copyFileSync(req.file.path, targetPath);

    // Удаляем временный файл
    fs.unlinkSync(req.file.path);

    res.redirect(`/admin/edit/${requestedPath}`);
});

// 🗑 Удаление логотипа
app.post('/admin/delete/:path*', (req, res) => {
    const requestedPath = req.params.path + (req.params[0] || '');
    if (!isValidPath(requestedPath)) {
        return res.status(400).render('error', { message: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, 'teletext', requestedPath);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).render('error', { message: 'Архив не найден' });
    }

    const logoSvg = path.join(fullPath, 'logo.svg');
    const logoPng = path.join(fullPath, 'logo.png');

    if (fs.existsSync(logoSvg)) fs.unlinkSync(logoSvg);
    if (fs.existsSync(logoPng)) fs.unlinkSync(logoPng);

    res.redirect(`/admin/edit/${requestedPath}`);
});

// 404
app.use((req, res) => {
    res.status(404).render('error', { message: 'Страница не найдена' });
});

app.listen(port, () => {
    console.log(`✅ Телетекст-плеер запущен: http://localhost:${port}`);
});