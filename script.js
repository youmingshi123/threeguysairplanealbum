// ================= 配置区 =================
// 🚨 必须修改 1：填入你的 CloudFlare-ImgBed 地址
const IMGBED_BASE = "https://cloudflare-imgbed-83e.pages.dev"; 
// 🚨 必须修改 2：填入你刚才部署的 Cloudflare Worker API 地址
const API_URL = "https://threeguysaa.pages.dev/api/aircrafts"; 

// ================= 全局变量 =================
let currentUser = null;
let currentBase64Image = null;
let currentAlbumFlight = null;     
let currentEditingFlightId = null; 
let currentViewMode = 'team'; // 'team' 或 'mine'

// ================= 账号系统 =================
const DEFAULT_ACCOUNTS = [
    { id: 1, username: 'user1', password: '11111111' },
    { id: 2, username: 'user2', password: '11111111' },
    { id: 3, username: 'user3', password: '11111111' },
    { id: 4, username: 'beiyong', password: '11111111' }
];

function getAccounts() {
    try {
        let acc = JSON.parse(localStorage.getItem('sjk_accounts'));
        if (!acc || acc.length === 0) {
            localStorage.setItem('sjk_accounts', JSON.stringify(DEFAULT_ACCOUNTS));
            return DEFAULT_ACCOUNTS;
        }
        return acc;
    } catch(e) { return DEFAULT_ACCOUNTS; }
}

function checkLogin() {
    try {
        let sessionUser = JSON.parse(sessionStorage.getItem('sjk_currentUser'));
        if (sessionUser) {
            currentUser = sessionUser;
            document.getElementById('loginModal').classList.remove('active');
            document.getElementById('displayCurrentUser').textContent = currentUser.username;
            loadFlightData(); // 登录后从云端拉取数据
        } else {
            document.getElementById('loginModal').classList.add('active');
        }
    } catch(e) { document.getElementById('loginModal').classList.add('active'); }
}

function handleLogin() {
    const user = document.getElementById('loginUser').value.trim();
    const pass = document.getElementById('loginPass').value.trim();
    if (!user || !pass) { alert('请输入用户名和密码！'); return; }
    
    const accounts = getAccounts();
    const found = accounts.find(a => a.username === user && a.password === pass);
    if (found) {
        currentUser = found;
        try { sessionStorage.setItem('sjk_currentUser', JSON.stringify(currentUser)); } catch(e) {}
        document.getElementById('loginPass').value = '';
        document.getElementById('loginModal').classList.remove('active');
        document.getElementById('displayCurrentUser').textContent = currentUser.username;
        
        switchView('team'); // 登录后默认切回团队图库
        loadFlightData(); 
    } else {
        alert('登录失败！检查账号密码。默认密码为 8 个 1。');
    }
}

function handleLogout() {
    try { sessionStorage.removeItem('sjk_currentUser'); } catch(e) {}
    currentUser = null;
    document.getElementById('displayCurrentUser').textContent = '未登录';
    document.getElementById('loginModal').classList.add('active');
    flightData = []; // 清空本地数据
}

function saveSettings() {
    if (!currentUser) return;
    const newUser = document.getElementById('newUsername').value.trim();
    const newPass = document.getElementById('newPassword').value.trim();
    if (!newUser && !newPass) { alert('请输入新的用户名或密码'); return; }
    
    let accounts = getAccounts();
    let idx = accounts.findIndex(a => a.id === currentUser.id);
    
    if (newUser && newUser !== currentUser.username) {
        if (accounts.some(a => a.username === newUser)) { alert('该用户名已被占用'); return; }
        accounts[idx].username = newUser;
        currentUser.username = newUser;
    }
    
    if (newPass) {
        accounts[idx].password = newPass;
        currentUser.password = newPass;
    }
    
    try {
        localStorage.setItem('sjk_accounts', JSON.stringify(accounts));
        sessionStorage.setItem('sjk_currentUser', JSON.stringify(currentUser));
    } catch(e) { alert('浏览器存储异常'); }
    
    document.getElementById('newUsername').value = '';
    document.getElementById('newPassword').value = '';
    closeModal('settingsModal');
    document.getElementById('displayCurrentUser').textContent = currentUser.username;
    alert('账号信息修改成功！');
}

// ================= 数据库 API 交互 =================
let flightData = [];

// 从云端加载数据
async function loadFlightData() {
    try {
        const res = await fetch(API_URL);
        if (res.ok) {
            flightData = await res.json();
            renderGallery();
        }
    } catch (e) {
        console.error("获取数据失败", e);
        alert("无法连接到云端数据库，请检查网络或 API 配置。");
    }
}

// 保存数据到云端
async function saveFlightData() {
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(flightData)
        });
        return res.ok;
    } catch (e) {
        alert('保存到云端数据库失败！');
        return false;
    }
}

// ================= 视图切换 =================
function switchView(mode) {
    currentViewMode = mode;
    document.getElementById('navTeam').classList.remove('active');
    document.getElementById('navMine').classList.remove('active');
    
    if (mode === 'team') {
        document.getElementById('navTeam').classList.add('active');
    } else {
        document.getElementById('navMine').classList.add('active');
    }
    renderGallery();
}

// ================= 渲染图库 =================
function renderGallery() {
    const gallery = document.getElementById('galleryGrid');
    if (!gallery) return;
    gallery.innerHTML = '';
    
    // 如果是“我的图库”，过滤出当前用户上传过的飞机
    let displayData = [...flightData];
    if (currentViewMode === 'mine' && currentUser) {
        displayData = flightData.filter(flight => 
            flight.photos.some(photo => photo.uploader === currentUser.username)
        );
    }

    if (displayData.length === 0) {
        gallery.innerHTML = `
            <div class="empty-state">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                <h2>${currentViewMode === 'mine' ? '你还没有拍过飞机哦' : '图库空空如也'}</h2>
                <p>${currentViewMode === 'mine' ? '快去“新增飞机”里上传你的第一张作品吧！' : '点击右下角的“新增飞机”按钮，开始添加第一架飞机吧！'}</p>
            </div>`;
        return;
    }
    
    const sortedData = [...displayData].reverse();
    sortedData.forEach(flight => {
        const coverPhoto = flight.photos[0];
        const photoCount = flight.photos.length;
        const card = document.createElement('div');
        card.className = 'card';
        card.onclick = () => openAlbum(flight);
        
        const liveryClass = flight.livery === '标准涂装' || !flight.livery ? 'standard' : 'special';
        
        card.innerHTML = `
            <div class="card-img-wrapper">
                <img src="${coverPhoto.url}" alt="${flight.model}">
                ${photoCount > 1 ? `<div class="photo-count">共 ${photoCount} 张</div>` : ''}
            </div>
            <div class="card-info">
                <div class="card-title-row">
                    <span class="aircraft-model">${flight.model}</span>
                    <span class="registration">${flight.reg}</span>
                </div>
                <span class="airline">${flight.airline}</span>
                <span class="livery-badge ${liveryClass}">${flight.livery || '标准涂装'}</span>
            </div>`;
        gallery.appendChild(card);
    });
}

// ================= 新增飞机/照片 =================
function openAddAircraft() {
    document.getElementById('addReg').value = '';
    document.getElementById('addModel').value = '';
    document.getElementById('addAirline').value = '';
    document.getElementById('addLivery').value = '';
    document.getElementById('addDate').value = ''; 
    document.getElementById('addImageUrl').value = '';
    document.getElementById('addFile').value = '';
    document.getElementById('uploadText').textContent = '点击选择本地图片';
    document.getElementById('imagePreview').style.display = 'none';
    document.getElementById('existingAircraftTip').style.display = 'none';
    document.getElementById('newAircraftFields').style.display = 'block';
    currentBase64Image = null;
    openModal('addAircraftModal');
}

function handleRegInput() {
    const reg = document.getElementById('addReg').value.trim().toUpperCase();
    const tip = document.getElementById('existingAircraftTip');
    const fields = document.getElementById('newAircraftFields');
    
    if (!reg) {
        tip.style.display = 'none';
        fields.style.display = 'block';
        return;
    }
    
    const found = flightData.find(f => f.reg.toUpperCase() === reg);
    
    if (found) {
        tip.innerHTML = `✅ 图库中已存在 <strong>${found.model}</strong> (${found.airline})，<br>您只需上传照片即可，无需重新填写信息。`;
        tip.style.display = 'block';
        fields.style.display = 'none';
    } else {
        tip.style.display = 'none';
        fields.style.display = 'block';
    }
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
        alert('图片太大了！建议小于20MB，或使用网络链接。');
        event.target.value = '';
        return;
    }
    const reader = new FileReader();
    reader.onload = function(e) {
        currentBase64Image = e.target.result;
        document.getElementById('uploadText').textContent = `已选择: ${file.name}`;
        const preview = document.getElementById('imagePreview');
        preview.src = currentBase64Image;
        preview.style.display = 'block';
        document.getElementById('addImageUrl').value = '';
    };
    reader.readAsDataURL(file);
}

function handleUrlInput() {
    const url = document.getElementById('addImageUrl').value.trim();
    if (url) {
        currentBase64Image = null;
        document.getElementById('addFile').value = '';
        document.getElementById('uploadText').textContent = '点击选择本地图片';
        const preview = document.getElementById('imagePreview');
        preview.src = url;
        preview.style.display = 'block';
    }
}

async function submitNewAircraft() {
    const reg = document.getElementById('addReg').value.trim().toUpperCase();
    if (!reg) { alert('请填写注册号！'); return; }
    
    const shootDate = document.getElementById('addDate').value;
    let imageUrl = '';
    const urlInput = document.getElementById('addImageUrl').value.trim();
    
    if (currentBase64Image) {
        const submitBtn = document.getElementById('submitBtn');
        submitBtn.textContent = '图片上传中...';
        submitBtn.disabled = true;

        try {
            const resBlob = await fetch(currentBase64Image);
            const blob = await resBlob.blob();
            
            const formData = new FormData();
            formData.append('file', blob, 'photo.jpg');

            const uploadRes = await fetch(`${IMGBED_BASE}/upload`, {
                method: 'POST',
                body: formData
            });

            if (!uploadRes.ok) throw new Error("上传失败");
            
            const result = await uploadRes.json();
            
            if (result && result[0] && result[0].src) {
                imageUrl = result[0].src;
                if (imageUrl.startsWith('/')) {
                    imageUrl = `${IMGBED_BASE}${imageUrl}`;
                }
            } else {
                throw new Error("无法解析图片地址");
            }

        } catch (error) {
            console.error(error);
            alert('图片上传失败！请检查 ImgBed 配置。');
            submitBtn.textContent = '确认提交';
            submitBtn.disabled = false;
            return;
        }
        
        submitBtn.textContent = '确认提交';
        submitBtn.disabled = false;

    } else if (urlInput) {
        imageUrl = urlInput;
    } else {
        alert('请上传照片或填写图片链接！'); return;
    }
    
    const existingAircraft = flightData.find(f => f.reg.toUpperCase() === reg);
    
    if (existingAircraft) {
        existingAircraft.photos.push({
            url: imageUrl,
            uploader: currentUser.username,
            date: shootDate
        });
        if (await saveFlightData()) {
            closeModal('addAircraftModal');
            loadFlightData(); 
            alert('📸 照片已追加到图集！');
        }
    } else {
        const model = document.getElementById('addModel').value.trim();
        const airline = document.getElementById('addAirline').value.trim();
        let livery = document.getElementById('addLivery').value.trim();
        
        if (!model || !airline) {
            alert('新飞机需要填写型号和航司！'); return;
        }
        if (!livery) livery = '标准涂装';
        
        const newFlight = {
            id: 'f' + Date.now(),
            model: model,
            reg: reg,
            airline: airline,
            livery: livery,
            photos: [{ url: imageUrl, uploader: currentUser.username, date: shootDate }]
        };
        
        flightData.push(newFlight);
        if (await saveFlightData()) {
            closeModal('addAircraftModal');
            loadFlightData(); 
            alert('✈️ 新增飞机成功！');
        } else {
            flightData.pop();
        }
    }
}

// ================= 相册与下载 =================
function openAlbum(flight) {
    currentAlbumFlight = flight; 
    
    document.getElementById('albumTitle').innerHTML = `
        <div style="font-size: 1.3rem; font-weight: bold; color: #333; margin-bottom: 8px;">
            ${flight.model} <span style="font-size: 1rem; color: #888; font-weight: normal;">(${flight.reg})</span>
        </div>
        <div style="font-size: 0.95rem; color: #555; line-height: 1.8;">
            <div><strong>注册号：</strong>${flight.reg}</div>
            <div><strong>型号：</strong>${flight.model}</div>
            <div><strong>航司：</strong>${flight.airline}</div>
            <div><strong>彩绘：</strong>${flight.livery || '标准涂装'}</div>
        </div>
    `;

    const content = document.getElementById('albumContent');
    content.innerHTML = '';
    
    const reversedPhotos = [...flight.photos].reverse();
    
    reversedPhotos.forEach((photo) => {
        const originalIndex = flight.photos.findIndex(p => p.url === photo.url);
        const div = document.createElement('div');
        div.className = 'album-photo';
        const dateText = photo.date ? `拍摄于: ${photo.date}` : '';
        
        div.innerHTML = `
            <img src="${photo.url}" alt="飞机照片">
            <div class="album-photo-info">
                <div>
                    <span class="uploader-tag">提供者: ${photo.uploader}</span>
                    ${dateText ? `<span class="date-tag" style="margin-left:8px;">${dateText}</span>` : ''}
                </div>
                <div class="album-photo-actions">
                    <span class="btn-download" onclick="downloadImage('${photo.url}', '${flight.reg}')">下载原图</span>
                    <span class="btn-delete-photo" onclick="deletePhoto('${flight.id}', ${originalIndex})">删除</span>
                </div>
            </div>`;
        content.appendChild(div);
    });
    openModal('albumModal');
}

function downloadImage(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${Date.now()}.jpg`;
    a.target = "_blank"; 
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// ================= 删除逻辑 =================
async function deleteAircraft(id) {
    if (!confirm('⚠️ 确定要删除这架飞机及其所有照片吗？此操作无法撤销！')) return;
    
    flightData = flightData.filter(f => f.id !== id);
    if (await saveFlightData()) {
        closeModal('albumModal');
        loadFlightData(); 
        alert('🗑️ 飞机已删除');
    }
}

async function deletePhoto(flightId, photoIndex) {
    if (!confirm('⚠️ 确定要删除这张照片吗？')) return;
    
    const flight = flightData.find(f => f.id === flightId);
    if (!flight) return;
    
    flight.photos.splice(photoIndex, 1);
    
    if (flight.photos.length === 0) {
        alert('该飞机已没有任何照片，将自动删除飞机档案。');
        deleteAircraft(flightId);
        return;
    }
    
    if (await saveFlightData()) {
        loadFlightData();
        openAlbum(flight);
    }
}

// ================= 编辑逻辑 =================
function openEditAircraft(id) {
    const flight = flightData.find(f => f.id === id);
    if (!flight) return;
    
    currentEditingFlightId = id;
    document.getElementById('editReg').value = flight.reg;
    document.getElementById('editModel').value = flight.model;
    document.getElementById('editAirline').value = flight.airline;
    document.getElementById('editLivery').value = flight.livery === '标准涂装' ? '' : flight.livery;
    
    closeModal('albumModal');
    openModal('editAircraftModal');
}

async function saveAircraftEdits() {
    const reg = document.getElementById('editReg').value.trim().toUpperCase();
    const model = document.getElementById('editModel').value.trim();
    const airline = document.getElementById('editAirline').value.trim();
    let livery = document.getElementById('editLivery').value.trim();
    
    if (!reg || !model || !airline) {
        alert('注册号、型号和航司不能为空！');
        return;
    }
    if (!livery) livery = '标准涂装';
    
    const duplicate = flightData.find(f => f.reg.toUpperCase() === reg && f.id !== currentEditingFlightId);
    if (duplicate) {
        alert('该注册号已被其他飞机使用，请检查是否填错！');
        return;
    }
    
    const flightIndex = flightData.findIndex(f => f.id === currentEditingFlightId);
    if (flightIndex === -1) return;
    
    flightData[flightIndex].reg = reg;
    flightData[flightIndex].model = model;
    flightData[flightIndex].airline = airline;
    flightData[flightIndex].livery = livery;
    
    if (await saveFlightData()) {
        closeModal('editAircraftModal');
        loadFlightData(); 
        openAlbum(flightData[flightIndex]);
        alert('✅ 飞机信息修改成功！');
    }
}

// ================= 搜索防抖 =================
document.getElementById('searchInput').addEventListener('input', debounce(function(e) {
    const term = e.target.value.toLowerCase().trim();
    const cards = document.querySelectorAll('.card');
    cards.forEach(card => {
        const text = card.textContent.toLowerCase();
        card.style.display = text.includes(term) ? 'flex' : 'none';
    });
}, 300));

// ================= 弹窗与辅助 =================
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
        if (e.target === this && this.id !== 'loginModal') {
            this.classList.remove('active');
        }
    });
});

window.onload = checkLogin;
