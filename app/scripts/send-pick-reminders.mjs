import {
  cert,
  initializeApp,
} from 'firebase-admin/app'

import {
  FieldValue,
  getFirestore,
} from 'firebase-admin/firestore'

import {
  getMessaging,
} from 'firebase-admin/messaging'

const REMINDER_WINDOW_MINUTES =
  Number(
    process.env.REMINDER_WINDOW_MINUTES ??
      35,
  )

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
  credential: cert(serviceAccount),
})

const db = getFirestore()
const messaging = getMessaging()

function isActiveMember(data) {
  return data?.active !== false
}

function toMillis(value) {
  if (!value) return NaN

  if (
    typeof value.toMillis ===
    'function'
  ) {
    return value.toMillis()
  }

  if (typeof value === 'string') {
    return new Date(value).getTime()
  }

  return NaN
}

function reminderMarkerId(
  weekId,
  userId,
  gameId,
) {
  return [
    'pick-reminder',
    weekId,
    userId,
    gameId,
  ]
    .map((value) =>
      String(value).replace(
        /[^a-zA-Z0-9_-]/g,
        '_',
      ),
    )
    .join('__')
}

async function enabledFidsForUser(
  userId,
) {
  const snapshot =
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

  return Array.from(
    new Set(
      snapshot.docs
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
        ),
    ),
  )
}

async function sendReminder({
  leagueId,
  leagueName,
  weekId,
  weekLabel,
  userId,
  missingGames,
  missingTiebreaker,
}) {
  const fids =
    await enabledFidsForUser(
      userId,
    )

  if (fids.length === 0) {
    return {
      sent: false,
      reason: 'no-enabled-devices',
    }
  }

  const pickCount =
    missingGames.length

  const pieces = []

  if (pickCount > 0) {
    pieces.push(
      pickCount === 1
        ? '1 pick'
        : `${pickCount} picks`,
    )
  }

  if (missingTiebreaker) {
    pieces.push('your tiebreaker')
  }

  const dueText =
    pieces.length > 1
      ? `${pieces
          .slice(0, -1)
          .join(', ')} and ${
          pieces[
            pieces.length - 1
          ]
        }`
      : pieces[0]

  const body =
    `${dueText} ${
      pieces.length === 1
        ? 'is'
        : 'are'
    } still missing for ${weekLabel}.`

  const response =
    await messaging
      .sendEachForMulticast({
        fids,

        notification: {
          title:
            `${leagueName} — Pick Reminder`,

          body,
        },

        data: {
          type: 'pick-reminder',
          leagueId,
          weekId,
        },
      })

  if (response.successCount === 0) {
    console.error(
      `No devices accepted reminder for ${userId}.`,
    )

    response.responses.forEach(
      (result, index) => {
        if (!result.success) {
          console.error(
            `Device ${index + 1}:`,
            result.error,
          )
        }
      },
    )

    return {
      sent: false,
      reason: 'all-devices-failed',
    }
  }

  const markerBatch = db.batch()

  for (const game of missingGames) {
    const markerRef =
      db
        .collection('leagues')
        .doc(leagueId)
        .collection(
          'notificationEvents',
        )
        .doc(
          reminderMarkerId(
            weekId,
            userId,
            game.gameId,
          ),
        )

    markerBatch.set(
      markerRef,
      {
        type: 'pick-reminder',
        userId,
        weekId,
        gameId: game.gameId,
        sentAt:
          FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      },
    )
  }

  if (missingTiebreaker) {
    const markerRef =
      db
        .collection('leagues')
        .doc(leagueId)
        .collection(
          'notificationEvents',
        )
        .doc(
          reminderMarkerId(
            weekId,
            userId,
            'tiebreaker',
          ),
        )

    markerBatch.set(
      markerRef,
      {
        type: 'pick-reminder',
        userId,
        weekId,
        gameId: 'tiebreaker',
        sentAt:
          FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      },
    )
  }

  await markerBatch.commit()

  console.log(
    `✓ ${leagueName}: reminded ${userId} about ${body}`,
  )

  return {
    sent: true,
  }
}

async function processLeague(
  leagueDocument,
  now,
) {
  const leagueId =
    leagueDocument.id

  const league =
    leagueDocument.data()

  const leagueName =
    String(
      league.name ??
        'College Pick’em',
    )

  const openWeeks =
    await db
      .collection('leagues')
      .doc(leagueId)
      .collection('weeks')
      .where(
        'status',
        '==',
        'open',
      )
      .where(
        'published',
        '==',
        true,
      )
      .get()

  if (openWeeks.empty) {
    return 0
  }

  let remindersSent = 0

  for (
    const weekDocument of
    openWeeks.docs
  ) {
    const week =
      weekDocument.data()

    const weekId =
      String(
        week.weekId ??
          weekDocument.id,
      )

    const weekLabel =
      String(
        week.label ??
          'Current Week',
      )

    const gamesSnapshot =
      await db
        .collection('leagues')
        .doc(leagueId)
        .collection('games')
        .where(
          'weekId',
          '==',
          weekId,
        )
        .where(
          'selected',
          '==',
          true,
        )
        .get()

    const reminderCutoff =
      now +
      REMINDER_WINDOW_MINUTES *
        60 *
        1000

    const dueGames =
      gamesSnapshot.docs
        .map((document) => {
          const data =
            document.data()

          return {
            gameId:
              String(
                data.gameId ??
                  document.id,
              ),

            kickoffMs:
              toMillis(
                data.kickoffTimestamp ??
                  data.kickoff,
              ),

            tiebreaker:
              data.tiebreaker ===
              true,
          }
        })
        .filter(
          (game) =>
            Number.isFinite(
              game.kickoffMs,
            ) &&
            game.kickoffMs > now &&
            game.kickoffMs <=
              reminderCutoff,
        )

    if (dueGames.length === 0) {
      continue
    }

    const membersSnapshot =
      await db
        .collection('leagues')
        .doc(leagueId)
        .collection('members')
        .get()

    for (
      const memberDocument of
      membersSnapshot.docs
    ) {
      const member =
        memberDocument.data()

      if (!isActiveMember(member)) {
        continue
      }

      const userId =
        String(
          member.userId ??
            memberDocument.id,
        )

      if (!userId) {
        continue
      }

      const picksSnapshot =
        await db
          .collection('leagues')
          .doc(leagueId)
          .collection('picks')
          .where(
            'userId',
            '==',
            userId,
          )
          .where(
            'weekId',
            '==',
            weekId,
          )
          .get()

      const pickedGameIds =
        new Set(
          picksSnapshot.docs
            .map(
              (document) =>
                document.data()
                  .gameId,
            )
            .filter(Boolean)
            .map(String),
        )

      const unpickedDueGames =
        dueGames.filter(
          (game) =>
            !pickedGameIds.has(
              game.gameId,
            ),
        )

      const eventCollection =
        db
          .collection('leagues')
          .doc(leagueId)
          .collection(
            'notificationEvents',
          )

      const missingGames = []

      for (
        const game of
        unpickedDueGames
      ) {
        const marker =
          await eventCollection
            .doc(
              reminderMarkerId(
                weekId,
                userId,
                game.gameId,
              ),
            )
            .get()

        if (!marker.exists) {
          missingGames.push(game)
        }
      }

      const tiebreakerGame =
        dueGames.find(
          (game) => game.tiebreaker,
        )

      let missingTiebreaker =
        false

      if (tiebreakerGame) {
        const tiebreakers =
          await db
            .collection('leagues')
            .doc(leagueId)
            .collection(
              'tiebreakers',
            )
            .where(
              'userId',
              '==',
              userId,
            )
            .where(
              'weekId',
              '==',
              weekId,
            )
            .get()

        if (tiebreakers.empty) {
          const marker =
            await eventCollection
              .doc(
                reminderMarkerId(
                  weekId,
                  userId,
                  'tiebreaker',
                ),
              )
              .get()

          missingTiebreaker =
            !marker.exists
        }
      }

      if (
        missingGames.length === 0 &&
        !missingTiebreaker
      ) {
        continue
      }

      const result =
        await sendReminder({
          leagueId,
          leagueName,
          weekId,
          weekLabel,
          userId,
          missingGames,
          missingTiebreaker,
        })

      if (result.sent) {
        remindersSent += 1
      }
    }
  }

  return remindersSent
}

const now = Date.now()

console.log(
  `Checking for missing picks due within ${REMINDER_WINDOW_MINUTES} minutes...`,
)

const leaguesSnapshot =
  await db
    .collection('leagues')
    .get()

let totalSent = 0

for (
  const leagueDocument of
  leaguesSnapshot.docs
) {
  totalSent +=
    await processLeague(
      leagueDocument,
      now,
    )
}

console.log('')

console.log(
  `Pick reminder check complete. Sent ${totalSent} reminder(s).`,
)