const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { isValidPath } = require('../lib/utils');

const router = express.Router();

router.get('/page/*/:page', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    const pageParam = req.params.page;
    const decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const page = parseInt(pageParam, 10);
    if (isNaN(page) || page < 100 || page > 999) {
        throw new AppError('Некорректный номер страницы (100–999)', 400);
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

    const files = await fs.readdir(fullPath);
    const pageNumbers = files
        .filter(f => f.endsWith('.html'))
        .map(f => parseInt(f.replace('.html', ''), 10))
        .filter(n => !isNaN(n) && n >= 100 && n <= 999)
        .sort((a, b) => a - b);

    const currentIndex = pageNumbers.indexOf(page);
    const prevPage = currentIndex > 0 ? pageNumbers[currentIndex - 1] : null;
    const nextPage = currentIndex < pageNumbers.length - 1 ? pageNumbers[currentIndex + 1] : null;

    const raw = await fs.readFile(htmlFile, 'utf-8');

    const headMatch = raw.match(/<head>([\s\S]*?)<\/head>/i);
    const headContent = headMatch ? headMatch[1] : '';

    const flFix = `<style>
@keyframes teletext-blink{0%,49%{color:inherit}50%,100%{color:transparent}}
.fl{text-decoration:none!important;animation:teletext-blink 1s step-end infinite}
.cn{visibility:hidden}
</style>`;

    const encodedBasePath = decodedPath.split('/').map(s => encodeURIComponent(s)).join('/');
    const assetBase = `/teletext/${encodedBasePath}/`;
    // Заменяем относительные href/src в head на абсолютные — base href в srcdoc ненадёжен
    const patchedHeadContent = headContent
        .replace(/(href|src)="(?!https?:|\/|#)([^"]+)"/g, `$1="${assetBase}$2"`);
    const patchedHead = `<head>${patchedHeadContent}${flFix}</head>`;

    const linkFixed = raw.replace(
        /href="(\d+)\.html"/g,
        (_, p) => `href="/page/${encodeURIComponent(decodedPath)}/${p}"`
    );

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
        disableCopy: true
    });
}));

module.exports = router;
