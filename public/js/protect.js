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

// Блокируем console.log
if (window.console && window.console.log) {
    window.console.log = function() {};
}








// Блокируем document.createAttribute
document.createAttribute = function() {
    throw new Error('createAttribute запрещён');
};

// Блокируем document.createAttributeNS
document.createAttributeNS = function() {
    throw new Error('createAttributeNS запрещён');
};

// Блокируем document.createEvent
document.createEvent = function() {
    throw new Error('createEvent запрещён');
};

// Блокируем document.createRange
document.createRange = function() {
    throw new Error('createRange запрещён');
};

// Блокируем document.createNodeIterator
document.createNodeIterator = function() {
    throw new Error('createNodeIterator запрещён');
};

// Блокируем document.createTreeWalker
document.createTreeWalker = function() {
    throw new Error('createTreeWalker запрещён');
};

// Блокируем document.createExpression
document.createExpression = function() {
    throw new Error('createExpression запрещён');
};

// Блокируем document.createNSResolver
document.createNSResolver = function() {
    throw new Error('createNSResolver запрещён');
};

// Блокируем document.createCDATASection
document.createCDATASection = function() {
    throw new Error('createCDATASection запрещён');
};

// Блокируем document.createEntityReference
document.createEntityReference = function() {
    throw new Error('createEntityReference запрещён');
};

// Блокируем document.createDocumentType
document.createDocumentType = function() {
    throw new Error('createDocumentType запрещён');
};

// Блокируем document.createProcessingInstruction
document.createProcessingInstruction = function() {
    throw new Error('createProcessingInstruction запрещён');
};

// Блокируем document.createAttribute
document.createAttribute = function() {
    throw new Error('createAttribute запрещён');
};

// Блокируем document.createAttributeNS
document.createAttributeNS = function() {
    throw new Error('createAttributeNS запрещён');
};

// Блокируем document.createEvent
document.createEvent = function() {
    throw new Error('createEvent запрещён');
};

// Блокируем document.createRange
document.createRange = function() {
    throw new Error('createRange запрещён');
};

// Блокируем document.createNodeIterator
document.createNodeIterator = function() {
    throw new Error('createNodeIterator запрещён');
};

// Блокируем document.createTreeWalker
document.createTreeWalker = function() {
    throw new Error('createTreeWalker запрещён');
};

// Блокируем document.createExpression
document.createExpression = function() {
    throw new Error('createExpression запрещён');
};

// Блокируем document.createNSResolver
document.createNSResolver = function() {
    throw new Error('createNSResolver запрещён');
};

// Блокируем document.createCDATASection
document.createCDATASection = function() {
    throw new Error('createCDATASection запрещён');
};

// Блокируем document.createEntityReference
document.createEntityReference = function() {
    throw new Error('createEntityReference запрещён');
};

// Блокируем document.createDocumentType
document.createDocumentType = function() {
    throw new Error('createDocumentType запрещён');
};

// Блокируем document.createProcessingInstruction
document.createProcessingInstruction = function() {
    throw new Error('createProcessingInstruction запрещён');
};