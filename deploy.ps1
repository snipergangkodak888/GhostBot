# Quick Deploy Script
# This will commit and push your changes

Write-Host "`n" -ForegroundColor Cyan
Write-Host "=== Quick Deploy to Vercel ===" -ForegroundColor Cyan
Write-Host "`n" -ForegroundColor Cyan

# Check if there are changes
$status = git status --porcelain
if ($status) {
    Write-Host "Changes detected:" -ForegroundColor Yellow
    git status --short
    Write-Host "`n" -ForegroundColor White
    
    # Add all changes
    Write-Host "Adding changes..." -ForegroundColor Cyan
    git add .
    
    # Commit
    $commitMsg = "Fix: Enhanced authentication logging and error handling"
    Write-Host "Committing with message: $commitMsg" -ForegroundColor Cyan
    git commit -m "$commitMsg"
    
    # Push
    Write-Host "`nPushing to GitHub..." -ForegroundColor Cyan
    git push origin main
    
    Write-Host "`n" -ForegroundColor Green
    Write-Host "SUCCESS: Code pushed to GitHub!" -ForegroundColor Green
    Write-Host "Vercel will auto-deploy in 2-3 minutes" -ForegroundColor Green
    Write-Host "`n" -ForegroundColor White
    
    Write-Host "What to do next:" -ForegroundColor Cyan
    Write-Host "1. Wait 2-3 minutes for Vercel to deploy" -ForegroundColor White
    Write-Host "2. Open your bot in Telegram" -ForegroundColor White
    Write-Host "3. Try to open the mini app" -ForegroundColor White
    Write-Host "4. Check Vercel logs: https://vercel.com/dashboard" -ForegroundColor White
    Write-Host "`n" -ForegroundColor White
    
    Write-Host "Debug URLs:" -ForegroundColor Cyan
    Write-Host "Main app: https://kickq-client-djfvr.vercel.app/telegram" -ForegroundColor Gray
    Write-Host "Debug page: https://kickq-client-djfvr.vercel.app/telegram/debug" -ForegroundColor Gray
    Write-Host "Vercel logs: https://vercel.com/dashboard" -ForegroundColor Gray
    
} else {
    Write-Host "No changes to commit" -ForegroundColor Yellow
    Write-Host "`n" -ForegroundColor White
    Write-Host "Your code is already up to date!" -ForegroundColor Green
}

Write-Host "`n" -ForegroundColor White
Write-Host "TIP: After deployment, check Vercel logs to see detailed auth logs" -ForegroundColor Yellow
Write-Host "`n" -ForegroundColor White
