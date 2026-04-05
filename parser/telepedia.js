const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');

class TelepediaParser {
    constructor() {
        this.baseURL = 'https://telepedia.fandom.com';
        this.categoryURL = `${this.baseURL}/ru/wiki/Категория:Логотипы_региональных_телеканалов`;
        this.data = [];
    }

    // Получение HTML страницы
    async getPageHTML(url) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            return response.data;
        } catch (error) {
            console.error(`Ошибка при загрузке ${url}:`, error.message);
            return null;
        }
    }

    // Парсинг списка каналов из категории
    async parseCategory() {
        console.log('📂 Парсинг категории...');
        const html = await this.getPageHTML(this.categoryURL);
        if (!html) return [];

        const $ = cheerio.load(html);
        const channels = [];

        // Fandom использует разные селекторы для списков страниц
        $('.category-page__member-link').each((_, element) => {
            const href = $(element).attr('href');
            const title = $(element).attr('title');
            if (href && title) {
                channels.push({
                    title: title,
                    url: this.baseURL + href
                });
            }
        });

        // Альтернативный селектор
        if (channels.length === 0) {
            $('.mw-category-generated li a').each((_, element) => {
                const href = $(element).attr('href');
                const title = $(element).attr('title');
                if (href && title && !title.includes('Категория')) {
                    channels.push({
                        title: title,
                        url: this.baseURL + href
                    });
                }
            });
        }

        console.log(`✅ Найдено каналов: ${channels.length}`);
        return channels;
    }

    // Парсинг информации о канале (с использованием Puppeteer для JS)
    async parseChannel(channelUrl) {
        console.log(`📺 Парсинг: ${channelUrl}`);

        let browser;
        try {
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const page = await browser.newPage();
            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

            await page.goto(channelUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000
            });

            // Извлечение данных со страницы
            const channelData = await page.evaluate(() => {
                const data = {
                    name: '',
                    logos: [],
                    description: '',
                    dates: [],
                    info: {}
                };

                // Название канала
                const titleEl = document.querySelector('#firstHeading');
                if (titleEl) {
                    data.name = titleEl.textContent.trim();
                }

                // Описание (если есть)
                const descEl = document.querySelector('.mw-parser-output > p');
                if (descEl) {
                    data.description = descEl.textContent.trim();
                }

                // Логотипы (изображения)
                const images = document.querySelectorAll('.mw-parser-output img');
                images.forEach(img => {
                    const src = img.src || img.getAttribute('data-src');
                    const alt = img.alt || '';
                    if (src && (src.includes('logo') || src.includes('Logotip') || alt.toLowerCase().includes('логотип'))) {
                        data.logos.push({
                            url: src,
                            alt: alt
                        });
                    }
                });

                // Таблица с информацией
                const infoRows = document.querySelectorAll('.infobox tr');
                infoRows.forEach(row => {
                    const th = row.querySelector('th');
                    const td = row.querySelector('td');
                    if (th && td) {
                        const key = th.textContent.trim().replace(':', '');
                        const value = td.textContent.trim();
                        data.info[key] = value;
                    }
                });

                // Даты (если есть в тексте)
                const datePattern = /\d{1,2}\s+(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+\d{4}/gi;
                const textContent = document.querySelector('.mw-parser-output')?.textContent || '';
                const dates = textContent.match(datePattern);
                if (dates) {
                    data.dates = dates;
                }

                return data;
            });

            await browser.close();
            return channelData;

        } catch (error) {
            console.error(`Ошибка парсинга ${channelUrl}:`, error.message);
            if (browser) await browser.close();
            return null;
        }
    }

    // Скачивание логотипа
    async downloadLogo(url, savePath) {
        try {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            await fs.writeFile(savePath, response.data);
            console.log(`💾 Сохранено: ${savePath}`);
            return true;
        } catch (error) {
            console.error(`Ошибка скачивания ${url}:`, error.message);
            return false;
        }
    }

    // Основной метод парсинга
    async start({ downloadLogos = false, saveDir = './teletext/telepedia' } = {}) {
        console.log('🚀 Запуск парсера Telepedia...\n');

        // Создание директории
        if (downloadLogos) {
            await fs.mkdir(saveDir, { recursive: true });
        }

        // Получение списка каналов
        const channels = await this.parseCategory();
        if (channels.length === 0) {
            console.log('❌ Каналы не найдены');
            return;
        }

        // Парсинг каждого канала
        for (let i = 0; i < channels.length; i++) {
            const channel = channels[i];
            console.log(`\n[${i + 1}/${channels.length}] ${channel.title}`);

            const channelData = await this.parseChannel(channel.url);

            if (channelData) {
                const result = {
                    ...channel,
                    ...channelData,
                    parsedAt: new Date().toISOString()
                };

                this.data.push(result);

                // Скачивание логотипов
                if (downloadLogos && channelData.logos.length > 0) {
                    const channelDir = path.join(saveDir, this.sanitizeFilename(channel.title));
                    await fs.mkdir(channelDir, { recursive: true });

                    for (let j = 0; j < channelData.logos.length; j++) {
                        const logo = channelData.logos[j];
                        const ext = path.extname(logo.url.split('?')[0]) || '.png';
                        const filename = `logo_${j + 1}${ext}`;
                        await this.downloadLogo(logo.url, path.join(channelDir, filename));
                    }
                }

                // Сохранение JSON после каждого канала
                await fs.writeFile(
                    './teletext/telepedia_data.json',
                    JSON.stringify(this.data, null, 2),
                    'utf-8'
                );
            }

            // Задержка чтобы не блокировали
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log('\n✅ Парсинг завершен!');
        console.log(`📊 Всего каналов: ${this.data.length}`);
        console.log(`💾 Данные сохранены в: ./teletext/telepedia_data.json`);
    }

    // Очистка имени файла
    sanitizeFilename(filename) {
        return filename.replace(/[/\\?%*:|"<>]/g, '_');
    }
}

// Запуск парсера
async function main() {
    const parser = new TelepediaParser();

    await parser.start({
        downloadLogos: true,  // Скачать логотипы
        saveDir: './teletext/telepedia_logos'
    });
}

// Экспорт для использования в других модулях
module.exports = TelepediaParser;

// Запуск если файл запущен напрямую
if (require.main === module) {
    main().catch(console.error);
}