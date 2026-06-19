const fs = require('fs');
const content = fs.readFileSync('app/dashboard/wallet/page.tsx', 'utf8');

const startStr = "  const selectedChartData = balanceView === 'usdt' ? usdtChartData : chartData";
const endStr = "  return (\n    <div className=\"min-h-screen bg-[#131313] flex flex-col\">";

const newContent = `  const selectedChartData = balanceView === 'usdt' ? usdtChartData : chartData

  if (view === 'swap') {
    const fromAmount = parseFloat(swapAmount) || 0
    const toAmount = fromAmount * (metalPriceUsd || 0)
    
    return (
      <div className="min-h-screen bg-[#111111] flex flex-col pt-4">
        {/* Top bar with back button */}
        <div className="flex items-center justify-between px-4 mb-4 mt-2">
           {/* spacer */}
        </div>

        <div className="px-4 flex-1 mt-2">
          {/* Swap Box */}
          <div className="relative">
            {/* Top Box (You Swap) */}
            <div className="bg-[#1c1c1e] rounded-t-3xl p-5 pb-8 border-b border-[#111111]/50">
              <p className="text-white/60 mb-2 font-medium">You Swap</p>
              <div className="flex justify-between items-center">
                <div className="flex-1">
                  <input 
                    type="text" 
                    value={swapAmount}
                    onChange={(e) => setSwapAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder="0"
                    className="bg-transparent text-white text-[42px] leading-none font-medium w-full outline-none placeholder:text-white/30"
                  />
                  <p className="text-white/50 text-sm mt-1">$\{(fromAmount * (metalPriceUsd || 0)).toFixed(2)\}</p>
                </div>
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-2 bg-[#2c2c2e] rounded-full pl-2 pr-3 py-1.5 mb-2 cursor-pointer shadow-sm">
                    <Image src="/images/Token/888.png" alt="8Ball" width={24} height={24} className="rounded-full" />
                    <span className="text-white font-semibold">8BALL</span>
                    <ChevronRight className="w-4 h-4 text-white/50" />
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-white/50 text-sm">\{formatNumber(metalBalance)\} 8BALL</span>
                    <button onClick={() => setSwapAmount(metalBalance.toString())} className="text-blue-400 text-sm font-medium hover:text-blue-300">Max</button>
                  </div>
                </div>
              </div>
            </div>

            {/* Middle Switcher */}
            <div className="absolute left-1/2 -ml-[22px] top-1/2 -mt-[22px] w-[44px] h-[44px] bg-[#1c1c1e] rounded-full flex items-center justify-center border-[4px] border-[#111111] z-10 shadow-lg">
              <ArrowDownUp className="w-5 h-5 text-white" />
            </div>

            {/* Bottom Box (You Receive) */}
            <div className="bg-[#1c1c1e] rounded-b-3xl p-5 pt-8">
              <p className="text-white/60 mb-2 font-medium">You Receive</p>
              <div className="flex justify-between items-center">
                <div className="flex-1">
                  <input 
                    type="text" 
                    value={toAmount > 0 ? toAmount.toFixed(4) : ''}
                    readOnly
                    placeholder="0"
                    className="bg-transparent text-white/70 text-[42px] leading-none font-medium w-full outline-none placeholder:text-white/30"
                  />
                  <p className="text-white/50 text-sm mt-1">$\{(toAmount).toFixed(2)\}</p>
                </div>
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-2 bg-[#2c2c2e] rounded-full pl-2 pr-3 py-1.5 mb-2 cursor-pointer shadow-sm">
                    <Image src="/images/Stickers/USDT.png" alt="USDT" width={24} height={24} className="rounded-full" />
                    <span className="text-white font-semibold">USDT</span>
                    <ChevronRight className="w-4 h-4 text-white/50" />
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-white/50 text-sm">\{(usdtValue || 0).toFixed(2)\} USDT</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="px-4 pb-8 mt-auto">
           <button className={\`w-full py-4 rounded-2xl font-semibold text-[17px] transition-all \${
             fromAmount > 0 && fromAmount <= metalBalance 
             ? 'bg-blue-500 text-white hover:bg-blue-400 active:scale-[0.98]' 
             : 'bg-[#2c2c2e] text-white/30 cursor-not-allowed'
           }\`}>
             {fromAmount > metalBalance ? 'Insufficient balance' : 'Continue'}
           </button>
        </div>
      </div>
    )
  }

  if (view === 'withdraw') {
    const handleAmountAdd = (add: number) => {
      setWithdrawAmount(prev => (parseFloat(prev || '0') + add).toString())
    }

    return (
      <div className="min-h-screen bg-[#111111] flex flex-col pt-6 relative">
        <div className="flex justify-center mb-16">
          <div className="bg-white/10 rounded-full pl-2 pr-4 py-1.5 flex items-center gap-2 backdrop-blur-md">
            <div className="bg-blue-500 rounded-full p-1">
              <ArrowUpCircle className="w-4 h-4 text-white" />
            </div>
            <span className="text-white text-sm font-medium">
              {userProfile?.user?.walletAddress 
                ? \`\${userProfile.user.walletAddress.slice(0, 4)}...\${userProfile.user.walletAddress.slice(-4)}\` 
                : t('connectWallet', 'Connect Wallet')}
            </span>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center px-4">
          {/* Centered Amount */}
          <div className="flex items-baseline justify-center gap-2 mb-2 w-full">
            <input 
               type="text"
               value={withdrawAmount}
               onChange={(e) => setWithdrawAmount(e.target.value.replace(/[^0-9.]/g, ''))}
               placeholder="0"
               className="bg-transparent text-white text-[72px] font-semibold text-right outline-none p-0 tracking-tight placeholder:text-white ios-number"
               style={{ width: withdrawAmount ? \`\${Math.max(1, withdrawAmount.length) * 44}px\` : '44px', maxWidth: '80%' }}
            />
            <span className="text-white/50 text-[40px] font-semibold tracking-tight leading-none pt-4">USDT</span>
          </div>
          
          <div className="flex items-center gap-1 mb-10">
            <span className="text-white/50 text-[15px]">1 USDT ≈ 1.00 USD</span>
            <div className="bg-white/10 rounded-full p-1 ml-1 cursor-pointer hover:bg-white/20">
               <ArrowDownUp className="w-3 h-3 text-white" />
            </div>
          </div>

          <div className="flex justify-center gap-2.5 w-full">
            <button className="flex items-center gap-1.5 bg-[#1c1c1e] border border-white/5 rounded-2xl px-4 py-2 hover:bg-[#2c2c2e] active:scale-95 transition-all">
              <PlusCircle className="w-4 h-4 text-white" />
              <span className="text-white font-medium">Deposit</span>
            </button>
            <button onClick={() => handleAmountAdd(5)} className="text-white bg-[#1c1c1e] border border-white/5 rounded-2xl px-5 py-2 font-medium hover:bg-[#2c2c2e] active:scale-95 transition-all">+5</button>
            <button onClick={() => handleAmountAdd(10)} className="text-white bg-[#1c1c1e] border border-white/5 rounded-2xl px-5 py-2 font-medium hover:bg-[#2c2c2e] active:scale-95 transition-all">+10</button>
            <button onClick={() => handleAmountAdd(25)} className="text-white bg-[#1c1c1e] border border-white/5 rounded-2xl px-5 py-2 font-medium hover:bg-[#2c2c2e] active:scale-95 transition-all">+25</button>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="w-full bg-[#1c1c1e] pb-8 pt-5 px-5 mt-auto rounded-t-3xl border-t border-white/5">
          <div className="flex items-center justify-between mb-5">
             <div className="flex items-center gap-3">
                <Image src="/images/Stickers/USDT.png" alt="USDT" width={40} height={40} className="rounded-full" />
                <div>
                  <p className="text-white text-[15px] font-medium mb-0.5">Balance: {(usdtValue || 0).toFixed(2)} USDT</p>
                  <button className="text-blue-400 font-medium text-[14px] flex items-center hover:text-blue-300 transition-colors">
                    Choose asset <ChevronRight className="w-4 h-4 ml-0.5"/>
                  </button>
                </div>
             </div>
             <button onClick={() => setWithdrawAmount((usdtValue || 0).toFixed(2))} className="bg-[#2c2c2e] hover:bg-[#3c3c3e] active:scale-95 transition-all text-blue-400 px-4 py-2 rounded-full font-semibold text-[15px]">
               Max
             </button>
          </div>
          <button className={\`w-full py-4 rounded-2xl font-semibold text-[17px] transition-all \${
            parseFloat(withdrawAmount) > 0 && parseFloat(withdrawAmount) <= usdtValue
            ? 'bg-white text-black hover:bg-gray-200 active:scale-[0.98]'
            : 'bg-[#2c2c2e] text-white/30 cursor-not-allowed'
          }\`}>
            Continue
          </button>
        </div>
      </div>
    )
  }

`;

const splitA = content.split(startStr);
const splitB = splitA[1].split(endStr);
const finalContent = splitA[0] + newContent + "  return (\n    <div className=\"min-h-screen bg-[#131313] flex flex-col\">" + splitB[1];

fs.writeFileSync('app/dashboard/wallet/page.tsx', finalContent);
