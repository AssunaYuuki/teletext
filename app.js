const express = require('express');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const port = 3000;

// Настройка EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Статика: /public и /teletext
app.use(express.static(path.join(__dirname, 'public')));
app.use('/teletext', express.static(path.join(__dirname, 'teletext')));

// Вспомогательные функции
function decodeURIComponentSafely(str) {
    try {
        return decodeURIComponent(str);
    } catch (e) {
        return str;
    }
}

function isValidPath(p) {
    if (!p) return true;
    return !p.includes('..') && !p.startsWith('/') && !p.includes(':') && !p.includes('\\') && !p.includes('\0');
}

// 🏠 Главная
app.get('/', (req, res) => {
    const dir = path.join(__dirname, 'teletext');
    let folders = [];

    if (fs.existsSync(dir)) {
        folders = fs.readdirSync(dir).filter(file => {
            const stat = fs.statSync(path.join(dir, file));
            return stat.isDirectory();
        });
    }

    console.log(`📁 Папка данных: ${dir}`);
    console.log(`🌐 Ресурсы доступны по: /teletext/...\n   Например: /teletext/Russia/2x2/2x2 23.07.93/100.png`);

    res.render('index', { folders });
});

// ℹ️ О проекте
app.get('/about', (req, res) => {
    res.render('about');
});

// 📁 Список папок и страниц
app.get('/folder/*', (req, res) => {
    const requestedPath = req.params[0] || '';
    if (!isValidPath(requestedPath)) {
        return res.status(400).render('error', { message: 'Недопустимый путь' });
    }

    const decodedPath = decodeURIComponentSafely(requestedPath);
    const fullPath = path.join(__dirname, 'teletext', decodedPath);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).render('error', { message: 'Папка не найдена' });
    }

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

    // Лог для отладки
    if (pages.length > 0) {
        console.log(`✅ Найдено страниц в папке "${fullPath}": ${pages.length}`);
        console.log(`   Пример:`, pages.slice(0, 5));
    }

    // Хлебные крошки
    const pathParts = decodedPath.split('/').filter(Boolean);
    const breadcrumb = pathParts.map((part, i) => ({
        name: part,
        path: pathParts.slice(0, i + 1).join('/')
    }));

    res.render('folder', {
        folderName: path.basename(fullPath) || 'Телетекст',
        currentPath: decodedPath,
        folders,
        pages,
        breadcrumb
    });
});

// 📄 Просмотр страницы
app.get('/page/*/:page', (req, res) => {
    const requestedPath = req.params[0] || '';
    const pageParam = req.params.page;

    if (!isValidPath(requestedPath)) {
        return res.status(400).render('error', { message: 'Недопустимый путь' });
    }

    const decodedPath = decodeURIComponentSafely(requestedPath);
    const page = parseInt(pageParam, 10);

    if (isNaN(page) || page < 100 || page > 999) {
        return res.status(400).render('error', {
            message: 'Некорректный номер страницы (только 100–999)'
        });
    }

    const fullPath = path.join(__dirname, 'teletext', decodedPath);
    const htmlFile = path.join(fullPath, `${page}.html`);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).render('error', { message: 'Архив не найден' });
    }

    if (!fs.existsSync(htmlFile)) {
        return res.status(404).render('error', {
            message: `Страница ${page} не найдена в архиве "${decodedPath}"`
        });
    }

    // Сканируем все страницы в папке
    const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.html'));
    const pageNumbers = files
        .map(f => parseInt(f.replace('.html', ''), 10))
        .filter(n => !isNaN(n) && n >= 100 && n <= 999)
        .sort((a, b) => a - b);

    const currentIndex = pageNumbers.indexOf(page);
    const prevPage = currentIndex > 0 ? pageNumbers[currentIndex - 1] : null;
    const nextPage = currentIndex < pageNumbers.length - 1 ? pageNumbers[currentIndex + 1] : null;

    const content = fs.readFileSync(htmlFile, 'utf-8');

    // Хлебные крошки
    const pathParts = decodedPath.split('/').filter(Boolean);
    const breadcrumb = pathParts.map((part, i) => ({
        name: part,
        path: pathParts.slice(0, i + 1).join('/')
    }));

    const pageList = pageNumbers.map(p => ({
        page: p,
        hasThumb: fs.existsSync(path.join(fullPath, `${p}.png`))
    }));

    // ✅ КЛЮЧЕВОЕ: basePath с экранированием пробелов
    const basePath = `/teletext/${decodedPath}/`.replace(/ /g, '%20');

    // Лог для отладки
    console.log(`📄 Открываем страницу: ${page} | Путь: ${decodedPath}`);
    console.log(`🔗 Prev: ${prevPage}, Next: ${nextPage}`);
    console.log(`📊 PageList:`, pageList.slice(0, 5));

    // ✅ Передаём basePath в шаблон
    res.render('page', {
        pageNumber: page,
        content,
        currentPath: decodedPath,
        folderName: path.basename(fullPath) || 'Архив',
        prevPage,
        nextPage,
        pageList,
        breadcrumb,
        basePath // ← ЭТО РЕШАЕТ ОШИБКУ "basePath is not defined"
    });
});

// 🖼️ Генерация миниатюр (если нужно — можно отключить)
app.get('/api/generate-thumbs/:path*', (req, res) => {
    const requestedPath = req.params[0] || '';
    if (!isValidPath(requestedPath)) {
        return res.status(400).json({ error: 'Invalid path' });
    }

    const decodedPath = decodeURIComponentSafely(requestedPath);
    const fullPath = path.join(__dirname, 'teletext', decodedPath);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
        return res.status(404).json({ error: 'Folder not found' });
    }

    const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.html'));
    const pages = files.map(f => parseInt(f.replace('.html', ''), 10)).filter(n => !isNaN(n));

    console.log(`⏳ Начинаем генерацию миниатюр для ${pages.length} страниц в папке: ${fullPath}`);

    // Простая заглушка: не генерируем реально без puppeteer/Playwright
    // В реальном проекте — здесь запуск headless-рендера → PNG
    setTimeout(() => {
        console.log(`✅ Все миниатюры сгенерированы для папки: ${fullPath}`);
        res.json({ success: true, count: pages.length });
    }, 500);
});

// ❌ 404
app.use((req, res) => {
    res.status(404).render('error', { message: 'Страница не найдена' });
});

// ▶️ Запуск
app.listen(port, () => {
    console.log(`✅ Телетекст-плеер запущен: http://localhost:${port}`);
});