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
  where,
} from 'firebase/firestore'
import { auth, db } from './firebase/firebase'
import './App.css'

type Tab = 'home' | 'picks' | 'standings' | 'history' | 'settings'
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
  gameName?: string
  kickoff: string
  awayTeam: Team
  homeTeam: Team
}

type Picks = Record<string, string>

const WEEK_ID = '2026-week-1'

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'picks', label: 'Picks', icon: '🏈' },
  { id: 'standings', label: 'Standings', icon: '▥' },
  { id: 'history', label: 'History', icon: '↺' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
]

const games: Game[] = [
  {
    id: 'game-1',
    kickoff: '2026-08-29T19:30:00Z',
    awayTeam: {
      id: 'ohio-state',
      name: 'Ohio State',
      rank: 4,
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/194.png',
      line: 3.5,
    },
    homeTeam: {
      id: 'texas',
      name: 'Texas',
      rank: 2,
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png',
      line: -3.5,
    },
  },
  {
    id: 'game-2',
    gameName: 'Chick-fil-A Kickoff Game',
    kickoff: '2026-08-30T00:00:00Z',
    awayTeam: {
      id: 'alabama',
      name: 'Alabama',
      rank: 8,
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/333.png',
      line: -2.5,
    },
    homeTeam: {
      id: 'florida-state',
      name: 'Florida State',
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/52.png',
      line: 2.5,
    },
  },
  {
    id: 'game-3',
    kickoff: '2026-08-30T23:30:00Z',
    awayTeam: {
      id: 'notre-dame',
      name: 'Notre Dame',
      rank: 6,
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/87.png',
      line: -1.5,
    },
    homeTeam: {
      id: 'miami',
      name: 'Miami',
      rank: 10,
      logo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2390.png',
      line: 1.5,
    },
  },
]

const tiebreakerGame = games[0]

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
  picksMade,
  totalGames,
}: {
  picksMade: number
  totalGames: number
}) {
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
            {picksMade === totalGames
              ? 'All picks completed'
              : 'Picks are open'}
          </strong>
        </div>
      </section>
    </>
  )
}

function PicksPage({
  picks,
  onPick,
  tiebreaker,
  onTiebreakerChange,
  savingGameId,
  savingTiebreaker,
  saveError,
}: {
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

      <div className="games-list">
        {games.map((game) => (
          <section className="game-section" key={game.id}>
            <GameHeader game={game} />

            <div className="team-grid">
              <TeamCard
                team={game.awayTeam}
                designation="Away"
                selected={picks[game.id] === game.awayTeam.id}
                onSelect={() => onPick(game.id, game.awayTeam.id)}
                disabled={savingGameId === game.id}
              />

              <TeamCard
                team={game.homeTeam}
                designation="Home"
                selected={picks[game.id] === game.homeTeam.id}
                onSelect={() => onPick(game.id, game.homeTeam.id)}
                disabled={savingGameId === game.id}
              />
            </div>

            {savingGameId === game.id && (
              <p className="save-status">Saving pick…</p>
            )}
          </section>
        ))}
      </div>

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
            onChange={(event) => onTiebreakerChange(event.target.value)}
          />
        </label>

        {savingTiebreaker && (
          <p className="save-status">Saving tiebreaker…</p>
        )}
      </section>
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

function SettingsPage({ user }: { user: User }) {
  async function handleSignOut() {
    await signOut(auth)
  }

  return (
    <section className="page-placeholder">
      <p className="eyebrow">College Pick&apos;em</p>
      <h1>Settings</h1>
      <p>Signed in as {user.email}</p>

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

        await createUserWithEmailAndPassword(auth, email, password)
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
          {mode === 'signup' && 'Create your College Pick’em account.'}
          {mode === 'reset' && 'Reset your password.'}
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
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
                onChange={(event) => setPassword(event.target.value)}
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
                onChange={(event) => setConfirmPassword(event.target.value)}
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
  const [authLoading, setAuthLoading] = useState(true)
  const [picksLoading, setPicksLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [picks, setPicks] = useState<Picks>({})
  const [tiebreaker, setTiebreaker] = useState('')
  const [savingGameId, setSavingGameId] = useState<string | null>(null)
  const [savingTiebreaker, setSavingTiebreaker] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser)
      setAuthLoading(false)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!user) {
      setPicks({})
      setTiebreaker('')
      return
    }

    async function loadUserData() {
      setPicksLoading(true)
      setSaveError('')

      try {
        const picksQuery = query(
          collection(db, 'picks'),
          where('userId', '==', user.uid),
          where('weekId', '==', WEEK_ID),
        )

        const snapshot = await getDocs(picksQuery)
        const loadedPicks: Picks = {}

        snapshot.forEach((pickDocument) => {
          const data = pickDocument.data()

          if (data.gameId && data.teamId) {
            loadedPicks[data.gameId] = data.teamId
          }
        })

        setPicks(loadedPicks)

        const tiebreakerId = `${user.uid}_${WEEK_ID}`
        const tiebreakerSnapshot = await getDoc(
          doc(db, 'tiebreakers', tiebreakerId),
        )

        if (tiebreakerSnapshot.exists()) {
          const data = tiebreakerSnapshot.data()

          if (typeof data.totalPoints === 'number') {
            setTiebreaker(String(data.totalPoints))
          }
        }
      } catch (error) {
        console.error(error)
        setSaveError('Unable to load your saved picks.')
      } finally {
        setPicksLoading(false)
      }
    }

    loadUserData()
  }, [user])

  async function savePick(gameId: string, teamId: string) {
    if (!user) return

    const previousTeamId = picks[gameId]

    setPicks((current) => ({
      ...current,
      [gameId]: teamId,
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

      setSaveError('Your pick could not be saved. Please try again.')
    } finally {
      setSavingGameId(null)
    }
  }

  async function saveTiebreaker(value: string) {
    if (!user) return

    setTiebreaker(value)
    setSaveError('')

    if (value === '') return

    const points = Number(value)

    if (!Number.isInteger(points) || points < 0) {
      setSaveError('Tiebreaker must be a whole number.')
      return
    }

    setSavingTiebreaker(true)

    try {
      const tiebreakerId = `${user.uid}_${WEEK_ID}`

      await setDoc(doc(db, 'tiebreakers', tiebreakerId), {
        userId: user.uid,
        weekId: WEEK_ID,
        gameId: tiebreakerGame.id,
        totalPoints: points,
        updatedAt: serverTimestamp(),
      })
    } catch (error) {
      console.error(error)
      setSaveError('Your tiebreaker could not be saved. Please try again.')
    } finally {
      setSavingTiebreaker(false)
    }
  }

  if (authLoading) {
    return <main className="loading-screen">College Pick&apos;em</main>
  }

  if (!user) {
    return <LoginPage />
  }

  if (picksLoading) {
    return <main className="loading-screen">Loading your picks…</main>
  }

  const page = {
    home: (
      <HomePage
        picksMade={Object.keys(picks).length}
        totalGames={games.length}
      />
    ),
    picks: (
      <PicksPage
        picks={picks}
        onPick={savePick}
        tiebreaker={tiebreaker}
        onTiebreakerChange={saveTiebreaker}
        savingGameId={savingGameId}
        savingTiebreaker={savingTiebreaker}
        saveError={saveError}
      />
    ),
    standings: <PlaceholderPage title="Standings" />,
    history: <PlaceholderPage title="History" />,
    settings: <SettingsPage user={user} />,
  }[activeTab]

  return (
    <div className="app-shell">
      <main className="app-content">{page}</main>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? 'nav-item active' : 'nav-item'}
            onClick={() => setActiveTab(tab.id)}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden="true">
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