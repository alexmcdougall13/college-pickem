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


function participatedInWeek(
  member,
  weekNumber,
) {
  const inactivePeriods =
    Array.isArray(
      member.inactivePeriods,
    )
      ? member.inactivePeriods
      : []

  if (
    inactivePeriods.some(
      (period) =>
        period &&
        typeof period.startWeekNumber ===
          'number' &&
        typeof period.endWeekNumber ===
          'number' &&
        weekNumber >=
          period.startWeekNumber &&
        weekNumber <=
          period.endWeekNumber,
    )
  ) {
    return false
  }

  if (
    member.active !==
    false
  ) {
    return true
  }

  if (
    typeof member
      .activeThroughWeekNumber ===
      'number'
  ) {
    return (
      weekNumber <=
      member
        .activeThroughWeekNumber
    )
  }

  return true
}


function pickResult(
  game,
  teamId,
) {
  if (
    !teamId ||
    typeof game.awayScore !==
      'number' ||
    typeof game.homeScore !==
      'number' ||
    game.final !== true
  ) {
    return 'pending'
  }

  let margin = 0

  if (
    teamId ===
    game.awayTeamId
  ) {
    margin =
      game.awayScore +
      (
        typeof game.awayTeamLine ===
          'number'
          ? game.awayTeamLine
          : 0
      ) -
      game.homeScore
  } else if (
    teamId ===
    game.homeTeamId
  ) {
    margin =
      game.homeScore +
      (
        typeof game.homeTeamLine ===
          'number'
          ? game.homeTeamLine
          : 0
      ) -
      game.awayScore
  } else {
    return 'pending'
  }

  if (margin > 0) {
    return 'ahead'
  }

  if (margin < 0) {
    return 'behind'
  }

  return 'push'
}


async function displayNameForMember(
  memberDocument,
) {
  const member =
    memberDocument.data()

  const membershipName =
    typeof member.displayName ===
      'string'
      ? member.displayName.trim()
      : ''

  if (membershipName) {
    return membershipName
  }

  const userSnapshot =
    await db
      .collection('users')
      .doc(
        memberDocument.id,
      )
      .get()

  if (
    userSnapshot.exists
  ) {
    const user =
      userSnapshot.data()

    const firstName =
      typeof user.firstName ===
        'string'
        ? user.firstName.trim()
        : ''

    const name =
      typeof user.name ===
        'string'
        ? user.name.trim()
        : ''

    if (firstName) {
      return firstName
    }

    if (name) {
      return name
    }

    const email =
      typeof user.email ===
        'string'
        ? user.email
        : ''

    if (email) {
      return (
        email
          .split('@')[0]
          .replace(
            /[^a-zA-Z]/g,
            '',
          ) ||
        'Player'
      )
    }
  }

  return 'Player'
}


async function enabledFidsForUser(
  userId,
) {
  const userSnapshot =
    await db
      .collection('users')
      .doc(userId)
      .get()

  if (
    userSnapshot.exists &&
    userSnapshot.data()
      .notificationPreferences
      ?.weekResults === false
  ) {
    return {
      disabled: true,
      fids: [],
    }
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

  return {
    disabled: false,
    fids,
  }
}


function resultMarkerId(
  weekId,
) {
  return `week-results__${String(
    weekId,
  ).replace(
    /[^a-zA-Z0-9_-]/g,
    '_',
  )}`
}


async function processWeek(
  leagueDocument,
  weekDocument,
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
        'Week',
    )

  const weekNumber =
    typeof week.weekNumber ===
      'number'
      ? week.weekNumber
      : 0

  if (
    week.published !== true
  ) {
    return false
  }

  const markerRef =
    db
      .collection('leagues')
      .doc(leagueId)
      .collection(
        'notificationEvents',
      )
      .doc(
        resultMarkerId(
          weekId,
        ),
      )

  const existingMarker =
    await markerRef.get()

  if (
    existingMarker.exists
  ) {
    return false
  }

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

  if (
    gamesSnapshot.empty
  ) {
    return false
  }

  const games =
    gamesSnapshot.docs.map(
      (document) => ({
        id:
          document.id,
        ...document.data(),
      }),
    )

  if (
    !games.every(
      (game) =>
        game.final === true,
    )
  ) {
    return false
  }

  const membersSnapshot =
    await db
      .collection('leagues')
      .doc(leagueId)
      .collection('members')
      .get()

  const eligibleMembers =
    membersSnapshot.docs.filter(
      (memberDocument) =>
        participatedInWeek(
          memberDocument.data(),
          weekNumber,
        ),
    )

  if (
    eligibleMembers.length ===
    0
  ) {
    return false
  }

  const picksSnapshot =
    await db
      .collection('leagues')
      .doc(leagueId)
      .collection('picks')
      .where(
        'weekId',
        '==',
        weekId,
      )
      .get()

  const picksByUser =
    new Map()

  for (
    const pickDocument of
    picksSnapshot.docs
  ) {
    const pick =
      pickDocument.data()

    const userId =
      String(
        pick.userId ?? '',
      )

    const gameId =
      String(
        pick.gameId ?? '',
      )

    const teamId =
      String(
        pick.teamId ?? '',
      )

    if (
      !userId ||
      !gameId ||
      !teamId
    ) {
      continue
    }

    if (
      !picksByUser.has(
        userId,
      )
    ) {
      picksByUser.set(
        userId,
        new Map(),
      )
    }

    picksByUser
      .get(userId)
      .set(
        gameId,
        teamId,
      )
  }

  const tiebreakersSnapshot =
    await db
      .collection('leagues')
      .doc(leagueId)
      .collection(
        'tiebreakers',
      )
      .where(
        'weekId',
        '==',
        weekId,
      )
      .get()

  const tiebreakersByUser =
    new Map()

  for (
    const tiebreakerDocument of
    tiebreakersSnapshot.docs
  ) {
    const data =
      tiebreakerDocument.data()

    const userId =
      String(
        data.userId ?? '',
      )

    if (
      userId &&
      typeof data.totalPoints ===
        'number'
    ) {
      tiebreakersByUser.set(
        userId,
        data.totalPoints,
      )
    }
  }

  const results = []

  for (
    const memberDocument of
    eligibleMembers
  ) {
    const member =
      memberDocument.data()

    const userId =
      String(
        member.userId ??
          memberDocument.id,
      )

    if (!userId) {
      continue
    }

    const userPicks =
      picksByUser.get(
        userId,
      ) ??
      new Map()

    let correct = 0
    let losses = 0
    let pushes = 0

    for (
      const game of
      games
    ) {
      const result =
        pickResult(
          game,
          userPicks.get(
            game.gameId,
          ),
        )

      if (
        result === 'ahead'
      ) {
        correct += 1
      } else if (
        result === 'behind'
      ) {
        losses += 1
      } else if (
        result === 'push'
      ) {
        pushes += 1
      }
    }

    results.push({
      userId,
      name:
        await displayNameForMember(
          memberDocument,
        ),
      correct,
      losses,
      pushes,
      tiebreaker:
        tiebreakersByUser.has(
          userId,
        )
          ? tiebreakersByUser.get(
              userId,
            )
          : null,
    })
  }

  if (
    results.length === 0
  ) {
    return false
  }

  const bestScore =
    Math.max(
      ...results.map(
        (result) =>
          result.correct,
      ),
    )

  let winners =
    results.filter(
      (result) =>
        result.correct ===
        bestScore,
    )

  const tiebreakerGame =
    games.find(
      (game) =>
        game.tiebreaker ===
        true,
    ) ?? null

  if (
    winners.length > 1 &&
    tiebreakerGame &&
    typeof tiebreakerGame
      .awayScore ===
      'number' &&
    typeof tiebreakerGame
      .homeScore ===
      'number'
  ) {
    const actualTotal =
      tiebreakerGame
        .awayScore +
      tiebreakerGame
        .homeScore

    const withTiebreakers =
      winners.filter(
        (winner) =>
          winner.tiebreaker !=
          null,
      )

    if (
      withTiebreakers.length >
      0
    ) {
      const bestDifference =
        Math.min(
          ...withTiebreakers.map(
            (winner) =>
              Math.abs(
                winner.tiebreaker -
                  actualTotal,
              ),
          ),
        )

      winners =
        withTiebreakers.filter(
          (winner) =>
            Math.abs(
              winner.tiebreaker -
                actualTotal,
            ) ===
            bestDifference,
        )
    }
  }

  const winnerNames =
    winners.map(
      (winner) =>
        winner.name,
    )

  const winningRecord =
    winners[0]

  let body = ''

  if (
    winners.length === 1
  ) {
    body =
      `${winnerNames[0]} won ${weekLabel} with ${winningRecord.correct}-${winningRecord.losses}.`
  } else if (
    winners.length === 2
  ) {
    body =
      `${winnerNames[0]} and ${winnerNames[1]} split ${weekLabel} with ${winningRecord.correct}-${winningRecord.losses}.`
  } else {
    body =
      `${winners.length} players split ${weekLabel} with ${winningRecord.correct}-${winningRecord.losses}.`
  }

  let usersNotified = 0
  let devicesNotified = 0

  for (
    const memberDocument of
    eligibleMembers
  ) {
    const member =
      memberDocument.data()

    const userId =
      String(
        member.userId ??
          memberDocument.id,
      )

    if (!userId) {
      continue
    }

    const {
      disabled,
      fids,
    } =
      await enabledFidsForUser(
        userId,
      )

    if (disabled) {
      console.log(
        `Skipping ${userId}: weekly-results notifications disabled.`,
      )
      continue
    }

    if (
      fids.length === 0
    ) {
      console.log(
        `Skipping ${userId}: no enabled notification devices.`,
      )
      continue
    }

    const response =
      await messaging
        .sendEachForMulticast({
          fids,

          notification: {
            title:
              `${leagueName} — ${weekLabel} Results`,

            body,
          },

          data: {
            type:
              'week-results',

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
        if (
          !result.success
        ) {
          console.error(
            `Failed device ${index + 1} for ${userId}:`,
            result.error,
          )
        }
      },
    )
  }

  /*
   * Only consume the event if at least one notification
   * was actually delivered.
   *
   * If everyone has results notifications disabled or has
   * no registered device, a later run may try again.
   */
  if (
    usersNotified === 0
  ) {
    console.log(
      `${leagueName} ${weekLabel} is final, but no results notifications were delivered.`,
    )

    return false
  }

  await markerRef.set({
    type:
      'week-results',

    weekId,

    weekLabel,

    winnerIds:
      winners.map(
        (winner) =>
          winner.userId,
      ),

    winnerNames,

    winningScore:
      winningRecord.correct,

    usersNotified,

    devicesNotified,

    sentAt:
      FieldValue.serverTimestamp(),
  })

  console.log(
    `✓ ${leagueName} ${weekLabel}: ${body} Sent to ${usersNotified} user(s) / ${devicesNotified} device(s).`,
  )

  return true
}


console.log(
  'Checking for completed weeks...',
)

const leaguesSnapshot =
  await db
    .collection('leagues')
    .get()

let weeksNotified = 0

for (
  const leagueDocument of
  leaguesSnapshot.docs
) {
  const weeksSnapshot =
    await db
      .collection('leagues')
      .doc(
        leagueDocument.id,
      )
      .collection('weeks')
      .where(
        'published',
        '==',
        true,
      )
      .get()

  for (
    const weekDocument of
    weeksSnapshot.docs
  ) {
    if (
      await processWeek(
        leagueDocument,
        weekDocument,
      )
    ) {
      weeksNotified += 1
    }
  }
}

console.log('')

console.log(
  weeksNotified === 0
    ? 'No new completed-week notifications to send.'
    : `Sent results notifications for ${weeksNotified} completed week(s).`,
)