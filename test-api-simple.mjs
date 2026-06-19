// Simple test to get predictions from API-Football
const API_KEY = '8e6c4a9477b12dfa70f4d5d4ff1752c1';
const BASE_URL = 'https://v3.football.api-sports.io';

console.log('🏆 Testing API-Football Predictions\n');

async function test() {
  try {
    // Try multiple top leagues
    const leagues = [39, 140, 78, 135, 61]; // Premier, La Liga, Bundesliga, Serie A, Ligue 1
    
    for (const leagueId of leagues) {
      console.log(`\n📊 Checking league ${leagueId}...`);
      
      const response = await fetch(`${BASE_URL}/fixtures?league=${leagueId}&season=2025&next=1`, {
        headers: {
          'x-rapidapi-key': API_KEY,
          'x-rapidapi-host': 'v3.football.api-sports.io'
        }
      });
      
      const data = await response.json();
      
      if (data.results > 0) {
        const fixture = data.response[0];
        const fixtureId = fixture.fixture.id;
        const homeTeam = fixture.teams.home.name;
        const awayTeam = fixture.teams.away.name;
        
        console.log(`✅ Found: ${homeTeam} vs ${awayTeam}`);
        console.log(`   Fixture ID: ${fixtureId}\n`);
        
        // Now get predictions for this fixture
        console.log(`🔍 Fetching prediction data...\n`);
        const predUrl = `${BASE_URL}/predictions?fixture=${fixtureId}`;
        
        const predResponse = await fetch(predUrl, {
          headers: {
            'x-rapidapi-key': API_KEY,
            'x-rapidapi-host': 'v3.football.api-sports.io'
          }
        });
        
        const predData = await predResponse.json();
        
        console.log('================================================================================');
        console.log('📋 FULL API RESPONSE:');
        console.log('================================================================================\n');
        console.log(JSON.stringify(predData, null, 2));
        
        if (predData.results > 0 && predData.response[0]) {
          const pred = predData.response[0];
          console.log('\n================================================================================');
          console.log('🎯 COMPLETE PREDICTIONS FIELD STRUCTURE:');
          console.log('================================================================================\n');
          
          console.log('📋 FULL predictions OBJECT:');
          console.log(JSON.stringify(pred.predictions, null, 2));
          
          console.log('\n\n================================================================================');
          console.log('🔍 DETAILED BREAKDOWN OF EACH FIELD:');
          console.log('================================================================================\n');
          
          const predictions = pred.predictions || {};
          
          Object.keys(predictions).forEach((key, index) => {
            console.log(`${index + 1}️⃣  predictions.${key}:`);
            console.log(`   Type: ${typeof predictions[key]}`);
            console.log(`   Value:`);
            console.log(JSON.stringify(predictions[key], null, 2));
            console.log('');
          });
          
          console.log('\n================================================================================');
          console.log('📊 SUMMARY:');
          console.log('================================================================================');
          console.log('All prediction keys:', Object.keys(predictions));
          console.log('Total fields:', Object.keys(predictions).length);
        }
        
        return; // Found one, stop
      }
    }
    
    console.log('\n❌ No upcoming fixtures found in any league');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

test();
