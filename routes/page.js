const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { isValidPath } = require('../lib/utils');

const router = express.Router();

/**
 * Универсальный парсер Fastext-кнопок.
 * Поддерживает:
 * 1. Кнопки с цветным текстом: <span class="f1 ..."><a href="101.html">...</a></span>
 * 2. Кнопки с цветным фоном: <span class="b1 ..."><a href="101.html">...</a></span>
 */
function extractFastextLinks(html) {
    const links = { red: null, green: null, yellow: null, blue: null };
    // Берём последние 600 символов (гарантированно захватывает зону Fastext)
    const bottom = html.slice(-600);

    const targets = [
        { codes: ['1'], key: 'red' },
        { codes: ['2'], key: 'green' },
        { codes: ['3'], key: 'yellow' },
        { codes: ['4', '6'], key: 'blue' } // f4/b4 или f6/b6 (cyan часто используется как blue)
    ];

    for (const t of targets) {
        if (links[t.key]) continue;

        // Формируем паттерн: ищем f1 ИЛИ b1 (и т.д.) внутри class="..."
        const codePattern = t.codes.map(c => `(?:f${c}|b${c})`).join('|');
        // [\s\S]*? позволяет матчить через переносы строк и вложенные теги
        const regex = new RegExp(`class="[^"]*${codePattern}[^"]*"[^>]*>[\\s\\S]*?href="(\\d{3,4})\\.html"`, 'i');
        const match = bottom.match(regex);

        if (match) {
            links[t.key] = match[1];
        }
    }

    // Fallback: если синяя кнопка не найдена по цвету, берём последнюю ссылку в зоне Fastext
    if (!links.blue) {
        const allLinks = bottom.match(/href="(\d{3,4})\.html"/g);
        if (allLinks && allLinks.length > 0) {
            const last = allLinks[allLinks.length - 1];
            const m = last.match(/href="(\d+)\.html"/);
            if (m) links.blue = m[1];
        }
    }

    return links;
}

router.get('/page/*/:page', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    const pageParam = req.params.page;
    const decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const page = parseInt(pageParam, 10);
    if (isNaN(page) || page < 100 || page > 9999) {
        throw new AppError('Некорректный номер страницы (100–9999)', 400);
    }

    const fullPath = path.join(__dirname, '../teletext', decodedPath);
    const htmlFile = path.join(fullPath, `${page}.html`);

    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        throw new AppError('Архив не найден', 404);
    }

    const htmlExists = await fs.access(htmlFile).then(() => true).catch(() => false);
    if (!htmlExists) {
        throw new AppError(`Страница ${page} не найдена`, 404);
    }

    const raw = await fs.readFile(htmlFile, 'utf-8');

    // ✅ Парсим Fastext ДО замены ссылок
    const fastextLinks = extractFastextLinks(raw);

    // Подготовка head для iframe
    const headMatch = raw.match(/<head>([\s\S]*?)<\/head>/i);
    const headContent = headMatch ? headMatch[1] : '';

    const flFix = `<style>
@keyframes teletext-blink{50%,100%{color:transparent}}
.fl{text-decoration:none!important;animation:teletext-blink 1s step-end infinite}
.cn{visibility:hidden}
body{display:flex;justify-content:center;margin:0;padding:10px 20px;background:#000;font-family:'Courier New',monospace;}
.f0{color:#000}.f1{color:#f00}.f2{color:#0f0}.f3{color:#ff0}.f4{color:#00f}.f5{color:#f0f}.f6{color:#0ff}.f7{color:#fff}
.b0{background:#000}.b1{background:#f00}.b2{background:#0f0}.b3{background:#ff0}.b4{background:#00f}.b5{background:#f0f}.b6{background:#0ff}.b7{background:#fff}
</style>`;

    const encodedBasePath = decodedPath.split('/').map(s => encodeURIComponent(s)).join('/');
    const assetBase = `/teletext/${encodedBasePath}/`;

    const patchedHeadContent = headContent
        .replace(/(href|src)="(?!https?:|\/|#)([^"]+)"/g, `$1="${assetBase}$2"`);

    const patchedHead = `<head>${patchedHeadContent}${flFix}</head>`;

    // Фиксим ссылки на другие страницы телетекста
    const linkFixed = raw.replace(
        /href="(\d+)\.html"/g,
        (_, p) => `href="/page/${encodeURIComponent(decodedPath)}/${p}" target="_top"`
    );

    // Парсинг подстраниц (subpages)
    const subpageRegex = /<div class="subpage" id="([^"]+)">([\s\S]*?)<\/div>/g;
    const subpages = [];
    let spMatch;
    while ((spMatch = subpageRegex.exec(linkFixed)) !== null) {
        const [, id, inner] = spMatch;
        const html = `<html>${patchedHead}<body><div class="subpage" id="${id}">${inner}</div></body></html>`;
        subpages.push({ id, html });
    }

    if (subpages.length === 0) {
        subpages.push({ id: '0000', html: raw });
    }

    // Хлебные крошки
    const pathParts = decodedPath.split('/').filter(Boolean);
    const breadcrumb = pathParts.map((part, i) => ({
        name: part,
        path: pathParts.slice(0, i + 1).join('/')
    }));

    // Список всех страниц в папке
    const files = await fs.readdir(fullPath);
    const pageNumbers = files
        .filter(f => f.endsWith('.html'))
        .map(f => parseInt(f.replace('.html', ''), 10))
        .filter(n => !isNaN(n) && n >= 100 && n <= 9999)
        .sort((a, b) => a - b);

    const currentIndex = pageNumbers.indexOf(page);
    const prevPage = currentIndex > 0 ? pageNumbers[currentIndex - 1] : null;
    const nextPage = currentIndex < pageNumbers.length - 1 ? pageNumbers[currentIndex + 1] : null;

    // Генерация списка с проверкой превью
    const pageList = await Promise.all(pageNumbers.map(async p => {
        const pngPath = path.join(fullPath, `${p}.png`);
        const hasThumb = await fs.access(pngPath).then(() => true).catch(() => false);
        return { page: p, hasThumb };
    }));

    // Логотип раздела
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
        subpages,
        currentPath: decodedPath,
        folderName: path.basename(fullPath) || 'Архив',
        prevPage,
        nextPage,
        pageList,
        breadcrumb,
        hasLogo: logoExists || logoExistsPng,
        logoUrl,
        fastextLinks
    });
}));

module.exports = router;