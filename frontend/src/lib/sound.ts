export function playNotificationChime(): void {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return

    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()

    // Soft "ding": quick attack, short decay
    osc.type = 'sine'
    osc.frequency.value = 880

    const now = ctx.currentTime
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25)

    osc.connect(gain)
    gain.connect(ctx.destination)

    osc.start(now)
    osc.stop(now + 0.27)

    osc.onended = () => {
      try {
        ctx.close()
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore (autoplay policies, unsupported)
  }
}
