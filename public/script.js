document.addEventListener('DOMContentLoaded', () => {
    loadStats();
    loadFunnel();
    loadUsers();

    // Event listeners
    document.getElementById('search-input').addEventListener('input', debounce(() => loadUsers(), 500));
    document.getElementById('filter-select').addEventListener('change', () => loadUsers());
    document.getElementById('export-btn').addEventListener('click', exportToCSV);
});

let purchaseChart, funnelChart;

async function loadStats() {
    try {
        const res = await fetch('/api/stats');
        if (res.status === 401) return window.location.href = '/login.html';
        const data = await res.json();
        
        document.getElementById('total-users').innerText = data.total_users;
        document.getElementById('purchased-users').innerText = data.purchased_users;
        
        const conversion = data.total_users > 0 ? ((data.purchased_users / data.total_users) * 100).toFixed(1) : 0;
        document.getElementById('conversion-rate').innerText = `${conversion}%`;

        renderPurchaseChart(data.purchased_users, data.non_purchased_users);
    } catch (err) {
        console.error('Error loading stats:', err);
    }
}

async function loadFunnel() {
    try {
        const res = await fetch('/api/funnel');
        if (res.status === 401) return window.location.href = '/login.html';
        const data = await res.json();
        renderFunnelChart(data);
    } catch (err) {
        console.error('Error loading funnel:', err);
    }
}

async function loadUsers() {
    const search = document.getElementById('search-input').value;
    const filter = document.getElementById('filter-select').value;
    
    try {
        const res = await fetch(`/api/users?search=${encodeURIComponent(search)}&filter=${filter}`);
        if (res.status === 401) return window.location.href = '/login.html';
        const users = await res.json();
        const tbody = document.querySelector('#users-table tbody');
        tbody.innerHTML = '';

        if (!Array.isArray(users)) {
            console.error('Ошибка от API:', users);
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="7" style="text-align:center; color:#ef4444; padding:2rem;">Ошибка загрузки данных: ${users.error || 'Неизвестная ошибка'}</td>`;
            tbody.appendChild(tr);
            return;
        }
        
        users.forEach(user => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${user.telegram_id}</td>
                <td>${user.username || '—'}</td>
                <td>${user.phone || '—'}</td>
                <td><span class="status-badge ${user.has_purchased ? 'status-purchased' : 'status-none'}">${user.has_purchased ? 'Купил' : 'Нет'}</span></td>
                <td>${user.purchase_date ? new Date(user.purchase_date).toLocaleDateString() : '—'}</td>
                <td>${user.last_step || '—'}</td>
                <td>${new Date(user.created_at).toLocaleDateString()}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Error loading users:', err);
    }
}

function renderPurchaseChart(purchased, nonPurchased) {
    const ctx = document.getElementById('purchaseChart').getContext('2d');
    if (purchaseChart) purchaseChart.destroy();
    
    purchaseChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Купили', 'Не купили'],
            datasets: [{
                data: [purchased, nonPurchased],
                backgroundColor: ['#6366f1', 'rgba(255, 255, 255, 0.1)'],
                borderColor: ['#6366f1', 'rgba(255, 255, 255, 0.2)'],
                borderWidth: 1
            }]
        },
        options: {
            plugins: {
                legend: { position: 'bottom', labels: { color: '#94a3b8' } }
            }
        }
    });
}

function renderFunnelChart(data) {
    const ctx = document.getElementById('funnelChart').getContext('2d');
    if (funnelChart) funnelChart.destroy();
    
    funnelChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: data.map(d => d.last_step),
            datasets: [{
                label: 'Пользователей',
                data: data.map(d => parseInt(d.count)),
                backgroundColor: 'rgba(99, 102, 241, 0.5)',
                borderColor: '#6366f1',
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            scales: {
                x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
                y: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

async function exportToCSV() {
    try {
        const res = await fetch('/api/export');
        
        if (res.status === 401) {
            window.location.href = '/login.html';
            return;
        }

        const data = await res.json();
        if (data.length === 0) return alert('Нет данных для выгрузки');

        // Определение четкого порядка и названий колонок по вашему запросу
        const headerMapping = {
            'created_at': 'Время входа',
            'username': 'Юзернейм',
            'phone': 'Номер телефона',
            'last_step': 'Этап остановки',
            'has_purchased': 'Купил или нет',
            'payment_method': 'Как купил',
            'purchase_date': 'Дата оплаты',
            'telegram_id': 'Telegram ID',
            'funnel_status': 'Все действия (лог)'
        };

        // Берем только нужные ключи в правильном порядке
        const headers = Object.keys(headerMapping).filter(k => Object.keys(data[0]).includes(k));
        
        // Добавляем остальные технические поля в конец, если они есть
        Object.keys(data[0]).forEach(k => {
            if (!headers.includes(k)) headers.push(k);
        });

        const csvContent = [
            headers.map(h => headerMapping[h] || h).join(','),
            ...data.map(row => headers.map(header => {
                let val = row[header];
                
                // Форматирование статуса покупки
                if (header === 'has_purchased') {
                    val = val ? 'ДА (Купил)' : 'НЕТ';
                }
                
                // Форматирование дат
                if (val && (header === 'created_at' || header === 'purchase_date')) {
                    val = new Date(val).toLocaleString('ru-RU');
                }

                if (val === null || val === undefined) val = '';
                
                // Экранирование и очистка текста (чтобы лог действий не ломал таблицу)
                if (typeof val === 'string') {
                    // Убираем лишние переносы строк для CSV
                    val = val.replace(/\n/g, ' ').replace(/\r/g, ' ');
                    val = `"${val.replace(/"/g, '""')}"`;
                }
                return val;
            }).join(','))
        ].join('\n');

        const blob = new Blob(["\ufeff" + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `analytics_export_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.error('Export error:', err);
        alert('Ошибка при выгрузке');
    }
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}
