// public/js/protect.js

// Блокируем копирование
document.addEventListener('copy', e => {
    e.preventDefault();
    alert('Копирование запрещено');
});

// Блокируем вырезание
document.addEventListener('cut', e => {
    e.preventDefault();
    alert('Вырезание запрещено');
});

// Блокируем вставку
document.addEventListener('paste', e => {
    e.preventDefault();
    alert('Вставка запрещена');
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