import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { getDatabase, ref, set, onValue, push, serverTimestamp, onDisconnect, update, off } from "firebase/database";
import firebaseConfig from "./firebase-config.js";

// --- Initialization ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// --- Constants ---
const IMGBB_API_KEY = "YOUR_IMGBB_API_KEY_HERE";
const AVATAR_GRADIENTS = [
    'linear-gradient(135deg, #bb86fc 0%, #6200ee 100%)',
    'linear-gradient(135deg, #03dac6 0%, #018786 100%)',
    'linear-gradient(135deg, #cf6679 0%, #b00020 100%)',
    'linear-gradient(135deg, #ffb74d 0%, #f57c00 100%)',
    'linear-gradient(135deg, #4fc3f7 0%, #0288d1 100%)',
    'linear-gradient(135deg, #81c784 0%, #388e3c 100%)'
];

// --- State Management ---
let currentUser = null;
let activeChatUserId = null;
let users = {};
let messageListener = null;

// --- DOM Cache ---
const elements = {
    authContainer: document.getElementById('auth-container'),
    appContainer: document.getElementById('app-container'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    showRegister: document.getElementById('show-register'),
    showLogin: document.getElementById('show-login'),
    userList: document.getElementById('user-list'),
    messagesContainer: document.getElementById('messages-container'),
    messageForm: document.getElementById('message-form'),
    messageInput: document.getElementById('message-input'),
    chatFooter: document.getElementById('chat-footer'),
    chatUsername: document.getElementById('chat-username'),
    chatStatus: document.getElementById('chat-status'),
    activeUserInfo: document.getElementById('active-user-info'),
    themeToggle: document.getElementById('theme-toggle'),
    logoutBtn: document.getElementById('logout-btn'),
    openProfile: document.getElementById('open-profile'),
    profileModal: document.getElementById('profile-modal'),
    closeProfile: document.getElementById('close-profile'),
    profileBio: document.getElementById('profile-bio'),
    saveProfile: document.getElementById('save-profile'),
    typingIndicator: document.getElementById('typing-indicator'),
    mobileMenuBtn: document.getElementById('mobile-menu-btn'),
    mobileCloseSidebar: document.getElementById('mobile-close-sidebar'),
    sidebar: document.getElementById('sidebar'),
    myAvatarContainer: document.getElementById('my-avatar-container'),
    chatAvatarContainer: document.getElementById('chat-avatar-container'),
    profilePreviewContainer: document.getElementById('profile-preview-container')
};

// --- Avatar System ---
function getAvatarHTML(user, isLarge = false) {
    const className = isLarge ? 'avatar-large' : 'avatar';
    if (user.avatar && user.avatar.startsWith('http')) {
        return `<img src="${user.avatar}" class="${className}" onerror="this.outerHTML='${getLetterAvatar(user.username, className)}'">`;
    }
    return getLetterAvatar(user.username, className);
}

function getLetterAvatar(username, className) {
    const firstLetter = username ? username.charAt(0).toUpperCase() : '?';
    const charCode = firstLetter.charCodeAt(0);
    const gradient = AVATAR_GRADIENTS[charCode % AVATAR_GRADIENTS.length];
    return `<div class="${className}" style="background: ${gradient}">${firstLetter}</div>`;
}

// --- UI Updates ---
function toggleLoading(isLoading) {
    // Bu fonksiyon "Loading" krizini yönetir
    if (isLoading) {
        // Gerekirse bir spinner eklenebilir
    } else {
        elements.authContainer.classList.add('hidden');
        elements.appContainer.classList.remove('hidden');
    }
}

// --- Auth Core ---
elements.showRegister.onclick = (e) => { e.preventDefault(); elements.loginForm.classList.add('hidden'); elements.registerForm.classList.remove('hidden'); };
elements.showLogin.onclick = (e) => { e.preventDefault(); elements.registerForm.classList.add('hidden'); elements.loginForm.classList.remove('hidden'); };

elements.registerForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const pass = document.getElementById('register-password').value;
    const email = `${username.toLowerCase()}@chatplus.com`;

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
        await set(ref(db, 'users/' + userCredential.user.uid), {
            uid: userCredential.user.uid,
            username: username,
            avatar: "",
            bio: "Hey there! I am using ChatPlus.",
            lastSeen: serverTimestamp(),
            online: false
        });
        alert("Kayıt başarılı! Giriş yapabilirsiniz.");
        await signOut(auth);
        elements.registerForm.reset();
        elements.showLogin.click();
    } catch (error) {
        alert("Kayıt Hatası: " + error.message);
    }
};

elements.loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const pass = document.getElementById('login-password').value;
    const email = `${username.toLowerCase()}@chatplus.com`;

    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (error) {
        alert("Giriş Hatası: " + error.message);
    }
};

elements.logoutBtn.onclick = async () => {
    if (currentUser) {
        await update(ref(db, 'users/' + currentUser.uid), { online: false, lastSeen: serverTimestamp() });
        await signOut(auth);
        window.location.reload(); // Temiz bir çıkış için
    }
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        toggleLoading(false);
        initializeAppData();
    } else {
        currentUser = null;
        elements.authContainer.classList.remove('hidden');
        elements.appContainer.classList.add('hidden');
    }
});

// --- Data Core ---
function initializeAppData() {
    setupUserPresence();
    listenToUsers();
    loadMyProfile();
}

function setupUserPresence() {
    const userStatusRef = ref(db, 'users/' + currentUser.uid);
    const connectedRef = ref(db, '.info/connected');
    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            update(userStatusRef, { online: true });
            onDisconnect(userStatusRef).update({ online: false, lastSeen: serverTimestamp() });
        }
    });
}

function listenToUsers() {
    onValue(ref(db, 'users'), (snapshot) => {
        users = snapshot.val() || {};
        renderUserList();
        if (activeChatUserId && users[activeChatUserId]) {
            updateChatHeader(users[activeChatUserId]);
        }
    });
}

function renderUserList() {
    elements.userList.innerHTML = '';
    Object.values(users).forEach(user => {
        if (user.uid === currentUser.uid) return;
        const div = document.createElement('div');
        div.className = `user-item ${activeChatUserId === user.uid ? 'active' : ''}`;
        div.innerHTML = `
            ${getAvatarHTML(user)}
            <div class="user-info">
                <h4>${user.username}</h4>
                <span class="status-text">${user.online ? 'Çevrimiçi' : 'Son görülme: ' + formatTime(user.lastSeen)}</span>
            </div>
            <span class="status-dot ${user.online ? 'online' : 'offline'}"></span>
        `;
        div.onclick = () => selectUser(user);
        elements.userList.appendChild(div);
    });
}

function selectUser(user) {
    activeChatUserId = user.uid;
    elements.activeUserInfo.classList.remove('hidden');
    elements.chatFooter.classList.remove('hidden');
    updateChatHeader(user);
    elements.sidebar.classList.remove('open');
    renderUserList();
    loadMessages();
    listenTyping();
}

function updateChatHeader(user) {
    elements.chatUsername.innerText = user.username;
    elements.chatAvatarContainer.innerHTML = getAvatarHTML(user);
    elements.chatStatus.innerText = user.online ? 'Çevrimiçi' : 'Son görülme: ' + formatTime(user.lastSeen);
}

// --- Real-time Messaging ---
function loadMessages() {
    if (messageListener) off(messageListener);
    const chatId = [currentUser.uid, activeChatUserId].sort().join('_');
    messageListener = ref(db, 'chats/' + chatId + '/messages');
    
    onValue(messageListener, (snapshot) => {
        elements.messagesContainer.innerHTML = '';
        const data = snapshot.val();
        if (data) {
            Object.entries(data).forEach(([key, msg]) => {
                const isMine = msg.senderId === currentUser.uid;
                const div = document.createElement('div');
                div.className = `message ${isMine ? 'sent' : 'received'}`;
                if (!isMine && !msg.read) update(ref(db, `chats/${chatId}/messages/${key}`), { read: true });
                div.innerHTML = `
                    <div class="message-text">${msg.text}</div>
                    <div class="message-info">
                        ${formatTime(msg.timestamp)}
                        ${isMine ? `<i class="fas fa-check-double ${msg.read ? 'tick-read' : ''}"></i>` : ''}
                    </div>
                `;
                elements.messagesContainer.appendChild(div);
            });
            elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
        } else {
            elements.messagesContainer.innerHTML = '<div class="welcome-screen"><i class="fas fa-comments"></i><p>Sohbeti başlatın!</p></div>';
        }
    });
}

elements.messageForm.onsubmit = (e) => {
    e.preventDefault();
    const text = elements.messageInput.value.trim();
    if (!text || !activeChatUserId) return;
    const chatId = [currentUser.uid, activeChatUserId].sort().join('_');
    push(ref(db, 'chats/' + chatId + '/messages'), {
        senderId: currentUser.uid,
        text: text,
        timestamp: serverTimestamp(),
        read: false
    });
    elements.messageInput.value = '';
    stopTyping();
};

// --- Typing Indicator ---
let typingTimeout;
elements.messageInput.oninput = () => {
    if (!activeChatUserId) return;
    const chatId = [currentUser.uid, activeChatUserId].sort().join('_');
    set(ref(db, `typing/${chatId}/${currentUser.uid}`), true);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(stopTyping, 3000);
};

function stopTyping() {
    if (!activeChatUserId) return;
    const chatId = [currentUser.uid, activeChatUserId].sort().join('_');
    set(ref(db, `typing/${chatId}/${currentUser.uid}`), false);
}

function listenTyping() {
    const chatId = [currentUser.uid, activeChatUserId].sort().join('_');
    onValue(ref(db, `typing/${chatId}/${activeChatUserId}`), (snapshot) => {
        if (snapshot.val() === true) {
            elements.typingIndicator.classList.remove('hidden');
            elements.typingIndicator.querySelector('#typing-text').innerText = `${users[activeChatUserId].username} yazıyor...`;
        } else {
            elements.typingIndicator.classList.add('hidden');
        }
    });
}

// --- Profile Management ---
function loadMyProfile() {
    onValue(ref(db, 'users/' + currentUser.uid), (snapshot) => {
        const data = snapshot.val();
        if (data) {
            document.getElementById('my-username').innerText = data.username;
            elements.myAvatarContainer.innerHTML = getAvatarHTML(data);
            updateProfilePreview(data);
            elements.profileBio.value = data.bio || "";
        }
    });
}

function updateProfilePreview(user) {
    elements.profilePreviewContainer.innerHTML = getAvatarHTML(user, true);
    const label = document.createElement('label');
    label.htmlFor = 'avatar-upload';
    label.className = 'upload-btn';
    label.innerHTML = '<i class="fas fa-camera"></i><input type="file" id="avatar-upload" accept="image/*" hidden>';
    elements.profilePreviewContainer.appendChild(label);
    document.getElementById('avatar-upload').onchange = handleAvatarUpload;
}

async function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('image', file);
    try {
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: 'POST', body: formData });
        const data = await res.json();
        if (data.success) {
            await update(ref(db, 'users/' + currentUser.uid), { avatar: data.data.url });
            alert("Profil resmi güncellendi!");
        }
    } catch (error) {
        alert("Yükleme Hatası!");
    }
}

elements.openProfile.onclick = () => elements.profileModal.classList.remove('hidden');
elements.closeProfile.onclick = () => elements.profileModal.classList.add('hidden');
elements.saveProfile.onclick = async () => {
    await update(ref(db, 'users/' + currentUser.uid), { bio: elements.profileBio.value });
    elements.profileModal.classList.add('hidden');
    alert("Profil güncellendi!");
};

// --- Theme & Utils ---
elements.themeToggle.onclick = () => {
    const isDark = document.body.classList.toggle('dark-mode');
    document.body.classList.toggle('light-mode', !isDark);
    elements.themeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
};

if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-mode');
    document.body.classList.remove('dark-mode');
    elements.themeToggle.innerHTML = '<i class="fas fa-moon"></i>';
} else {
    document.body.classList.add('dark-mode');
    elements.themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
}

function formatTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const now = new Date();
    return date.toDateString() === now.toDateString() 
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

elements.mobileMenuBtn.onclick = () => elements.sidebar.classList.add('open');
elements.mobileCloseSidebar.onclick = () => elements.sidebar.classList.remove('open');
