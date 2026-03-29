const express = require('express');
const path = require('path');

require('dotenv').config({ quiet: true });

const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const securityHeaders = require('./middleware/security');
const { logAction } = require('./lib/utils');

const indexRouter = require('./routes/index');
const folderRouter = require('./routes/folder');
const pageRouter = require('./routes/page');
const cardRouter = require('./routes/card');
const managerRouter = require('./routes/manager');
const thumbnailsRouter = require('./routes/thumbnails');

const app = express();
const port = process.env.HTTP_PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/teletext', express.static(path.join(__dirname, 'teletext')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(securityHeaders);

app.use(indexRouter);
app.use(folderRouter);
app.use(pageRouter);
app.use(cardRouter);
app.use(managerRouter);
app.use(thumbnailsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
    logAction('SERVER_START', `http://localhost:${port}`);
    console.log(`✅ Телетекст-плеер запущен: http://localhost:${port}`);
});

process.on('SIGINT', () => {
    logAction('SERVER_SHUTDOWN', 'Graceful shutdown...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logAction('SERVER_SHUTDOWN', 'Graceful shutdown...');
    process.exit(0);
});
