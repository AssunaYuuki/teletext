const fs = require('fs').promises;
const path = require('path');

// Логирование ошибок в файл
async function logError(error, req) {
    const timestamp = new Date().toISOString();
    const logEntry = {
        timestamp,
        error: {
            message: error.message,
            stack: error.stack,
            code: error.code
        },
        request: {
            method: req.method,
            url: req.url,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('user-agent')
        }
    };

    const logDir = path.join(__dirname, '../logs');
    const logFile = path.join(logDir, `error-${new Date().toISOString().split('T')[0]}.log`);

    try {
        await fs.mkdir(logDir, { recursive: true });
        await fs.appendFile(logFile, JSON.stringify(logEntry, null, 2) + '\n');
    } catch (err) {
        console.error('Failed to write error log:', err);
    }
}

// Wrapper для асинхронных маршрутов
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// Глобальный обработчик ошибок
const errorHandler = async (err, req, res, next) => {
    // Логируем ошибку
    await logError(err, req);
    console.error(`[ERROR] ${err.message}`, err.stack);

    // Определяем статус код
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Внутренняя ошибка сервера';
    let userMessage = message;

    // Обработка специфичных ошибок
    switch (err.code) {
        case 'ENOENT':
            statusCode = 404;
            userMessage = 'Файл или папка не найдены';
            break;
        case 'EPERM':
        case 'EACCES':
            statusCode = 403;
            userMessage = 'Доступ запрещён. Проверьте права доступа к файлам.';
            break;
        case 'EEXIST':
            statusCode = 409;
            userMessage = 'Файл или папка уже существует';
            break;
        case 'ENOTDIR':
            statusCode = 400;
            userMessage = 'Указанный путь не является папкой';
            break;
        case 'EISDIR':
            statusCode = 400;
            userMessage = 'Указанный путь является папкой';
            break;
        case 'EMFILE':
        case 'ENFILE':
            statusCode = 503;
            userMessage = 'Слишком много открытых файлов. Попробуйте позже.';
            break;
    }

    // Ошибки валидации Multer
    if (err instanceof Error && err.message.includes('Только SVG/PNG/JPG')) {
        statusCode = 400;
        userMessage = err.message;
    }

    // Ошибки Puppeteer
    if (err.message && err.message.includes('Navigation timeout')) {
        statusCode = 504;
        userMessage = 'Превышено время ожидания загрузки страницы';
    }

    // Отправляем ответ
    if (req.accepts('html')) {
        // HTML ответ для браузера
        return res.status(statusCode).render('error', {
            message: userMessage,
            status: statusCode,
            stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
            disableCopy: true
        });
    } else {
        // JSON ответ для API
        return res.status(statusCode).json({
            error: userMessage,
            status: statusCode,
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
        });
    }
};

// 404 обработчик
const notFoundHandler = (req, res) => {
    const statusCode = 404;
    const message = 'Страница не найдена';

    if (req.accepts('html')) {
        return res.status(statusCode).render('error', {
            message,
            status: statusCode,
            disableCopy: true
        });
    } else {
        return res.status(statusCode).json({
            error: message,
            status: statusCode
        });
    }
};

// Класс для кастомных ошибок
class AppError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = {
    asyncHandler,
    errorHandler,
    notFoundHandler,
    AppError
};