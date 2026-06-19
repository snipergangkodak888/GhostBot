// Test API-Football Response Structure
// Run this with: node test-api-football.mjs

const API_KEY = '8e6c4a9477b12dfa70f4d5d4ff1752c1'
const BASE_URL = 'https://v3.football.api-sports.io'

async function makeRequest(endpoint, params = {}) {
  const url = new URL(`${BASE_URL}/${endpoint}`)
  Object.keys(params).forEach(key => url.searchParams.append(key, params[key]))
  
  console.log(`\n🔍 Calling: ${url.toString()}`)
  
  const response = await fetch(url, {
    headers: {
      'x-apisports-key': API_KEY
    }
  })
  
  const data = await response.json()
  return data
}

async function testPredictions() {
  try {
    console.log('=' .repeat(80))
    console.log('🏆 API-FOOTBALL PREDICTION TEST')
    console.log('=' .repeat(80))
    
    // Step 1: Get today's date
    const today = new Date().toISOString().split('T')[0]
    console.log(`\n📅 Testing predictions for matches on: ${today}`)
    
    // Step 2: Fetch today's fixtures from Premier League (ID: 39)
    console.log('\n📊 Fetching today\'s Premier League fixtures...')
    const fixturesResult = await makeRequest('fixtures', {
      league: 39,
      season: 2024,
      date: today
    })
    
    console.log(`\n✅ API Response:`)
    console.log(`- Results: ${fixturesResult.results} fixtures found`)
    console.log(`- Get: ${fixturesResult.get}`)
    
    if (!fixturesResult.response || fixturesResult.response.length === 0) {
      console.log('\n⚠️  No matches today. Trying to get next upcoming fixture...')
      
      // Try to get upcoming fixtures
      const upcomingResult = await makeRequest('fixtures', {
        league: 39,
        season: 2024,
        next: 5
      })
      
      console.log(`\n✅ Upcoming fixtures: ${upcomingResult.results} found`)
      
      if (upcomingResult.response && upcomingResult.response.length > 0) {
        const fixture = upcomingResult.response[0]
        console.log(`\n🎯 Testing with upcoming fixture:`)
        console.log(`- Fixture ID: ${fixture.fixture.id}`)
        console.log(`- Match: ${fixture.teams.home.name} vs ${fixture.teams.away.name}`)
        console.log(`- Date: ${fixture.fixture.date}`)
        console.log(`- Status: ${fixture.fixture.status.long}`)
        
        // Get prediction for this fixture
        await testSinglePrediction(fixture.fixture.id)
      } else {
        console.log('❌ No upcoming fixtures found either!')
      }
      
      return
    }
    
    // Step 3: Get prediction for the first match
    const firstMatch = fixturesResult.response[0]
    console.log(`\n🎯 Testing prediction for:`)
    console.log(`- Fixture ID: ${firstMatch.fixture.id}`)
    console.log(`- Match: ${firstMatch.teams.home.name} vs ${firstMatch.teams.away.name}`)
    console.log(`- Date: ${firstMatch.fixture.date}`)
    console.log(`- Status: ${firstMatch.fixture.status.long}`)
    
    await testSinglePrediction(firstMatch.fixture.id)
    
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error(error.stack)
  }
}

async function testSinglePrediction(fixtureId) {
  console.log(`\n${'='.repeat(80)}`)
  console.log(`🔮 FETCHING PREDICTION FOR FIXTURE: ${fixtureId}`)
  console.log('='.repeat(80))
  
  const predictionResult = await makeRequest('predictions', {
    fixture: fixtureId
  })
  
  console.log(`\n✅ Prediction API Response:`)
  console.log(`- Results: ${predictionResult.results}`)
  console.log(`- Errors: ${JSON.stringify(predictionResult.errors)}`)
  
  if (!predictionResult.response || predictionResult.response.length === 0) {
    console.log('\n❌ No prediction data returned!')
    console.log('Full response:', JSON.stringify(predictionResult, null, 2))
    return
  }
  
  const prediction = predictionResult.response[0]
  
  console.log(`\n📊 PREDICTION DATA STRUCTURE:`)
  console.log('='.repeat(80))
  
  // Basic Prediction
  console.log(`\n1️⃣  BASIC PREDICTION:`)
  console.log(`- Winner: ${prediction.predictions?.winner?.name || 'N/A'}`)
  console.log(`- Advice: ${prediction.predictions?.advice || 'N/A'}`)
  console.log(`- Win or Draw: ${prediction.predictions?.win_or_draw}`)
  console.log(`- Under/Over: ${prediction.predictions?.under_over || 'N/A'}`)
  
  // Goals
  console.log(`\n2️⃣  GOALS:`)
  console.log(`- Home: ${prediction.predictions?.goals?.home || 'N/A'} (Type: ${typeof prediction.predictions?.goals?.home})`)
  console.log(`- Away: ${prediction.predictions?.goals?.away || 'N/A'} (Type: ${typeof prediction.predictions?.goals?.away})`)
  
  // Percentages
  console.log(`\n3️⃣  WIN PERCENTAGES:`)
  console.log(`- Home: ${prediction.predictions?.percent?.home || 'N/A'}`)
  console.log(`- Draw: ${prediction.predictions?.percent?.draw || 'N/A'}`)
  console.log(`- Away: ${prediction.predictions?.percent?.away || 'N/A'}`)
  
  // Over/Under 2.5
  console.log(`\n4️⃣  OVER/UNDER 2.5 GOALS:`)
  console.log(`- Over 2.5: ${prediction.predictions?.percent?.over_2_5 || '❌ NOT AVAILABLE'}`)
  console.log(`- Under 2.5: ${prediction.predictions?.percent?.under_2_5 || '❌ NOT AVAILABLE'}`)
  
  // Comparison
  console.log(`\n5️⃣  TEAM COMPARISON:`)
  if (prediction.comparison) {
    console.log(`- Form: Home ${prediction.comparison.form?.home || 'N/A'} - Away ${prediction.comparison.form?.away || 'N/A'}`)
    console.log(`- Attack: Home ${prediction.comparison.att?.home || 'N/A'} - Away ${prediction.comparison.att?.away || 'N/A'}`)
    console.log(`- Defense: Home ${prediction.comparison.def?.home || 'N/A'} - Away ${prediction.comparison.def?.away || 'N/A'}`)
  } else {
    console.log(`❌ NOT AVAILABLE`)
  }
  
  // Scores (Poisson)
  console.log(`\n6️⃣  LIKELY SCORES (Poisson Distribution):`)
  if (prediction.scores && Object.keys(prediction.scores).length > 0) {
    const scoreEntries = Object.entries(prediction.scores)
    console.log(`✅ ${scoreEntries.length} possible scores found:`)
    scoreEntries.slice(0, 6).forEach(([score, prob]) => {
      console.log(`   ${score}: ${prob}`)
    })
  } else {
    console.log(`❌ NOT AVAILABLE`)
  }
  
  // Summary
  console.log(`\n${'='.repeat(80)}`)
  console.log('📋 AVAILABILITY SUMMARY:')
  console.log('='.repeat(80))
  console.log(`✅ Basic Prediction: ${prediction.predictions?.winner?.name ? 'YES' : 'NO'}`)
  console.log(`✅ Goals: ${prediction.predictions?.goals?.home ? 'YES' : 'NO'}`)
  console.log(`✅ Win Percentages: ${prediction.predictions?.percent?.home ? 'YES' : 'NO'}`)
  console.log(`${prediction.predictions?.percent?.over_2_5 ? '✅' : '❌'} Over/Under 2.5: ${prediction.predictions?.percent?.over_2_5 ? 'YES' : 'NO'}`)
  console.log(`${prediction.comparison ? '✅' : '❌'} Team Comparison: ${prediction.comparison ? 'YES' : 'NO'}`)
  console.log(`${prediction.scores ? '✅' : '❌'} Likely Scores: ${prediction.scores && Object.keys(prediction.scores).length > 0 ? 'YES' : 'NO'}`)
  
  // Full Response
  console.log(`\n${'='.repeat(80)}`)
  console.log('📄 FULL RAW RESPONSE:')
  console.log('='.repeat(80))
  console.log(JSON.stringify(prediction, null, 2))
}

// Run the test
testPredictions()
