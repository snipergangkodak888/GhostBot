# Environment Variables Check Script
# Run this to verify your configuration

Write-Host "`n" -ForegroundColor Cyan
Write-Host "Checking Telegram App Configuration..." -ForegroundColor Cyan
Write-Host "`n" -ForegroundColor Cyan

# Check .env.local
if (Test-Path ".env.local") {
    Write-Host "✅ .env.local file exists" -ForegroundColor Green
    
    $envContent = Get-Content ".env.local" -Raw
    
    # Check TELEGRAM_BOT_TOKEN
    if ($envContent -match "TELEGRAM_BOT_TOKEN=(.+)") {
        $token = $Matches[1].Trim()
        if ($token -eq "your_token_here" -or $token -eq "" -or $token -eq "your_telegram_bot_token_here") {
            Write-Host "❌ TELEGRAM_BOT_TOKEN is not configured properly" -ForegroundColor Red
            Write-Host "   Current value: $token" -ForegroundColor Yellow
            Write-Host "   Should be: 8421599806:AAH16Bfeu7IT178ObxiouQ7FAgXvogLzZOs" -ForegroundColor Yellow
        } else {
            Write-Host "✅ TELEGRAM_BOT_TOKEN is set" -ForegroundColor Green
            Write-Host "   Value: $($token.Substring(0, 10))..." -ForegroundColor Gray
        }
    } else {
        Write-Host "❌ TELEGRAM_BOT_TOKEN not found in .env.local" -ForegroundColor Red
    }
    
    # Check MONGODB_URI
    if ($envContent -match "MONGODB_URI=(.+)") {
        $mongoUri = $Matches[1].Trim()
        if ($mongoUri -match "mongodb") {
            Write-Host "✅ MONGODB_URI is set" -ForegroundColor Green
        } else {
            Write-Host "❌ MONGODB_URI appears invalid" -ForegroundColor Red
        }
    } else {
        Write-Host "WARNING: MONGODB_URI not found in .env.local" -ForegroundColor Yellow
    }
} else {
    Write-Host "ERROR: .env.local file not found" -ForegroundColor Red
    Write-Host "   Create it from .env.example" -ForegroundColor Yellow
}

Write-Host "`n" -ForegroundColor Cyan
Write-Host "Next Steps:" -ForegroundColor Cyan

Write-Host "
1. Update .env.local with correct values:
   
   TELEGRAM_BOT_TOKEN=8421599806:AAH16Bfeu7IT178ObxiouQ7FAgXvogLzZOs
   MONGODB_URI=your_mongodb_connection_string

2. Add the same variables to Vercel:
   - Go to: https://vercel.com/dashboard
   - Select project: kickq-client-djfvr
   - Go to: Settings → Environment Variables
   - Add both variables
   - Redeploy!

3. Test locally first:
   
   pnpm dev
   # Visit: http://localhost:3000/telegram/debug

4. Deploy to Vercel:
   
   vercel --prod --force

5. Test in Telegram:
   
   Open your bot and click the menu button

" -ForegroundColor White

Write-Host "`n" -ForegroundColor Cyan
Write-Host "Useful Links:" -ForegroundColor Cyan
Write-Host "   Debug Page: https://kickq-client-djfvr.vercel.app/telegram/debug" -ForegroundColor Gray
Write-Host "   Vercel Dashboard: https://vercel.com/dashboard" -ForegroundColor Gray
Write-Host "   BotFather: https://t.me/BotFather" -ForegroundColor Gray

Write-Host "`n" -ForegroundColor Cyan
Write-Host "Configuration check complete!" -ForegroundColor Cyan
Write-Host "`n" -ForegroundColor Cyan
