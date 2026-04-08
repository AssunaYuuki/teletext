const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { isValidPath, logAction } = require('../lib/utils');
const { uploadFiles } = require('../middleware/upload');

const router = express.Router();

router.get('/manager/edit-html/*', asyncHandler(async (req, res) => {
    const filePath = req.params[0];
    if (!isValidPath(filePath)) throw new AppError('Недопустимый путь', 400);
    const fullPath = path.join(__dirname, '../teletext', filePath);
    const content = await fs.readFile(fullPath, 'utf-8').catch(() => '');
    res.render('editor', {
        filePath,
        fileName: path.basename(fullPath),
        content,
        parentPath: path.dirname(filePath) === '.' ? '' : path.dirname(filePath),
        disableCopy: true
    });
}));

router.post('/manager/save-html/*', asyncHandler(async (req, res) => {
    const filePath = req.params[0];
    if (!isValidPath(filePath)) throw new AppError('Недопустимый путь', 400);
    const fullPath = path.join(__dirname, '../teletext', filePath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, req.body.content, 'utf-8');
    logAction('FILE_SAVED', fullPath);
    res.json({ success: true });
}));

router.get(['/manager', '/manager/*'], asyncHandler(async (req, res) => {
    const decodedPath = req.params[0] || '';
    if (!isValidPath(decodedPath)) throw new AppError('Недопустимый путь', 400);
    const fullPath = path.join(__dirname, '../teletext', decodedPath);

    await fs.mkdir(fullPath, { recursive: true });

    const items = await fs.readdir(fullPath);
    const folders = [], files = [];

    for (const item of items) {
        if (item.startsWith('.')) continue;
        const itemPath = path.join(fullPath, item);
        const stats = await fs.stat(itemPath);

        if (stats.isDirectory()) {
            folders.push({
                name: item,
                path: decodedPath ? `${decodedPath}/${item}` : item
            });
        } else {
            files.push({
                name: item,
                size: stats.size,
                url: `/teletext/${decodedPath ? encodeURIComponent(decodedPath) + '/' : ''}${encodeURIComponent(item)}`,
                ext: path.extname(item).toLowerCase()
            });
        }
    }

    folders.sort((a,b) => a.name.localeCompare(b.name));
    files.sort((a,b) => a.name.localeCompare(b.name));

    const pathParts = decodedPath.split('/').filter(Boolean);
    const breadcrumb = pathParts.map((p,i) => ({ name: p, path: pathParts.slice(0,i+1).join('/') }));

    res.render('manager', { folders, files, currentPath: decodedPath, breadcrumb, disableCopy: true });
}));

router.post('/create-folder/*', asyncHandler(async (req, res) => {
    const reqPath = req.params[0] || '';
    const clean = req.body.name.trim().replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s._\-()]/g, '_').replace(/\s+/g, '_');
    const target = path.join(__dirname, '../teletext', reqPath, clean);
    await fs.mkdir(target, { recursive: true });
    res.json({ success: true });
}));

router.post('/delete-item/*', asyncHandler(async (req, res) => {
    const reqPath = req.params[0] || '';
    const target = path.join(__dirname, '../teletext', reqPath, path.basename(req.body.name));
    req.body.type === 'file' ? await fs.unlink(target) : await fs.rm(target, { recursive:true });
    res.json({ success: true });
}));

router.post('/rename-item/*', asyncHandler(async (req, res) => {
    const reqPath = req.params[0] || '';
    const src = path.join(__dirname, '../teletext', reqPath, path.basename(req.body.oldName));
    const dst = path.join(__dirname, '../teletext', reqPath, path.basename(req.body.newName));
    await fs.rename(src, dst);
    res.json({ success: true });
}));

router.post('/move-item/*', asyncHandler(async (req, res) => {
    const reqPath = req.params[0] || '';
    const targetDir = req.body.targetPath ? path.join(__dirname, '../teletext', req.body.targetPath) : path.join(__dirname, '../teletext', reqPath);
    const src = path.join(__dirname, '../teletext', reqPath, path.basename(req.body.itemName));
    const dst = path.join(targetDir, path.basename(req.body.itemName));
    await fs.rename(src, dst);
    res.json({ success: true });
}));

// ⬆️ ЗАГРУЗКА: С ЗАЩИТОЙ ОТ ДУБЛИКАТОВ И ПОЛНОЙ ОБРАБОТКОЙ
router.post('/upload/*', uploadFiles.any(), asyncHandler(async (req, res) => {
    const reqPath = req.params[0] || '';
    const baseDir = path.join(__dirname, '../teletext', reqPath);
    await fs.mkdir(baseDir, { recursive: true });

    console.log(`\n[UPLOAD] ========== НАЧАЛО ==========`);
    console.log(`[UPLOAD] Путь: ${baseDir}`);
    console.log(`[UPLOAD] Получено файлов от клиента: ${req.files ? req.files.length : 0}`);

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'Нет файлов' });
    }

    const isFolderUpload = req.body.targetFolderName && req.body.targetFolderName.trim() !== '';
    let destDir = baseDir;
    let folderName = '';

    if (isFolderUpload) {
        folderName = req.body.targetFolderName.trim()
            .replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s._\-()]/g, '_')
            .replace(/\s+/g, '_');
        destDir = path.join(baseDir, folderName);
        await fs.mkdir(destDir, { recursive: true });
        console.log(`[UPLOAD] Загрузка папки: "${folderName}"`);
    }

    const errors = [], saved = [], skipped = [];
    const usedNames = new Set(); // Для отслеживания уникальных имен

    for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];

        try {
            let fileName = path.basename(file.originalname);
            const ext = path.extname(fileName).toLowerCase();

            // Пропускаем .t42
            if (ext === '.t42') {
                skipped.push(fileName);
                await fs.unlink(file.path).catch(()=>{});
                continue;
            }

            // Очищаем имя
            const nameOnly = path.basename(fileName, ext);
            let cleanName = nameOnly.replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s._\-()]/g, '_').replace(/\s+/g, '_');

            if (!cleanName) cleanName = `file_${Date.now()}_${i}`;

            fileName = cleanName + ext;

            // ✅ ЗАЩИТА ОТ ДУБЛИКАТОВ: если имя уже занято, добавляем номер
            let finalFileName = fileName;
            let counter = 1;
            while (usedNames.has(finalFileName.toLowerCase())) {
                finalFileName = `${cleanName}_${counter}${ext}`;
                counter++;
            }
            usedNames.add(finalFileName.toLowerCase());

            const finalPath = path.join(destDir, finalFileName);

            await fs.copyFile(file.path, finalPath);
            await fs.unlink(file.path);

            // Проверяем что файл действительно создался
            const exists = await fs.access(finalPath).then(() => true).catch(() => false);
            if (!exists) {
                throw new Error('Файл не создан после копирования');
            }

            const stats = await fs.stat(finalPath);
            console.log(`[${i+1}/${req.files.length}] ✅ ${finalFileName} (${stats.size} байт)`);

            saved.push(finalFileName);

        } catch (err) {
            console.error(`[${i+1}/${req.files.length}] ❌ ${file.originalname}: ${err.message}`);
            await fs.unlink(file.path).catch(()=>{});
            errors.push(`${file.originalname}: ${err.message}`);
        }
    }

    console.log(`\n[UPLOAD] ========== РЕЗУЛЬТАТЫ ==========`);
    console.log(`[UPLOAD] Всего получено: ${req.files.length}`);
    console.log(`[UPLOAD] Сохранено: ${saved.length}`);
    console.log(`[UPLOAD] Пропущено (.t42): ${skipped.length}`);
    console.log(`[UPLOAD] Ошибок: ${errors.length}`);
    console.log(`[UPLOAD] ==================================\n`);

    res.json({
        success: saved.length > 0,
        saved,
        warnings: errors.length ? errors : undefined,
        skippedCount: skipped.length,
        totalReceived: req.files.length,
        totalSaved: saved.length
    });
}));

module.exports = router;