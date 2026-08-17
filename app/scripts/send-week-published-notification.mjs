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

const db = getFirestore()
const messaging = getMessaging()

const leagueId =
  process.argv[2]

const weekId =
  process.argv[3]

const weekLabel =
  process.argv[4]

const excludeUserId =
  process.argv[5] ?? ''

if (
  !leagueId ||
  !weekId ||
  !weekLabel
) {
  throw new Error(
    'Usage: node scripts/send-week-published-notification.mjs <leagueId> <weekId> <weekLabel> [excludeUserId]',
  )
}

const leagueSnapshot =
  await db
    .collection('leagues')
    .doc(leagueId)
    .get()

if (!leagueSnapshot.exists) {
  throw new Error(
    `League ${leagueId} was not found.`,
  )
}

const league =
  leagueSnapshot.data()

const leagueName =
  String(
    league?.name ??
      'College Pick’em',
  )

const membersSnapshot =
  await db
    .collection('leagues')
    .doc(leagueId)
    .collection('members')
    .get()

let usersNotified = 0
let devicesNotified = 0

for (
  const memberDocument of
  membersSnapshot.docs
) {
  const member =
    memberDocument.data()

  if (
    member.active === false
  ) {
    continue
  }

  const userId =
    String(
      member.userId ??
        memberDocument.id,
    )

  if (
    !userId ||
    userId === excludeUserId
  ) {
    continue
  }

  const registrations =
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
    Array.from(
      new Set(
        registrations.docs
          .map(
            (document) =>
              document.data()
                .installationId,
          )
          .filter(
            (fid) =>
              typeof fid ===
                'string' &&
              fid.length > 0,
          ),
      ),
    )

  if (
    fids.length === 0
  ) {
    continue
  }

  const response =
    await messaging
      .sendEachForMulticast({
        fids,

        notification: {
          title:
            `${leagueName} — ${weekLabel} Ready`,

          body:
            `The games for ${weekLabel} have been published. Make your picks now.`,
        },

        data: {
          type:
            'week-published',

          leagueId,

          weekId,
        },
      })

  if (
    response.successCount >
    0
  ) {
    usersNotified += 1
    devicesNotified +=
      response.successCount
  }

  response.responses.forEach(
    (result, index) => {
      if (!result.success) {
        console.error(
          `Failed device ${index + 1} for ${userId}:`,
          result.error,
        )
      }
    },
  )
}

console.log('')
console.log(
  `${leagueName} — ${weekLabel}`,
)

console.log(
  `Users notified: ${usersNotified}`,
)

console.log(
  `Devices notified: ${devicesNotified}`,
)

console.log(
  'Week-published notification complete.',
)