import admin from 'firebase-admin'

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

admin.initializeApp({
  credential:
    admin.credential.cert(
      serviceAccount,
    ),
})

const db = admin.firestore()

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

  console.log('')
  console.log(
    `users: ${usersSnapshot.size}`,
  )

  console.log('')
  console.log(
    `Documents targeted outside users: ${totalDocuments}`,
  )

  if (!EXECUTE) {
    console.log('')
    console.log(
      'DRY RUN ONLY — nothing was deleted.',
    )
    console.log(
      'User documents were inspected but are NOT included in the reset yet.',
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
    'Launch-test data deleted.',
  )
  console.log(
    'User documents were preserved.',
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
