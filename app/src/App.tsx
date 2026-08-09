import { useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { auth, db } from './firebase/firebase'
import './App.css'

type Tab =
  | 'home'
  | 'picks'
  | 'standings'
  | 'history'
  | 'settings'
  | 'admin'

type AuthMode = 'signin' | 'signup' | 'reset'

type Team = {
  id: string
  name: string
  rank?: number
  logo: string
  line: number
}

type Game = {
  id: string
  gameId: string
  gameName?: string
  kickoff: string
  awayTeam: Team
  homeTeam: Team
  selected: boolean
  tiebreaker: boolean
  order: number
  final?: boolean
  winnerTeamId?: string | null
  awayScore?: number | null
  homeScore?: number | null
}

type AvailableGame = {
  id: string
  gameId: string
  gameName: string
  kickoff: string
  awayTeamName: string
  awayTeamRank?: number
  homeTeamName: string
  homeTeamRank?: number
  homeTeamLine: number | null
  rating: number
  ratingRank: number
  selected: boolean
  tiebreaker: boolean
}

type LeaguePlayer = {
  uid: string
  name: string
}

type HomePicks = Record<string, Record<string, string>>
type HomeTiebreakers = Record<string, number>

type Picks = Record<string, string>

const WEEK_ID = '2026-week-1'

const regularTabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'picks', label: 'Picks', icon: '🏈' },
  { id: 'standings', label: 'Standings', icon: '▥' },
  { id: 'history', label: 'History', icon: '↺' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

function formatKickoff(kickoff: string) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(kickoff))
}

function formatLine(line: number) {
  return line > 0 ? `+${line}` : `${line}`
}

function isGameLocked(kickoff: string) {
  return Date.now() >= new Date(kickoff).getTime()
}

function TeamCard({
  team,
  designation,
  selected,
  onSelect,
  disabled,
}: {
  team: Team
  designation: 'Away' | 'Home'
  selected: boolean
  onSelect: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={selected ? 'team-card selected' : 'team-card'}
      onClick={() => {
        if (!selected && !disabled) onSelect()
      }}
      aria-pressed={selected}
      disabled={disabled}
    >
      {selected && (
        <span className="selected-check" aria-hidden="true">
          ✓
        </span>
      )}

      <span className="team-designation">{designation}</span>

      <span className="team-name">
        {team.rank && <span className="team-rank">{team.rank}</span>}
        {team.name}
      </span>

      <img src={team.logo} alt={`${team.name} logo`} />

      <span className="team-line">{formatLine(team.line)}</span>
    </button>
  )
}

function StaticTeamCard({
  team,
  designation,
}: {
  team: Team
  designation: 'Away' | 'Home'
}) {
  return (
    <div className="team-card static-card">
      <span className="team-designation">{designation}</span>

      <span className="team-name">
        {team.rank && <span className="team-rank">{team.rank}</span>}
        {team.name}
      </span>

      <img src={team.logo} alt={`${team.name} logo`} />
    </div>
  )
}

function GameHeader({ game }: { game: Game }) {
  return (
    <header className="game-header">
      {game.gameName && <h3>{game.gameName}</h3>}
      <p>{formatKickoff(game.kickoff)}</p>
    </header>
  )
}

function HomePage({
  currentUserId,
  players,
  games,
  picksMade,
  totalGames,
  homePicks,
  homeTiebreakers,
}: {
  currentUserId: string
  players: LeaguePlayer[]
  games: Game[]
  picksMade: number
  totalGames: number
  homePicks: HomePicks
  homeTiebreakers: HomeTiebreakers
}) {
  const orderedPlayers = [...players].sort((a, b) => {
    if (a.uid === currentUserId) return -1
    if (b.uid === currentUserId) return 1
    return a.name.localeCompare(b.name)
  })

  const getPickTeam = (game: Game, teamId?: string) => {
    if (!teamId) return null
    if (game.awayTeam.id === teamId) return game.awayTeam
    if (game.homeTeam.id === teamId) return game.homeTeam
    return null
  }

  const getWeeklyScore = (player: LeaguePlayer) => {
    if (!player.uid) return 0

    return games.reduce((score, game) => {
      if (!game.final || !game.winnerTeamId) return score
      const pick = homePicks[game.gameId]?.[player.uid]
      return pick === game.winnerTeamId ? score + 1 : score
    }, 0)
  }

  const tiebreakerGame = games.find((game) => game.tiebreaker) ?? null

  return (
    <>
      <header className="app-header">
        <p className="eyebrow">2026 Season</p>
        <h1>College Pick&apos;em</h1>
        <p className="subtitle">Private league for Alex, Sean, and Ben</p>
      </header>

      <section className="week-card">
        <p className="week-label">Current Week</p>
        <h2>Week 1</h2>

        <div className="pick-status">
          <span>
            {picksMade} of {totalGames} picks made
          </span>

          <strong>
            {totalGames === 0
              ? 'No games published yet'
              : picksMade === totalGames
                ? 'All picks completed'
                : `${totalGames - picksMade} picks remaining`}
          </strong>
        </div>
      </section>

      {games.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <div
            style={{
              background: '#fff',
              border: '1px solid #d9e0ea',
              borderRadius: 18,
              overflow: 'hidden',
              boxShadow: '0 10px 30px rgba(15, 23, 42, 0.05)',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 440 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.55fr repeat(3, 1fr)',
                    alignItems: 'center',
                    borderBottom: '1px solid #e7ebf1',
                    background: '#f8fafc',
                  }}
                >
                  <div style={{ padding: '14px 12px' }}>
                    <span className="eyebrow" style={{ margin: 0 }}>
                      Week 1 Picks
                    </span>
                  </div>

                  {orderedPlayers.map((player) => (
                    <div
                      key={player.name}
                      style={{
                        padding: '12px 6px',
                        textAlign: 'center',
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: 14 }}>
                        {player.name}
                      </div>
                      <div
                        style={{
                          marginTop: 3,
                          fontSize: 20,
                          lineHeight: 1,
                          fontWeight: 800,
                        }}
                      >
                        {getWeeklyScore(player)}
                      </div>
                    </div>
                  ))}
                </div>

                {games.map((game) => {
                  const locked = isGameLocked(game.kickoff)

                  return (
                    <div
                      key={game.gameId}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.55fr repeat(3, 1fr)',
                        alignItems: 'stretch',
                        borderBottom: '1px solid #edf0f5',
                      }}
                    >
                      <div
                        style={{
                          padding: '10px 8px',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                          alignItems: 'center',
                          textAlign: 'center',
                          minWidth: 0,
                          minHeight: 82,
                        }}
                      >
                        <div
                          style={{
                            width: '100%',
                            fontSize: 11,
                            fontWeight: 800,
                            lineHeight: 1.15,
                            textAlign: 'center',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {game.awayTeam.name}
                          </div>
                          <div
                            style={{
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            at {game.homeTeam.name}
                          </div>
                        </div>

                        <div
                          style={{
                            width: '100%',
                            marginTop: 5,
                            fontSize: 10,
                            lineHeight: 1.15,
                            color: '#64748b',
                            whiteSpace: 'nowrap',
                            textAlign: 'center',
                          }}
                        >
                          {game.final &&
                          game.awayScore != null &&
                          game.homeScore != null
                            ? `Final · ${game.awayScore}-${game.homeScore}`
                            : formatKickoff(game.kickoff)}
                        </div>
                      </div>

                      {orderedPlayers.map((player) => {
                        const canReveal =
                          player.uid === currentUserId || locked
                        const teamId = player.uid
                          ? homePicks[game.gameId]?.[player.uid]
                          : undefined
                        const team = getPickTeam(game, teamId)
                        const correct =
                          game.final &&
                          Boolean(game.winnerTeamId) &&
                          teamId === game.winnerTeamId
                        const incorrect =
                          game.final &&
                          Boolean(teamId) &&
                          Boolean(game.winnerTeamId) &&
                          teamId !== game.winnerTeamId

                        return (
                          <div
                            key={`${game.gameId}-${player.name}`}
                            style={{
                              minHeight: 82,
                              borderLeft: '1px solid #edf0f5',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: 8,
                            }}
                          >
                            {!canReveal ? (
                              <div
                                title="Hidden until kickoff"
                                style={{
                                  width: 38,
                                  height: 38,
                                  borderRadius: '50%',
                                  background: '#eef2f7',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 16,
                                }}
                              >
                                🔒
                              </div>
                            ) : team ? (
                              <div
                                style={{
                                  position: 'relative',
                                  width: 54,
                                  height: 54,
                                  borderRadius: 14,
                                  background: correct
                                    ? '#ecfdf3'
                                    : incorrect
                                      ? '#fff1f1'
                                      : '#f8fafc',
                                  border: correct
                                    ? '2px solid #3aaa55'
                                    : incorrect
                                      ? '2px solid #dc5a5a'
                                      : '1px solid #dbe2ea',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                }}
                              >
                                <img
                                  src={team.logo}
                                  alt={team.name}
                                  style={{
                                    width: 38,
                                    height: 38,
                                    objectFit: 'contain',
                                  }}
                                />
                                {(correct || incorrect) && (
                                  <span
                                    style={{
                                      position: 'absolute',
                                      top: -7,
                                      right: -7,
                                      width: 20,
                                      height: 20,
                                      borderRadius: '50%',
                                      background: correct ? '#3aaa55' : '#dc5a5a',
                                      color: '#fff',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      fontSize: 12,
                                      fontWeight: 900,
                                    }}
                                  >
                                    {correct ? '✓' : '×'}
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span style={{ color: '#94a3b8', fontWeight: 700 }}>
                                —
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}

                {tiebreakerGame && (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.55fr repeat(3, 1fr)',
                      alignItems: 'center',
                      background: '#f8fafc',
                    }}
                  >
                    <div style={{ padding: '14px 12px' }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>
                        Tiebreaker
                      </div>
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                        Combined points
                      </div>
                    </div>

                    {orderedPlayers.map((player) => {
                      const reveal =
                        player.uid === currentUserId ||
                        isGameLocked(tiebreakerGame.kickoff)
                      const value = player.uid
                        ? homeTiebreakers[player.uid]
                        : undefined

                      return (
                        <div
                          key={`tb-${player.name}`}
                          style={{
                            minHeight: 58,
                            borderLeft: '1px solid #edf0f5',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 17,
                            fontWeight: 800,
                          }}
                        >
                          {reveal ? (value ?? '—') : '🔒'}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  )
}

function PicksPage({
  games,
  tiebreakerGame,
  picks,
  onPick,
  tiebreaker,
  onTiebreakerChange,
  savingGameId,
  savingTiebreaker,
  saveError,
}: {
  games: Game[]
  tiebreakerGame: Game | null
  picks: Picks
  onPick: (gameId: string, teamId: string) => Promise<void>
  tiebreaker: string
  onTiebreakerChange: (value: string) => void
  savingGameId: string | null
  savingTiebreaker: boolean
  saveError: string
}) {
  const picksMade = Object.keys(picks).length

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">Week 1</p>
        <h1>Make Picks</h1>
        <p className="subtitle">
          {picksMade} of {games.length} games selected
        </p>

        {saveError && <p className="login-error">{saveError}</p>}
      </header>

      {games.length === 0 ? (
        <section className="week-card">
          <strong>No games have been published yet.</strong>
        </section>
      ) : (
        <div className="games-list">
          {games.map((game) => (
            <section className="game-section" key={game.id}>
              <GameHeader game={game} />

              <div className="team-grid">
                <TeamCard
                  team={game.awayTeam}
                  designation="Away"
                  selected={picks[game.gameId] === game.awayTeam.id}
                  onSelect={() => onPick(game.gameId, game.awayTeam.id)}
                  disabled={
                    savingGameId === game.gameId ||
                    isGameLocked(game.kickoff)
                  }
                />

                <TeamCard
                  team={game.homeTeam}
                  designation="Home"
                  selected={picks[game.gameId] === game.homeTeam.id}
                  onSelect={() => onPick(game.gameId, game.homeTeam.id)}
                  disabled={
                    savingGameId === game.gameId ||
                    isGameLocked(game.kickoff)
                  }
                />
              </div>

              {isGameLocked(game.kickoff) && (
                <p className="save-status">Picks Locked</p>
              )}

              {savingGameId === game.gameId && !isGameLocked(game.kickoff) && (
                <p className="save-status">Saving pick…</p>
              )}
            </section>
          ))}
        </div>
      )}

      {tiebreakerGame && (
        <section className="tiebreaker-section">
          <div className="tiebreaker-label">Tiebreaker</div>

          <GameHeader game={tiebreakerGame} />

          <div className="team-grid">
            <StaticTeamCard
              team={tiebreakerGame.awayTeam}
              designation="Away"
            />

            <StaticTeamCard
              team={tiebreakerGame.homeTeam}
              designation="Home"
            />
          </div>

          <label className="tiebreaker-input">
            <span>Predicted combined total points</span>

            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder="54"
              value={tiebreaker}
              disabled={isGameLocked(tiebreakerGame.kickoff)}
              onChange={(event) =>
                onTiebreakerChange(event.target.value)
              }
            />
          </label>

          {isGameLocked(tiebreakerGame.kickoff) && (
            <p className="save-status">Tiebreaker Locked</p>
          )}

          {savingTiebreaker && !isGameLocked(tiebreakerGame.kickoff) && (
            <p className="save-status">Saving tiebreaker…</p>
          )}
        </section>
      )}
    </>
  )
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <section className="page-placeholder">
      <p className="eyebrow">College Pick&apos;em</p>
      <h1>{title}</h1>
      <p>This section is coming next.</p>
    </section>
  )
}

function AdminPage({
  onPublished,
}: {
  onPublished: () => Promise<void>
}) {
  const [availableGames, setAvailableGames] = useState<AvailableGame[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [publishMessage, setPublishMessage] = useState('')
  const [error, setError] = useState('')

  async function loadAvailableGames() {
    setLoading(true)
    setError('')

    try {
      const snapshot = await getDocs(collection(db, 'availableGames'))

      const loadedGames: AvailableGame[] = snapshot.docs
        .map((gameDocument) => {
          const data = gameDocument.data()

          return {
            id: gameDocument.id,
            gameId: String(data.gameId ?? gameDocument.id),
            gameName: String(data.gameName ?? ''),
            kickoff: String(data.kickoff ?? ''),
            awayTeamName: String(data.awayTeamName ?? 'Away'),
            awayTeamRank:
              typeof data.awayTeamRank === 'number'
                ? data.awayTeamRank
                : undefined,
            homeTeamName: String(data.homeTeamName ?? 'Home'),
            homeTeamRank:
              typeof data.homeTeamRank === 'number'
                ? data.homeTeamRank
                : undefined,
            homeTeamLine:
              typeof data.homeTeamLine === 'number'
                ? data.homeTeamLine
                : null,
            rating:
              typeof data.rating === 'number' ? data.rating : 0,
            ratingRank:
              typeof data.ratingRank === 'number'
                ? data.ratingRank
                : 9999,
            selected: data.selected === true,
            tiebreaker: data.tiebreaker === true,
          }
        })
        .sort((a, b) => {
          if (a.ratingRank !== b.ratingRank) {
            return a.ratingRank - b.ratingRank
          }

          return b.rating - a.rating
        })

      setAvailableGames(loadedGames)
    } catch (loadError) {
      console.error(loadError)
      setError('Unable to load available games.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAvailableGames()
  }, [])

  async function toggleSelection(game: AvailableGame) {
    const nextSelected = !game.selected

    setSavingId(game.id)
    setError('')

    setAvailableGames((current) =>
      current.map((item) =>
        item.id === game.id
          ? {
              ...item,
              selected: nextSelected,
              tiebreaker: nextSelected ? item.tiebreaker : false,
            }
          : item,
      ),
    )

    try {
      await setDoc(
        doc(db, 'availableGames', game.id),
        {
          selected: nextSelected,
          ...(nextSelected ? {} : { tiebreaker: false }),
        },
        { merge: true },
      )
    } catch (saveError) {
      console.error(saveError)
      setError('Unable to save the game selection.')
      await loadAvailableGames()
    } finally {
      setSavingId(null)
    }
  }

  async function toggleTiebreaker(game: AvailableGame) {
    if (!game.selected) return

    const nextTiebreaker = !game.tiebreaker

    setSavingId(game.id)
    setError('')

    const previousGames = availableGames

    setAvailableGames((current) =>
      current.map((item) => ({
        ...item,
        tiebreaker:
          item.id === game.id ? nextTiebreaker : false,
      })),
    )

    try {
      const batch = writeBatch(db)

      for (const item of previousGames) {
        if (item.tiebreaker && item.id !== game.id) {
          batch.set(
            doc(db, 'availableGames', item.id),
            { tiebreaker: false },
            { merge: true },
          )
        }
      }

      batch.set(
        doc(db, 'availableGames', game.id),
        { tiebreaker: nextTiebreaker },
        { merge: true },
      )

      await batch.commit()
    } catch (saveError) {
      console.error(saveError)
      setError('Unable to save the tiebreaker selection.')
      await loadAvailableGames()
    } finally {
      setSavingId(null)
    }
  }

  async function publishWeek() {
    const selectedGames = availableGames.filter((game) => game.selected)
    const selectedTiebreakers = selectedGames.filter((game) => game.tiebreaker)

    setError('')
    setPublishMessage('')

    if (selectedGames.length === 0) {
      setError('Select at least one game before publishing.')
      return
    }

    if (selectedTiebreakers.length !== 1) {
      setError('Select exactly one tiebreaker game before publishing.')
      return
    }

    const tiebreakerGameId = selectedTiebreakers[0].gameId

    const orderedGames = [...selectedGames].sort((a, b) => {
      const kickoffDifference =
        new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime()

      if (kickoffDifference !== 0) {
        return kickoffDifference
      }

      return b.rating - a.rating
    })

    setPublishing(true)

    try {
      const batch = writeBatch(db)

      const existingGamesQuery = query(
        collection(db, 'games'),
        where('weekId', '==', WEEK_ID),
      )

      const existingGamesSnapshot = await getDocs(existingGamesQuery)

      for (const existingGame of existingGamesSnapshot.docs) {
        batch.delete(existingGame.ref)
      }

      for (let index = 0; index < orderedGames.length; index += 1) {
        const game = orderedGames[index]
        const sourceSnapshot = await getDoc(doc(db, 'availableGames', game.id))
        const source = sourceSnapshot.data()

        if (!source) {
          throw new Error(`Missing available game ${game.id}`)
        }

        batch.set(doc(db, 'games', game.gameId), {
          weekId: WEEK_ID,
          gameId: game.gameId,
          gameName: source.gameName || '',
          kickoff: source.kickoff,
          kickoffTimestamp: Timestamp.fromDate(new Date(source.kickoff)),
          selected: true,
          tiebreaker: game.gameId === tiebreakerGameId,
          order: index + 1,

          awayTeamId: source.awayTeamId,
          awayTeamName: source.awayTeamName,
          awayTeamRank: source.awayTeamRank ?? null,
          awayTeamLogo: source.awayTeamLogo || '',
          awayTeamLine:
            typeof source.homeTeamLine === 'number'
              ? -source.homeTeamLine
              : 0,

          homeTeamId: source.homeTeamId,
          homeTeamName: source.homeTeamName,
          homeTeamRank: source.homeTeamRank ?? null,
          homeTeamLogo: source.homeTeamLogo || '',
          homeTeamLine:
            typeof source.homeTeamLine === 'number'
              ? source.homeTeamLine
              : 0,

          rating: source.rating ?? 0,
          ratingRank: source.ratingRank ?? null,
          final: source.final === true,
          winnerTeamId:
            typeof source.winnerTeamId === 'string'
              ? source.winnerTeamId
              : null,
          awayScore:
            typeof source.awayScore === 'number' ? source.awayScore : null,
          homeScore:
            typeof source.homeScore === 'number' ? source.homeScore : null,
          publishedAt: serverTimestamp(),
        })
      }

      await batch.commit()
      await onPublished()

      setPublishMessage(
        `Week 1 published with ${orderedGames.length} games. Tiebreaker is last.`,
      )
    } catch (publishError) {
      console.error(publishError)
      setError('Unable to publish Week 1.')
    } finally {
      setPublishing(false)
    }
  }

  const selectedCount = availableGames.filter((game) => game.selected).length

  return (
    <section className="admin-page">
      <header className="page-header">
        <p className="eyebrow">League Management</p>
        <h1>Admin</h1>
        <p className="subtitle">
          {selectedCount} of {availableGames.length} games selected
        </p>
        {error && <p className="login-error">{error}</p>}
      </header>

      {!loading && availableGames.length > 0 && (
        <section className="week-card">
          <p className="week-label">Week 1</p>
          <h2>Publish Picks</h2>
          <div className="pick-status">
            <span>
              {selectedCount} games selected
            </span>
            <strong>
              {availableGames.some((game) => game.selected && game.tiebreaker)
                ? 'Tiebreaker selected'
                : 'Choose a tiebreaker'}
            </strong>
          </div>

          <button
            type="button"
            className="settings-signout"
            onClick={publishWeek}
            disabled={publishing || savingId !== null}
            style={{ marginTop: 16 }}
          >
            {publishing ? 'Publishing…' : 'Publish Week 1'}
          </button>

          {publishMessage && (
            <p className="login-message" style={{ marginTop: 12 }}>
              {publishMessage}
            </p>
          )}
        </section>
      )}

      {loading ? (
        <section className="week-card">
          <strong>Loading available games…</strong>
        </section>
      ) : availableGames.length === 0 ? (
        <section className="week-card">
          <strong>No ESPN games have been imported yet.</strong>
        </section>
      ) : (
        <div
          style={{
            overflowX: 'auto',
            background: 'white',
            border: '1px solid #d9e0ea',
            borderRadius: 18,
          }}
        >
          <table
            style={{
              width: '100%',
              minWidth: 760,
              borderCollapse: 'collapse',
              fontSize: 14,
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: 'left',
                  borderBottom: '1px solid #d9e0ea',
                }}
              >
                <th style={{ padding: '14px 10px', textAlign: 'center' }}>
                  Ranking
                </th>
                <th style={{ padding: '14px 10px' }}>Kickoff Time</th>
                <th style={{ padding: '14px 10px' }}>Away</th>
                <th style={{ padding: '14px 10px' }}>Home</th>
                <th style={{ padding: '14px 10px', textAlign: 'center' }}>
                  Rating
                </th>
                <th style={{ padding: '14px 10px', textAlign: 'center' }}>
                  Selection
                </th>
                <th style={{ padding: '14px 10px', textAlign: 'center' }}>
                  Tiebreaker
                </th>
              </tr>
            </thead>

            <tbody>
              {availableGames.map((game) => (
                <tr
                  key={game.id}
                  style={{
                    borderBottom: '1px solid #edf0f5',
                    opacity: savingId === game.id ? 0.6 : 1,
                  }}
                >
                  <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                    {game.ratingRank}
                  </td>

                  <td style={{ padding: '12px 10px', whiteSpace: 'nowrap' }}>
                    {game.kickoff ? formatKickoff(game.kickoff) : '—'}
                  </td>

                  <td style={{ padding: '12px 10px', whiteSpace: 'nowrap' }}>
                    {game.awayTeamRank && (
                      <strong style={{ marginRight: 6 }}>
                        {game.awayTeamRank}
                      </strong>
                    )}
                    {game.awayTeamName}
                    {game.homeTeamLine != null && (
                      <strong style={{ marginLeft: 8 }}>
                        {formatLine(-game.homeTeamLine)}
                      </strong>
                    )}
                  </td>

                  <td style={{ padding: '12px 10px', whiteSpace: 'nowrap' }}>
                    {game.homeTeamRank && (
                      <strong style={{ marginRight: 6 }}>
                        {game.homeTeamRank}
                      </strong>
                    )}
                    {game.homeTeamName}
                    {game.homeTeamLine != null && (
                      <strong style={{ marginLeft: 8 }}>
                        {formatLine(game.homeTeamLine)}
                      </strong>
                    )}
                  </td>

                  <td
                    style={{
                      padding: '12px 10px',
                      textAlign: 'center',
                      fontWeight: 700,
                    }}
                  >
                    {game.rating.toFixed(2)}
                  </td>

                  <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={game.selected}
                      disabled={savingId !== null}
                      onChange={() => toggleSelection(game)}
                      aria-label={`Select ${game.awayTeamName} at ${game.homeTeamName}`}
                      style={{ width: 20, height: 20 }}
                    />
                  </td>

                  <td style={{ padding: '12px 10px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={game.tiebreaker}
                      disabled={!game.selected || savingId !== null}
                      onChange={() => toggleTiebreaker(game)}
                      aria-label={`Use ${game.awayTeamName} at ${game.homeTeamName} as tiebreaker`}
                      style={{ width: 20, height: 20 }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function SettingsPage({
  user,
  isAdmin,
}: {
  user: User
  isAdmin: boolean
}) {
  async function handleSignOut() {
    await signOut(auth)
  }

  return (
    <section className="page-placeholder">
      <p className="eyebrow">College Pick&apos;em</p>
      <h1>Settings</h1>

      <p>Signed in as {user.email}</p>

      {isAdmin && <p>Administrator account</p>}

      <button
        type="button"
        className="settings-signout"
        onClick={handleSignOut}
      >
        Sign Out
      </button>
    </section>
  )
}

function LoginPage() {
  const [mode, setMode] = useState<AuthMode>('signin')
  const [firstName, setFirstName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  function resetMessages() {
    setError('')
    setMessage('')
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    resetMessages()
    setLoading(true)

    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password)
      }

      if (mode === 'signup') {
        if (password !== confirmPassword) {
          setError('Passwords do not match.')
          return
        }

        if (!firstName.trim()) {
          setError('Enter your first name.')
          return
        }

        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        )

        await setDoc(doc(db, 'users', credential.user.uid), {
          name: firstName.trim(),
          email: credential.user.email ?? email,
          isAdmin: false,
        })
      }

      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email)
        setMessage('Password reset email sent. Check your inbox.')
      }
    } catch {
      setError(
        mode === 'reset'
          ? 'Unable to send reset email.'
          : 'Unable to continue. Check your information and try again.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <p className="eyebrow">2026 Season</p>
        <h1>College Pick&apos;em</h1>

        <p className="subtitle">
          {mode === 'signin' && 'Sign in to make your picks.'}
          {mode === 'signup' &&
            'Create your College Pick’em account.'}
          {mode === 'reset' && 'Reset your password.'}
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <label>
              <span>First Name</span>
              <input
                type="text"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                required
              />
            </label>
          )}

          <label>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          {mode !== 'reset' && (
            <label>
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                required
              />
            </label>
          )}

          {mode === 'signup' && (
            <label>
              <span>Confirm Password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(event.target.value)
                }
                required
              />
            </label>
          )}

          {error && <p className="login-error">{error}</p>}
          {message && <p className="login-message">{message}</p>}

          <button type="submit" disabled={loading}>
            {loading
              ? 'Please wait…'
              : mode === 'signin'
                ? 'Sign In'
                : mode === 'signup'
                  ? 'Create Account'
                  : 'Send Reset Email'}
          </button>
        </form>

        <div className="auth-links">
          {mode === 'signin' && (
            <>
              <button
                type="button"
                onClick={() => {
                  resetMessages()
                  setMode('signup')
                }}
              >
                Create Account
              </button>

              <button
                type="button"
                onClick={() => {
                  resetMessages()
                  setMode('reset')
                }}
              >
                Forgot Password?
              </button>
            </>
          )}

          {mode !== 'signin' && (
            <button
              type="button"
              onClick={() => {
                resetMessages()
                setMode('signin')
              }}
            >
              Back to Sign In
            </button>
          )}
        </div>
      </div>
    </main>
  )
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [dataLoading, setDataLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [games, setGames] = useState<Game[]>([])
  const [picks, setPicks] = useState<Picks>({})
  const [leaguePlayers, setLeaguePlayers] = useState<LeaguePlayer[]>([])
  const [homePicks, setHomePicks] = useState<HomePicks>({})
  const [homeTiebreakers, setHomeTiebreakers] = useState<HomeTiebreakers>({})
  const [tiebreaker, setTiebreaker] = useState('')
  const [savingGameId, setSavingGameId] =
    useState<string | null>(null)
  const [savingTiebreaker, setSavingTiebreaker] =
    useState(false)
  const [saveError, setSaveError] = useState('')
  const [gamesRefreshKey, setGamesRefreshKey] = useState(0)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        setUser(firebaseUser)
        setAuthLoading(false)
      },
    )

    return unsubscribe
  }, [])

  useEffect(() => {
  if (!user) {
    setIsAdmin(false)
    setGames([])
    setPicks({})
    setLeaguePlayers([])
    setHomePicks({})
    setHomeTiebreakers({})
    setTiebreaker('')
    return
  }

  const currentUser = user

  async function loadUserData() {
      setDataLoading(true)
      setSaveError('')

      try {
        const userSnapshot = await getDoc(
          doc(db, 'users', currentUser.uid),
        )

        const currentUserData = userSnapshot.exists()
          ? userSnapshot.data()
          : {}

        if (userSnapshot.exists()) {
          setIsAdmin(currentUserData.isAdmin === true)
        } else {
          setIsAdmin(false)
        }

        const usersSnapshot = await getDocs(collection(db, 'users'))
        const savedPlayers: LeaguePlayer[] = usersSnapshot.docs.map(
          (userDocument) => {
            const data = userDocument.data()
            const fallbackName =
              userDocument.id === currentUser.uid && data.isAdmin === true
                ? 'Alex'
                : String(data.email ?? '')
                    .split('@')[0]
                    .replace(/[^a-zA-Z]/g, '') || 'Player'

            return {
              uid: userDocument.id,
              name: String(data.name ?? data.firstName ?? fallbackName),
            }
          },
        )

        const knownPlayerNames = ['Alex', 'Ben', 'Sean']
        const playerSlots: LeaguePlayer[] = knownPlayerNames.map((name) => {
          const match = savedPlayers.find(
            (player) => player.name.toLowerCase() === name.toLowerCase(),
          )

          if (match) return match

          if (
            name === 'Alex' &&
            currentUserData.isAdmin === true &&
            !savedPlayers.some((player) => player.uid === currentUser.uid)
          ) {
            return { uid: currentUser.uid, name: 'Alex' }
          }

          return { uid: '', name }
        })

        const currentSavedPlayer = savedPlayers.find(
          (player) => player.uid === currentUser.uid,
        )

        if (
          currentSavedPlayer &&
          !playerSlots.some((player) => player.uid === currentUser.uid)
        ) {
          playerSlots[0] = currentSavedPlayer
        }

        setLeaguePlayers(playerSlots)

        const gamesQuery = query(
          collection(db, 'games'),
          where('weekId', '==', WEEK_ID),
          where('selected', '==', true),
        )

        const gamesSnapshot = await getDocs(gamesQuery)

        const loadedGames: Game[] = gamesSnapshot.docs
          .map((gameDocument) => {
            const data = gameDocument.data()

            return {
              id: gameDocument.id,
              gameId: data.gameId,
              gameName: data.gameName || '',
              kickoff: data.kickoff,
              selected: data.selected,
              tiebreaker: data.tiebreaker,
              order: data.order,
              final: data.final === true,
              winnerTeamId:
                typeof data.winnerTeamId === 'string'
                  ? data.winnerTeamId
                  : null,
              awayScore:
                typeof data.awayScore === 'number' ? data.awayScore : null,
              homeScore:
                typeof data.homeScore === 'number' ? data.homeScore : null,
              awayTeam: {
                id: data.awayTeamId,
                name: data.awayTeamName,
                rank: data.awayTeamRank,
                logo: data.awayTeamLogo,
                line: data.awayTeamLine,
              },
              homeTeam: {
                id: data.homeTeamId,
                name: data.homeTeamName,
                rank: data.homeTeamRank,
                logo: data.homeTeamLogo,
                line: data.homeTeamLine,
              },
            }
          })
          .sort((a, b) => a.order - b.order)

        setGames(loadedGames)

        const picksQuery = query(
          collection(db, 'picks'),
          where('userId', '==', currentUser.uid),
          where('weekId', '==', WEEK_ID),
        )

        const picksSnapshot = await getDocs(picksQuery)
        const loadedPicks: Picks = {}

        const currentGameIds = new Set(
          loadedGames.map((game) => game.gameId),
        )

        picksSnapshot.forEach((pickDocument) => {
          const data = pickDocument.data()

          if (
            data.gameId &&
            data.teamId &&
            currentGameIds.has(data.gameId)
          ) {
            loadedPicks[data.gameId] = data.teamId
          }
        })

        setPicks(loadedPicks)

        const loadedHomePicks: HomePicks = {}

        Object.entries(loadedPicks).forEach(([gameId, teamId]) => {
          loadedHomePicks[gameId] = {
            ...(loadedHomePicks[gameId] ?? {}),
            [currentUser.uid]: teamId,
          }
        })

        const lockedGames = loadedGames.filter((game) =>
          isGameLocked(game.kickoff),
        )

        await Promise.all(
          lockedGames.map(async (game) => {
            const revealedSnapshot = await getDocs(
              query(
                collection(db, 'picks'),
                where('gameId', '==', game.gameId),
              ),
            )

            revealedSnapshot.forEach((pickDocument) => {
              const data = pickDocument.data()

              if (data.userId && data.teamId) {
                loadedHomePicks[game.gameId] = {
                  ...(loadedHomePicks[game.gameId] ?? {}),
                  [String(data.userId)]: String(data.teamId),
                }
              }
            })
          }),
        )

        setHomePicks(loadedHomePicks)

        const tiebreakerId = `${currentUser.uid}_${WEEK_ID}`

        const tiebreakerSnapshot = await getDoc(
          doc(db, 'tiebreakers', tiebreakerId),
        )

        const loadedHomeTiebreakers: HomeTiebreakers = {}

        if (tiebreakerSnapshot.exists()) {
          const data = tiebreakerSnapshot.data()

          if (typeof data.totalPoints === 'number') {
            setTiebreaker(String(data.totalPoints))
            loadedHomeTiebreakers[currentUser.uid] = data.totalPoints
          }
        }

        const loadedTiebreakerGame =
          loadedGames.find((game) => game.tiebreaker) ?? null

        if (
          loadedTiebreakerGame &&
          isGameLocked(loadedTiebreakerGame.kickoff)
        ) {
          const revealedTiebreakers = await getDocs(
            query(
              collection(db, 'tiebreakers'),
              where('gameId', '==', loadedTiebreakerGame.gameId),
            ),
          )

          revealedTiebreakers.forEach((document) => {
            const data = document.data()

            if (data.userId && typeof data.totalPoints === 'number') {
              loadedHomeTiebreakers[String(data.userId)] = data.totalPoints
            }
          })
        }

        setHomeTiebreakers(loadedHomeTiebreakers)
      } catch (error) {
        console.error(error)
        setSaveError('Unable to load the current week.')
      } finally {
        setDataLoading(false)
      }
    }

    loadUserData()
  }, [user, gamesRefreshKey])

  async function refreshPublishedGames() {
    setGamesRefreshKey((current) => current + 1)
  }

  async function savePick(
    gameId: string,
    teamId: string,
  ) {
    if (!user) return

    const game = games.find((item) => item.gameId === gameId)

    if (!game || isGameLocked(game.kickoff)) {
      setSaveError('This game is locked because kickoff has passed.')
      return
    }

    const previousTeamId = picks[gameId]

    setPicks((current) => ({
      ...current,
      [gameId]: teamId,
    }))

    setHomePicks((current) => ({
      ...current,
      [gameId]: {
        ...(current[gameId] ?? {}),
        [user.uid]: teamId,
      },
    }))

    setSavingGameId(gameId)
    setSaveError('')

    try {
      const pickId = `${user.uid}_${WEEK_ID}_${gameId}`

      await setDoc(doc(db, 'picks', pickId), {
        userId: user.uid,
        weekId: WEEK_ID,
        gameId,
        teamId,
        updatedAt: serverTimestamp(),
      })
    } catch (error) {
      console.error(error)

      setPicks((current) => {
        const next = { ...current }

        if (previousTeamId) {
          next[gameId] = previousTeamId
        } else {
          delete next[gameId]
        }

        return next
      })

      setHomePicks((current) => {
        const next = { ...current }
        const gamePicks = { ...(next[gameId] ?? {}) }

        if (previousTeamId) {
          gamePicks[user.uid] = previousTeamId
        } else {
          delete gamePicks[user.uid]
        }

        next[gameId] = gamePicks
        return next
      })

      setSaveError(
        'Your pick could not be saved. Please try again.',
      )
    } finally {
      setSavingGameId(null)
    }
  }

  async function saveTiebreaker(value: string) {
    if (!user) return

    const tiebreakerGame = games.find(
      (game) => game.tiebreaker,
    )

    if (!tiebreakerGame) {
      setSaveError('No tiebreaker game has been selected.')
      return
    }

    if (isGameLocked(tiebreakerGame.kickoff)) {
      setSaveError('The tiebreaker is locked because kickoff has passed.')
      return
    }

    setTiebreaker(value)
    setSaveError('')

    if (value === '') return

    const points = Number(value)

    if (!Number.isInteger(points) || points < 0) {
      setSaveError('Tiebreaker must be a whole number.')
      return
    }

    setHomeTiebreakers((current) => ({
      ...current,
      [user.uid]: points,
    }))

    setSavingTiebreaker(true)

    try {
      const tiebreakerId = `${user.uid}_${WEEK_ID}`

      await setDoc(
        doc(db, 'tiebreakers', tiebreakerId),
        {
          userId: user.uid,
          weekId: WEEK_ID,
          gameId: tiebreakerGame.gameId,
          totalPoints: points,
          updatedAt: serverTimestamp(),
        },
      )
    } catch (error) {
      console.error(error)
      setSaveError(
        'Your tiebreaker could not be saved. Please try again.',
      )
    } finally {
      setSavingTiebreaker(false)
    }
  }

  if (authLoading) {
    return (
      <main className="loading-screen">
        College Pick&apos;em
      </main>
    )
  }

  if (!user) {
    return <LoginPage />
  }

  if (dataLoading) {
    return (
      <main className="loading-screen">
        Loading Week 1…
      </main>
    )
  }

  const tiebreakerGame =
    games.find((game) => game.tiebreaker) ?? null

  const tabs = isAdmin
    ? [
        ...regularTabs,
        {
          id: 'admin' as Tab,
          label: 'Admin',
          icon: '🛠',
        },
      ]
    : regularTabs

  let page

  if (activeTab === 'home') {
    page = (
      <HomePage
        currentUserId={user.uid}
        players={leaguePlayers}
        games={games}
        picksMade={Object.keys(picks).length}
        totalGames={games.length}
        homePicks={homePicks}
        homeTiebreakers={homeTiebreakers}
      />
    )
  } else if (activeTab === 'picks') {
    page = (
      <PicksPage
        games={games}
        tiebreakerGame={tiebreakerGame}
        picks={picks}
        onPick={savePick}
        tiebreaker={tiebreaker}
        onTiebreakerChange={saveTiebreaker}
        savingGameId={savingGameId}
        savingTiebreaker={savingTiebreaker}
        saveError={saveError}
      />
    )
  } else if (activeTab === 'standings') {
    page = <PlaceholderPage title="Standings" />
  } else if (activeTab === 'history') {
    page = <PlaceholderPage title="History" />
  } else if (activeTab === 'settings') {
    page = (
      <SettingsPage
        user={user}
        isAdmin={isAdmin}
      />
    )
  } else if (
    activeTab === 'admin' &&
    isAdmin
  ) {
    page = <AdminPage onPublished={refreshPublishedGames} />
  } else {
    page = (
      <HomePage
        currentUserId={user.uid}
        players={leaguePlayers}
        games={games}
        picksMade={Object.keys(picks).length}
        totalGames={games.length}
        homePicks={homePicks}
        homeTiebreakers={homeTiebreakers}
      />
    )
  }

  return (
    <div className="app-shell">
      <main className="app-content">{page}</main>

      <nav
        className="bottom-nav"
        aria-label="Primary navigation"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={
              activeTab === tab.id
                ? 'nav-item active'
                : 'nav-item'
            }
            onClick={() => setActiveTab(tab.id)}
            aria-current={
              activeTab === tab.id
                ? 'page'
                : undefined
            }
          >
            <span
              className="nav-icon"
              aria-hidden="true"
            >
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default App