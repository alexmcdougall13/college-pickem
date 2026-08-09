export type RatingInputs = {
  awayRank?: number | null
  homeRank?: number | null
  homeLine?: number | null
  awayConference?: string | null
  homeConference?: string | null
}

export type RatingBreakdown = {
  combined: number
  difference: number
  spread: number
  conference: number
  rating: number
}

export const RATING_CONFIG = {
  weights: {
    combined: 0.25,
    difference: 0.25,
    spread: 0.25,
    conference: 0.25,
  },

  combinedUnrankedValue: 50,
  differenceUnrankedValue: 26,

  conferenceValues: {
    'Big Ten': 5,
    SEC: 5,
    Independent: 5,
    ACC: 4,
    'Big 12': 4,
    'Pac-12': 4,
    AAC: 2,
    CUSA: 2,
    MAC: 2,
    MWC: 2,
    'Sun Belt': 2,
    Other: 2,
    FCS: 0,
  } as Record<string, number>,
}

function roundToTwo(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateGameRating(
  inputs: RatingInputs,
): RatingBreakdown {
  const {
    awayRank,
    homeRank,
    homeLine,
    awayConference,
    homeConference,
  } = inputs

  /*
   * Q — Combined
   *
   * Spreadsheet:
   * 100 - (away rank + home rank)
   *
   * An unranked team is treated as 50.
   */
  const awayCombinedRank =
    awayRank ?? RATING_CONFIG.combinedUnrankedValue

  const homeCombinedRank =
    homeRank ?? RATING_CONFIG.combinedUnrankedValue

  const combined =
    100 - (awayCombinedRank + homeCombinedRank)

  /*
   * R — Difference
   *
   * Spreadsheet:
   * (25 - ranking difference) * 4
   *
   * An unranked team is treated as 26.
   *
   * If BOTH teams are unranked, the spreadsheet explicitly
   * uses a difference of 1 instead of 0.
   */
  const bothUnranked =
    awayRank == null && homeRank == null

  const rankingDifference = bothUnranked
    ? 1
    : Math.abs(
        (awayRank ?? RATING_CONFIG.differenceUnrankedValue) -
          (homeRank ?? RATING_CONFIG.differenceUnrankedValue),
      )

  const difference =
    (25 - rankingDifference) * 4

  /*
   * S — Spread
   *
   * Spreadsheet:
   * 100 - ROUNDDOWN(ABS(home line), 0)
   *
   * Blank line = 0 rating.
   */
  const spread =
    homeLine == null
      ? 0
      : 100 - Math.floor(Math.abs(homeLine))

  /*
   * T — Conference
   *
   * Spreadsheet:
   * (Away conference score + Home conference score) * 10
   *
   * Missing/unrecognized conference = 0.
   */
  const awayConferenceScore =
    awayConference
      ? RATING_CONFIG.conferenceValues[awayConference] ?? 0
      : 0

  const homeConferenceScore =
    homeConference
      ? RATING_CONFIG.conferenceValues[homeConference] ?? 0
      : 0

  const conference =
    (awayConferenceScore + homeConferenceScore) * 10

  /*
   * U — Overall Rating
   *
   * Weighted average of Q:T, rounded to two decimals.
   */
  const rating = roundToTwo(
    combined * RATING_CONFIG.weights.combined +
      difference * RATING_CONFIG.weights.difference +
      spread * RATING_CONFIG.weights.spread +
      conference * RATING_CONFIG.weights.conference,
  )

  return {
    combined,
    difference,
    spread,
    conference,
    rating,
  }
}