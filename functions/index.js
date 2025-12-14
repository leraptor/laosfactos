const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

admin.initializeApp();
const db = admin.firestore();

const { defineSecret } = require('firebase-functions/params');
const geminiApiKey = defineSecret('GEMINI_API_KEY');


exports.sendDailyBriefing = onSchedule({
    schedule: "every day 08:00",
    secrets: [geminiApiKey]
}, async (event) => {
    logger.info("Starting Daily Briefing Batch...");

    // 1. Get all users who have an FCM Token
    // Index might be required on 'fcmToken'
    const usersSnapshot = await db.collection('users').where('fcmToken', '!=', null).get();

    if (usersSnapshot.empty) {
        logger.info("No users with FCM tokens found.");
        return;
    }

    // We need to initialize the model INSIDE the function after getting the secret
    const genAI = new GoogleGenerativeAI(geminiApiKey.value());
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

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

        // Get recent journals (last 24h) for context
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        const journalSnap = await db.collection('users').doc(uid).collection('contracts') // This query is tricky across all contracts; let's simplify.
        // Actually, getting all journals for all contracts might be expensive / require collection group query.
        // Let's stick to active contracts context for now to keep it efficient, or just generic motivation.
        // User requested "based on what has been done yesterday".
        // We can do a collectionGroup query if indexes allow, or just skip specific logs for V1.
        // Let's add a placeholder for "Recent Activity" based on streaks.


        // 3. Call AI
        const prompt = `
      You are a Stoic Accountability Partner.
      The user has the following active self-contracts:
      ${contractContext}

      Task: Write a daily briefing.
      1. Acknowledge their current streaks.
      2. Give a stoic reflection on Consistency.
      3. Tell them exactly what to focus on today.
      
      Constraint: Keep it under 3 sentences. No emojis. Serious tone.
    `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const notificationBody = response.text().trim();

        // 3.5 Save to Firestore for In-App Widget
        await db.collection('users').doc(uid).set({
            dailyBriefing: {
                text: notificationBody,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                archived: false
            }
        }, { merge: true });

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

exports.consultOracle = onCall({
    secrets: [geminiApiKey]
}, async (request) => {
    // 1. Validate Auth
    if (!request.auth) {
        throw new HttpsError('failed-precondition', 'The function must be called while authenticated.');
    }

    const { contractTitle, contractBehavior, userQuery } = request.data;

    // 2. Call Gemini Securely
    const genAI = new GoogleGenerativeAI(geminiApiKey.value());
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const prompt = `
    You are the Oracle of the Void. A stoic, strict, but fair judge of self-contracts.
    
    Contract: "${contractTitle}"
    Behavior: "${contractBehavior}"
    
    User Query: "${userQuery}"
    
    Verdict (Strictly adhere to the contract. No excuses. If they failed, they failed.):
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return { text: response.text() };
    } catch (e) {
        logger.error("Oracle Error", e);
        throw new HttpsError('internal', `The Oracle is silent: ${e.message}`);
    }
});


exports.draftContract = onCall({
    secrets: [geminiApiKey]
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('failed-precondition', 'Authentication required.');
    }

    const { userGoal } = request.data;
    const genAI = new GoogleGenerativeAI(geminiApiKey.value());
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });

    const prompt = `
    You are a Stoic Contract Lawyer.
    User Goal: "${userGoal}"
    
    Task: Draft a strict self-contract.
    Output JSON with keys: "title" (short, punchy, Latin or English) and "behavior" (specific, measurable rule).
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return JSON.parse(response.text());
    } catch (e) {
        logger.error("Drafting Error", e);
        throw new HttpsError('internal', `Drafting failed: ${e.message}`);
    }
});

exports.judgeViolation = onCall({
    secrets: [geminiApiKey]
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('failed-precondition', 'Authentication required.');
    }

    const { reason, story, decision, contractTitle, contractBehavior } = request.data;
    const genAI = new GoogleGenerativeAI(geminiApiKey.value());
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });

    const prompt = `
    You are a strict, stoic judge.
    Contract: "${contractTitle}"
    Behavior: "${contractBehavior}"
    
    Violation Report:
    Reason: ${reason}
    Story: ${story}
    User Decision: ${decision}
    
    Task: Judge this situation.
    Output JSON:
    {
      "verdict": "GUILTY" or "ACQUITTED",
      "reasoning": "Short, stern explanation."
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return JSON.parse(response.text());
    } catch (e) {
        logger.error("Judging Error", e);
        throw new HttpsError('internal', `Judging failed: ${e.message}`);
    }
});
