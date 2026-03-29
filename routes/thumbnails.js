const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const { asyncHandler } = require('../middleware/errorHandler');
const { isValidPath, logAction } = require('../lib/utils');
const { generateThumbnail, PUPPETEER_ARGS } = require('../lib/thumbnails');

const router = express.Router();

router.get('/regenerate-thumbnails-stream/*', asyncHandler(async (req, res) => {
    const decodedPath = req.params[0] || '';

    if (!isValidPath(decodedPath)) {
        return res.status(400).json({ error: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, '../teletext', decodedPath);
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
            res.write(`data: ${JSON.stringify({ progress, current: i + 1, total: totalFiles, generated: [`${page}.png`] })}\n\n`);
        } catch (err) {
            errors.push(`${file}: ${err.message}`);
            logAction('THUMBNAIL_REGEN_ERROR', `${pngPath}: ${err.message}`);
        }
    }

    res.write(`data: ${JSON.stringify({ success: true, errors: errors.length > 0 ? errors : undefined, generated, message: 'Все превьюшки обновлены!' })}\n\n`);
    res.end();
}));

router.post('/manager/regenerate-thumbnails-fast/*', asyncHandler(async (req, res) => {
    const decodedPath = req.params[0] || '';

    if (!isValidPath(decodedPath)) {
        return res.status(400).json({ error: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, '../teletext', decodedPath);
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
            args: PUPPETEER_ARGS,
            defaultViewport: { width: 800, height: 600 }
        });

        let currentIndex = 0;
        let completed = 0;

        const workers = new Array(MAX_CONCURRENT_PAGES).fill(null).map(async () => {
            const page = await browser.newPage();
            while (currentIndex < totalFiles) {
                const index = currentIndex++;
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

    res.write(`${JSON.stringify({ success: true, errors: errors.length > 0 ? errors : undefined, generated, message: 'Все превьюшки обновлены!' })}\n\n`);
    res.end();
}));

module.exports = router;
