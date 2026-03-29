const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { isValidPath, logAction } = require('../lib/utils');
const { uploadFiles } = require('../middleware/upload');

const router = express.Router();

router.get(['/manager', '/manager/*'], asyncHandler(async (req, res) => {
    const decodedPath = req.params[0] || '';

    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const fullPath = path.join(__dirname, '../teletext', decodedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        throw new AppError('Папка не найдена', 404);
    }

    const items = await fs.readdir(fullPath);
    const folders = [];
    const files = [];

    await Promise.all(items.map(async item => {
        const itemPath = path.join(fullPath, item);
        const itemStats = await fs.stat(itemPath);

        if (itemStats.isDirectory()) {
            const subItems = await fs.readdir(itemPath);
            folders.push({
                name: item,
                path: decodedPath ? `${decodedPath}/${item}` : item,
                isEmpty: subItems.length === 0
            });
        } else {
            files.push({
                name: item,
                size: itemStats.size,
                url: `/teletext/${decodedPath ? encodeURIComponent(decodedPath) + '/' : ''}${encodeURIComponent(item)}`,
                ext: path.extname(item).toLowerCase()
            });
        }
    }));

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
}));

router.post('/create-folder/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    const { name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Имя папки обязательно' });
    }

    if (!isValidPath(requestedPath)) {
        return res.status(400).json({ error: 'Недопустимый путь' });
    }

    const cleanName = name.trim()
        .replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s._\-()]/g, '_')
        .replace(/\s+/g, '_');

    const fullPath = path.join(__dirname, '../teletext', requestedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        return res.status(404).json({ error: 'Папка не найдена' });
    }

    const dirPath = path.join(fullPath, cleanName);
    const dirExists = await fs.access(dirPath).then(() => true).catch(() => false);
    if (dirExists) {
        return res.status(400).json({ error: 'Папка уже существует' });
    }

    try {
        await fs.mkdir(dirPath, { recursive: true });
        logAction('FOLDER_CREATED', `teletext/${requestedPath ? requestedPath + '/' : ''}${cleanName}`);
        res.json({ success: true, name: cleanName });
    } catch (err) {
        throw new AppError(`Не удалось создать: ${err.message}`, 500);
    }
}));

router.post('/delete-item/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    const { name, type } = req.body;

    if (!name || !type || !['file', 'folder'].includes(type)) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    if (!isValidPath(requestedPath)) {
        return res.status(400).json({ error: 'Недопустимый путь' });
    }

    const cleanName = path.basename(name);
    const fullPath = path.join(__dirname, '../teletext', requestedPath, cleanName);

    const itemExists = await fs.access(fullPath).then(() => true).catch(() => false);
    if (!itemExists) {
        return res.status(404).json({ error: 'Объект не найден' });
    }

    try {
        if (type === 'file') {
            await fs.unlink(fullPath);
            logAction('FILE_DELETED', `teletext/${requestedPath ? requestedPath + '/' : ''}${cleanName}`);
        } else {
            await fs.rm(fullPath, { recursive: true, force: true });
            logAction('FOLDER_DELETED', `teletext/${requestedPath ? requestedPath + '/' : ''}${cleanName}`);
        }
        res.json({ success: true });
    } catch (err) {
        throw new AppError(`Ошибка удаления: ${err.message}`, 500);
    }
}));

router.post('/rename-item/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    const { oldName, newName, type } = req.body;

    if (!isValidPath(requestedPath) || !oldName || !newName || !['file', 'folder'].includes(type)) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    const cleanOldName = path.basename(oldName);
    const cleanNewName = path.basename(newName);
    const sourcePath = path.join(__dirname, '../teletext', requestedPath, cleanOldName);
    const targetPath = path.join(__dirname, '../teletext', requestedPath, cleanNewName);

    const sourceExists = await fs.access(sourcePath).then(() => true).catch(() => false);
    if (!sourceExists) {
        return res.status(404).json({ error: 'Объект не найден' });
    }

    const targetExists = await fs.access(targetPath).then(() => true).catch(() => false);
    if (targetExists) {
        return res.status(400).json({ error: 'Объект с таким именем уже существует' });
    }

    const maxRetries = 3;
    let success = false;
    try {
        for (let i = 0; i < maxRetries; i++) {
            try {
                await fs.rename(sourcePath, targetPath);
                success = true;
                logAction('ITEM_RENAMED', `${type} ${sourcePath} -> ${targetPath}`);
                break;
            } catch (renameErr) {
                if (renameErr.code === 'EPERM' && i < maxRetries - 1) {
                    logAction('ITEM_RENAME_RETRY', `${requestedPath}/${cleanOldName}: попытка ${i + 1} из ${maxRetries} (EPERM)`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    throw renameErr;
                }
            }
        }

        if (!success) {
            throw new AppError(`Не удалось переименовать после ${maxRetries} попыток`, 500);
        }

        res.json({ success: true });
    } catch (err) {
        logAction('ITEM_RENAME_ERROR', `${requestedPath}/${cleanOldName}: ${err.message}`);
        if (err.code === 'EPERM') {
            return res.status(500).json({ error: 'Ошибка переименования: операция запрещена. Убедитесь, что объект не используется другим процессом.' });
        }
        throw err;
    }
}));

router.post('/move-item/*', asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';
    const { itemName, targetPath, type } = req.body;

    if (!isValidPath(requestedPath) || !itemName || !['file', 'folder'].includes(type)) {
        return res.status(400).json({ error: 'Некорректные данные' });
    }

    const finalTargetPath = targetPath ? path.join(targetPath) : requestedPath;
    if (!isValidPath(finalTargetPath)) {
        return res.status(400).json({ error: 'Недопустимый путь назначения' });
    }

    const cleanItemName = path.basename(itemName);
    const sourcePath = path.join(__dirname, '../teletext', requestedPath, cleanItemName);
    const targetDirPath = path.join(__dirname, '../teletext', finalTargetPath);
    const targetItemPath = path.join(targetDirPath, cleanItemName);

    const sourceExists = await fs.access(sourcePath).then(() => true).catch(() => false);
    if (!sourceExists) {
        return res.status(404).json({ error: 'Объект не найден' });
    }

    const targetDirStats = await fs.stat(targetDirPath).catch(() => null);
    if (!targetDirStats || !targetDirStats.isDirectory()) {
        return res.status(404).json({ error: 'Папка назначения не найдена' });
    }

    const targetItemExists = await fs.access(targetItemPath).then(() => true).catch(() => false);
    if (targetItemExists) {
        return res.status(400).json({ error: 'Объект с таким именем уже существует в папке назначения' });
    }

    try {
        await fs.rename(sourcePath, targetItemPath);
        logAction('ITEM_MOVED', `${type} ${sourcePath} -> ${targetItemPath}`);
        res.json({ success: true });
    } catch (err) {
        logAction('ITEM_MOVE_ERROR', `${requestedPath}/${cleanItemName} -> ${finalTargetPath}: ${err.message}`);
        if (err.code === 'EPERM') {
            return res.status(500).json({ error: 'Ошибка перемещения: операция запрещена. Убедитесь, что объект не используется другим процессом.' });
        }
        throw err;
    }
}));

router.post('/upload/*', uploadFiles.any(), asyncHandler(async (req, res) => {
    const requestedPath = req.params[0] || '';

    if (!isValidPath(requestedPath)) {
        return res.status(400).json({ error: 'Недопустимый путь' });
    }

    const fullPath = path.join(__dirname, '../teletext', requestedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        return res.status(404).json({ error: 'Папка не найдена' });
    }

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
                .replace(/[^a-zA-Zа-яА-ЯёЁ0-9\s._\-()]/g, '_')
                .replace(/\s+/g, '_');

            await fs.copyFile(file.path, path.join(fullPath, targetName));
            await fs.unlink(file.path);
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
}));

module.exports = router;
