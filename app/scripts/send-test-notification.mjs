import {
  cert,
  initializeApp,
} from 'firebase-admin/app'

import {
  getFirestore,
} from 'firebase-admin/firestore'

import {
  getMessaging,
} from 'firebase-admin/messaging'

const serviceAccount = {
  projectId:
    process.env.FIREBASE_PROJECT_ID,

  clientEmail:
    process.env.FIREBASE_CLIENT_EMAIL,

  privateKey:
    process.env.FIREBASE_PRIVATE_KEY?.replace(
      /\\n/g,
      '\n',
    ),
}

if (
  !serviceAccount.projectId ||
  !serviceAccount.clientEmail ||
  !serviceAccount.privateKey
) {
  throw new Error(
    'Missing Firebase service account environment variables.',
  )
}

initializeApp({
  credential:
    cert(serviceAccount),
})

const db =
  getFirestore()

const messaging =
  getMessaging()

const userId =
  process.argv[2]

if (!userId) {
  throw new Error(
    'Usage: node scripts/send-test-notification.mjs <firebase-user-id>',
  )
}

console.log(
  `Loading notification registrations for ${userId}...`,
)

const registrationsSnapshot =
  await db
    .collection('users')
    .doc(userId)
    .collection(
      'notificationRegistrations',
    )
    .where(
      'enabled',
      '==',
      true,
    )
    .get()

const fids =
  registrationsSnapshot.docs
    .map(
      (document) =>
        document.data()
          .installationId,
    )
    .filter(
      (installationId) =>
        typeof installationId ===
          'string' &&
        installationId.length > 0,
    )

if (fids.length === 0) {
  throw new Error(
    'No enabled notification registrations found for this user.',
  )
}

console.log(
  `Found ${fids.length} enabled device(s).`,
)

const response =
  await messaging
    .sendEachForMulticast({
      fids,

      notification: {
        title:
          'College Pick’em',

        body:
          'Test notification — push notifications are working.',
      },

      webpush: {
        fcmOptions: {
          link:
            '/',
        },
      },
    })

console.log('')
console.log(
  `Successes: ${response.successCount}`,
)

console.log(
  `Failures: ${response.failureCount}`,
)

response.responses.forEach(
  (result, index) => {
    if (result.success) {
      console.log(
        `✓ Device ${index + 1}`,
      )
    } else {
      console.error(
        `✗ Device ${index + 1}:`,
        result.error,
      )
    }
  },
)

console.log('')
console.log(
  'Test notification send complete.',
)