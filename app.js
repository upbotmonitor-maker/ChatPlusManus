import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { getDatabase, ref, set, onValue, push, serverTimestamp, onDisconnect, update, off } from "firebase/database";
import firebaseConfig from "./firebase-config.js";

// --- Initialize ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// --- Config & State ---
const AVATAR_GRADIENTS = [
    'linear-gradient(135deg, #bf40bf 0%, #5d26c1 100%)',
    'linear-gradient(135deg, #00d2ff 0%, #3a7bd5 100%)',
    'linear-gradient(135deg, #f2709c 0%, #ff9472 100%)',
    'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)',
    'linear-gradient(135deg, #FC466B 0%, #3F5EFB 100%)'
];

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
    userSkeleton: document.getElementById('user-skeleton'),
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
    sidebar: document.getElementById('sidebar'),
    myAvatarContainer: document.getElementById('my-avatar-container'),
    chatAvatarContainer: document.getElementById('chat-avatar-container'),
    profilePreviewContainer: document.getElementById('profile-preview-container')
};

// --- Avatar Helper ---
function getAvatarHTML(user, isLarge = false) {
    const className = isLarge ? 'avatar-large' : 'avatar';
    if (user.avatar && user.avatar.startsWith('http')) {
        return `<img src="${user.avatar}" class="${className}" onerror="this.outerHTML='${getLetterAvatar(user.username, className)}'">`;
    }
    return getLetterAvatar(user.username, className);
}

function getLetterAvatar(username, className) {
    const letter = username ? username.charAt(0).toUpperCase() : '?';
    const gradient = AVATAR_GRADIENTS[letter.charCodeAt(0) % AVATAR_GRADIENTS.length];
    return `<div class="${className}" style="background: ${gradient}">${letter}</div>`;
}

// --- Auth Handlers ---
elements.showRegister.onclick = (e) => { e.preventDefault(); elements.loginForm.classList.add('hidden'); elements.registerForm.classList.remove('hidden'); };
elements.showLogin.onclick = (e) => { e.preventDefault(); elements.registerForm.classList.add('hidden'); elements.loginForm.classList.remove('hidden'); };

elements.registerForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const pass = document.getElementById('register-password').value;
    const email = `${username.toLowerCase()}@chatplus.com`;

    try {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await set(ref(db, 'users/' + cred.user.uid), {
            uid: cred.user.uid,
            username: username,
            avatar: "",
            bio: "Hey! I'm using ChatPlus Midnight.",
            lastSeen: serverTimestamp(),
            online: false
        });
        alert("Kayıt başarılı! Giriş yapabilirsiniz.");
        await signOut(auth);
        elements.registerForm.reset();
        elements.showLogin.click();
    } catch (err) {
        console.error("Register Error:", err);
        alert("Hata: " + err.message);
    }
};

elements.loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const pass = document.getElementById('login-password').value;
    const email = `${username.toLowerCase()}@chatplus.com`;

    try {
        await signInWithEmailAndPassword(auth, email, pass);
    } catch (err) {
        console.error("Login Error:", err);
        alert("Giriş başarısız: " + err.message);
    }
};

elements.logoutBtn.onclick = async () => {
    if (currentUser) {
        await update(ref(db, 'users/' + currentUser.uid), { online: false, lastSeen: serverTimestamp() });
        await signOut(auth);
        window.location.reload();
    }
};

// --- App Core ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        elements.authContainer.classList.add('hidden');
        elements.appContainer.classList.remove('hidden');
        startApp();
    } else {
        currentUser = null;
        elements.authContainer.classList.remove('hidden');
        elements.appContainer.classList.add('hidden');
    }
});

function startApp() {
    setupPresence();
    listenUsers();
    loadMyProfile();
}

function setupPresence() {
    const statusRef = ref(db, 'users/' + currentUser.uid);
    const connectedRef = ref(db, '.info/connected');
    onValue(connectedRef, (snap) => {
        if (snap.val() === true) {
            update(statusRef, { online: true });
            onDisconnect(statusRef).update({ online: false, lastSeen: serverTimestamp() });
        }
    });
}

function listenUsers() {
    onValue(ref(db, 'users'), (snap) => {
        users = snap.val() || {};
        elements.userSkeleton.classList.add('hidden');
        elements.userList.classList.remove('hidden');
        renderUsers();
        if (activeChatUserId && users[activeChatUserId]) updateChatHeader(users[activeChatUserId]);
    });
}

function renderUsers() {
    elements.userList.innerHTML = '';
    Object.values(users).forEach(u => {
        if (u.uid === currentUser.uid) return;
        const div = document.createElement('div');
        div.className = `user-item ${activeChatUserId === u.uid ? 'active' : ''}`;
        div.innerHTML = `
            ${getAvatarHTML(u)}
            <div style="flex:1">
                <div style="font-weight:600">${u.username}</div>
                <div class="status-text">${u.online ? 'Çevrimiçi' : 'Son görülme: ' + formatTime(u.lastSeen)}</div>
            </div>
            <div class="status-dot ${u.online ? 'online' : 'offline'}"></div>
        `;
        div.onclick = () => selectUser(u);
        elements.userList.appendChild(div);
    });
}

function selectUser(u) {
    activeChatUserId = u.uid;
    elements.activeUserInfo.classList.remove('hidden');
    elements.chatFooter.classList.remove('hidden');
    updateChatHeader(u);
    elements.sidebar.classList.remove('open');
    renderUsers();
    loadMessages();
}

function updateChatHeader(u) {
    elements.chatUsername.innerText = u.username;
    elements.chatAvatarContainer.innerHTML = getAvatarHTML(u);
    elements.chatStatus.innerText = u.online ? 'Çevrimiçi' : 'Son görülme: ' + formatTime(u.lastSeen);
}

// --- Messaging ---
function loadMessages() {
    if (messageListener) off(messageListener);
    const chatId = [currentUser.uid, activeChatUserId].sort().join('_');
    messageListener = ref(db, 'chats/' + chatId + '/messages');
    
    onValue(messageListener, (snap) => {
        elements.messagesContainer.innerHTML = '';
        const data = snap.val();
        if (data) {
            Object.entries(data).forEach(([key, m]) => {
                const isMine = m.senderId === currentUser.uid;
                const div = document.createElement('div');
                div.className = `message ${isMine ? 'sent' : 'received'}`;
                if (!isMine && !m.read) update(ref(db, `chats/${chatId}/messages/${key}`), { read: true });
                div.innerHTML = `
                    <div>${m.text}</div>
                    <div style="font-size:0.7rem; opacity:0.7; text-align:right; margin-top:4px">
                        ${formatTime(m.timestamp)} ${isMine ? (m.read ? '✓✓' : '✓') : ''}
                    </div>
                `;
                elements.messagesContainer.appendChild(div);
            });
            elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
        } else {
            elements.messagesContainer.innerHTML = '<div class="welcome-screen"><p>Mesajlaşmaya başlayın!</p></div>';
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
        text,
        timestamp: serverTimestamp(),
        read: false
    });
    elements.messageInput.value = '';
};

// --- Profile ---
function loadMyProfile() {
    onValue(ref(db, 'users/' + currentUser.uid), (snap) => {
        const d = snap.val();
        if (d) {
            document.getElementById('my-username').innerText = d.username;
            elements.myAvatarContainer.innerHTML = getAvatarHTML(d);
            elements.profilePreviewContainer.innerHTML = getAvatarHTML(d, true);
            elements.profileBio.value = d.bio || "";
        }
    });
}

elements.openProfile.onclick = () => elements.profileModal.classList.remove('hidden');
elements.closeProfile.onclick = () => elements.profileModal.classList.add('hidden');
elements.saveProfile.onclick = async () => {
    await update(ref(db, 'users/' + currentUser.uid), { bio: elements.profileBio.value });
    elements.profileModal.classList.add('hidden');
};

// --- Utils ---
function formatTime(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

elements.mobileMenuBtn.onclick = () => elements.sidebar.classList.add('open');
