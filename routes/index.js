const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
    const dir = path.join(__dirname, '../teletext');

    let folders = [];
    const dirExists = await fs.access(dir).then(() => true).catch(() => false);

    if (dirExists) {
        const items = await fs.readdir(dir);
        const folderStats = await Promise.all(
            items.map(async item => {
                const itemPath = path.join(dir, item);
                const stats = await fs.stat(itemPath);
                return { item, isDirectory: stats.isDirectory() };
            })
        );
        folders = folderStats.filter(f => f.isDirectory).map(f => f.item);
    }

    res.render('index', { folders, disableCopy: true });
}));

router.get('/about', (req, res) => {
    res.render('about', { disableCopy: true });
});

module.exports = router;
