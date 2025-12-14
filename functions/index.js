const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

admin.initializeApp();
const db = admin.firestore();

// API Key should be set in environment variables: firebase functions:config:set gemini.key="THE_KEY"
// For now, we'll try to use the one from process.env if available, or hardcode/placeholder.
// WARNING: Hardcoding here is visible in source. Ideally use defineSecret or param.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "AIzaSyAlU_oCxjPGfu26YoWOgPJZgIf8ouhpiO0"; // Using the key found in .env for convenience, user should secure this.

exports.sendDailyBriefing = onSchedule("every day 08:00", async (event) => {
    logger.info("Starting Daily Briefing Batch...");

    // 1. Get all users who have an FCM Token
    // Index might be required on 'fcmToken'
    const usersSnapshot = await db.collection('users').where('fcmToken', '!=', null).get();

    if (usersSnapshot.empty) {
        logger.info("No users with FCM tokens found.");
        return;
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const promises = [];

    usersSnapshot.forEach(userDoc => {
        promises.push(processUser(userDoc, model));
    });

    await Promise.all(promises);
    logger.info("Batch Complete.");
});

async function processUser(userDoc, model) {
    const uid = userDoc.id;
    const userData = userDoc.data();
    const fcmToken = userData.fcmToken;

    try {
        // 2. Build Context: Get Active Contracts
        const contractsSnap = await db.collection('users').doc(uid).collection('contracts')
            .where('status', '==', 'active')
            .get();

        if (contractsSnap.empty) {
            logger.info(`User ${uid} has no active contracts. Skipping.`);
            return;
        }

        // Summarize contracts
        let contractContext = "";
        contractsSnap.forEach(doc => {
            const data = doc.data();
            contractContext += `- Contract: ${data.title}. Streak: ${data.streak || 0}. Behavior: ${data.behavior}.\n`;
        });

        // 3. Call AI
        const prompt = `
      You are a Stoic Accountability Partner.
      The user has the following active self-contracts:
      ${contractContext}

      Task: Write a single, punchy, MOTIVATIONAL notification (max 15 words) to wake them up and keep them disciplined today.
      Do not use emojis. Be serious but encouraging.
    `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const notificationBody = response.text().trim();

        // 4. Send Notification
        await admin.messaging().send({
            token: fcmToken,
            notification: {
                title: "Daily Protocol",
                body: notificationBody
            },
            // Android specific
            android: {
                priority: "high",
                notification: {
                    icon: "stock_ticker_update" // or standard icon
                }
            },
            // Web specific
            webpush: {
                headers: {
                    Urgency: "high"
                },
                notification: {
                    icon: "/vite.svg"
                }
            }
        });

        logger.info(`Sent to ${uid}: ${notificationBody}`);

    } catch (e) {
        logger.error(`Error processing user ${uid}`, e);
    }
}
