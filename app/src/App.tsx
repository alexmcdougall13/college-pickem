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

type ThemePreference = 'light' | 'dark' | 'system'

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
  status?: string
  statusState?: string
  period?: number | null
  displayClock?: string
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

type LeagueRole = 'admin' | 'player'

type League = {
  id: string
  name: string
  joinCode: string
  season: number
}

type LeagueMembership = {
  leagueId: string
  userId: string
  role: LeagueRole
}

type HomePicks = Record<string, Record<string, string>>
type HomeTiebreakers = Record<string, number>

type Picks = Record<string, string>

type Week = {
  weekId: string
  weekNumber: number
  label: string
  stake: number
  status: 'open' | 'final'
  competitionType: 'regular' | 'postseason'
  tiebreakerGameId: string
  gameCount: number
  published: boolean
}

type SeasonWeekData = {
  week: Week
  games: Game[]
  picks: HomePicks
  tiebreakers: HomeTiebreakers
}

const SEASON = 2026
const LEGACY_LEAGUE_ID = 'legacy-2026'



function makeWeekId(weekNumber: number) {
  return `${SEASON}-week-${weekNumber}`
}

const DEFAULT_WEEK: Week = {
  weekId: makeWeekId(1),
  weekNumber: 1,
  label: 'Week 1',
  stake: 10,
  status: 'open',
  competitionType: 'regular',
  tiebreakerGameId: '',
  gameCount: 0,
  published: false,
}

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

function formatGameClock(displayClock: string) {
  const match = displayClock.match(/^(\d+):(\d{1,2})$/)

  if (!match) {
    return displayClock
  }

  const minutes = Number(match[1])
  const seconds = Number(match[2])

  if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return displayClock
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatPeriod(period?: number | null) {
  if (!period || period < 1) {
    return ''
  }

  if (period === 1) return '1st'
  if (period === 2) return '2nd'
  if (period === 3) return '3rd'
  if (period === 4) return '4th'
  if (period === 5) return 'OT'

  return `${period - 4}OT`
}

function getHomeGameStatus(game: Game) {
  if (game.final) {
    return game.status || 'Final'
  }

  if (game.statusState === 'in') {
    const period = formatPeriod(game.period)
    const clock = formatGameClock(game.displayClock || '')

    if (period && clock) {
      return `${period} · ${clock}`
    }

    return game.status || 'Live'
  }

  return formatKickoff(game.kickoff)
}


type PickAgainstSpreadStatus = 'ahead' | 'behind' | 'push' | 'pending'

function getPickAgainstSpreadStatus(
  game: Game,
  teamId?: string,
): PickAgainstSpreadStatus {
  if (
    !teamId ||
    game.awayScore == null ||
    game.homeScore == null ||
    (game.statusState !== 'in' && !game.final)
  ) {
    return 'pending'
  }

  let margin = 0

  if (teamId === game.awayTeam.id) {
    margin =
      game.awayScore +
      game.awayTeam.line -
      game.homeScore
  } else if (teamId === game.homeTeam.id) {
    margin =
      game.homeScore +
      game.homeTeam.line -
      game.awayScore
  } else {
    return 'pending'
  }

  if (margin > 0) return 'ahead'
  if (margin < 0) return 'behind'

  return 'push'
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
  weekLabel,
  leagueName,
}: {
  currentUserId: string
  players: LeaguePlayer[]
  games: Game[]
  picksMade: number
  totalGames: number
  homePicks: HomePicks
  homeTiebreakers: HomeTiebreakers
  weekLabel: string
  leagueName: string
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
      if (!game.final) return score

      const pick = homePicks[game.gameId]?.[player.uid]
      const result = getPickAgainstSpreadStatus(game, pick)

      return result === 'ahead' ? score + 1 : score
    }, 0)
  }

  const tiebreakerGame = games.find((game) => game.tiebreaker) ?? null
  const playerColumnWidth = 86
  const gameColumnWidth = 142
  const picksGridMinWidth = Math.max(
    440,
    gameColumnWidth + orderedPlayers.length * playerColumnWidth,
  )
  const picksGridTemplate = `${gameColumnWidth}px repeat(${Math.max(
    orderedPlayers.length,
    1,
  )}, minmax(${playerColumnWidth}px, 1fr))`

  return (
    <>
      <header className="app-header">
        <p className="eyebrow">2026 Season</p>
        <h1>College Pick&apos;em</h1>
        <p className="subtitle">{leagueName}</p>
      </header>

      <section className="week-card">
        <p className="week-label">Current Week</p>
        <h2>{weekLabel}</h2>

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
              <div style={{ minWidth: picksGridMinWidth }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: picksGridTemplate,
                    alignItems: 'center',
                    borderBottom: '1px solid #e7ebf1',
                    background: '#f8fafc',
                  }}
                >
                  <div style={{ padding: '14px 12px' }}>
                    <span className="eyebrow" style={{ margin: 0 }}>
                      {weekLabel} Picks
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
                  const awayText = game.awayTeam.name
                  const homeText = `at ${game.homeTeam.name}`
                  const longestTeamLine = Math.max(
                    awayText.length,
                    homeText.length,
                  )
                  const sharedTeamFontSize = Math.max(
                    8,
                    Math.min(
                      11,
                      11 - Math.max(0, longestTeamLine - 16) * 0.18,
                    ),
                  )

                  return (
                    <div
                      key={game.gameId}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: picksGridTemplate,
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
                              position: 'relative',
                              width: '100%',
                              minHeight: 14,
                              padding: '0 22px',
                              boxSizing: 'border-box',
                            }}
                          >
                            <div
                              style={{
                                position: 'absolute',
                                left: '50%',
                                top: 0,
                                transform: 'translateX(-50%)',
                                whiteSpace: 'nowrap',
                                textAlign: 'center',
                                fontSize: `${sharedTeamFontSize}px`,
                                letterSpacing: '-0.01em',
                              }}
                            >
                              {game.awayTeam.name}
                            </div>

                            {(game.statusState === 'in' || game.final) &&
                              game.awayScore != null && (
                                <span
                                  style={{
                                    position: 'absolute',
                                    right: 0,
                                    top: 0,
                                    minWidth: 18,
                                    textAlign: 'right',
                                    fontVariantNumeric: 'tabular-nums',
                                  }}
                                >
                                  {game.awayScore}
                                </span>
                              )}
                          </div>

                          <div
                            style={{
                              position: 'relative',
                              width: '100%',
                              minHeight: 14,
                              padding: '0 22px',
                              boxSizing: 'border-box',
                              marginTop: 2,
                            }}
                          >
                            <div
                              style={{
                                position: 'absolute',
                                left: '50%',
                                top: 0,
                                transform: 'translateX(-50%)',
                                whiteSpace: 'nowrap',
                                textAlign: 'center',
                                fontSize: `${sharedTeamFontSize}px`,
                                letterSpacing: '-0.01em',
                              }}
                            >
                              at {game.homeTeam.name}
                            </div>

                            {(game.statusState === 'in' || game.final) &&
                              game.homeScore != null && (
                                <span
                                  style={{
                                    position: 'absolute',
                                    right: 0,
                                    top: 0,
                                    minWidth: 18,
                                    textAlign: 'right',
                                    fontVariantNumeric: 'tabular-nums',
                                  }}
                                >
                                  {game.homeScore}
                                </span>
                              )}
                          </div>
                        </div>

                        <div
                          style={{
                            width: '100%',
                            marginTop: 5,
                            fontSize: 10,
                            lineHeight: 1.15,
                            color:
                              game.statusState === 'in'
                                ? '#1d4ed8'
                                : '#64748b',
                            fontWeight:
                              game.statusState === 'in' || game.final
                                ? 700
                                : 400,
                            whiteSpace: 'nowrap',
                            textAlign: 'center',
                          }}
                        >
                          {getHomeGameStatus(game)}
                        </div>
                      </div>

                      {orderedPlayers.map((player) => {
                        const canReveal =
                          player.uid === currentUserId || locked
                        const teamId = player.uid
                          ? homePicks[game.gameId]?.[player.uid]
                          : undefined
                        const team = getPickTeam(game, teamId)
                        const spreadStatus =
                          getPickAgainstSpreadStatus(game, teamId)
                        const correct =
                          game.final && spreadStatus === 'ahead'
                        const incorrect =
                          game.final && spreadStatus === 'behind'
                        const liveAhead =
                          !game.final &&
                          game.statusState === 'in' &&
                          spreadStatus === 'ahead'
                        const liveBehind =
                          !game.final &&
                          game.statusState === 'in' &&
                          spreadStatus === 'behind'
                        const livePush =
                          !game.final &&
                          game.statusState === 'in' &&
                          spreadStatus === 'push'

                        return (
                          <div
                            key={`${game.gameId}-${player.name}`}
                            style={{
                              minHeight: 88,
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
                                  width: 58,
                                  minHeight: 68,
                                  borderRadius: 14,
                                  background:
                                    correct
                                      ? '#e7f8ec'
                                      : incorrect
                                        ? '#fde8e8'
                                        : liveAhead
                                          ? '#eefaf1'
                                          : liveBehind
                                            ? '#fff1f1'
                                            : livePush
                                              ? '#fff8e6'
                                              : '#f8fafc',
                                  border:
                                    correct
                                      ? '2px solid #3aaa55'
                                      : incorrect
                                        ? '2px solid #dc5a5a'
                                        : liveAhead
                                          ? '1px solid #9bd5aa'
                                          : liveBehind
                                            ? '1px solid #efb0b0'
                                            : livePush
                                              ? '1px solid #e9cf84'
                                              : '1px solid #dbe2ea',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: '6px 4px 5px',
                                  boxSizing: 'border-box',
                                }}
                              >
                                <img
                                  src={team.logo}
                                  alt={team.name}
                                  style={{
                                    width: 34,
                                    height: 34,
                                    objectFit: 'contain',
                                  }}
                                />

                                <div
                                  style={{
                                    marginTop: 3,
                                    fontSize: 11,
                                    lineHeight: 1,
                                    fontWeight: 800,
                                    color: '#172033',
                                    fontVariantNumeric: 'tabular-nums',
                                  }}
                                >
                                  {formatLine(team.line)}
                                </div>

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
                      gridTemplateColumns: picksGridTemplate,
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
  weekLabel,
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
  weekLabel: string
}) {
  const picksMade = Object.keys(picks).length

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">{weekLabel}</p>
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


function StandingsPage({
  players,
  seasonWeeks,
  currentWeek,
  currentUserId,
}: {
  players: LeaguePlayer[]
  seasonWeeks: SeasonWeekData[]
  currentWeek: Week
  currentUserId: string
}) {
  const rows = players.map((player) => ({
    ...player,
    correct: 0,
    losses: 0,
    weeklyWins: 0,
    balance: 0,
  }))

  const rowByUid = new Map(
    rows
      .filter((player) => Boolean(player.uid))
      .map((player) => [player.uid, player]),
  )

  for (const weekData of seasonWeeks) {
    const { week, games: weekGames, picks: weekPicks, tiebreakers } = weekData
    const finalGames = weekGames.filter((game) => game.final)

    for (const game of finalGames) {
      for (const player of rows) {
        if (!player.uid) continue

        const pick = weekPicks[game.gameId]?.[player.uid]
        const result = getPickAgainstSpreadStatus(game, pick)

        if (result === 'ahead') {
          player.correct += 1
        } else if (result === 'behind') {
          player.losses += 1
        }
      }
    }

    const allGamesFinal =
      weekGames.length > 0 &&
      weekGames.every((game) => game.final)

    if (!allGamesFinal) {
      continue
    }

    const weekResults = rows
      .filter((player) => Boolean(player.uid))
      .map((player) => {
        const weekCorrect = weekGames.reduce((total, game) => {
          const pick = weekPicks[game.gameId]?.[player.uid]
          const result = getPickAgainstSpreadStatus(game, pick)
          return result === 'ahead' ? total + 1 : total
        }, 0)

        const tiebreaker =
          typeof tiebreakers[player.uid] === 'number'
            ? tiebreakers[player.uid]
            : null

        return {
          uid: player.uid,
          weekCorrect,
          tiebreaker,
        }
      })

    if (weekResults.length === 0) continue

    const bestScore = Math.max(
      ...weekResults.map((result) => result.weekCorrect),
    )

    let winners = weekResults.filter(
      (result) => result.weekCorrect === bestScore,
    )

    const tiebreakerGame =
      weekGames.find((game) => game.tiebreaker) ?? null

    if (
      winners.length > 1 &&
      tiebreakerGame &&
      tiebreakerGame.awayScore != null &&
      tiebreakerGame.homeScore != null
    ) {
      const actualTotal =
        tiebreakerGame.awayScore + tiebreakerGame.homeScore

      const withTiebreakers = winners.filter(
        (winner) => winner.tiebreaker != null,
      )

      if (withTiebreakers.length > 0) {
        const bestDifference = Math.min(
          ...withTiebreakers.map((winner) =>
            Math.abs((winner.tiebreaker as number) - actualTotal),
          ),
        )

        winners = withTiebreakers.filter(
          (winner) =>
            Math.abs((winner.tiebreaker as number) - actualTotal) ===
            bestDifference,
        )
      }
    }

    const winnerIds = new Set(winners.map((winner) => winner.uid))
    const totalPot = week.stake * weekResults.length
    const payoutPerWinner =
      winners.length > 0 ? totalPot / winners.length : 0

    for (const result of weekResults) {
      const row = rowByUid.get(result.uid)
      if (!row) continue

      if (winnerIds.has(result.uid)) {
        row.weeklyWins += 1
        row.balance += payoutPerWinner - week.stake
      } else {
        row.balance -= week.stake
      }
    }
  }

  const rankedRows = [...rows].sort((a, b) => {
    const aTotal = a.correct + a.losses
    const bTotal = b.correct + b.losses
    const aPct = aTotal > 0 ? a.correct / aTotal : 0
    const bPct = bTotal > 0 ? b.correct / bTotal : 0

    if (bPct !== aPct) return bPct - aPct
    if (b.correct !== a.correct) return b.correct - a.correct
    if (b.weeklyWins !== a.weeklyWins) return b.weeklyWins - a.weeklyWins
    return a.name.localeCompare(b.name)
  })

  const currentWeekData =
    seasonWeeks.find(
      (weekData) => weekData.week.weekId === currentWeek.weekId,
    ) ?? null

  const currentFinalGames =
    currentWeekData?.games.filter((game) => game.final) ?? []

  const currentAllFinal =
    Boolean(currentWeekData) &&
    currentWeekData!.games.length > 0 &&
    currentWeekData!.games.every((game) => game.final)

  function formatMoney(value: number) {
    if (value > 0) {
      return `+$${value.toFixed(value % 1 === 0 ? 0 : 2)}`
    }

    if (value < 0) {
      return `-$${Math.abs(value).toFixed(value % 1 === 0 ? 0 : 2)}`
    }

    return '$0'
  }

  const currentWeekRows = players
    .map((player) => {
      if (!player.uid || !currentWeekData) {
        return {
          player,
          correct: 0,
          remaining: null as number | null,
          tiebreaker: null as number | null,
        }
      }

      const correct = currentFinalGames.reduce((total, game) => {
        const pick =
          currentWeekData.picks[game.gameId]?.[player.uid]
        const result = getPickAgainstSpreadStatus(game, pick)
        return result === 'ahead' ? total + 1 : total
      }, 0)

      const remaining =
        currentWeekData.games.length - currentFinalGames.length

      const tiebreaker =
        typeof currentWeekData.tiebreakers[player.uid] === 'number'
          ? currentWeekData.tiebreakers[player.uid]
          : null

      return {
        player,
        correct,
        remaining,
        tiebreaker,
      }
    })
    .sort((a, b) => {
      if (b.correct !== a.correct) {
        return b.correct - a.correct
      }

      if (a.player.uid === currentUserId && b.player.uid !== currentUserId) {
        return -1
      }

      if (b.player.uid === currentUserId && a.player.uid !== currentUserId) {
        return 1
      }

      return a.player.name.localeCompare(b.player.name)
    })

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">{SEASON} Season</p>
        <h1>Standings</h1>
        <p className="subtitle">
          Season totals through {currentWeek.label}
        </p>
      </header>

      <section
        style={{
          background: '#fff',
          border: '1px solid #d9e0ea',
          borderRadius: 18,
          overflow: 'hidden',
          boxShadow: '0 10px 30px rgba(15, 23, 42, 0.05)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '44px 1.4fr .9fr .9fr 1fr',
            gap: 0,
            padding: '12px 10px',
            background: '#f8fafc',
            borderBottom: '1px solid #e7ebf1',
            fontSize: 11,
            fontWeight: 800,
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: '.04em',
          }}
        >
          <div style={{ textAlign: 'center' }}>#</div>
          <div style={{ textAlign: 'center' }}>Player</div>
          <div style={{ textAlign: 'center' }}>Record</div>
          <div style={{ textAlign: 'center' }}>Wins</div>
          <div style={{ textAlign: 'center' }}>Balance</div>
        </div>

        {rankedRows.map((player, index) => {
          const total = player.correct + player.losses
          const pct =
            total > 0
              ? `${Math.round((player.correct / total) * 100)}%`
              : '—'

          return (
            <div
              key={player.uid || player.name}
              style={{
                display: 'grid',
                gridTemplateColumns: '44px 1.4fr .9fr .9fr 1fr',
                gap: 0,
                alignItems: 'center',
                padding: '15px 10px',
                borderBottom:
                  index === rankedRows.length - 1
                    ? 'none'
                    : '1px solid #edf0f5',
              }}
            >
              <div style={{ fontWeight: 800, textAlign: 'center' }}>
                {index + 1}
              </div>
              <div style={{ fontWeight: 800, textAlign: 'center' }}>
                {player.name}
              </div>

              <div style={{ textAlign: 'center', fontWeight: 800 }}>
                {player.correct}-{player.losses}
                <span
                  style={{
                    marginLeft: 5,
                    color: '#64748b',
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {pct}
                </span>
              </div>

              <div style={{ textAlign: 'center', fontWeight: 800 }}>
                {player.weeklyWins}
              </div>

              <div
                className={
                  player.balance > 0
                    ? 'money-positive'
                    : player.balance < 0
                      ? 'money-negative'
                      : ''
                }
                style={{
                  textAlign: 'center',
                  fontWeight: 900,
                }}
              >
                {formatMoney(player.balance)}
              </div>
            </div>
          )
        })}
      </section>

      <section
        style={{
          marginTop: 20,
          background: '#fff',
          border: '1px solid #d9e0ea',
          borderRadius: 18,
          padding: 18,
        }}
      >
        <p className="week-label">Current Week</p>
        <h2 style={{ marginTop: 4, marginBottom: 16 }}>
          {currentWeek.label}
        </h2>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '44px 1.1fr .9fr .9fr',
            gap: 8,
            padding: '0 0 8px',
            color: '#64748b',
            fontSize: 11,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '.04em',
          }}
        >
          <span style={{ textAlign: 'center' }}>#</span>
          <span style={{ textAlign: 'center' }}>Player</span>
          <span style={{ textAlign: 'center' }}>Correct</span>
          <span style={{ textAlign: 'center' }}>
            {currentAllFinal ? 'Tiebreaker' : 'Games Left'}
          </span>
        </div>

        {currentWeekRows.map((row, index) => (
          <div
            key={`current-${row.player.uid || row.player.name}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '44px 1.1fr .9fr .9fr',
              gap: 8,
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: '1px solid #edf0f5',
            }}
          >
            <strong style={{ textAlign: 'center' }}>{index + 1}</strong>

            <strong style={{ textAlign: 'center' }}>
              {row.player.name}
            </strong>

            <span style={{ textAlign: 'center' }}>
              {row.correct} correct
            </span>

            <span style={{ textAlign: 'center', color: '#64748b' }}>
              {currentAllFinal
                ? row.tiebreaker == null
                  ? '—'
                  : `TB ${row.tiebreaker}`
                : row.remaining == null
                  ? '—'
                  : `${row.remaining} left`}
            </span>
          </div>
        ))}

        <p
          style={{
            marginTop: 14,
            marginBottom: 0,
            color: '#64748b',
            fontSize: 12,
          }}
        >
          {currentAllFinal
            ? `${currentWeek.label} is final and included in season money totals.`
            : 'Season record updates as games become final. Weekly money settles after the full week is final.'}
        </p>
      </section>
    </>
  )
}


function HistoryPage({
  players,
  seasonWeeks,
  currentUserId,
}: {
  players: LeaguePlayer[]
  seasonWeeks: SeasonWeekData[]
  currentUserId: string
}) {
  const orderedWeeks = [...seasonWeeks].sort(
    (a, b) => b.week.weekNumber - a.week.weekNumber,
  )

  const [selectedWeekId, setSelectedWeekId] = useState(
    orderedWeeks[0]?.week.weekId ?? '',
  )

  useEffect(() => {
    if (
      orderedWeeks.length > 0 &&
      !orderedWeeks.some(
        (weekData) => weekData.week.weekId === selectedWeekId,
      )
    ) {
      setSelectedWeekId(orderedWeeks[0].week.weekId)
    }
  }, [orderedWeeks, selectedWeekId])

  const selectedWeek =
    orderedWeeks.find(
      (weekData) => weekData.week.weekId === selectedWeekId,
    ) ??
    orderedWeeks[0] ??
    null

  const orderedPlayers = [...players].sort((a, b) => {
    if (a.uid === currentUserId) return -1
    if (b.uid === currentUserId) return 1
    return a.name.localeCompare(b.name)
  })

  const historyPlayerColumnWidth = 86
  const historyGameColumnWidth = 142
  const historyGridMinWidth = Math.max(
    440,
    historyGameColumnWidth +
      orderedPlayers.length * historyPlayerColumnWidth,
  )
  const historyGridTemplate = `${historyGameColumnWidth}px repeat(${Math.max(
    orderedPlayers.length,
    1,
  )}, minmax(${historyPlayerColumnWidth}px, 1fr))`

  const getPickTeam = (game: Game, teamId?: string) => {
    if (!teamId) return null
    if (teamId === game.awayTeam.id) return game.awayTeam
    if (teamId === game.homeTeam.id) return game.homeTeam
    return null
  }

  const formatHistoricalStatus = (game: Game) => {
    if (game.final) {
      return game.status || 'Final'
    }

    if (game.statusState === 'in') {
      return getHomeGameStatus(game)
    }

    return formatKickoff(game.kickoff)
  }

  if (!selectedWeek) {
    return (
      <section className="page-placeholder">
        <p className="eyebrow">{SEASON} Season</p>
        <h1>History</h1>
        <p>No weeks have been published yet.</p>
      </section>
    )
  }

  const allGamesFinal =
    selectedWeek.games.length > 0 &&
    selectedWeek.games.every((game) => game.final)

  const tiebreakerGame =
    selectedWeek.games.find((game) => game.tiebreaker) ?? null

  const weekRows = orderedPlayers
    .map((player) => {
      const correct = selectedWeek.games.reduce((total, game) => {
        if (!game.final || !player.uid) return total

        const pick =
          selectedWeek.picks[game.gameId]?.[player.uid]
        const result = getPickAgainstSpreadStatus(game, pick)

        return result === 'ahead' ? total + 1 : total
      }, 0)

      return {
        player,
        correct,
        tiebreaker:
          player.uid &&
          typeof selectedWeek.tiebreakers[player.uid] === 'number'
            ? selectedWeek.tiebreakers[player.uid]
            : null,
      }
    })
    .sort((a, b) => {
      if (b.correct !== a.correct) {
        return b.correct - a.correct
      }

      if (
        a.player.uid === currentUserId &&
        b.player.uid !== currentUserId
      ) {
        return -1
      }

      if (
        b.player.uid === currentUserId &&
        a.player.uid !== currentUserId
      ) {
        return 1
      }

      return a.player.name.localeCompare(b.player.name)
    })

  let winnerIds = new Set<string>()

  if (allGamesFinal && weekRows.length > 0) {
    const bestScore = Math.max(
      ...weekRows.map((row) => row.correct),
    )

    let winners = weekRows.filter(
      (row) => row.correct === bestScore,
    )

    if (
      winners.length > 1 &&
      tiebreakerGame &&
      tiebreakerGame.awayScore != null &&
      tiebreakerGame.homeScore != null
    ) {
      const actualTotal =
        tiebreakerGame.awayScore + tiebreakerGame.homeScore

      const withTiebreakers = winners.filter(
        (row) => row.tiebreaker != null,
      )

      if (withTiebreakers.length > 0) {
        const bestDifference = Math.min(
          ...withTiebreakers.map((row) =>
            Math.abs(
              (row.tiebreaker as number) - actualTotal,
            ),
          ),
        )

        winners = withTiebreakers.filter(
          (row) =>
            Math.abs(
              (row.tiebreaker as number) - actualTotal,
            ) === bestDifference,
        )
      }
    }

    winnerIds = new Set(
      winners.map((row) => row.player.uid),
    )
  }

  const totalPot = selectedWeek.week.stake * weekRows.length
  const payoutPerWinner =
    allGamesFinal && winnerIds.size > 0
      ? totalPot / winnerIds.size
      : 0

  const actualTiebreakerTotal =
    allGamesFinal &&
    tiebreakerGame &&
    tiebreakerGame.awayScore != null &&
    tiebreakerGame.homeScore != null
      ? tiebreakerGame.awayScore + tiebreakerGame.homeScore
      : null

  return (
    <>
      <header className="page-header">
        <p className="eyebrow">{SEASON} Season</p>
        <h1>History</h1>
        <p className="subtitle">
          Review picks and results from every week.
        </p>
      </header>

      <div
        style={{
          display: 'flex',
          gap: 8,
          overflowX: 'auto',
          paddingBottom: 4,
          marginBottom: 18,
        }}
      >
        {orderedWeeks.map((weekData) => {
          const selected =
            weekData.week.weekId === selectedWeek.week.weekId

          return (
            <button
              key={weekData.week.weekId}
              type="button"
              className={
                selected
                  ? 'history-week-button selected'
                  : 'history-week-button'
              }
              onClick={() =>
                setSelectedWeekId(weekData.week.weekId)
              }
              style={{
                flex: '0 0 auto',
                padding: '9px 14px',
                borderRadius: 999,
                border: selected
                  ? '2px solid #2563eb'
                  : '1px solid #cbd5e1',
                background: selected
                  ? '#eff6ff'
                  : 'transparent',
                color: 'inherit',
                font: 'inherit',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {weekData.week.label}
            </button>
          )
        })}
      </div>

      <section
        style={{
          background: '#fff',
          border: '1px solid #d9e0ea',
          borderRadius: 18,
          padding: 18,
          marginBottom: 18,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'flex-start',
          }}
        >
          <div>
            <p className="week-label" style={{ marginBottom: 4 }}>
              {allGamesFinal ? 'Final' : 'Current / Open'}
            </p>
            <h2 style={{ margin: 0 }}>
              {selectedWeek.week.label}
            </h2>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                color: '#64748b',
                fontSize: 11,
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '.04em',
              }}
            >
              Stake
            </div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>
              ${selectedWeek.week.stake}
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: 16,
            display: 'grid',
            gridTemplateColumns: '36px 1fr .9fr .9fr .9fr',
            gap: 8,
            color: '#64748b',
            fontSize: 11,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '.04em',
          }}
        >
          <span style={{ textAlign: 'center' }}>#</span>
          <span style={{ textAlign: 'center' }}>Player</span>
          <span style={{ textAlign: 'center' }}>Record</span>
          <span style={{ textAlign: 'center' }}>Tiebreaker</span>
          <span style={{ textAlign: 'center' }}>
            {allGamesFinal ? 'Payout' : 'Result'}
          </span>
        </div>

        {weekRows.map((row, index) => (
          <div
            key={`history-summary-${row.player.uid || row.player.name}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '36px 1fr .9fr .9fr .9fr',
              gap: 8,
              alignItems: 'center',
              padding: '10px 0',
              borderBottom: '1px solid #edf0f5',
            }}
          >
            <strong style={{ textAlign: 'center' }}>
              {index + 1}
            </strong>
            <strong style={{ textAlign: 'center' }}>
              {row.player.name}
            </strong>
            <span style={{ textAlign: 'center', fontWeight: 800 }}>
              {row.correct}-
              {selectedWeek.games.filter((game) => game.final).length -
                row.correct}
            </span>

            <span style={{ textAlign: 'center' }}>
              {row.tiebreaker == null ? '—' : row.tiebreaker}
            </span>

            <span
              className={
                allGamesFinal
                  ? winnerIds.has(row.player.uid)
                    ? 'money-positive'
                    : 'money-negative'
                  : ''
              }
              style={{
                textAlign: 'center',
                fontWeight:
                  allGamesFinal &&
                  winnerIds.has(row.player.uid)
                    ? 900
                    : 700,
              }}
            >
              {allGamesFinal
                ? winnerIds.has(row.player.uid)
                  ? `+$${(payoutPerWinner - selectedWeek.week.stake).toFixed(
                      (payoutPerWinner - selectedWeek.week.stake) % 1 === 0
                        ? 0
                        : 2,
                    )}`
                  : `-$${selectedWeek.week.stake}`
                : '—'}
            </span>
          </div>
        ))}

        {allGamesFinal && (
          <div
            style={{
              marginTop: 16,
              paddingTop: 14,
              borderTop: '1px solid #edf0f5',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 900 }}>
              {winnerIds.size === 1
                ? `${weekRows.find((row) => winnerIds.has(row.player.uid))?.player.name ?? 'Winner'} won ${selectedWeek.week.label}`
                : `${winnerIds.size} players split ${selectedWeek.week.label}`}
            </div>

            <div
              style={{
                marginTop: 5,
                color: '#64748b',
                fontSize: 12,
              }}
            >
              ${totalPot} pot
              {winnerIds.size > 1
                ? ` · $${payoutPerWinner.toFixed(
                    payoutPerWinner % 1 === 0 ? 0 : 2,
                  )} gross per winner`
                : ''}
            </div>

            {actualTiebreakerTotal != null && (
              <div
                style={{
                  marginTop: 5,
                  color: '#64748b',
                  fontSize: 12,
                }}
              >
                Tiebreaker actual: {actualTiebreakerTotal} combined points
              </div>
            )}
          </div>
        )}
      </section>

      <section
        style={{
          background: '#fff',
          border: '1px solid #d9e0ea',
          borderRadius: 18,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: historyGridTemplate,
            alignItems: 'center',
            borderBottom: '1px solid #e7ebf1',
            background: '#f8fafc',
            minWidth: historyGridMinWidth,
          }}
        >
          <div style={{ padding: '14px 10px' }}>
            <span className="eyebrow" style={{ margin: 0 }}>
              Game Results
            </span>
          </div>

          {orderedPlayers.map((player) => (
            <div
              key={`history-header-${player.uid || player.name}`}
              style={{
                padding: '12px 6px',
                textAlign: 'center',
                fontWeight: 800,
                fontSize: 13,
              }}
            >
              {player.name}
            </div>
          ))}
        </div>

        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 440 }}>
            {selectedWeek.games.map((game) => {
              const locked = isGameLocked(game.kickoff)

              return (
                <div
                  key={`history-game-${game.gameId}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: historyGridTemplate,
                    alignItems: 'stretch',
                    borderBottom: '1px solid #edf0f5',
                  }}
                >
                  <div
                    style={{
                      minHeight: 82,
                      padding: '10px 8px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                    }}
                  >
                    <strong
                      style={{
                        fontSize: 11,
                        lineHeight: 1.2,
                      }}
                    >
                      {game.awayTeam.name}
                      <br />
                      at {game.homeTeam.name}
                    </strong>

                    {(game.statusState === 'in' || game.final) &&
                      game.awayScore != null &&
                      game.homeScore != null && (
                        <div
                          style={{
                            marginTop: 4,
                            fontSize: 12,
                            fontWeight: 900,
                          }}
                        >
                          {game.awayScore} - {game.homeScore}
                        </div>
                      )}

                    <span
                      style={{
                        marginTop: 4,
                        color: '#64748b',
                        fontSize: 10,
                      }}
                    >
                      {formatHistoricalStatus(game)}
                    </span>
                  </div>

                  {orderedPlayers.map((player) => {
                    const canReveal =
                      player.uid === currentUserId || locked
                    const teamId = player.uid
                      ? selectedWeek.picks[game.gameId]?.[
                          player.uid
                        ]
                      : undefined
                    const team = getPickTeam(game, teamId)
                    const result =
                      getPickAgainstSpreadStatus(game, teamId)

                    return (
                      <div
                        key={`history-${game.gameId}-${player.uid || player.name}`}
                        style={{
                          minHeight: 82,
                          borderLeft: '1px solid #edf0f5',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 6,
                        }}
                      >
                        {!canReveal ? (
                          <span>🔒</span>
                        ) : team ? (
                          <div
                            style={{
                              position: 'relative',
                              width: 56,
                              minHeight: 66,
                              borderRadius: 14,
                              border:
                                game.final && result === 'ahead'
                                  ? '2px solid #3aaa55'
                                  : game.final &&
                                      result === 'behind'
                                    ? '2px solid #dc5a5a'
                                    : '1px solid #dbe2ea',
                              background:
                                game.final && result === 'ahead'
                                  ? '#e7f8ec'
                                  : game.final &&
                                      result === 'behind'
                                    ? '#fde8e8'
                                    : '#f8fafc',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '6px 4px 5px',
                              boxSizing: 'border-box',
                            }}
                          >
                            <img
                              src={team.logo}
                              alt={team.name}
                              style={{
                                width: 32,
                                height: 32,
                                objectFit: 'contain',
                              }}
                            />
                            <span
                              style={{
                                marginTop: 3,
                                fontSize: 11,
                                lineHeight: 1,
                                fontWeight: 800,
                              }}
                            >
                              {formatLine(team.line)}
                            </span>

                            {game.final &&
                              (result === 'ahead' ||
                                result === 'behind') && (
                                <span
                                  style={{
                                    position: 'absolute',
                                    top: -7,
                                    right: -7,
                                    width: 20,
                                    height: 20,
                                    borderRadius: '50%',
                                    background:
                                      result === 'ahead'
                                        ? '#3aaa55'
                                        : '#dc5a5a',
                                    color: '#fff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 12,
                                    fontWeight: 900,
                                  }}
                                >
                                  {result === 'ahead' ? '✓' : '×'}
                                </span>
                              )}
                          </div>
                        ) : (
                          <span
                            style={{
                              color: '#94a3b8',
                              fontWeight: 700,
                            }}
                          >
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
                  gridTemplateColumns:
                    '1.55fr repeat(3, 1fr)',
                  alignItems: 'center',
                  background: '#f8fafc',
                }}
              >
                <div style={{ padding: '14px 12px' }}>
                  <div
                    style={{
                      fontWeight: 800,
                      fontSize: 13,
                    }}
                  >
                    Tiebreaker
                  </div>
                  <div
                    style={{
                      color: '#64748b',
                      fontSize: 11,
                      marginTop: 2,
                    }}
                  >
                    Combined points
                  </div>
                </div>

                {orderedPlayers.map((player) => {
                  const reveal =
                    player.uid === currentUserId ||
                    isGameLocked(tiebreakerGame.kickoff)
                  const value = player.uid
                    ? selectedWeek.tiebreakers[player.uid]
                    : undefined

                  return (
                    <div
                      key={`history-tb-${player.uid || player.name}`}
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
      </section>
    </>
  )
}

function AdminPage({
  leagueId,
  onPublished,
  onStartNextWeek,
  onStartPostseason,
  currentWeek,
  currentWeekIsFinal,
}: {
  leagueId: string
  onPublished: () => Promise<void>
  onStartNextWeek: () => Promise<void>
  onStartPostseason: () => Promise<void>
  currentWeek: Week
  currentWeekIsFinal: boolean
}) {
  const [availableGames, setAvailableGames] = useState<AvailableGame[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [startingNextWeek, setStartingNextWeek] = useState(false)
  const [startingPostseason, setStartingPostseason] = useState(false)
  const [publishMessage, setPublishMessage] = useState('')
  const [error, setError] = useState('')
  const [stake, setStake] = useState(String(currentWeek.stake))
  const publishWeekNumber = currentWeek.weekNumber
  const publishWeekId = currentWeek.weekId
  const publishWeekLabel = currentWeek.label
  const isPostseason = currentWeek.competitionType === 'postseason'

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

  useEffect(() => {
    setStake(String(currentWeek.stake))
  }, [currentWeek.weekId, currentWeek.stake])

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

  async function startNextWeek() {
    const confirmed = window.confirm(
      `Start Week ${currentWeek.weekNumber + 1}? ${currentWeek.label} will remain saved for season standings and history.`,
    )

    if (!confirmed) return

    setStartingNextWeek(true)
    setError('')
    setPublishMessage('')

    try {
      await onStartNextWeek()
      setPublishMessage(`Week ${currentWeek.weekNumber + 1} is ready.`)
      await loadAvailableGames()
    } catch (startError) {
      console.error(startError)
      setError(`Unable to start Week ${currentWeek.weekNumber + 1}.`)
    } finally {
      setStartingNextWeek(false)
    }
  }

  async function startPostseason() {
    const confirmed = window.confirm(
      `Start Postseason? ${currentWeek.label} will remain saved as the final regular-season week. Army-Navy week can simply be skipped.`,
    )

    if (!confirmed) return

    setStartingPostseason(true)
    setError('')
    setPublishMessage('')

    try {
      await onStartPostseason()
      setPublishMessage(
        'Postseason is ready. Select all bowl and playoff games, choose the tiebreaker, and set the one-time stake.',
      )
      await loadAvailableGames()
    } catch (startError) {
      console.error(startError)
      setError('Unable to start Postseason.')
    } finally {
      setStartingPostseason(false)
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

    const stakeAmount = Number(stake)

    if (!Number.isFinite(stakeAmount) || stakeAmount < 0) {
      setError('Enter a valid weekly stake.')
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
        collection(db, 'leagues', leagueId, 'games'),
        where('weekId', '==', publishWeekId),
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

        batch.set(doc(db, 'leagues', leagueId, 'games', game.gameId), {
          weekId: publishWeekId,
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

      batch.set(
        doc(db, 'leagues', leagueId, 'weeks', publishWeekId),
        {
          weekId: publishWeekId,
          weekNumber: publishWeekNumber,
          label: publishWeekLabel,
          stake: stakeAmount,
          status: 'open',
          competitionType: currentWeek.competitionType,
          tiebreakerGameId,
          gameCount: orderedGames.length,
          published: true,
          publishedAt: serverTimestamp(),
        },
        { merge: true },
      )

      await batch.commit()
      await onPublished()

      setPublishMessage(
        `${publishWeekLabel} published with ${orderedGames.length} games at $${stakeAmount} per player.`,
      )
    } catch (publishError) {
      console.error(publishError)
      setError(`Unable to publish ${publishWeekLabel}.`)
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
          <div
            style={{
              marginBottom: 14,
              padding: '9px 11px',
              border: '1px solid #d9e0ea',
              borderRadius: 10,
              textAlign: 'center',
              fontSize: 12,
              fontWeight: 800,
            }}
          >
            {!currentWeek.published
              ? 'Not published'
              : currentWeekIsFinal
                ? 'Final'
                : 'Published'}
          </div>

          <p className="week-label">{publishWeekLabel}</p>
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

          <label
            style={{
              display: 'block',
              marginTop: 16,
              fontWeight: 700,
            }}
          >
            <span
              style={{
                display: 'block',
                marginBottom: 6,
                fontSize: 13,
                color: '#475569',
              }}
            >
              {isPostseason
                ? 'Postseason stake per player'
                : 'Weekly stake per player'}
            </span>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                maxWidth: 150,
              }}
            >
              <span style={{ fontWeight: 800 }}>$</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={stake}
                onChange={(event) => setStake(event.target.value)}
                disabled={publishing}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #cbd5e1',
                  borderRadius: 10,
                  font: 'inherit',
                }}
              />
            </div>
          </label>

          <button
            type="button"
            className="settings-signout"
            onClick={publishWeek}
            disabled={publishing || savingId !== null}
            style={{ marginTop: 16 }}
          >
            {publishing ? 'Publishing…' : `Publish ${publishWeekLabel}`}
          </button>

          {publishMessage && (
            <p className="login-message" style={{ marginTop: 12 }}>
              {publishMessage}
            </p>
          )}

          {!isPostseason ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    currentWeek.weekNumber >= 14
                      ? '1fr 1fr'
                      : '1fr',
                  gap: 10,
                  marginTop: 18,
                }}
              >
                <button
                  type="button"
                  onClick={startNextWeek}
                  disabled={
                    publishing ||
                    startingNextWeek ||
                    startingPostseason ||
                    savingId !== null ||
                    !currentWeek.published ||
                    !currentWeekIsFinal
                  }
                  style={{
                    padding: '11px 10px',
                    border: '1px solid #cbd5e1',
                    borderRadius: 10,
                    background: 'transparent',
                    color: 'inherit',
                    font: 'inherit',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {startingNextWeek
                    ? 'Starting…'
                    : `Start Week ${currentWeek.weekNumber + 1}`}
                </button>

                {currentWeek.weekNumber >= 14 && (
                  <button
                    type="button"
                    onClick={startPostseason}
                    disabled={
                      publishing ||
                      startingNextWeek ||
                      startingPostseason ||
                      savingId !== null ||
                      !currentWeek.published ||
                    !currentWeekIsFinal
                    }
                    style={{
                      padding: '11px 10px',
                      border: '1px solid #cbd5e1',
                      borderRadius: 10,
                      background: 'transparent',
                      color: 'inherit',
                      font: 'inherit',
                      fontWeight: 800,
                      cursor: 'pointer',
                    }}
                  >
                    {startingPostseason
                      ? 'Starting…'
                      : 'Start Postseason'}
                  </button>
                )}
              </div>

              {(!currentWeek.published || !currentWeekIsFinal) && (
                <p
                  style={{
                    margin: '8px 0 0',
                    color: '#64748b',
                    fontSize: 12,
                  }}
                >
                  {!currentWeek.published
                    ? 'Publish the current competition before advancing.'
                    : 'Week-transition controls unlock after every current-week game is final.'}
                </p>
              )}
            </>
          ) : (
            <p
              style={{
                margin: '16px 0 0',
                color: '#64748b',
                fontSize: 12,
              }}
            >
              Postseason includes all selected bowl and playoff games as one competition.
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
            background: 'var(--theme-surface, #fff)',
            border: '1px solid var(--theme-border, #d9e0ea)',
            borderRadius: 16,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '28px minmax(0, 1fr) 54px 44px 44px',
              gap: 6,
              alignItems: 'center',
              padding: '8px 8px',
              borderBottom: '1px solid var(--theme-border, #d9e0ea)',
              color: 'var(--theme-muted, #64748b)',
              fontSize: 9,
              fontWeight: 800,
              textTransform: 'uppercase',
              letterSpacing: '.03em',
            }}
          >
            <span style={{ textAlign: 'center' }}>#</span>
            <span>Game</span>
            <span style={{ textAlign: 'center' }}>Rating</span>
            <span style={{ textAlign: 'center' }}>Pick</span>
            <span style={{ textAlign: 'center' }}>TB</span>
          </div>

          {availableGames.map((game) => (
            <div
              key={game.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '28px minmax(0, 1fr) 54px 44px 44px',
                gap: 6,
                alignItems: 'center',
                minHeight: 66,
                padding: '7px 8px',
                borderBottom: '1px solid var(--theme-border, #edf0f5)',
                opacity: savingId === game.id ? 0.6 : 1,
              }}
            >
              <strong
                style={{
                  textAlign: 'center',
                  fontSize: 12,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {game.ratingRank}
              </strong>

              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: 6,
                    alignItems: 'baseline',
                  }}
                >
                  <strong
                    style={{
                      minWidth: 0,
                      fontSize: 11,
                      lineHeight: 1.15,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {game.awayTeamRank && (
                      <span style={{ marginRight: 4 }}>
                        #{game.awayTeamRank}
                      </span>
                    )}
                    {game.awayTeamName}
                  </strong>

                  <strong
                    style={{
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {game.homeTeamLine != null
                      ? formatLine(-game.homeTeamLine)
                      : '—'}
                  </strong>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: 6,
                    alignItems: 'baseline',
                    marginTop: 2,
                  }}
                >
                  <strong
                    style={{
                      minWidth: 0,
                      fontSize: 11,
                      lineHeight: 1.15,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span
                      style={{
                        color: 'var(--theme-muted, #64748b)',
                        fontWeight: 700,
                        marginRight: 4,
                      }}
                    >
                      at
                    </span>
                    {game.homeTeamRank && (
                      <span style={{ marginRight: 4 }}>
                        #{game.homeTeamRank}
                      </span>
                    )}
                    {game.homeTeamName}
                  </strong>

                  <strong
                    style={{
                      fontSize: 11,
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {game.homeTeamLine != null
                      ? formatLine(game.homeTeamLine)
                      : '—'}
                  </strong>
                </div>

                <div
                  style={{
                    marginTop: 4,
                    fontSize: 9,
                    lineHeight: 1.1,
                    color: 'var(--theme-muted, #64748b)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {game.kickoff ? formatKickoff(game.kickoff) : '—'}
                </div>
              </div>

              <strong
                style={{
                  textAlign: 'center',
                  fontSize: 11,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {game.rating.toFixed(2)}
              </strong>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 44,
                  cursor: savingId !== null ? 'default' : 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={game.selected}
                  disabled={savingId !== null}
                  onChange={() => toggleSelection(game)}
                  aria-label={`Select ${game.awayTeamName} at ${game.homeTeamName}`}
                  style={{
                    width: 20,
                    height: 20,
                    margin: 0,
                  }}
                />
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  minHeight: 44,
                  opacity: game.selected ? 1 : 0.45,
                  cursor:
                    game.selected && savingId === null
                      ? 'pointer'
                      : 'default',
                }}
              >
                <input
                  type="checkbox"
                  checked={game.tiebreaker}
                  disabled={!game.selected || savingId !== null}
                  onChange={() => toggleTiebreaker(game)}
                  aria-label={`Use ${game.awayTeamName} at ${game.homeTeamName} as tiebreaker`}
                  style={{
                    width: 20,
                    height: 20,
                    margin: 0,
                  }}
                />
              </label>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function SettingsPage({
  user,
  isAdmin,
  leagueName,
  themePreference,
  onThemePreferenceChange,
}: {
  user: User
  isAdmin: boolean
  leagueName: string
  themePreference: ThemePreference
  onThemePreferenceChange: (theme: ThemePreference) => void
}) {
  async function handleSignOut() {
    await signOut(auth)
  }

  const options: { value: ThemePreference; label: string; description: string }[] = [
    { value: 'light', label: 'Light', description: 'Always use light mode' },
    { value: 'dark', label: 'Dark', description: 'Always use dark mode' },
    { value: 'system', label: 'System', description: 'Match this device' },
  ]

  return (
    <section className="page-placeholder">
      <p className="eyebrow">College Pick&apos;em</p>
      <h1>Settings</h1>

      <div className="settings-card theme-settings-card">
        <h2>Appearance</h2>
        <p className="theme-settings-description">
          Choose how College Pick&apos;em looks on this device.
        </p>
        <div className="theme-options">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={themePreference === option.value ? 'theme-option selected' : 'theme-option'}
              onClick={() => onThemePreferenceChange(option.value)}
              aria-pressed={themePreference === option.value}
            >
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              <span className="theme-radio" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <div className="settings-card account-settings-card">
        <h2>Account</h2>
        <p>Signed in as {user.email}</p>
        <p>League: {leagueName}</p>
        <p>{isAdmin ? 'League administrator' : 'League player'}</p>
        <button type="button" className="settings-signout" onClick={handleSignOut}>
          Sign Out
        </button>
      </div>
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
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const savedTheme = localStorage.getItem('college-pickem-theme')
    return savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system'
      ? savedTheme
      : 'system'
  })
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches,
  )
  const [user, setUser] = useState<User | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [activeLeague, setActiveLeague] = useState<League | null>(null)
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
  const [currentWeek, setCurrentWeek] = useState<Week>(DEFAULT_WEEK)
  const [seasonWeeks, setSeasonWeeks] = useState<SeasonWeekData[]>([])
  const [gamesRefreshKey, setGamesRefreshKey] = useState(0)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    setSystemPrefersDark(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  const resolvedTheme =
    themePreference === 'system'
      ? systemPrefersDark ? 'dark' : 'light'
      : themePreference

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
    localStorage.setItem('college-pickem-theme', themePreference)
  }, [resolvedTheme, themePreference])

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
    setActiveLeague(null)
    setGames([])
    setPicks({})
    setLeaguePlayers([])
    setHomePicks({})
    setHomeTiebreakers({})
    setTiebreaker('')
    setCurrentWeek(DEFAULT_WEEK)
    setSeasonWeeks([])
    return
  }

  const currentUser = user

  async function loadUserData() {
      setDataLoading(true)
      setSaveError('')

      try {
        const leagueRef = doc(db, 'leagues', LEGACY_LEAGUE_ID)
        const leagueSnapshot = await getDoc(leagueRef)

        if (!leagueSnapshot.exists()) {
          throw new Error('The migrated league could not be found.')
        }

        const membershipSnapshot = await getDoc(
          doc(
            db,
            'leagues',
            LEGACY_LEAGUE_ID,
            'members',
            currentUser.uid,
          ),
        )

        if (!membershipSnapshot.exists()) {
          throw new Error('Your league membership could not be found.')
        }

        const leagueData = leagueSnapshot.data()
        const membershipData = membershipSnapshot.data()

        const chosenMembership: LeagueMembership = {
          leagueId: LEGACY_LEAGUE_ID,
          userId: currentUser.uid,
          role: membershipData.role === 'admin' ? 'admin' : 'player',
        }

        setActiveLeague({
          id: LEGACY_LEAGUE_ID,
          name: String(leagueData.name ?? 'College Pick’em'),
          joinCode: String(leagueData.joinCode ?? ''),
          season:
            typeof leagueData.season === 'number'
              ? leagueData.season
              : SEASON,
        })

        setIsAdmin(chosenMembership.role === 'admin')

        const allUsersSnapshot = await getDocs(collection(db, 'users'))

        const weeksSnapshot = await getDocs(
          collection(db, 'leagues', LEGACY_LEAGUE_ID, 'weeks'),
        )

        const loadedWeeks: Week[] = weeksSnapshot.docs
          .map((weekDocument): Week => {
            const data = weekDocument.data()

            return {
              weekId: String(data.weekId ?? weekDocument.id),
              weekNumber: typeof data.weekNumber === 'number' ? data.weekNumber : 0,
              label: String(data.label ?? `Week ${data.weekNumber ?? ''}`),
              stake: typeof data.stake === 'number' ? data.stake : 10,
              status: data.status === 'final' ? 'final' : 'open',
              competitionType:
                data.competitionType === 'postseason' ||
                String(data.weekId ?? weekDocument.id).endsWith('-postseason')
                  ? 'postseason'
                  : 'regular',
              tiebreakerGameId: String(data.tiebreakerGameId ?? ''),
              gameCount: typeof data.gameCount === 'number' ? data.gameCount : 0,
              published:
                data.published === true ||
                typeof data.publishedAt !== 'undefined' ||
                (typeof data.gameCount === 'number' && data.gameCount > 0),
            }
          })
          .filter((week) => week.weekNumber > 0)
          .sort((a, b) => b.weekNumber - a.weekNumber)

        const activeWeek = loadedWeeks[0] ?? DEFAULT_WEEK

        setCurrentWeek(activeWeek)

        const leagueMembersSnapshot = await getDocs(
          collection(
            db,
            'leagues',
            LEGACY_LEAGUE_ID,
            'members',
          ),
        )

        const memberIds = new Set(
          leagueMembersSnapshot.docs.map((memberDocument) =>
            String(memberDocument.data().userId ?? memberDocument.id),
          ),
        )

        const savedPlayers: LeaguePlayer[] = allUsersSnapshot.docs
          .filter((userDocument) => memberIds.has(userDocument.id))
          .map((userDocument) => {
            const data = userDocument.data()
            const fallbackName =
              String(data.email ?? '')
                .split('@')[0]
                .replace(/[^a-zA-Z]/g, '') || 'Player'

            const savedFirstName =
              typeof data.firstName === 'string'
                ? data.firstName.trim()
                : ''

            const savedName =
              typeof data.name === 'string'
                ? data.name.trim()
                : ''

            return {
              uid: userDocument.id,
              name:
                savedFirstName ||
                savedName ||
                fallbackName,
            }
          })
          .sort((a, b) => a.name.localeCompare(b.name))

        setLeaguePlayers(savedPlayers)

        const gamesQuery = query(
          collection(db, 'leagues', LEGACY_LEAGUE_ID, 'games'),
          where('weekId', '==', activeWeek.weekId),
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
              status:
                typeof data.status === 'string' ? data.status : '',
              statusState:
                typeof data.statusState === 'string' ? data.statusState : '',
              period:
                typeof data.period === 'number' ? data.period : null,
              displayClock:
                typeof data.displayClock === 'string' ? data.displayClock : '',
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
          collection(db, 'leagues', LEGACY_LEAGUE_ID, 'picks'),
          where('userId', '==', currentUser.uid),
          where('weekId', '==', activeWeek.weekId),
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
                collection(db, 'leagues', LEGACY_LEAGUE_ID, 'picks'),
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

        const tiebreakerId = `${currentUser.uid}_${activeWeek.weekId}`

        const tiebreakerSnapshot = await getDoc(
          doc(db, 'leagues', LEGACY_LEAGUE_ID, 'tiebreakers', tiebreakerId),
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
              collection(db, 'leagues', LEGACY_LEAGUE_ID, 'tiebreakers'),
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

        const seasonData: SeasonWeekData[] = []

        for (const week of [...loadedWeeks].sort(
          (a, b) => a.weekNumber - b.weekNumber,
        )) {
          if (week.weekId === activeWeek.weekId) {
            seasonData.push({
              week,
              games: loadedGames,
              picks: loadedHomePicks,
              tiebreakers: loadedHomeTiebreakers,
            })
            continue
          }

          const historicalGamesSnapshot = await getDocs(
            query(
              collection(db, 'leagues', LEGACY_LEAGUE_ID, 'games'),
              where('weekId', '==', week.weekId),
              where('selected', '==', true),
            ),
          )

          const historicalGames: Game[] =
            historicalGamesSnapshot.docs
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
                    typeof data.awayScore === 'number'
                      ? data.awayScore
                      : null,
                  homeScore:
                    typeof data.homeScore === 'number'
                      ? data.homeScore
                      : null,
                  status:
                    typeof data.status === 'string'
                      ? data.status
                      : '',
                  statusState:
                    typeof data.statusState === 'string'
                      ? data.statusState
                      : '',
                  period:
                    typeof data.period === 'number'
                      ? data.period
                      : null,
                  displayClock:
                    typeof data.displayClock === 'string'
                      ? data.displayClock
                      : '',
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

          const historicalPicks: HomePicks = {}

          await Promise.all(
            historicalGames
              .filter((game) => isGameLocked(game.kickoff))
              .map(async (game) => {
                const pickSnapshot = await getDocs(
                  query(
                    collection(db, 'leagues', LEGACY_LEAGUE_ID, 'picks'),
                    where('gameId', '==', game.gameId),
                  ),
                )

                pickSnapshot.forEach((pickDocument) => {
                  const data = pickDocument.data()

                  if (data.userId && data.teamId) {
                    historicalPicks[game.gameId] = {
                      ...(historicalPicks[game.gameId] ?? {}),
                      [String(data.userId)]: String(data.teamId),
                    }
                  }
                })
              }),
          )

          const historicalTiebreakers: HomeTiebreakers = {}
          const historicalTiebreakerGame =
            historicalGames.find((game) => game.tiebreaker) ?? null

          if (
            historicalTiebreakerGame &&
            isGameLocked(historicalTiebreakerGame.kickoff)
          ) {
            const tiebreakerSnapshot = await getDocs(
              query(
                collection(db, 'leagues', LEGACY_LEAGUE_ID, 'tiebreakers'),
                where(
                  'gameId',
                  '==',
                  historicalTiebreakerGame.gameId,
                ),
              ),
            )

            tiebreakerSnapshot.forEach((document) => {
              const data = document.data()

              if (
                data.userId &&
                typeof data.totalPoints === 'number'
              ) {
                historicalTiebreakers[String(data.userId)] =
                  data.totalPoints
              }
            })
          }

          seasonData.push({
            week,
            games: historicalGames,
            picks: historicalPicks,
            tiebreakers: historicalTiebreakers,
          })
        }

        setSeasonWeeks(seasonData)
      } catch (error) {
        console.error(error)
        setSaveError('Unable to load the current week.')
      } finally {
        setDataLoading(false)
      }
    }

    loadUserData()
  }, [user, gamesRefreshKey])

  async function clearAvailableGameSelections() {
    const availableSnapshot = await getDocs(collection(db, 'availableGames'))
    const batch = writeBatch(db)

    availableSnapshot.docs.forEach((gameDocument) => {
      batch.set(
        gameDocument.ref,
        { selected: false, tiebreaker: false },
        { merge: true },
      )
    })

    await batch.commit()
  }

  async function startNextWeek() {
    if (
      !currentWeek.published ||
      games.length === 0 ||
      !games.every((game) => game.final)
    ) {
      throw new Error('Current week must be published and final before advancing.')
    }

    if (currentWeek.competitionType === 'postseason') {
      throw new Error('Cannot advance after postseason.')
    }

    const nextWeekNumber = currentWeek.weekNumber + 1
    const nextWeekId = makeWeekId(nextWeekNumber)
    const nextWeekLabel = `Week ${nextWeekNumber}`

    await setDoc(
      doc(db, 'leagues', LEGACY_LEAGUE_ID, 'weeks', currentWeek.weekId),
      {
        status: 'final',
        finalizedAt: serverTimestamp(),
      },
      { merge: true },
    )

    const nextWeek: Week = {
      weekId: nextWeekId,
      weekNumber: nextWeekNumber,
      label: nextWeekLabel,
      stake: 10,
      status: 'open',
      competitionType: 'regular',
      tiebreakerGameId: '',
      gameCount: 0,
      published: false,
    }

    await setDoc(
      doc(db, 'leagues', LEGACY_LEAGUE_ID, 'weeks', nextWeekId),
      {
        ...nextWeek,
        createdAt: serverTimestamp(),
      },
      { merge: true },
    )

    await clearAvailableGameSelections()

    setCurrentWeek(nextWeek)
    setSeasonWeeks((current) => [
      ...current.filter(
        (weekData) => weekData.week.weekId !== nextWeekId,
      ),
      {
        week: nextWeek,
        games: [],
        picks: {},
        tiebreakers: {},
      },
    ])
    setGames([])
    setPicks({})
    setHomePicks({})
    setHomeTiebreakers({})
    setTiebreaker('')
  }

  async function startPostseason() {
    if (
      !currentWeek.published ||
      games.length === 0 ||
      !games.every((game) => game.final)
    ) {
      throw new Error('Current week must be published and final before starting postseason.')
    }

    if (currentWeek.weekNumber < 14) {
      throw new Error('Postseason cannot start before Week 14.')
    }

    if (currentWeek.competitionType === 'postseason') {
      throw new Error('Postseason has already started.')
    }

    const existingPostseason = await getDoc(
      doc(db, 'leagues', LEGACY_LEAGUE_ID, 'weeks', `${SEASON}-postseason`),
    )

    if (existingPostseason.exists()) {
      throw new Error('Postseason already exists.')
    }

    const postseasonId = `${SEASON}-postseason`
    const postseason: Week = {
      weekId: postseasonId,
      weekNumber: currentWeek.weekNumber + 1,
      label: 'Postseason',
      stake: 30,
      status: 'open',
      competitionType: 'postseason',
      tiebreakerGameId: '',
      gameCount: 0,
      published: false,
    }

    await setDoc(
      doc(db, 'leagues', LEGACY_LEAGUE_ID, 'weeks', currentWeek.weekId),
      {
        status: 'final',
        finalizedAt: serverTimestamp(),
      },
      { merge: true },
    )

    await setDoc(
      doc(db, 'leagues', LEGACY_LEAGUE_ID, 'weeks', postseasonId),
      {
        ...postseason,
        createdAt: serverTimestamp(),
      },
      { merge: true },
    )

    await clearAvailableGameSelections()

    setCurrentWeek(postseason)
    setSeasonWeeks((current) => [
      ...current.filter(
        (weekData) => weekData.week.weekId !== postseasonId,
      ),
      {
        week: postseason,
        games: [],
        picks: {},
        tiebreakers: {},
      },
    ])
    setGames([])
    setPicks({})
    setHomePicks({})
    setHomeTiebreakers({})
    setTiebreaker('')
  }

  async function refreshPublishedGames() {
    const currentWeekSnapshot = await getDoc(
      doc(db, 'leagues', LEGACY_LEAGUE_ID, 'weeks', currentWeek.weekId),
    )

    if (currentWeekSnapshot.exists()) {
      const data = currentWeekSnapshot.data()

      setCurrentWeek((week) => ({
        ...week,
        stake: typeof data.stake === 'number' ? data.stake : week.stake,
        gameCount:
          typeof data.gameCount === 'number' ? data.gameCount : week.gameCount,
        tiebreakerGameId: String(
          data.tiebreakerGameId ?? week.tiebreakerGameId,
        ),
        published:
          data.published === true ||
          typeof data.publishedAt !== 'undefined' ||
          (typeof data.gameCount === 'number' && data.gameCount > 0),
      }))
    }

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
      const pickId = `${user.uid}_${currentWeek.weekId}_${gameId}`

      await setDoc(doc(db, 'leagues', LEGACY_LEAGUE_ID, 'picks', pickId), {
        userId: user.uid,
        weekId: currentWeek.weekId,
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
      const tiebreakerId = `${user.uid}_${currentWeek.weekId}`

      await setDoc(
        doc(db, 'leagues', LEGACY_LEAGUE_ID, 'tiebreakers', tiebreakerId),
        {
          userId: user.uid,
          weekId: currentWeek.weekId,
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
        Loading current week…
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
        weekLabel={currentWeek.label}
        leagueName={activeLeague?.name ?? 'College Pick’em'}
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
        weekLabel={currentWeek.label}
      />
    )
  } else if (activeTab === 'standings') {
    page = (
      <StandingsPage
        players={leaguePlayers}
        seasonWeeks={seasonWeeks}
        currentWeek={currentWeek}
        currentUserId={user.uid}
      />
    )
  } else if (activeTab === 'history') {
    page = (
      <HistoryPage
        players={leaguePlayers}
        seasonWeeks={seasonWeeks}
        currentUserId={user.uid}
      />
    )
  } else if (activeTab === 'settings') {
    page = (
      <SettingsPage
        user={user}
        isAdmin={isAdmin}
        leagueName={activeLeague?.name ?? 'College Pick’em'}
        themePreference={themePreference}
        onThemePreferenceChange={setThemePreference}
      />
    )
  } else if (
    activeTab === 'admin' &&
    isAdmin
  ) {
    page = (
      <AdminPage
        leagueId={activeLeague?.id ?? LEGACY_LEAGUE_ID}
        onPublished={refreshPublishedGames}
        onStartNextWeek={startNextWeek}
        onStartPostseason={startPostseason}
        currentWeek={currentWeek}
        currentWeekIsFinal={
          games.length > 0 && games.every((game) => game.final)
        }
      />
    )
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
        weekLabel={currentWeek.label}
        leagueName={activeLeague?.name ?? 'College Pick’em'}
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