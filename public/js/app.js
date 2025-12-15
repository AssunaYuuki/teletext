// public/js/app.js

document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/data')
        .then(r => r.json())
        .then(data => {
            const app = document.getElementById('app');
            app.innerHTML = `
                <header class="nav-bar">
                    <div class="breadcrumb">
                        <a href="/">🏠 Главная</a>
                        ${data.breadcrumb.map(crumb => `<span> → ${crumb.name}</span>`).join('')}
                    </div>
                    <h2>${data.folderName}</h2>
                </header>

                <div class="folder-container">
                    <div class="content-wrapper">
                        <div class="header">
                            <h1>${data.folderName}</h1>
                            <div class="breadcrumb">
                                Подпапок: ${data.folders.length}, страниц: ${data.pages.length}
                            </div>
                        </div>

                        ${data.folders.length > 0 ? `
                            <section>
                                <h3>📁 Подпапки</h3>
                                <div class="grid">
                                    ${data.folders.map(folder => `
                                        <div class="card-container" style="position:relative; display:inline-block;">
                                            <div class="card"
                                                 data-logo="${folder.logoUrl || ''}"
                                                 data-folder="${folder.displayName}"
                                                 data-path="${folder.path}"
                                                 onclick="updateHeaderLogo(this); window.location.href='/folder/${folder.path}';"
                                                 onmouseenter="showEditButton(this)"
                                                 onmouseleave="hideEditButton(this)">
                                                ${folder.logoUrl ? `<img src="${folder.logoUrl}?t=${Date.now()}" alt="Логотип" style="height:32px; max-width: 100%; object-fit: contain; margin-top:8px;">` : `<span style="color:#ffcc00;font-size:1.2rem;">🌐</span>`}
                                                <span style="font-size:0.85rem; text-align:center; display:block; word-wrap:break-word; line-height:1.2; margin-top:6px;">${folder.displayName}</span>
                                                ${folder.description ? `<span class="info-icon" onclick="openModal('${folder.displayName}', '${folder.description.replace(/'/g, "\\'").replace(/\n/g, "\\n")}')">ℹ️</span>` : ''}
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            </section>
                        ` : ''}

                        ${data.pages.length > 0 ? `
                            <section class="thumbs-grid">
                                <h3>🖼️ Страницы</h3>
                                <div class="grid">
                                    ${data.pages.map(page => `
                                        <a href="/page/${data.currentPath}/${page.page}" class="thumb-item">
                                            ${page.hasThumb ? `<img src="/teletext/${data.currentPath}/${page.page}.png" alt="Стр. ${page.page}">` : `<div style="height:80px; width:100%; background:#0a220a; display:flex; align-items:center; justify-content:center; color:#00ff88; font-size:1.1rem; font-weight:bold;">${page.page}</div>`}
                                            <span style="margin-top:4px; font-size:0.85rem;">${page.page}</span>
                                        </a>
                                    `).join('')}
                                </div>
                            </section>
                        ` : ''}

                        <footer style="margin-top: 30px; text-align: center; font-size: 0.85rem; opacity: 0.7;">
                            <small>Телетекст | Путь: ${data.currentPath || 'корень'}</small>
                        </footer>
                    </div>
                </div>

                <!-- Модальное окно -->
                <div id="modal" class="modal">
                    <div class="modal-content">
                        <div class="modal-header">
                            <div class="modal-title" id="modal-title">Описание канала</div>
                            <span class="close" onclick="closeModal()">&times;</span>
                        </div>
                        <div class="modal-body" id="modal-body">
                            <!-- Текст будет вставлен здесь -->
                        </div>
                        <div class="modal-footer">
                            <button class="btn-close" onclick="closeModal()">Закрыть</button>
                        </div>
                    </div>
                </div>
            `;
        })
        .catch(err => {
            document.getElementById('app').innerHTML = '<p>Ошибка загрузки данных</p>';
        });
});

function updateHeaderLogo(card) {
    const logoUrl = card.getAttribute('data-logo');
    const headerLogo = document.getElementById('header-logo');
    if (headerLogo && logoUrl) {
        headerLogo.style.opacity = '0';
        setTimeout(() => {
            headerLogo.src = logoUrl + '?t=' + Date.now();
            headerLogo.style.opacity = '1';
        }, 100);
    }
}

function showEditButton(card) {
    const btn = document.createElement('a');
    btn.className = 'edit-btn-wrapper';
    btn.href = `/edit-card/${card.dataset.path}`;
    btn.title = 'Редактировать карточку';
    btn.innerHTML = '<span>✏️</span>';
    btn.addEventListener('click', (e) => e.stopPropagation());
    card.appendChild(btn);
}

function hideEditButton(card) {
    const btn = card.querySelector('.edit-btn-wrapper');
    if (btn) card.removeChild(btn);
}

function openModal(title, description) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').textContent = description;
    document.getElementById('modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

window.onclick = function(event) {
    const modal = document.getElementById('modal');
    if (event.target === modal) closeModal();
};