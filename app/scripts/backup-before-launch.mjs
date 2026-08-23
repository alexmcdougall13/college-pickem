import {
  cert,
  initializeApp,
} from 'firebase-admin/app'

import {
  getFirestore,
  Timestamp,
} from 'firebase-admin/firestore'

import fs from 'node:fs/promises'

const PLATFORM_OWNER_UID =
  'qS0G8A8h13XJZdRtrm8cXidbIJd2'

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
    cert(serviceAccount),
})

const db =
  getFirestore()

const TARGET_COLLECTIONS = [
  'leagues',
  'leagueRequests',
  'leagueInvites',
  'bugReports',
  'availableGames',
  'picks',
  'tiebreakers',
  'games',
  'weeks',
]

function serialize(value) {
  if (
    value instanceof Timestamp
  ) {
    return {
      __firestoreType:
        'timestamp',
      seconds:
        value.seconds,
      nanoseconds:
        value.nanoseconds,
    }
  }

  if (Array.isArray(value)) {
    return value.map(serialize)
  }

  if (
    value &&
    typeof value === 'object'
  ) {
    return Object.fromEntries(
      Object.entries(value).map(
        ([key, item]) => [
          key,
          serialize(item),
        ],
      ),
    )
  }

  return value
}

async function collectDocument(
  document,
  output,
) {
  output.push({
    path:
      document.ref.path,

    data:
      serialize(
        document.data(),
      ),
  })

  const subcollections =
    await document.ref
      .listCollections()

  for (
    const collectionRef of
    subcollections
  ) {
    const snapshot =
      await collectionRef.get()

    for (
      const child of
      snapshot.docs
    ) {
      await collectDocument(
        child,
        output,
      )
    }
  }
}

const documents = []

for (
  const collectionName of
  TARGET_COLLECTIONS
) {
  const snapshot =
    await db
      .collection(
        collectionName,
      )
      .get()

  for (
    const document of
    snapshot.docs
  ) {
    await collectDocument(
      document,
      documents,
    )
  }
}

/*
 * Back up only the Firestore users that the
 * launch reset intends to delete.
 */
const usersSnapshot =
  await db
    .collection('users')
    .get()

for (
  const document of
  usersSnapshot.docs
) {
  if (
    document.id ===
    PLATFORM_OWNER_UID
  ) {
    continue
  }

  await collectDocument(
    document,
    documents,
  )
}

const backup = {
  createdAt:
    new Date().toISOString(),

  projectId:
    serviceAccount.projectId,

  platformOwnerUid:
    PLATFORM_OWNER_UID,

  documentCount:
    documents.length,

  documents,
}

const filename =
  'launch-backup.json'

await fs.writeFile(
  filename,
  JSON.stringify(
    backup,
    null,
    2,
  ),
)

console.log('')
console.log(
  `✓ Backed up ${documents.length} documents`,
)
console.log(
  `✓ Saved to ${filename}`,
)
console.log('')
