const replies = [
  "{caller} TOUCH GRASS, NOT ABRA, YOU HORNY LITTLE SHIT. AND TRY NOT TO MAKE IT WEIRD FOR THE GRASS.",
  "ABRA TOOK ONE FUCKING BLINKER AND NOW HE’S PITCHING A BUNDLE TO THE FRIDGE.",
  "{caller} YOU’RE PAID TO MANAGE CLIENT LIQUIDITY, NOT DIDDY THE FUCKING TEAM TELEGRAM BOT. EYES ON THE CHARTS, HANDS OFF ABRA.",
] as const

// Each chat gets the full rotation independently; a restart begins at reply one.
const nextReplyByChat = new Map<string, number>()

export function nextTouchAbraReply(chatId: number | string, caller: string) {
  const key = String(chatId)
  const index = nextReplyByChat.get(key) ?? 0
  nextReplyByChat.set(key, (index + 1) % replies.length)
  return replies[index].replace("{caller}", () => caller)
}
