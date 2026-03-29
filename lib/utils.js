function logAction(action, details = '') {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${action}${details ? ` - ${details}` : ''}\n`;
    console.log(line.trim());
}

function isValidPath(p) {
    if (!p) return true;
    const allowedChars = /^[a-zA-Zа-яА-ЯёЁ0-9\s,. -_\/&()'$$$${}@#~$%^*+=<>:;]+$/u;
    if (!allowedChars.test(p)) return false;
    return !p.includes('..') && !p.startsWith('/') && !p.includes(':') && !p.includes('\\') && !p.includes('\0');
}

module.exports = { logAction, isValidPath };
