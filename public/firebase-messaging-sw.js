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
    const notificationTitle = payload.notification.title;
    const notificationOptions = {
        body: payload.notification.body,
        icon: '/vite.svg', // Customize as needed
        badge: '/vite.svg'
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});
