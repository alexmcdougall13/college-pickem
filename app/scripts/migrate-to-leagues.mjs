import { cert, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

/*
 * ONE-TIME MULTI-LEAGUE MIGRATION
 *
 * Copies the original single-league data into:
 *
 * leagues/{leagueId}
 * leagues/{leagueId}/members/{userId}
 * leagues/{leagueId}/weeks/{weekId}
 * leagues/{leagueId}/games/{gameId}
 * leagues/{leagueId}/picks/{pickId}
 * leagues/{leagueId}/tiebreakers/{tiebreakerId}
 *
 * IMPORTANT:
 * - COPY ONLY
 * - Does NOT delete the old collections
 * - Does NOT modify the old collections
 * - Safe to re-run because destination documents use merge:true
 */

const LEAGUE_ID = 'legacy-2026'
const LEAGUE_NAME = 'College Pick’em'
const SEASON = 2026

/*
 * ============================================================
 * FIREBASE
 * ============================================================
 */

const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(
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

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function generateJoinCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

  let code = ''

  for (let i = 0; i < length; i += 1) {
    code +=
      alphabet[Math.floor(Math.random() * alphabet.length)]
  }

  return code
}

async function copyCollection(
  sourceName,
  destinationCollection,
) {
  const sourceSnapshot = await db
    .collection(sourceName)
    .get()

  if (sourceSnapshot.empty) {
    console.log(`  ${sourceName}: 0 documents`)

    return {
      sourceCount: 0,
      destinationCount: 0,
    }
  }

  const writer = db.bulkWriter()

  for (const sourceDocument of sourceSnapshot.docs) {
    writer.set(
      destinationCollection.doc(sourceDocument.id),
      {
        ...sourceDocument.data(),
        migratedFromLegacy: true,
        migratedAt: FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      },
    )
  }

  await writer.close()

  const destinationSnapshot =
    await destinationCollection.get()

  console.log(
    `  ${sourceName}: ${sourceSnapshot.size} source → ${destinationSnapshot.size} destination`,
  )

  return {
    sourceCount: sourceSnapshot.size,
    destinationCount: destinationSnapshot.size,
  }
}

/*
 * ============================================================
 * MIGRATION
 * ============================================================
 */

async function main() {
  console.log('')
  console.log(
    '====================================================',
  )
  console.log(
    ' College Pick’em — Multi-League Migration',
  )
  console.log(
    '====================================================',
  )
  console.log('')

  console.log(`Project: ${serviceAccount.projectId}`)
  console.log(`League ID: ${LEAGUE_ID}`)
  console.log(
    'Mode: COPY ONLY — legacy data will not be deleted',
  )
  console.log('')

  /*
   * ----------------------------------------------------------
   * 1. LOAD USERS
   * ----------------------------------------------------------
   */

  const usersSnapshot = await db
    .collection('users')
    .get()

  if (usersSnapshot.empty) {
    throw new Error(
      'No users were found. Migration stopped.',
    )
  }

  const users = usersSnapshot.docs.map(
    (userDocument) => ({
      id: userDocument.id,
      ...userDocument.data(),
    }),
  )

  const admins = users.filter(
    (user) => user.isAdmin === true,
  )

  if (admins.length === 0) {
    throw new Error(
      'No legacy admin account was found. Migration stopped.',
    )
  }

  const creator = admins[0]

  console.log(`Users found: ${users.length}`)

  console.log(
    `League creator/admin: ${
      creator.firstName ??
      creator.name ??
      creator.email ??
      creator.id
    }`,
  )

  /*
   * ----------------------------------------------------------
   * 2. CREATE LEAGUE
   * ----------------------------------------------------------
   */

  const leagueRef = db
    .collection('leagues')
    .doc(LEAGUE_ID)

  const existingLeague = await leagueRef.get()

  let joinCode

  if (existingLeague.exists) {
    joinCode =
      existingLeague.data()?.joinCode ||
      generateJoinCode()

    await leagueRef.set(
      {
        name: LEAGUE_NAME,
        joinCode,
        season: SEASON,

        createdBy:
          existingLeague.data()?.createdBy ||
          creator.id,

        migrationVersion: 1,
        migratedFromLegacy: true,

        updatedAt:
          FieldValue.serverTimestamp(),
      },
      {
        merge: true,
      },
    )

    console.log(
      `League already existed; preserving join code ${joinCode}`,
    )
  } else {
    joinCode = generateJoinCode()

    await leagueRef.set({
      name: LEAGUE_NAME,
      joinCode,
      season: SEASON,

      createdBy: creator.id,

      createdAt:
        FieldValue.serverTimestamp(),

      migrationVersion: 1,
      migratedFromLegacy: true,
    })

    console.log(
      `Created league with join code ${joinCode}`,
    )
  }

  /*
   * ----------------------------------------------------------
   * 3. CREATE LEAGUE MEMBERSHIPS
   * ----------------------------------------------------------
   */

  console.log('')
  console.log('Creating league memberships...')

  const memberWriter = db.bulkWriter()

  for (const user of users) {
    const role =
      user.isAdmin === true
        ? 'admin'
        : 'player'

    memberWriter.set(
      leagueRef
        .collection('members')
        .doc(user.id),

      {
        userId: user.id,
        role,

        joinedAt:
          FieldValue.serverTimestamp(),

        migratedFromLegacy: true,
      },

      {
        merge: true,
      },
    )

    console.log(
      `  ${
        user.firstName ??
        user.name ??
        user.email ??
        user.id
      }: ${role}`,
    )
  }

  await memberWriter.close()

  /*
   * ----------------------------------------------------------
   * 4. COPY WEEKS
   * ----------------------------------------------------------
   */

  console.log('')
  console.log('Copying legacy collections...')

  const results = {}

  results.weeks = await copyCollection(
    'weeks',
    leagueRef.collection('weeks'),
  )

  /*
   * ----------------------------------------------------------
   * 5. COPY GAMES
   * ----------------------------------------------------------
   */

  results.games = await copyCollection(
    'games',
    leagueRef.collection('games'),
  )

  /*
   * ----------------------------------------------------------
   * 6. COPY PICKS
   * ----------------------------------------------------------
   */

  results.picks = await copyCollection(
    'picks',
    leagueRef.collection('picks'),
  )

  /*
   * ----------------------------------------------------------
   * 7. COPY TIEBREAKERS
   * ----------------------------------------------------------
   */

  results.tiebreakers = await copyCollection(
    'tiebreakers',
    leagueRef.collection('tiebreakers'),
  )

  /*
   * ----------------------------------------------------------
   * 8. VERIFY MEMBERS
   * ----------------------------------------------------------
   */

  const memberSnapshot = await leagueRef
    .collection('members')
    .get()

  /*
   * ----------------------------------------------------------
   * 9. VERIFY EVERYTHING
   * ----------------------------------------------------------
   */

  console.log('')
  console.log('Verification')
  console.log('------------')

  const checks = [
    {
      label: 'members',
      expected: users.length,
      actual: memberSnapshot.size,
    },

    ...Object.entries(results).map(
      ([label, value]) => ({
        label,
        expected: value.sourceCount,
        actual: value.destinationCount,
      }),
    ),
  ]

  let passed = true

  for (const check of checks) {
    const ok =
      check.expected === check.actual

    console.log(
      `  ${ok ? '✓' : '✗'} ${check.label}: ${check.actual} / ${check.expected}`,
    )

    if (!ok) {
      passed = false
    }
  }

  console.log('')

  /*
   * ----------------------------------------------------------
   * 10. FINAL RESULT
   * ----------------------------------------------------------
   */

  if (!passed) {
    throw new Error(
      'Migration copy completed, but one or more verification counts did not match. Legacy data is untouched.',
    )
  }

  console.log(
    '====================================================',
  )
  console.log(
    ' MIGRATION VERIFIED',
  )
  console.log(
    '====================================================',
  )
  console.log('')

  console.log(`League: ${LEAGUE_NAME}`)
  console.log(`League ID: ${LEAGUE_ID}`)
  console.log(`Join code: ${joinCode}`)

  console.log('')

  console.log(
    'Legacy collections were NOT deleted or changed.',
  )

  console.log(
    'Do not remove the temporary migration Firestore permissions yet.',
  )

  console.log(
    'Next step: switch the website to read/write the league collections.',
  )

  console.log('')
}

/*
 * ============================================================
 * RUN
 * ============================================================
 */

main().catch((error) => {
  console.error('')
  console.error('MIGRATION FAILED')
  console.error(error)
  console.error('')

  console.error(
    'No legacy documents were deleted. Fix the error before continuing.',
  )

  process.exitCode = 1
})