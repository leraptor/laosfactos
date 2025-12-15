const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

admin.initializeApp();
const db = admin.firestore();

const { defineSecret } = require('firebase-functions/params');
const geminiApiKey = defineSecret('GEMINI_API_KEY');


// Morning Briefing: Set intentions for the day (08:00)
exports.sendMorningBriefing = onSchedule({
    schedule: "every day 08:00",
    secrets: [geminiApiKey]
}, async (event) => {
    logger.info("Starting Morning Briefing Batch...");
    await processBriefingBatch('morning');
});

// Evening Briefing: Reflect on the day (18:00)
exports.sendEveningBriefing = onSchedule({
    schedule: "every day 18:00",
    secrets: [geminiApiKey]
}, async (event) => {
    logger.info("Starting Evening Briefing Batch...");
    await processBriefingBatch('evening');
});

async function processBriefingBatch(timeOfDay) {
    const usersSnapshot = await db.collection('users').where('fcmToken', '!=', null).get();

    if (usersSnapshot.empty) {
        logger.info("No users with FCM tokens found.");
        return;
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey.value());
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const promises = [];
    usersSnapshot.forEach(userDoc => {
        promises.push(processUserBriefing(userDoc, model, timeOfDay));
    });

    await Promise.all(promises);
    logger.info(`${timeOfDay} Briefing Batch Complete.`);
}

async function processUserBriefing(userDoc, model, timeOfDay) {
    const uid = userDoc.id;
    const userData = userDoc.data();
    const fcmToken = userData.fcmToken;

    // Idempotency: Check if this specific briefing was already sent today
    const existingBriefing = userData.dailyBriefing?.[timeOfDay];
    if (existingBriefing && existingBriefing.timestamp) {
        const briefingDate = existingBriefing.timestamp.toDate();
        const today = new Date();
        if (briefingDate.toDateString() === today.toDateString()) {
            logger.info(`User ${uid} already received ${timeOfDay} briefing today. Skipping.`);
            return;
        }
    }

    try {
        // Get Active Contracts
        const contractsSnap = await db.collection('users').doc(uid).collection('contracts')
            .where('status', '==', 'active')
            .get();

        if (contractsSnap.empty) {
            logger.info(`User ${uid} has no active contracts. Skipping.`);
            return;
        }

        let contractContext = "";
        contractsSnap.forEach(doc => {
            const data = doc.data();
            contractContext += `- Contract: ${data.title}. Streak: ${data.streak || 0}. Behavior: ${data.behavior}.\n`;
        });

        // For evening: also get today's journal entries
        let journalContext = "";
        if (timeOfDay === 'evening') {
            const todayStr = new Date().toISOString().split('T')[0];
            for (const contractDoc of contractsSnap.docs) {
                const journalSnap = await db.collection('users').doc(uid)
                    .collection('contracts').doc(contractDoc.id).collection('journal')
                    .orderBy('createdAt', 'desc')
                    .limit(3)
                    .get();

                journalSnap.forEach(jDoc => {
                    const jData = jDoc.data();
                    if (jData.type === 'manual') {
                        journalContext += `- "${jData.text}"\n`;
                    }
                });
            }
        }

        // Build prompts based on time of day
        let notificationPrompt, inAppPrompt;

        if (timeOfDay === 'morning') {
            notificationPrompt = `
You are a Stoic Accountability Partner. The user has these active contracts:
${contractContext}

Task: Write a very short MORNING briefing for a mobile push notification.
Constraints:
- Maximum 2 lines, under 80 characters total.
- Focus on what they will accomplish TODAY.
- No emojis. Serious, stoic tone.
            `;

            inAppPrompt = `
You are a Stoic Accountability Partner. The user has these active contracts:
${contractContext}

Task: Write a MORNING briefing for their dashboard.
1. Acknowledge their current streaks.
2. Set their intention for today.
3. Give a stoic reflection on discipline.

Constraint: 3-4 sentences. No emojis. Serious, philosophical tone.
            `;
        } else {
            // Evening
            notificationPrompt = `
You are a Stoic Accountability Partner. The user has these active contracts:
${contractContext}

Today's Journal Entries:
${journalContext || 'No journal entries today.'}

Task: Write a very short EVENING reflection for a mobile push notification.
Constraints:
- Maximum 2 lines, under 80 characters total.
- Acknowledge their day's effort.
- No emojis. Calm, reflective tone.
            `;

            inAppPrompt = `
You are a Stoic Accountability Partner. The user has these active contracts:
${contractContext}

Today's Journal Entries:
${journalContext || 'No journal entries today.'}

Task: Write an EVENING reflection for their dashboard.
1. Acknowledge what they accomplished today.
2. Celebrate any journal entries or wins.
3. Prepare them mentally for tomorrow.

Constraint: 3-4 sentences. No emojis. Calm, reflective, encouraging tone.
            `;
        }

        const notificationResult = await model.generateContent(notificationPrompt);
        const notificationText = (await notificationResult.response).text().trim();

        const inAppResult = await model.generateContent(inAppPrompt);
        const inAppText = (await inAppResult.response).text().trim();

        // Save to Firestore with new structure
        await db.collection('users').doc(uid).set({
            dailyBriefing: {
                [timeOfDay]: {
                    text: inAppText,
                    notificationText: notificationText,
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                    archived: false
                }
            }
        }, { merge: true });

        // Send Notification
        await admin.messaging().send({
            token: fcmToken,
            notification: {
                title: timeOfDay === 'morning' ? "Morning Protocol" : "Evening Reflection",
                body: notificationText
            },
            android: { priority: "high" },
            webpush: { headers: { Urgency: "high" }, notification: { icon: "/vite.svg" } }
        });

        logger.info(`Sent ${timeOfDay} to ${uid}: "${notificationText.substring(0, 50)}..."`);

    } catch (e) {
        logger.error(`Error processing ${timeOfDay} briefing for user ${uid}`, e);
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

// Daily Auto-Keep: Check AVOID contracts and auto-fill if missed
exports.dailyAutoKeep = onSchedule({
    schedule: "every day 00:01"
}, async (event) => {
    logger.info("Starting Daily Auto-Keep...");

    const usersSnapshot = await db.collection('users').get();
    if (usersSnapshot.empty) return;

    let processed = 0;
    let autoKeptCount = 0;

    // Calculate "yesterday" (the day we are evaluating)
    const todayDate = new Date();
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(todayDate.getDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().split('T')[0];

    for (const userDoc of usersSnapshot.docs) {
        const uid = userDoc.id;

        try {
            // Get active AVOID contracts with autoKeep: true
            const contractsSnap = await db.collection('users').doc(uid).collection('contracts')
                .where('status', '==', 'active')
                .where('type', '==', 'AVOID')
                .where('autoKeep', '==', true)
                .get();

            if (contractsSnap.empty) continue;

            // Fetch all logs for yesterday for this user (Optimization)
            const logsSnap = await db.collection('users').doc(uid).collection('logs')
                .where('date', '==', yesterdayStr)
                .get();

            const loggedContractIds = new Set();
            logsSnap.forEach(doc => loggedContractIds.add(doc.data().contractId));

            const batch = db.batch();
            let userUpdates = 0;

            for (const contractDoc of contractsSnap.docs) {
                const contractId = contractDoc.id;

                if (!loggedContractIds.has(contractId)) {
                    // No log found? Auto-keep it.

                    // 1. Create Log
                    const logRef = db.collection('users').doc(uid).collection('logs').doc();
                    batch.set(logRef, {
                        contractId: contractId,
                        date: yesterdayStr,
                        status: 'kept',
                        source: 'auto',
                        timestamp: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // 2. Update Contract Streak
                    const currentStreak = contractDoc.data().streak || 0;
                    batch.update(contractDoc.ref, {
                        streak: currentStreak + 1,
                        lastCheckIn: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // 3. Create Journal Entry (Visible History)
                    const journalRef = db.collection('users').doc(uid).collection('contracts').doc(contractId).collection('journal').doc();
                    batch.set(journalRef, {
                        text: "Auto-completed (No violation reported)",
                        createdAt: admin.firestore.FieldValue.serverTimestamp(),
                        type: 'auto'
                    });

                    autoKeptCount++;
                    userUpdates++;
                    logger.info(`Auto-kept contract ${contractId} for user ${uid}`);
                }
            }

            if (userUpdates > 0) {
                await batch.commit();
            }
            processed++;

        } catch (e) {
            logger.error(`Error processing auto-keep for user ${uid}`, e);
        }
    }

    logger.info(`Daily Auto-Keep Complete. Processed ${processed} users. Auto-kept ${autoKeptCount} contracts.`);
});

// AI Journal Replies: Generate coach reply when user adds a journal entry
exports.onJournalEntryCreated = onDocumentCreated({
    document: "users/{userId}/contracts/{contractId}/journal/{entryId}",
    secrets: [geminiApiKey]
}, async (event) => {
    const snapshot = event.data;
    if (!snapshot) {
        logger.warn("No data in journal entry snapshot");
        return;
    }

    const entryData = snapshot.data();
    const { userId, contractId, entryId } = event.params;

    // Only reply to manual entries (not auto-generated system logs)
    if (entryData.type !== 'manual') {
        logger.info(`Skipping AI reply for non-manual entry: ${entryId}`);
        return;
    }

    // Skip if already has a reply (idempotency)
    if (entryData.aiReply) {
        logger.info(`Entry ${entryId} already has a reply, skipping`);
        return;
    }

    try {
        // 1. Fetch contract details for context
        const contractDoc = await db.collection('users').doc(userId)
            .collection('contracts').doc(contractId).get();

        if (!contractDoc.exists) {
            logger.error(`Contract ${contractId} not found`);
            return;
        }

        const contract = contractDoc.data();

        // 2. Fetch recent journal entries for context (last 5, excluding current)
        const recentEntriesSnap = await db.collection('users').doc(userId)
            .collection('contracts').doc(contractId).collection('journal')
            .orderBy('createdAt', 'desc')
            .limit(6) // Get 6 to exclude current one
            .get();

        const recentEntries = [];
        recentEntriesSnap.forEach(doc => {
            if (doc.id !== entryId && doc.data().type === 'manual') {
                recentEntries.push(doc.data().text);
            }
        });
        // Take only last 5
        const contextEntries = recentEntries.slice(0, 5).reverse();

        // 3. Build the AI prompt
        const genAI = new GoogleGenerativeAI(geminiApiKey.value());
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const recentContext = contextEntries.length > 0
            ? contextEntries.map((t, i) => `${i + 1}. "${t}"`).join('\n')
            : 'No previous entries.';

        const prompt = `You are a supportive accountability coach helping someone stick to their personal contract.

CONTRACT: "${contract.title}"
GOAL: "${contract.behavior}"
CURRENT STREAK: ${contract.streak || 0} days

RECENT JOURNAL ENTRIES:
${recentContext}

USER'S NEW ENTRY: "${entryData.text}"

Instructions:
- Write a SHORT reply (1-2 sentences max) as a real coach would.
- Be warm, genuine, and specific to what they shared.
- Celebrate wins enthusiastically. Offer empathy for struggles.
- If they share a milestone, acknowledge it specially.
- Use one emoji that fits the mood.
- Do NOT use markdown formatting.
- Do NOT be generic or robotic.

Your reply:`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const replyText = response.text().trim();

        // 4. Write the reply back to the document
        await snapshot.ref.update({
            aiReply: {
                text: replyText,
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            }
        });

        logger.info(`Generated AI reply for entry ${entryId}: "${replyText.substring(0, 50)}..."`);

    } catch (e) {
        logger.error(`Error generating AI reply for entry ${entryId}:`, e);
    }
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
