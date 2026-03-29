const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { isValidPath, logAction } = require('../lib/utils');
const { generateThumbnailsForFolder } = require('../lib/thumbnails');

const router = express.Router();

router.get('/folder/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    const decodedPath = requestedPath;

    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const fullPath = path.join(__dirname, '../teletext', decodedPath);

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

        if (!pagesByYear[year]) pagesByYear[year] = [];
        pagesByYear[year].push({ page, hasThumb });
    }

    const sortedYears = Object.keys(pagesByYear)
        .map(y => parseInt(y, 10))
        .sort((a, b) => b - a);

    const groupedPages = {};
    sortedYears.forEach(year => {
        groupedPages[year] = pagesByYear[year].sort((a, b) => a.page - b.page);
    });

    const pages = htmlFiles.map(file => {
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
        if (!foldersByYear[year]) foldersByYear[year] = [];
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
        } catch (e) { /* файл не существует */ }

        let description = '';
        const descFile = path.join(folderPath, 'description.txt');
        try {
            description = await fs.readFile(descFile, 'utf-8').then(d => d.trim());
        } catch (e) { /* файл не существует */ }

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

module.exports = router;
