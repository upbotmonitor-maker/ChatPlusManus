import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { getDatabase, ref, set, onValue, push, serverTimestamp, onDisconnect, update } from "firebase/database";
import firebaseConfig from "./firebase-config.js";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Constants
const IMGBB_API_KEY = "YOUR_IMGBB_API_KEY_HERE"; // Placeholder
const DEFAULT_AVATAR = "https://via.placeholder.com/150";

// State
let currentUser = null;
let activeChatUserId = null;
let users = {};

// DOM Elements
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const showRegister = document.getElementById('show-register');
const showLogin = document.getElementById('show-login');
const userList = document.getElementById('user-list');
const messagesContainer = document.getElementById('messages-container');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const chatFooter = document.getElementById('chat-footer');
const chatUsername = document.getElementById('chat-username');
const chatStatus = document.getElementById('chat-status');
const chatAvatar = document.getElementById('chat-avatar');
const activeUserInfo = document.getElementById('active-user-info');
const themeToggle = document.getElementById('theme-toggle');
const logoutBtn = document.getElementById('logout-btn');
const openProfile = document.getElementById('open-profile');
const profileModal = document.getElementById('profile-modal');
const closeProfile = document.getElementById('close-profile');
const profilePreview = document.getElementById('profile-preview');
const avatarUpload = document.getElementById('avatar-upload');
const profileBio = document.getElementById('profile-bio');
const saveProfile = document.getElementById('save-profile');
const typingIndicator = document.getElementById('typing-indicator');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileCloseSidebar = document.getElementById('mobile-close-sidebar');
const sidebar = document.getElementById('sidebar');

// --- Auth Logic ---

showRegister.onclick = (e) => { e.preventDefault(); loginForm.classList.add('hidden'); registerForm.classList.remove('hidden'); };
showLogin.onclick = (e) => { e.preventDefault(); registerForm.classList.add('hidden'); loginForm.classList.remove('hidden'); };

registerForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const pass = document.getElementById('register-password').value;
    const email = `${username}@chatplus.com`;

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, pass);
        const user = userCredential.user;
        
        await set(ref(db, 'users/' + user.uid), {
            uid: user.uid,
            username: username,
            avatar: DEFAULT_AVATAR,
            bio: "Hey there! I am using ChatPlus.",
            lastSeen: serverTimestamp(),
            online: false
        });

        alert("Kayıt başarılı! Şimdi giriş yapabilirsiniz.");
        await signOut(auth);
        registerForm.reset();
        showLogin.click();
    } catch (error) {
        alert("Hata: " + error.message);
    }
};

loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const pass = document.getElementById('login-password').value;
    const email = `${username}@chatplus.com`;

    try {
        await signInWithEmailAndPassword(auth, email, pass);
        loginForm.reset();
    } catch (error) {
        alert("Hata: " + error.message);
    }
};

logoutBtn.onclick = () => {
    if (currentUser) {
        update(ref(db, 'users/' + currentUser.uid), { online: false, lastSeen: serverTimestamp() });
        signOut(auth);
    }
};

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        authContainer.classList.add('hidden');
        appContainer.classList.remove('hidden');
        setupUserPresence();
        loadUserList();
        loadMyProfile();
    } else {
        currentUser = null;
        authContainer.classList.remove('hidden');
        appContainer.classList.add('hidden');
    }
});

// --- Presence & User List ---

function setupUserPresence() {
    const userStatusRef = ref(db, 'users/' + currentUser.uid);
    update(userStatusRef, { online: true });
    onDisconnect(userStatusRef).update({ online: false, lastSeen: serverTimestamp() });
}

function loadUserList() {
    onValue(ref(db, 'users'), (snapshot) => {
        userList.innerHTML = '';
        users = snapshot.val() || {};
        
        Object.values(users).forEach(user => {
            if (user.uid === currentUser.uid) return;

            const div = document.createElement('div');
            div.className = `user-item ${activeChatUserId === user.uid ? 'active' : ''}`;
            div.innerHTML = `
                <img src="${user.avatar || DEFAULT_AVATAR}" class="avatar">
                <div class="user-info">
                    <h4>${user.username}</h4>
                    <span class="status-text">${user.online ? 'Çevrimiçi' : 'Son görülme: ' + formatTime(user.lastSeen)}</span>
                </div>
                <span class="status-dot ${user.online ? 'online' : 'offline'}"></span>
            `;
            div.onclick = () => selectUser(user);
            userList.appendChild(div);
        });
    });
}

function selectUser(user) {
    activeChatUserId = user.uid;
    activeUserInfo.classList.remove('hidden');
    chatFooter.classList.remove('hidden');
    chatUsername.innerText = user.username;
    chatAvatar.src = user.avatar || DEFAULT_AVATAR;
    chatStatus.innerText = user.online ? 'Çevrimiçi' : 'Son görülme: ' + formatTime(user.lastSeen);
    
    // Mobile: Close sidebar after selection
    sidebar.classList.remove('open');
    
    loadMessages();
    listenTyping();
}

// --- Messaging Logic ---

function loadMessages() {
    const chatId = [currentUser.uid, activeChatUserId].sort().join('_');
    const messagesRef = ref(db, 'chats/' + chatId + '/messages');
    
    onValue(messagesRef, (snapshot) => {
        messagesContainer.innerHTML = '';
        const data = snapshot.val();
        if (data) {
            Object.entries(data).forEach(([key, msg]) => {
                const isMine = msg.senderId === currentUser.uid;
                const div = document.createElement('div');
                div.className = `message ${isMine ? 'sent' : 'received'}`;
                
                // Mark as read if received
                if (!isMine && !msg.read) {
                    update(ref(db, `chats/${chatId}/messages/${key}`), { read: true });
                }

                div.innerHTML = `
                    <div class="message-text">${msg.text}</div>
                    <div class="message-info">
                        ${formatTime(msg.timestamp)}
                        ${isMine ? `<i class="fas fa-check-double ${msg.read ? 'tick-read' : ''}"></i>` : ''}
                    </div>
                `;
                messagesContainer.appendChild(div);
            });
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } else {
            messagesContainer.innerHTML = '<div class="welcome-screen"><p>Henüz mesaj yok. İlk mesajı sen gönder!</p></div>';
        }
    });
}

messageForm.onsubmit = (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !activeChatUserId) return;

    const chatId = [currentUser.uid, activeChatUserId].sort().join('_');
    const messagesRef = ref(db, 'chats/' + chatId + '/messages');
    
    push(messagesRef, {
        senderId: currentUser.uid,
        text: text,
        timestamp: serverTimestamp(),
        read: false
    });

    messageInput.value = '';
    stopTyping();
};

// --- Typing Indicator ---

let typingTimeout;
messageInput.oninput = () => {
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
            typingIndicator.classList.remove('hidden');
            typingIndicator.querySelector('#typing-text').innerText = `${users[activeChatUserId].username} yazıyor...`;
        } else {
            typingIndicator.classList.add('hidden');
        }
    });
}

// --- Profile & ImgBB ---

function loadMyProfile() {
    onValue(ref(db, 'users/' + currentUser.uid), (snapshot) => {
        const data = snapshot.val();
        if (data) {
            document.getElementById('my-username').innerText = data.username;
            document.getElementById('my-avatar').src = data.avatar || DEFAULT_AVATAR;
            profilePreview.src = data.avatar || DEFAULT_AVATAR;
            profileBio.value = data.bio || "";
        }
    });
}

openProfile.onclick = () => profileModal.classList.remove('hidden');
closeProfile.onclick = () => profileModal.classList.add('hidden');

avatarUpload.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);

    try {
        const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            profilePreview.src = data.data.url;
        }
    } catch (error) {
        alert("Resim yükleme hatası!");
    }
};

saveProfile.onclick = async () => {
    await update(ref(db, 'users/' + currentUser.uid), {
        avatar: profilePreview.src,
        bio: profileBio.value
    });
    profileModal.classList.add('hidden');
    alert("Profil güncellendi!");
};

// --- Theme & Utils ---

themeToggle.onclick = () => {
    const isDark = document.body.classList.toggle('dark-mode');
    document.body.classList.toggle('light-mode', !isDark);
    themeToggle.innerHTML = isDark ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
};

// Load saved theme
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    document.body.classList.remove('light-mode');
    themeToggle.innerHTML = '<i class="fas fa-sun"></i>';
}

function formatTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Mobile Handlers
mobileMenuBtn.onclick = () => sidebar.classList.add('open');
mobileCloseSidebar.onclick = () => sidebar.classList.remove('open');
