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

    // Idempotency check: Skip if briefing was already sent today
    const existingBriefing = userData.dailyBriefing;
    if (existingBriefing && existingBriefing.timestamp) {
        const briefingDate = existingBriefing.timestamp.toDate();
        const today = new Date();
        if (briefingDate.toDateString() === today.toDateString()) {
            logger.info(`User ${uid} already received briefing today. Skipping.`);
            return;
        }
    }

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

        // 3. Call AI - SHORT prompt for notification (2 lines max, ~80 chars)
        const notificationPrompt = `
      You are a Stoic Accountability Partner.
      The user has these active contracts:
      ${contractContext}

      Task: Write a very short daily briefing for a mobile push notification.
      
      Constraints:
      - Maximum 2 lines, under 80 characters total.
      - One punchy sentence about their mission today.
      - No emojis. Serious, stoic tone.
    `;

        const notificationResult = await model.generateContent(notificationPrompt);
        const notificationResponse = await notificationResult.response;
        const notificationText = notificationResponse.text().trim();

        // 4. Call AI - LONG prompt for in-app display (3-4 sentences)
        const inAppPrompt = `
      You are a Stoic Accountability Partner.
      The user has the following active self-contracts:
      ${contractContext}

      Task: Write a daily briefing for their dashboard.
      1. Acknowledge their current streaks.
      2. Give a stoic reflection on Consistency.
      3. Tell them exactly what to focus on today.
      
      Constraint: Keep it to 3-4 sentences. No emojis. Serious, philosophical tone.
    `;

        const inAppResult = await model.generateContent(inAppPrompt);
        const inAppResponse = await inAppResult.response;
        const inAppText = inAppResponse.text().trim();

        // 5. Save to Firestore for In-App Widget (both texts)
        await db.collection('users').doc(uid).set({
            dailyBriefing: {
                text: inAppText,
                notificationText: notificationText,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                archived: false
            }
        }, { merge: true });

        // 6. Send Notification with SHORT text
        await admin.messaging().send({
            token: fcmToken,
            notification: {
                title: "Daily Protocol",
                body: notificationText
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

        logger.info(`Sent to ${uid}: Notification="${notificationText}" | InApp="${inAppText.substring(0, 50)}..."`);

    } catch (e) {
        logger.error(`Error processing user ${uid}`, e);
    }

}

// Weekly Rollover: Evaluate weekly contracts and update streaks
exports.weeklyRollover = onSchedule({
    schedule: "every monday 00:01"
}, async (event) => {
    logger.info("Starting Weekly Rollover...");

    // Get all users
    const usersSnapshot = await db.collection('users').get();

    if (usersSnapshot.empty) {
        logger.info("No users found.");
        return;
    }

    let processed = 0;
    let successCount = 0;
    let failCount = 0;

    for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;

        try {
            // Get all active weekly contracts for this user
            const contractsSnap = await db.collection('users').doc(uid).collection('contracts')
                .where('status', '==', 'active')
                .where('frequency.type', '==', 'weekly')
                .get();

            if (contractsSnap.empty) continue;

            const batch = db.batch();

            // Calculate new week start (today = Monday)
            const today = new Date();
            const newWeekStart = today.toISOString().split('T')[0];

            for (const contractDoc of contractsSnap.docs) {
                const contract = contractDoc.data();
                const goal = contract.frequency?.timesPerWeek || 3;
                const completed = contract.weeklyProgress?.completedCount || 0;
                const currentStreak = contract.streak || 0;

                // Evaluate: did they meet the goal?
                const metGoal = completed >= goal;
                const newStreak = metGoal ? currentStreak + 1 : 0;

                if (metGoal) {
                    successCount++;
                } else {
                    failCount++;
                }

                // Update contract: reset weeklyProgress, update streak
                batch.update(contractDoc.ref, {
                    streak: newStreak,
                    weeklyProgress: {
                        weekStart: newWeekStart,
                        completedCount: 0,
                        lastCheckInDate: null
                    }
                });

                logger.info(`User ${uid} - Contract "${contract.title}": ${completed}/${goal} → ${metGoal ? 'SUCCESS' : 'FAIL'} (streak: ${newStreak})`);
            }

            await batch.commit();
            processed++;

        } catch (e) {
            logger.error(`Error processing user ${uid}`, e);
        }
    }

    logger.info(`Weekly Rollover Complete. Processed ${processed} users. Success: ${successCount}, Fail: ${failCount}`);
});


exports.consultOracle = onCall({
    secrets: [geminiApiKey]
}, async (request) => {
    // 1. Validate Auth
    if (!request.auth) {
        throw new HttpsError('failed-precondition', 'The function must be called while authenticated.');
    }

    const { contractTitle, contractBehavior, userQuery, contractExceptions } = request.data;

    // Format exceptions for the prompt
    const exceptionsText = Array.isArray(contractExceptions) && contractExceptions.length > 0
        ? contractExceptions.map(e => `- ${e}`).join('\n')
        : 'None';

    // 2. Call Gemini Securely
    const genAI = new GoogleGenerativeAI(geminiApiKey.value());
    const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: { responseMimeType: "application/json" }
    });

    const prompt = `
    You are the Oracle of the Void. Judge if the User Query violates the Contract, taking into account any defined exceptions.
    
    Contract: "${contractTitle}"
    Behavior: "${contractBehavior}"
    
    Allowed Exceptions (situations where the contract does NOT apply):
    ${exceptionsText}
    
    User Query: "${userQuery}"
    
    Instructions:
    1. If the user's query matches one of the allowed exceptions, respond with "ALLOWED" and explain it's permitted due to the exception.
    2. If the user's query does not violate the contract behavior, respond with "ALLOWED".
    3. If the user's query violates the contract and no exception applies, respond with "FORBIDDEN".
    
    Output JSON:
    {
        "status": "ALLOWED" or "FORBIDDEN",
        "explanation": "A short, stoic explanation of why. Reference the exception if applicable. Do not use markdown."
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        // Return the parsed object directly
        return JSON.parse(response.text());
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

exports.auditContract = onCall({
    secrets: [geminiApiKey]
}, async (request) => {
    if (!request.auth) {
        throw new HttpsError('failed-precondition', 'Authentication required.');
    }

    const { contractData } = request.data;
    const genAI = new GoogleGenerativeAI(geminiApiKey.value());
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash", generationConfig: { responseMimeType: "application/json" } });

    const prompt = `
    You are a Devil's Advocate lawyer. Review this personal contract.
    Contract Details: ${JSON.stringify(contractData)}

    Find 1 specific, likely loophole the user's future self will exploit. Be cynical.
    Output JSON:
    {
        "weakness": "string",
        "suggestion": "string"
    }
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return JSON.parse(response.text());
    } catch (e) {
        logger.error("Audit Error", e);
        throw new HttpsError('internal', `Audit failed: ${e.message}`);
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
