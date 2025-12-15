// public/js/protect.js

// Блокируем копирование
document.addEventListener('copy', e => {
    e.preventDefault();
});

// Блокируем вырезание
document.addEventListener('cut', e => {
    e.preventDefault();
});

// Блокируем вставку
document.addEventListener('paste', e => {
    e.preventDefault();
});

// Блокируем контекстное меню
document.addEventListener('contextmenu', e => {
    e.preventDefault();
});

// Блокируем выбор текста
document.addEventListener('selectstart', e => {
    e.preventDefault();
});

// Блокируем перетаскивание
document.addEventListener('dragstart', e => {
    e.preventDefault();
});

// Показать алерт при открытии DevTools
(function() {
    const devtools = {
        open: false,
        orientation: null
    };

    const threshold = 160;

    const emitEvent = function(type) {
        window.dispatchEvent(new Event(type));
    };

    setInterval(() => {
        const widthThreshold = window.outerWidth - window.innerWidth > threshold;
        const heightThreshold = window.outerHeight - window.innerHeight > threshold;
        const orientation = widthThreshold ? 'vertical' : heightThreshold ? 'horizontal' : null;

        if (
            (widthThreshold || heightThreshold)
            && !devtools.open
        ) {
            devtools.open = true;
            devtools.orientation = orientation;
            emitEvent('devtoolsopen');
            // Заменяем HTML на пустой
            document.body.innerHTML = '<h1></h1><p></p>';
        } else if (
            !(widthThreshold || heightThreshold)
            && devtools.open
        ) {
            devtools.open = false;
            emitEvent('devtoolsclose');
        }
    }, 500);

    window.addEventListener('devtoolsopen', () => {
        // Можно добавить что-то ещё
    });
})();

// Блокируем Ctrl+U, Ctrl+Shift+I, F12
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key === 'u') {
            e.preventDefault();
            // Заменяем HTML на пустой
            document.body.innerHTML = '<h1></h1><p></p>';
        }
        if (e.ctrlKey && e.shiftKey && e.key === 'I') {
            e.preventDefault();
            // Заменяем HTML на пустой
            document.body.innerHTML = '<h1></h1><p></p>';
        }
        if (e.key === 'F12') {
            e.preventDefault();
            // Заменяем HTML на пустой
            document.body.innerHTML = '<h1></h1><p></p>';
        }
    });
});