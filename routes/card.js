const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { isValidPath, logAction } = require('../lib/utils');
const { upload } = require('../middleware/upload');

const router = express.Router();

// ✏️ GET: Открытие редактора карточки
router.get('/edit-card/*', asyncHandler(async (req, res) => {
    const decodedPath = req.params[0] || '';
    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const fullPath = path.join(__dirname, '../teletext', decodedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        throw new AppError('Папка не найдена', 404);
    }

    // Читаем текущее название
    let title = path.basename(decodedPath);
    const titleFile = path.join(fullPath, 'title.txt');
    try {
        const titleContent = await fs.readFile(titleFile, 'utf-8');
        if (titleContent.trim()) title = titleContent.trim();
    } catch (err) { /* файл не существует */ }

    // Читаем текущее описание
    let description = '';
    const descFile = path.join(fullPath, 'description.txt');
    try {
        description = (await fs.readFile(descFile, 'utf-8')).trim();
    } catch (err) { /* файл не существует */ }

    // Проверяем наличие логотипа
    const logoSvgPath = path.join(fullPath, 'logo.svg');
    const logoPngPath = path.join(fullPath, 'logo.png');
    const logoExists = await fs.access(logoSvgPath).then(() => true).catch(() => false);
    const logoExistsPng = await fs.access(logoPngPath).then(() => true).catch(() => false);
    const logoUrl = logoExists
        ? `/teletext/${decodedPath}/logo.svg`
        : logoExistsPng
            ? `/teletext/${decodedPath}/logo.png`
            : null;

    res.render('edit-card', {
        archivePath: decodedPath,
        folderName: path.basename(fullPath),
        currentTitle: title,
        currentDescription: description,
        hasLogo: logoExists || logoExistsPng,
        logoUrl,
        disableCopy: true
    });
}));

// 💾 POST: Сохранение изменений
router.post('/save-card/*', upload.single('logo'), asyncHandler(async (req, res) => {
    const decodedPath = req.params[0] || '';
    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const fullPath = path.join(__dirname, '../teletext', decodedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        throw new AppError('Папка не найдена', 404);
    }

    const newTitle = (req.body.title || '').trim();
    const newDescription = (req.body.description || '').trim();

    if (!newTitle) {
        return res.redirect(`/edit-card/${decodedPath}`);
    }

    let finalPathAfterRename = decodedPath;

    // Переименование папки, если название изменилось
    if (newTitle !== path.basename(decodedPath)) {
        const parentDir = path.dirname(fullPath);
        const newFolderPath = path.join(parentDir, newTitle);

        const newFolderExists = await fs.access(newFolderPath).then(() => true).catch(() => false);
        if (newFolderExists) {
            throw new AppError(`Папка '${newTitle}' уже существует`, 400);
        }

        // Безопасное переименование с обработкой блокировок Windows
        const maxRetries = 3;
        let success = false;
        for (let i = 0; i < maxRetries; i++) {
            try {
                await fs.rename(fullPath, newFolderPath);
                success = true;
                logAction('FOLDER_RENAMED', `${fullPath} -> ${newFolderPath}`);
                break;
            } catch (renameErr) {
                if (renameErr.code === 'EPERM' && i < maxRetries - 1) {
                    logAction('FOLDER_RENAME_RETRY', `${decodedPath}: попытка ${i + 1} из ${maxRetries} (EPERM)`);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    logAction('FOLDER_RENAME_ERROR', `${decodedPath}: ${renameErr.message}`);
                    if (renameErr.code === 'EPERM') {
                        throw new AppError('Ошибка переименования: операция запрещена. Убедитесь, что папка не используется другим процессом.', 500);
                    }
                    throw renameErr;
                }
            }
        }
        if (!success) {
            throw new AppError(`Не удалось переименовать после ${maxRetries} попыток`, 500);
        }
        finalPathAfterRename = path.join(path.dirname(decodedPath), newTitle).replace(/^\/+/, '');
    }

    const finalFullDirPath = path.join(__dirname, '../teletext', finalPathAfterRename);

    // Сохраняем title.txt
    try {
        await fs.writeFile(path.join(finalFullDirPath, 'title.txt'), newTitle, 'utf-8');
        logAction('TITLE_SAVED', `${newTitle} -> ${finalPathAfterRename}`);
    } catch (err) {
        logAction('TITLE_SAVE_ERROR', `${finalPathAfterRename}: ${err.message}`);
    }

    // Сохраняем или удаляем description.txt
    if (newDescription) {
        try {
            await fs.writeFile(path.join(finalFullDirPath, 'description.txt'), newDescription, 'utf-8');
            logAction('DESC_SAVED', `${newDescription.substring(0, 20)}... -> ${finalPathAfterRename}`);
        } catch (err) {
            logAction('DESC_SAVE_ERROR', `${finalPathAfterRename}: ${err.message}`);
        }
    } else {
        const descFile = path.join(finalFullDirPath, 'description.txt');
        const descExists = await fs.access(descFile).then(() => true).catch(() => false);
        if (descExists) {
            try {
                await fs.unlink(descFile);
                logAction('DESC_DELETED', `description.txt удален из ${finalPathAfterRename}`);
            } catch (err) {
                logAction('DESC_DELETE_ERROR', `${finalPathAfterRename}: ${err.message}`);
            }
        }
    }

    // Сохраняем логотип, если загружен
    if (req.file) {
        const targetName = req.file.originalname.toLowerCase().endsWith('.svg') ? 'logo.svg' : 'logo.png';
        const targetPath = path.join(finalFullDirPath, targetName);
        try {
            await fs.copyFile(req.file.path, targetPath);
            await fs.unlink(req.file.path);
            logAction('LOGO_UPLOADED', `${targetName} -> ${finalPathAfterRename}`);
        } catch (err) {
            logAction('LOGO_UPLOAD_ERROR', `${finalPathAfterRename}: ${err.message}`);
        }
    }

    res.redirect(`/folder/${finalPathAfterRename}`);
}));

// 🗑️ POST: Удаление логотипа
router.post('/logo-delete/*', asyncHandler(async (req, res) => {
    const decodedPath = req.params[0] || '';
    if (!isValidPath(decodedPath)) {
        throw new AppError('Недопустимый путь', 400);
    }

    const fullPath = path.join(__dirname, '../teletext', decodedPath);
    const stats = await fs.stat(fullPath).catch(() => null);
    if (!stats || !stats.isDirectory()) {
        throw new AppError('Папка не найдена', 404);
    }

    const logoSvg = path.join(fullPath, 'logo.svg');
    const logoPng = path.join(fullPath, 'logo.png');
    const deleted = [];

    const svgExists = await fs.access(logoSvg).then(() => true).catch(() => false);
    if (svgExists) {
        await fs.unlink(logoSvg);
        deleted.push('logo.svg');
    }

    const pngExists = await fs.access(logoPng).then(() => true).catch(() => false);
    if (pngExists) {
        await fs.unlink(logoPng);
        deleted.push('logo.png');
    }

    if (deleted.length > 0) {
        logAction('LOGO_DELETED', `${deleted.join(', ')} из ${decodedPath}`);
    }

    res.redirect(`/edit-card/${decodedPath}`);
}));

module.exports = router;