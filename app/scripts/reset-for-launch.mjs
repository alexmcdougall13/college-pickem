import {
  cert,
  initializeApp,
} from 'firebase-admin/app'

import {
  getFirestore,
} from 'firebase-admin/firestore'

const EXECUTE =
  process.argv.includes('--execute')

const serviceAccount = {
  projectId:
    process.env.FIREBASE_PROJECT_ID,

  clientEmail:
    process.env.FIREBASE_CLIENT_EMAIL,

  privateKey:
    process.env.FIREBASE_PRIVATE_KEY
      ?.replace(/\\n/g, '\n'),
}

if (
  !serviceAccount.projectId ||
  !serviceAccount.clientEmail ||
  !serviceAccount.privateKey
) {
  throw new Error(
    'Missing Firebase service-account environment variables.',
  )
}

initializeApp({
  credential:
    cert(
      serviceAccount,
    ),
})

const db =
  getFirestore()

const PLATFORM_OWNER_UID =
  'qS0G8A8h13XJZdRtrm8cXidbIJd2'

const TOP_LEVEL_COLLECTIONS = [
  'leagues',
  'leagueRequests',
  'leagueInvites',
  'bugReports',
  'availableGames',

  // Legacy pre-league collections
  'picks',
  'tiebreakers',
  'games',
  'weeks',
]

async function countTree(
  documentRef,
) {
  let count = 1

  const collections =
    await documentRef.listCollections()

  for (
    const collectionRef of
    collections
  ) {
    const snapshot =
      await collectionRef.get()

    for (
      const document of
      snapshot.docs
    ) {
      count +=
        await countTree(
          document.ref,
        )
    }
  }

  return count
}

async function countCollectionTree(
  collectionName,
) {
  const snapshot =
    await db
      .collection(collectionName)
      .get()

  let count = 0

  for (
    const document of
    snapshot.docs
  ) {
    count +=
      await countTree(
        document.ref,
      )
  }

  return {
    topLevel:
      snapshot.size,
    total:
      count,
  }
}

async function main() {
  console.log('')
  console.log(
    '==============================================',
  )
  console.log(
    EXECUTE
      ? ' LAUNCH RESET — EXECUTE MODE'
      : ' LAUNCH RESET — DRY RUN',
  )
  console.log(
    '==============================================',
  )
  console.log('')
  console.log(
    `Firebase project: ${serviceAccount.projectId}`,
  )
  console.log('')

  let totalDocuments = 0

  for (
    const collectionName of
    TOP_LEVEL_COLLECTIONS
  ) {
    const counts =
      await countCollectionTree(
        collectionName,
      )

    totalDocuments +=
      counts.total

    console.log(
      `${collectionName}: ${counts.topLevel} top-level, ${counts.total} including subcollections`,
    )
  }

  const usersSnapshot =
    await db
      .collection('users')
      .get()

  const ownerDocument =
    usersSnapshot.docs.find(
      (document) =>
        document.id ===
        PLATFORM_OWNER_UID,
    )

  if (!ownerDocument) {
    throw new Error(
      'STOPPED: platform-owner Firestore document was not found.',
    )
  }

  const testUsers =
    usersSnapshot.docs.filter(
      (document) =>
        document.id !==
        PLATFORM_OWNER_UID,
    )

  let testUserDocuments = 0

  for (
    const document of
    testUsers
  ) {
    testUserDocuments +=
      await countTree(
        document.ref,
      )
  }

  console.log('')
  console.log(
    `users: ${usersSnapshot.size} total`,
  )
  console.log(
    `platform owner preserved: 1`,
  )
  console.log(
    `test users targeted: ${testUsers.length}`,
  )
  console.log(
    `test user documents including subcollections: ${testUserDocuments}`,
  )

  console.log('')
  console.log(
    `Documents targeted outside users: ${totalDocuments}`,
  )
  console.log(
    `TOTAL documents targeted: ${totalDocuments + testUserDocuments}`,
  )

  if (!EXECUTE) {
    console.log('')
    console.log(
      'DRY RUN ONLY — nothing was deleted.',
    )
    console.log(
      'The platform-owner user document will be preserved.',
    )
    console.log(
      'Firebase Authentication accounts are NOT affected.',
    )
    console.log('')
    return
  }

  console.log('')
  console.log(
    'Deleting launch-test data...',
  )

  for (
    const collectionName of
    TOP_LEVEL_COLLECTIONS
  ) {
    await db.recursiveDelete(
      db.collection(
        collectionName,
      ),
    )

    console.log(
      `✓ Deleted ${collectionName}`,
    )
  }

  console.log('')
  console.log(
    'Deleting test Firestore users...',
  )

  for (
    const document of
    testUsers
  ) {
    await db.recursiveDelete(
      document.ref,
    )

    console.log(
      `✓ Deleted test user ${document.id}`,
    )
  }

  console.log('')
  console.log(
    'Launch-test data deleted.',
  )
  console.log(
    '✓ Platform-owner Firestore user preserved.',
  )
  console.log(
    '✓ Firebase Authentication accounts unchanged.',
  )
  console.log('')
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
