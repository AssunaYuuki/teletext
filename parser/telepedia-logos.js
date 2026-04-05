const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs').promises;
const path = require('path');

class TelepediaLogosParser {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || 'https://telepedia.fandom.com';
        this.categoryUrl = options.categoryUrl || `${this.baseUrl}/ru/wiki/Категория:Логотипы_региональных_телеканалов`;
        this.delay = options.delay || 1000; // Задержка между запросами (мс)
        this.maxPages = options.maxPages || 50; // Максимум страниц для парсинга
        this.outputDir = options.outputDir || './output';
        this.logos = [];
        this.stats = {
            pagesParsed: 0,
            logosFound: 0,
            errors: 0
        };
    }

    // Создание директории вывода
    async init() {
        try {
            await fs.mkdir(this.outputDir, { recursive: true });
            console.log(`📁 Директория вывода: ${this.outputDir}`);
        } catch (err) {
            console.error('❌ Ошибка создания директории:', err.message);
            process.exit(1);
        }
    }

    // Загрузка HTML страницы
    async fetchPage(url) {
        try {
            console.log(`🌐 Загрузка: ${url}`);
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8'
                },
                timeout: 15000
            });
            return response.data;
        } catch (err) {
            console.error(`❌ Ошибка загрузки ${url}:`, err.message);
            this.stats.errors++;
            return null;
        }
    }

    // Парсинг одной страницы категории
    parseCategoryPage(html) {
        const $ = cheerio.load(html);
        const pageLogos = [];

        // Находим все элементы логотипов
        $('.category-page__member').each((index, element) => {
            const $el = $(element);

            // Ссылка на файл
            const $link = $el.find('.category-page__member-link');
            const fileUrl = $link.attr('href') || '';
            const fileName = $link.text().trim();

            // Извлекаем название канала из имени файла
            // Пример: "Файл:10 канал (1994-2004, без фона).png" -> "10 канал"
            const channelMatch = fileName.match(/^Файл:(.+?)(?:\s*\(|\s*\d{4}|\s*\.)/);
            const channelName = channelMatch ? channelMatch[1].trim() : fileName.replace('Файл:', '').split('.')[0].trim();

            // Извлекаем годы из имени файла
            const yearMatch = fileName.match(/(\d{4})(?:-\d{4})?/);
            const year = yearMatch ? parseInt(yearMatch[1]) : null;

            // Извлекаем город/регион
            const cityMatch = fileName.match(/г\.\s*([^(),]+)/);
            const city = cityMatch ? cityMatch[1].trim() : null;

            // Ссылка на изображение (thumbnail)
            const $thumb = $el.find('.category-page__member-thumbnail');
            const thumbUrl = $thumb.attr('data-src') || $thumb.attr('src') || '';

            // Полная ссылка на файл (для скачивания)
            const fullFileUrl = fileUrl ? `${this.baseUrl}${fileUrl}` : '';

            pageLogos.push({
                fileName,
                channelName,
                year,
                city,
                fileUrl: fullFileUrl,
                thumbUrl: thumbUrl ? (thumbUrl.startsWith('http') ? thumbUrl : `${this.baseUrl}${thumbUrl}`) : '',
                pageUrl: fullFileUrl
            });
        });

        return pageLogos;
    }

    // Получение ссылки на следующую страницу
    getNextPageUrl(html) {
        const $ = cheerio.load(html);
        const nextLink = $('.category-page__pagination-next');
        if (nextLink.length) {
            const href = nextLink.attr('href');
            if (href) {
                return href.startsWith('http') ? href : `${this.baseUrl}${href}`;
            }
        }
        return null;
    }

    // Основной метод парсинга
    async parse() {
        console.log('🚀 Начало парсинга логотипов Telepedia...');
        console.log(`📂 Категория: ${this.categoryUrl}`);
        console.log('---');

        await this.init();

        let currentUrl = this.categoryUrl;
        let pageCount = 0;

        while (currentUrl && pageCount < this.maxPages) {
            // Задержка между запросами
            if (pageCount > 0) {
                await this.sleep(this.delay);
            }

            // Загрузка страницы
            const html = await this.fetchPage(currentUrl);
            if (!html) {
                console.log('⚠️ Пропуск страницы из-за ошибки');
                break;
            }

            // Парсинг
            const pageLogos = this.parseCategoryPage(html);
            this.logos.push(...pageLogos);
            this.stats.pagesParsed++;
            this.stats.logosFound += pageLogos.length;

            console.log(`✅ Страница ${pageCount + 1}: найдено ${pageLogos.length} логотипов (всего: ${this.stats.logosFound})`);

            // Поиск следующей страницы
            const nextPageUrl = this.getNextPageUrl(html);
            if (nextPageUrl) {
                currentUrl = nextPageUrl;
                pageCount++;
            } else {
                console.log('🏁 Все страницы пройдены');
                break;
            }
        }

        // Сохранение результатов
        await this.saveResults();

        // Вывод статистики
        console.log('\n📊 Статистика:');
        console.log(`   📄 Страниц пройдено: ${this.stats.pagesParsed}`);
        console.log(`   🎨 Логотипов найдено: ${this.stats.logosFound}`);
        console.log(`   ❌ Ошибок: ${this.stats.errors}`);
        console.log(`💾 Результаты сохранены в: ${this.outputDir}`);
    }

    // Сохранение результатов
    async saveResults() {
        // JSON с полной информацией
        const jsonPath = path.join(this.outputDir, 'logos.json');
        await fs.writeFile(jsonPath, JSON.stringify(this.logos, null, 2), 'utf-8');
        console.log(`📄 JSON сохранен: ${jsonPath}`);

        // CSV для Excel
        const csvPath = path.join(this.outputDir, 'logos.csv');
        const csvHeader = 'fileName,channelName,year,city,fileUrl,thumbUrl,pageUrl\n';
        const csvRows = this.logos.map(logo =>
            `"${logo.fileName.replace(/"/g, '""')}","${logo.channelName.replace(/"/g, '""')}",${logo.year || ''},"${(logo.city || '').replace(/"/g, '""')}","${logo.fileUrl}","${logo.thumbUrl}","${logo.pageUrl}"`
        );
        await fs.writeFile(csvPath, csvHeader + csvRows.join('\n'), 'utf-8');
        console.log(`📊 CSV сохранен: ${csvPath}`);

        // Список уникальных каналов
        const channels = [...new Set(this.logos.map(l => l.channelName))].sort();
        const channelsPath = path.join(this.outputDir, 'channels.txt');
        await fs.writeFile(channelsPath, channels.join('\n'), 'utf-8');
        console.log(`📝 Список каналов: ${channelsPath} (${channels.length} каналов)`);
    }

    // Утилита для задержки
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Запуск парсера
const parser = new TelepediaLogosParser({
    delay: 1500,        // Задержка 1.5 сек между запросами
    maxPages: 100,      // Максимум страниц
    outputDir: './telepedia-output'
});

parser.parse().catch(err => {
    console.error('❌ Критическая ошибка:', err);
    process.exit(1);
});