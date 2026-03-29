# CLAUDE.md

## Запуск

```bash
npm run dev   # разработка (nodemon, авторестарт)
npm start     # продакшн
```

Порт задаётся в `.env`: `HTTP_PORT=3232`. По умолчанию 3000.

## Стек

- **Node.js + Express 4** — HTTP-сервер
- **EJS** — шаблонизатор (`views/*.ejs`)
- **Puppeteer + Sharp** — генерация PNG-превью из HTML
- **Multer** — загрузка файлов
- **dotenv** — конфигурация через `.env`

## Структура проекта

```
server.js              — entrypoint: инициализация app, подключение роутеров
lib/
  utils.js             — logAction, isValidPath
  thumbnails.js        — generateThumbnail, generateThumbnailsForFolder, PUPPETEER_ARGS
middleware/
  errorHandler.js      — AppError, asyncHandler, errorHandler, notFoundHandler
  upload.js            — multer: upload (логотипы), uploadFiles (файлы)
  security.js          — CSP и security headers
routes/
  index.js             — GET /, GET /about
  folder.js            — GET /folder/*
  page.js              — GET /page/*/:page
  card.js              — GET/POST /edit-card/*, /save-card/*, /logo-delete/*
  manager.js           — GET/POST /manager/*, /create-folder/*, /delete-item/*, /rename-item/*, /move-item/*, /upload/*
  thumbnails.js        — GET /regenerate-thumbnails-stream/*, POST /manager/regenerate-thumbnails-fast/*
views/                 — EJS-шаблоны
public/                — статика (CSS, изображения)
teletext/              — контент (в .gitignore): HTML-страницы, PNG-превью, логотипы
```

## Контент (teletext/)

Структура: `teletext/<архив>/<страница>.html` + `<страница>.png` (превью).

Дополнительные файлы в папке архива:
- `title.txt` — отображаемое название
- `description.txt` — описание
- `logo.svg` / `logo.png` — логотип

Номера страниц: целые числа от 100 до 999.

## Валидация путей

Все пути через `isValidPath()` из `lib/utils.js`: запрещены `..`, абсолютные пути, `\`, `:`, `\0`.

## Обработка ошибок

- `AppError(message, statusCode)` — операционные ошибки
- `asyncHandler(fn)` — обёртка для async-роутов
- Глобальный `errorHandler` рендерит `views/error.ejs` (HTML) или JSON

## Превью

`generateThumbnail(htmlPath, pngPath)` — запускает Puppeteer, делает скриншот, ресайзит до 250×250 через Sharp.

`generateThumbnailsForFolder(fullPath)` — батч-генерация (до 3 параллельно), пропускает уже существующие.

Быстрый режим (`/manager/regenerate-thumbnails-fast/*`) — один браузер на 5 параллельных вкладок, перегенерирует всё принудительно.
