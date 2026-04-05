const express = require('express');
const session = require('express-session');

const router = express.Router();

const ADMIN_PASSWORD = '369836985f';
const SESSION_SECRET = 'teletext_secure_secret_2026'; // замените на любую случайную строку при деплое

// 🟢 Инициализация сессий
const sessionMiddleware = session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,      // поставьте true, если сервер работает по HTTPS
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax'
    }
});

// 🛡️ Middleware проверки авторизации
const requireAuth = (req, res, next) => {
    if (req.session && req.session.authenticated) return next();

    // Для AJAX/Fetch запросов
    if (req.accepts('json') || req.headers['content-type']?.includes('application/json')) {
        return res.status(401).json({ error: 'Требуется авторизация', redirect: '/login' });
    }

    // Для обычных переходов в браузере
    req.session.returnTo = req.originalUrl;
    res.redirect('/login');
};

// 🚪 Маршруты входа/выхода
router.get('/login', (req, res) => {
    res.render('login', {
        error: req.query.error === '1',
        returnTo: req.session.returnTo || '/manager',
        disableCopy: true
    });
});

router.post('/login', (req, res) => {
    if (req.body.password === ADMIN_PASSWORD) {
        req.session.authenticated = true;
        const returnTo = req.session.returnTo || '/manager';
        delete req.session.returnTo;
        return res.redirect(returnTo);
    }
    res.redirect('/login?error=1');
});

router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

module.exports = { router, sessionMiddleware, requireAuth };