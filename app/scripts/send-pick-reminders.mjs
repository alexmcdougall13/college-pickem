import { cert, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getMessaging } from 'firebase-admin/messaging'

const REMINDER_WINDOW_MINUTES = Number(
  process.env.REMINDER_WINDOW_MINUTES ?? 35,
)

const TEST_MODE =
  process.env.TEST_MODE === 'true'

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

function toMillis(value) {
  if (!value) return NaN

  if (
    typeof value.toMillis === 'function'
  ) {
    return value.toMillis()
  }

  if (typeof value === 'string') {
    return new Date(value).getTime()
  }

  return NaN
}

function markerId(
  weekId,
  userId,
  itemId,
) {
  return [
    'pick-reminder-v2',
    weekId,
    userId,
    itemId,
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
          (doc) =>
            doc.data()
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
}

async function alreadyReminded(
  leagueId,
  weekId,
  userId,
  itemId,
) {
  /*
   * Test mode deliberately ignores
   * reminder markers so we can test
   * repeatedly without affecting
   * production reminders.
   */
  if (TEST_MODE) {
    return false
  }

  const snapshot =
    await db
      .collection('leagues')
      .doc(leagueId)
      .collection(
        'notificationEvents',
      )
      .doc(
        markerId(
          weekId,
          userId,
          itemId,
        ),
      )
      .get()

  return snapshot.exists
}

function describeLeague(
  reminder,
) {
  const parts = []

  if (
    reminder.missingGames.length > 0
  ) {
    parts.push(
      reminder.missingGames.length === 1
        ? '1 pick'
        : `${reminder.missingGames.length} picks`,
    )
  }

  if (
    reminder.missingTiebreaker
  ) {
    parts.push(
      'your tiebreaker',
    )
  }

  const due =
    parts.length === 1
      ? parts[0]
      : `${parts
          .slice(0, -1)
          .join(', ')} and ${
          parts[
            parts.length - 1
          ]
        }`

  return `${due} in ${reminder.leagueName}`
}

function buildBody(
  reminders,
) {
  /*
   * If everything missing belongs
   * to one league, keep the message
   * short and natural.
   */
  if (reminders.length === 1) {
    const reminder =
      reminders[0]

    const parts = []

    if (
      reminder.missingGames.length >
      0
    ) {
      parts.push(
        reminder.missingGames.length ===
          1
          ? '1 pick'
          : `${reminder.missingGames.length} picks`,
      )
    }

    if (
      reminder.missingTiebreaker
    ) {
      parts.push(
        'your tiebreaker',
      )
    }

    const due =
      parts.length === 1
        ? parts[0]
        : `${parts
            .slice(0, -1)
            .join(', ')} and ${
            parts[
              parts.length - 1
            ]
          }`

    return `${due} ${
      parts.length === 1
        ? 'is'
        : 'are'
    } still missing for ${reminder.weekLabel}.`
  }

  /*
   * Multiple leagues are combined
   * into one notification.
   */
  return `You still have picks due: ${reminders
    .map(describeLeague)
    .join('; ')}.`
}

async function collectLeague(
  leagueDoc,
  now,
  remindersByUser,
) {
  const leagueId =
    leagueDoc.id

  const leagueData =
    leagueDoc.data()

  const leagueName =
    String(
      leagueData.name ??
        'College Pick’em',
    )

  const weeksSnapshot =
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

  for (
    const weekDoc of
    weeksSnapshot.docs
  ) {
    const week =
      weekDoc.data()

    const weekId =
      String(
        week.weekId ??
          weekDoc.id,
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

    const cutoff =
      now +
      REMINDER_WINDOW_MINUTES *
        60 *
        1000

    const dueGames =
      gamesSnapshot.docs
        .map((doc) => {
          const data =
            doc.data()

          return {
            gameId:
              String(
                data.gameId ??
                  doc.id,
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
              cutoff,
        )

    if (
      dueGames.length === 0
    ) {
      continue
    }

    const membersSnapshot =
      await db
        .collection('leagues')
        .doc(leagueId)
        .collection('members')
        .get()

    for (
      const memberDoc of
      membersSnapshot.docs
    ) {
      const member =
        memberDoc.data()

      if (
        member.active === false
      ) {
        continue
      }

      const userId =
        String(
          member.userId ??
            memberDoc.id,
        )

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
              (doc) =>
                doc.data()
                  .gameId,
            )
            .filter(Boolean)
            .map(String),
        )

      const missingGames = []

      for (
        const game of
        dueGames
      ) {
        if (
          pickedGameIds.has(
            game.gameId,
          )
        ) {
          continue
        }

        const sent =
          await alreadyReminded(
            leagueId,
            weekId,
            userId,
            game.gameId,
          )

        if (!sent) {
          missingGames.push(
            game,
          )
        }
      }

      let missingTiebreaker =
        false

      const tiebreakerGame =
        dueGames.find(
          (game) =>
            game.tiebreaker,
        )

      if (tiebreakerGame) {
        const tiebreakersSnapshot =
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

        if (
          tiebreakersSnapshot.empty
        ) {
          const sent =
            await alreadyReminded(
              leagueId,
              weekId,
              userId,
              'tiebreaker',
            )

          missingTiebreaker =
            !sent
        }
      }

      if (
        missingGames.length === 0 &&
        !missingTiebreaker
      ) {
        continue
      }

      const reminder = {
        leagueId,
        leagueName,
        weekId,
        weekLabel,
        missingGames,
        missingTiebreaker,
      }

      const existing =
        remindersByUser.get(
          userId,
        ) ?? []

      existing.push(
        reminder,
      )

      remindersByUser.set(
        userId,
        existing,
      )
    }
  }
}

async function markItems(
  userId,
  reminders,
) {
  /*
   * A manual test must not create
   * production reminder markers.
   */
  if (TEST_MODE) {
    return
  }

  const batch =
    db.batch()

  for (
    const reminder of
    reminders
  ) {
    for (
      const game of
      reminder.missingGames
    ) {
      const ref =
        db
          .collection('leagues')
          .doc(
            reminder.leagueId,
          )
          .collection(
            'notificationEvents',
          )
          .doc(
            markerId(
              reminder.weekId,
              userId,
              game.gameId,
            ),
          )

      batch.set(
        ref,
        {
          type:
            'pick-reminder',

          userId,

          weekId:
            reminder.weekId,

          gameId:
            game.gameId,

          sentAt:
            FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        },
      )
    }

    if (
      reminder.missingTiebreaker
    ) {
      const ref =
        db
          .collection('leagues')
          .doc(
            reminder.leagueId,
          )
          .collection(
            'notificationEvents',
          )
          .doc(
            markerId(
              reminder.weekId,
              userId,
              'tiebreaker',
            ),
          )

      batch.set(
        ref,
        {
          type:
            'pick-reminder',

          userId,

          weekId:
            reminder.weekId,

          gameId:
            'tiebreaker',

          sentAt:
            FieldValue.serverTimestamp(),
        },
        {
          merge: true,
        },
      )
    }
  }

  await batch.commit()
}

async function sendUserReminder(
  userId,
  reminders,
) {
  const fids =
    await enabledFidsForUser(
      userId,
    )

  if (
    fids.length === 0
  ) {
    console.log(
      `Skipping ${userId}: no enabled notification devices.`,
    )

    return false
  }

  const body =
    buildBody(
      reminders,
    )

  /*
   * This is deliberately one send
   * per USER rather than one send
   * per league.
   */
  const response =
    await messaging
      .sendEachForMulticast({
        fids,

        notification: {
          title:
            'College Pick’em — Pick Reminder',

          body,
        },

        data: {
          type:
            'pick-reminder',
        },
      })

  if (
    response.successCount === 0
  ) {
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

    return false
  }

  await markItems(
    userId,
    reminders,
  )

  console.log(
    `✓ Reminded ${userId}: ${body}`,
  )

  return true
}

const now =
  Date.now()

console.log(
  `Checking for missing picks due within ${REMINDER_WINDOW_MINUTES} minutes...`,
)

if (TEST_MODE) {
  console.log(
    'TEST MODE: reminder markers will not be read or written.',
  )
}

const leaguesSnapshot =
  await db
    .collection('leagues')
    .get()

const remindersByUser =
  new Map()

/*
 * First collect everything each
 * user owes across ALL leagues.
 */
for (
  const leagueDoc of
  leaguesSnapshot.docs
) {
  await collectLeague(
    leagueDoc,
    now,
    remindersByUser,
  )
}

/*
 * Then send exactly one notification
 * to each user who owes something.
 */
let totalSent = 0

for (
  const [
    userId,
    reminders,
  ] of remindersByUser
) {
  const sent =
    await sendUserReminder(
      userId,
      reminders,
    )

  if (sent) {
    totalSent += 1
  }
}

console.log('')

console.log(
  `Pick reminder check complete. Sent ${totalSent} user reminder(s).`,
)