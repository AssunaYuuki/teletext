const securityHeaders = (req, res, next) => {
    const csp = [
        "default-src 'self'",
        "img-src 'self' https://cdn.discordapp.com https://okgamer.ru/uploads/fotos/ https://mc.yandex.ru https://yastatic.net https://tele.assunayuuki.ru data:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline' https://mc.yandex.ru https://yastatic.net",
        "script-src-elem 'self' 'unsafe-inline' https://mc.yandex.ru https://yastatic.net",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self' https://mc.yandex.ru wss://mc.yandex.ru https://yastatic.net https://stats.g.doubleclick.net",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'"
    ].join('; ');

    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
};

module.exports = securityHeaders;
