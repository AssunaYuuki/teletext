const fs = require('fs').promises;
const path = require('path');
const puppeteer = require('puppeteer');
const sharp = require('sharp');
const { AppError } = require('../middleware/errorHandler');
const { logAction } = require('./utils');

const MAX_CONCURRENT = 3;

const PUPPETEER_ARGS = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-web-security'
];

async function generateThumbnail(htmlPath, pngPath) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: PUPPETEER_ARGS,
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

module.exports = { generateThumbnail, generateThumbnailsForFolder, PUPPETEER_ARGS };
