const admin = require('firebase-admin');

// Initialize with project ID
admin.initializeApp({
    projectId: 'laosfactos-product'
});
const db = admin.firestore();

const SOURCE_UID = 'skzGn0ryLXTNxPm9FYbixsbWLGT2';
const TARGET_UID = 'LCAAczFQ7SfCElLb6KJ7rbjw7AV2';

async function migrateUserData() {
    console.log(`\n🔄 Starting migration from ${SOURCE_UID} to ${TARGET_UID}\n`);

    const results = {
        contracts: 0,
        logs: 0,
        journals: 0,
        errors: []
    };

    try {
        // 1. Copy all contracts
        console.log('📋 Copying contracts...');
        const contractsSnap = await db.collection('users').doc(SOURCE_UID).collection('contracts').get();

        if (contractsSnap.empty) {
            console.log('⚠️  No contracts found in source account!');
        }

        for (const contractDoc of contractsSnap.docs) {
            try {
                const contractData = contractDoc.data();
                console.log(`   → Contract: "${contractData.title || contractDoc.id}"`);

                const newContractRef = db.collection('users').doc(TARGET_UID).collection('contracts').doc(contractDoc.id);

                await newContractRef.set({
                    ...contractData,
                    userId: TARGET_UID,
                    migratedFrom: SOURCE_UID,
                    migratedAt: admin.firestore.FieldValue.serverTimestamp()
                });
                results.contracts++;

                // Copy journal entries for this contract
                const journalSnap = await db.collection('users').doc(SOURCE_UID)
                    .collection('contracts').doc(contractDoc.id).collection('journal').get();

                for (const journalDoc of journalSnap.docs) {
                    try {
                        const journalData = journalDoc.data();
                        await db.collection('users').doc(TARGET_UID)
                            .collection('contracts').doc(contractDoc.id)
                            .collection('journal').doc(journalDoc.id)
                            .set(journalData);
                        results.journals++;
                    } catch (e) {
                        results.errors.push(`Journal ${journalDoc.id}: ${e.message}`);
                    }
                }
                console.log(`     ✓ Copied ${journalSnap.size} journal entries`);

            } catch (e) {
                results.errors.push(`Contract ${contractDoc.id}: ${e.message}`);
                console.error(`   ✗ Error: ${e.message}`);
            }
        }

        // 2. Copy all logs
        console.log('\n📝 Copying logs...');
        const logsSnap = await db.collection('users').doc(SOURCE_UID).collection('logs').get();

        for (const logDoc of logsSnap.docs) {
            try {
                const logData = logDoc.data();
                await db.collection('users').doc(TARGET_UID).collection('logs').doc(logDoc.id).set(logData);
                results.logs++;
            } catch (e) {
                results.errors.push(`Log ${logDoc.id}: ${e.message}`);
            }
        }
        console.log(`   ✓ Copied ${results.logs} logs`);

        // 3. Copy user document data (settings, briefings, etc.)
        console.log('\n👤 Copying user settings...');
        const sourceUserDoc = await db.collection('users').doc(SOURCE_UID).get();
        if (sourceUserDoc.exists) {
            const userData = sourceUserDoc.data();
            const { fcmToken, ...restData } = userData;
            await db.collection('users').doc(TARGET_UID).set({
                ...restData,
                migratedFrom: SOURCE_UID,
                migratedAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            console.log('   ✓ User settings copied');
        }

        console.log('\n' + '='.repeat(50));
        console.log('✅ MIGRATION COMPLETE!');
        console.log('='.repeat(50));
        console.log(`   Contracts copied: ${results.contracts}`);
        console.log(`   Logs copied: ${results.logs}`);
        console.log(`   Journal entries copied: ${results.journals}`);
        if (results.errors.length > 0) {
            console.log(`   Errors: ${results.errors.length}`);
            results.errors.forEach(e => console.log(`     - ${e}`));
        }
        console.log('\n🎉 Your data has been recovered! Refresh the app to see your contracts.\n');

    } catch (e) {
        console.error('❌ Migration failed:', e);
        process.exit(1);
    }

    process.exit(0);
}

migrateUserData();
