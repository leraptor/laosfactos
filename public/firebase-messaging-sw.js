importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyDDF8mcFnT1Q-PMsMQmQ8UAUlcLhp2PLf0",
    authDomain: "laosfactos-product.firebaseapp.com",
    projectId: "laosfactos-product",
    storageBucket: "laosfactos-product.firebasestorage.app",
    messagingSenderId: "893917054082",
    appId: "1:893917054082:web:114366b918bf6e2479e09b"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    // NOTE: FCM SDK automatically displays notifications when `notification` field is present.
    // Only use this handler for data-only messages or custom processing.
    // DO NOT call showNotification here for standard notifications - it causes duplicates!
});
